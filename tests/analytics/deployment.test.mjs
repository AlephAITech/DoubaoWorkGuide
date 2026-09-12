import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { configure } from '../../tools/analytics/configure-preview.mjs';
import { hashPassword } from '../../analytics/crypto.mjs';

test('preview configuration cannot target production routes or carry local verification bypass', async()=>{
  const base=JSON.parse(await readFile('wrangler.analytics.jsonc','utf8'));
  base.routes=['production.example/*'];
  const values={accountId:'a'.repeat(32),databaseId:'a1234567-1234-1234-1234-123456789012',host:'doubao-analytics-preview.example.workers.dev',siteKey:'real-looking-site-key-for-test'};
  const config=configure(base,values);
  assert.equal(config.vars.ENVIRONMENT,'preview');assert.equal(config.vars.LOCAL_TEST,undefined);assert.equal(config.routes,undefined);
  assert.equal(base.vars.LOCAL_TEST,'true');
  for(const replacement of [{host:'doubaowork.homes'},{databaseId:'00000000-0000-0000-0000-000000000001'},{siteKey:'1x00000000000000000000AA'},{siteKey:'2x00000000000000000000AB'},{siteKey:'3x00000000000000000000FF'}]) assert.throws(()=>configure(base,{...values,...replacement}));
});

test('production configuration only claims analytics paths and cannot serve a workers.dev preview', async()=>{
  const config=JSON.parse(await readFile('wrangler.analytics.production.jsonc','utf8'));
  assert.equal(config.name,'doubao-analytics');
  assert.equal(config.vars.ENVIRONMENT,'production');
  assert.equal(config.vars.LOCAL_TEST,undefined);
  assert.equal(config.vars.ALLOWED_HOSTS,'doubaowork.homes');
  assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
  assert.equal(config.assets,undefined,'ordinary pages and assets must continue through Pages');
  assert.deepEqual(config.routes.map(route=>route.pattern),[
    'doubaowork.homes/api/analytics/*',
    'doubaowork.homes/api/admin/*',
    'doubaowork.homes/admin*',
    'doubaowork.homes/privacy*',
  ]);
});

test('public hosts fail closed and real-mode login verifies Turnstile hostname/action/result',async()=>{
  const bundle=await build({entryPoints:['analytics/worker.mjs'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:*']});
  const password='integration-only-high-entropy-secret-12345';
  const bindings={ENVIRONMENT:'preview',LOCAL_TEST:'true',ALLOWED_HOSTS:'preview.example',ADMIN_USERNAME:'admin',ADMIN_PASSWORD_HASH:await hashPassword(password),SIGNING_KEY:'a'.repeat(48),IP_ENCRYPTION_KEY:'b'.repeat(48),TURNSTILE_SITE_KEY:'real-looking-site-key-for-test',TURNSTILE_SECRET_KEY:'real-looking-secret-key-for-test'};
  let answer={success:true,hostname:'preview.example',action:'admin_login'},calls=0;
  const options=(vars)=>convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-12',compatibilityFlags:['nodejs_compat'],cf:false,bindings:vars,d1Databases:['DB'],durableObjects:{TRAFFIC_GATE:{className:'TrafficGate',useSQLite:true}},outboundService:async request=>{
    assert.equal(request.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');calls++;
    return Response.json(answer);
  }});
  const mf=new Miniflare(options(bindings));
  try {
    const db=await mf.getD1Database('DB');
    for(const statement of (await readFile('migrations/0001_analytics.sql','utf8')).split('-- statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
    const login=(token)=>mf.dispatchFetch('https://preview.example/api/admin/login',{method:'POST',headers:{Origin:'https://preview.example','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({username:'admin',password,turnstileToken:token})});
    assert.equal((await login()).status,403);assert.equal(calls,0);
    for(const invalid of [{success:false,hostname:'preview.example',action:'admin_login'},{success:true,hostname:'evil.example',action:'admin_login'},{success:true,hostname:'preview.example',action:'analytics_session'}]) {answer=invalid;assert.equal((await login('token')).status,403);}
    answer={success:true,hostname:'preview.example',action:'admin_login'};assert.equal((await login('token')).status,200);assert.equal(calls,4);
    assert.equal((await mf.dispatchFetch('https://other.example/api/admin/config')).status,404);
    for(const siteKey of ['','1x00000000000000000000AA','2x00000000000000000000AB','3x00000000000000000000FF']) {
      await mf.setOptions(options({...bindings,TURNSTILE_SITE_KEY:siteKey}));
      assert.equal((await mf.dispatchFetch('https://preview.example/api/admin/config')).status,503,siteKey);
    }
    await mf.setOptions(options({...bindings,ENVIRONMENT:'local',TURNSTILE_SITE_KEY:'',TURNSTILE_SECRET_KEY:''}));
    assert.equal((await mf.dispatchFetch('https://preview.example/api/admin/config')).status,503);
  } finally {await mf.dispose();}
});
