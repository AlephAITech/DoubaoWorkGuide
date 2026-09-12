import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { hashPassword, verifyPassword, signToken, readToken, fingerprint, encryptIP, decryptIP, canonicalIP } from '../../analytics/crypto.mjs';
import { AnalyticsStore, parseRange, shanghaiDay, csv } from '../../analytics/store.mjs';

// Real SQLite with the D1 call shape; SQL/uniqueness/transactions are not mocked.
export function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/0001_analytics.sql', import.meta.url), 'utf8'));
  return {
    sql,
    prepare(query) {
      const make = (params = []) => ({
        bind: (...values) => make(values),
        async first() { return sql.prepare(query).get(...params) ?? null; },
        async all() { return { results: sql.prepare(query).all(...params) }; },
        async run() { const r = sql.prepare(query).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
      });
      return make();
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const r = []; for (const s of statements) r.push(await s.run()); sql.exec('COMMIT'); return r; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

test('password hashes use random salt; wrong, malformed, empty passwords do not authenticate', async () => {
  const password = 'long-random-administrator-password-123!';
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword('', first), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
});
test('tokens reject tampering, expiry, wrong purpose and other keys', async () => {
  const token = await signToken({ type: 'visitor', id: '123', exp: 2000 }, 'test-secret');
  assert.equal((await readToken(token, 'test-secret', 'visitor', 1000)).id, '123');
  for (const [value,key,type,now] of [[token+'x','test-secret','visitor',1000],[token,'other','visitor',1000],[token,'test-secret','admin',1000],[token,'test-secret','visitor',2000]]) {
    assert.equal(await readToken(value,key,type,now), null);
  }
});
test('IPv6 aliases deduplicate, invalid IP is rejected, HMAC cannot be reused across purposes', async () => {
  assert.equal(canonicalIP('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(canonicalIP('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(canonicalIP('not-an-ip'), null);
  assert.notEqual(await fingerprint('ip','192.0.2.1','secret'), await fingerprint('visitor','192.0.2.1','secret'));
  const encoded = await encryptIP('192.0.2.1','a-private-encryption-key');
  assert.ok(!encoded.includes('192.0.2.1'));
  assert.equal(await decryptIP(encoded,'a-private-encryption-key'), '192.0.2.1');
  await assert.rejects(() => decryptIP(encoded, 'wrong'));
});
test('Shanghai boundaries and inclusive date ranges reject invalid/oversized input', () => {
  assert.equal(shanghaiDay(new Date('2026-09-11T16:00:00Z')), '2026-09-12');
  assert.equal(shanghaiDay(new Date('2026-09-11T15:59:59Z')), '2026-09-11');
  const now = new Date('2026-09-12T09:00:00Z');
  assert.deepEqual(parseRange('2026-09-11','2026-09-12',now), { from:'2026-09-11',to:'2026-09-12' });
  for (const [from,to] of [['2026-02-30','2026-09-12'],['2025-01-01','2026-09-12'],['2026-09-12','2026-09-11'],['2026-09-12','2026-09-13']]) assert.throws(() => parseRange(from,to,now));
});
test('SQL deduplicates retries and computes range visitors/IPs without summing daily distincts', async () => {
  const db=database(), store=new AnalyticsStore(db);
  const event=(id,day,visitor,ip,quality='valid')=>({id,time:`${day}T04:00:00.000Z`,day,page:'/intro',visitor,ip,quality,referrer:'direct',country:'CN',device:'desktop'});
  assert.equal(await store.record(event('a','2026-09-11','visitorA','ipA')),true);
  assert.equal(await store.record(event('a','2026-09-11','visitorA','ipA')),false);
  await store.record(event('b','2026-09-11','visitorB','ipA'));
  await store.record(event('c','2026-09-12','visitorA','ipB'));
  await store.record(event('d','2026-09-12','bot','botIP','suspicious'));
  const report=await store.report({from:'2026-09-11',to:'2026-09-12'});
  assert.equal(report.summary.pv,4); assert.equal(report.summary.validPv,3);
  assert.equal(report.summary.uv,2); assert.equal(report.summary.ips,2);
  assert.equal(report.summary.suspicious,1); assert.equal(report.summary.totalPv,4);
  assert.equal(report.daily[0].uv,2); assert.equal(report.daily[1].uv,1);
  assert.equal(report.pages[0].pv,3);
  db.sql.close();
});
test('cleanup removes expired detail and encrypted IP while retaining historical daily and total PV', async () => {
  const db=database(),store=new AnalyticsStore(db);
  await store.record({id:'old',time:'2026-05-01T00:00:00Z',day:'2026-05-01',page:'/',visitor:'v',ip:'i',quality:'valid',referrer:'direct',country:'CN',device:'desktop'});
  await store.saveIP({key:'i',masked:'192.0.2.*',encrypted:'encrypted',time:'2026-09-01T00:00:00Z'});
  await store.cleanup(new Date('2026-09-12T09:00:00Z'));
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM page_events').get().n,0);
  assert.equal(db.sql.prepare('SELECT pv FROM traffic_daily').get().pv,1);
  assert.equal(db.sql.prepare('SELECT pv FROM traffic_total').get().pv,1);
  assert.equal(db.sql.prepare('SELECT encrypted FROM ip_details').get().encrypted,null);
  db.sql.close();
});
test('admin sessions can be revoked and expire even if the cookie is retained', async () => {
  const db=database(),store=new AnalyticsStore(db);
  await store.createSession('digest','csrf',2000);
  assert.equal((await store.session('digest',1000)).csrf,'csrf');
  assert.equal(await store.session('digest',2000),null);
  await store.revokeSession('digest');
  assert.equal(await store.session('digest',1000),null);
  db.sql.close();
});
test('CSV neutralizes spreadsheet formulas, preserves commas/newlines and emits a header',()=>{
  const result=csv([['article','pv'],['=HYPERLINK("evil")',2],['a,b\nc',1]]);
  assert.ok(result.includes("'=HYPERLINK"));
  assert.ok(result.includes('"a,b\nc"'));
  assert.ok(result.startsWith('\uFEFF"article","pv"'));
});
