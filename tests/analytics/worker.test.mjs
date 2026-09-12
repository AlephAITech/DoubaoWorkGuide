import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { hashPassword } from '../../analytics/crypto.mjs';

let mf,db,adminCookie,adminCsrf;
const password='integration-only-long-random-password-12345';
const origin='http://localhost';
before(async()=>{
  const result=await build({entryPoints:['analytics/worker.mjs'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:*']});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-09-12',compatibilityFlags:['nodejs_compat'],cf:false,
    bindings:{ENVIRONMENT:'local',LOCAL_TEST:'true',ALLOWED_HOSTS:'localhost',ADMIN_USERNAME:'admin',ADMIN_PASSWORD_HASH:await hashPassword(password),SIGNING_KEY:'a'.repeat(48),IP_ENCRYPTION_KEY:'b'.repeat(48),MAX_EVENTS_PER_MINUTE:'200',MAX_EVENTS_PER_DAY:'2000'},
    d1Databases:['DB'],durableObjects:{TRAFFIC_GATE:{className:'TrafficGate',useSQLite:true}}}));
  db=await mf.getD1Database('DB');
  const migration=await readFile('migrations/0001_analytics.sql','utf8');
  for(const statement of migration.split('-- statement-breakpoint').filter(s=>s.trim())) await db.prepare(statement).run();
});
after(async()=>{await mf?.dispose();});
const request=(path,{method='GET',cookie,body,headers={},ip='192.0.2.1'}={})=>mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{'CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const cookieOf=(response)=>response.headers.get('set-cookie')?.split(';')[0];
async function visitor(ip) {
 const res=await request('/api/analytics/session',{method:'POST',body:{},ip});
 assert.equal(res.status,200); const body=await res.json(); return {cookie:cookieOf(res),csrf:body.csrfToken};
}
test('anonymous/forged sessions cannot read dashboard, report, CSV or raw IP',async()=>{
 for(const path of ['/api/admin/report','/api/admin/export','/api/admin/history']) assert.equal((await request(path)).status,401,path);
 assert.equal((await request('/admin/analytics')).status,302);
 assert.equal((await request('/api/admin/report',{cookie:'__Host-dwg_admin=forged'})).status,401);
 assert.equal((await request('/api/admin/reveal',{method:'POST',body:{key:'x'}})).status,401);
});
test('login rejects cross-origin requests and wrong password; authenticated data is never publicly cached',async()=>{
 assert.equal((await request('/api/admin/login',{method:'POST',body:{username:'admin',password},headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await request('/api/admin/login',{method:'POST',body:{username:'admin',password:'wrong'}})).status,401);
 const res=await request('/api/admin/login',{method:'POST',body:{username:'admin',password}});
 assert.equal(res.status,200); adminCookie=cookieOf(res);
 assert.match(res.headers.get('set-cookie'),/HttpOnly/);assert.match(res.headers.get('set-cookie'),/Secure/);assert.match(res.headers.get('set-cookie'),/SameSite=Strict/);
 const report=await request('/api/admin/report',{cookie:adminCookie});
 assert.equal(report.status,200);assert.match(report.headers.get('cache-control'),/no-store/);
 adminCsrf=(await report.json()).csrfToken; assert.ok(adminCsrf);
 const html=await request('/admin/analytics',{cookie:adminCookie});assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('real D1/DO collection rejects forged events and atomically deduplicates concurrent retries',async()=>{
 const one=await visitor('198.51.100.1'),two=await visitor('198.51.100.1');
 const event={eventId:crypto.randomUUID(),page:'/intro',ip:'1.1.1.1'};
 assert.equal((await request('/api/analytics/event',{method:'POST',body:event,cookie:one.cookie,ip:'198.51.100.1'})).status,403);
 assert.equal((await request('/api/analytics/event',{method:'POST',body:{...event,page:'/p/nonexistent'},cookie:one.cookie,ip:'198.51.100.1',headers:{'X-Analytics-CSRF':one.csrf}})).status,400);
 const responses=await Promise.all(Array.from({length:3},()=>request('/api/analytics/event',{method:'POST',body:event,cookie:one.cookie,ip:'198.51.100.1',headers:{'X-Analytics-CSRF':one.csrf}})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,202]);
 assert.equal((await request('/api/analytics/event',{method:'POST',body:{eventId:crypto.randomUUID(),page:'/toc'},cookie:two.cookie,ip:'198.51.100.1',headers:{'X-Analytics-CSRF':two.csrf}})).status,202);
 const report=await(await request('/api/admin/report',{cookie:adminCookie})).json();
 assert.equal(report.summary.pv,2);assert.equal(report.summary.uv,2);assert.equal(report.summary.ips,1);
 assert.ok(!JSON.stringify(report).includes('198.51.100.1"'));
 assert.equal((await request('/api/admin/reveal',{method:'POST',cookie:adminCookie,body:{key:report.ips[0].key}})).status,403);
 const reveal=await request('/api/admin/reveal',{method:'POST',cookie:adminCookie,body:{key:report.ips[0].key},headers:{'X-CSRF-Token':adminCsrf}});
 assert.equal(reveal.status,200);assert.equal((await reveal.json()).ip,'198.51.100.1');
});
test('same browser switching IP remains one UV; administrators are excluded from collection',async()=>{
 const v=await visitor('203.0.113.1');
 for(const ip of ['203.0.113.1','203.0.113.2']) assert.equal((await request('/api/analytics/event',{method:'POST',cookie:v.cookie,body:{eventId:crypto.randomUUID(),page:'/'},ip,headers:{'X-Analytics-CSRF':v.csrf}})).status,202);
 const report=await(await request('/api/admin/report',{cookie:adminCookie})).json();
 assert.equal(report.summary.pv,4);assert.equal(report.summary.uv,3);assert.equal(report.summary.ips,3);
  assert.equal((await request('/api/analytics/session',{method:'POST',body:{},cookie:adminCookie})).status,204);
});
test('site opt-out cookie stops collection and can be cleared again',async()=>{
  const out=await request('/api/analytics/opt-out',{method:'POST',body:{}});
  assert.equal(out.status,303);assert.equal(out.headers.get('location'),'/privacy?status=disabled');
  const optout=cookieOf(out);assert.match(optout,/__Host-dwg_analytics_optout=1/);
  assert.equal((await request('/api/analytics/session',{method:'POST',body:{},cookie:optout})).status,204);
  const restore=await request('/api/analytics/opt-in',{method:'POST',body:{},cookie:optout});
  assert.equal(restore.status,303);assert.match(restore.headers.get('set-cookie'),/Max-Age=0/);
});
test('rotating IPs cannot bypass visitor velocity or the globally coordinated request budget',async()=>{
 const gate=await mf.getDurableObjectNamespace('TRAFFIC_GATE');const stub=gate.get(gate.idFromName('test-budget'));
 const call=(body)=>stub.fetch('http://gate/',{method:'POST',body:JSON.stringify(body)}).then(r=>r.json());
 for(let n=0;n<30;n++) assert.equal((await call({action:'event',ip:'ip'+n,visitor:'same-visitor',proof:false})).allowed,true);
 const limited=await call({action:'event',ip:'new-ip',visitor:'same-visitor',proof:false});
 assert.equal(limited.challenge,true);
 for(let n=0;n<200;n++) await call({action:'event',ip:'pool'+n,visitor:'v'+n,proof:true});
 assert.equal((await call({action:'event',ip:'last-ip',visitor:'last-v',proof:true})).allowed,false);
});
test('logout requires CSRF and revokes server-side session immediately',async()=>{
 assert.equal((await request('/api/admin/logout',{method:'POST',cookie:adminCookie,body:{}})).status,403);
 const out=await request('/api/admin/logout',{method:'POST',cookie:adminCookie,body:{},headers:{'X-CSRF-Token':adminCsrf}});
 assert.equal(out.status,200); assert.equal((await request('/api/admin/report',{cookie:adminCookie})).status,401);
});
