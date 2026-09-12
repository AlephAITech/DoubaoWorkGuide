import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderLogin, renderDashboard, ADMIN_JS} from '../../analytics/admin-ui.mjs';

test('untrusted identity and configuration cannot break out of HTML attributes or text', () => {
  const attack = '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  for (const html of [renderLogin({siteKey:attack,environment:attack}),renderDashboard({username:attack,environment:attack})]) {
    assert.ok(html.includes('&lt;'));
    assert.doesNotMatch(html, /<img|<script>alert/);
  }
});
test('public shells use external CSP-compatible resources and accessible form fields', () => {
  for (const html of [renderLogin({}),renderDashboard({})]) {
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /href="\/admin\/style.css"/);
    assert.match(html, /src="\/admin\/app.js"/);
    assert.doesNotMatch(html, / style=|<style|<script(?![^>]*src=)/);
  }
  assert.match(renderLogin({}), /autocomplete="current-password"/);
  assert.match(renderLogin({}), /autocomplete="username"/);
});
test('browser bundle parses without executing network operations on unrelated shells', () => {
  const script = new vm.Script(ADMIN_JS);
  script.runInNewContext({document:{body:{dataset:{page:'other'}}}});
});

test('Wrangler-style bundling keeps the browser program independent of Worker helpers', async()=>{
  const {build}=await import('esbuild');
  const bundled=await build({entryPoints:['analytics/admin-ui.mjs'],bundle:true,write:false,format:'esm',keepNames:true});
  const {ADMIN_JS:deployed}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  new vm.Script(deployed).runInNewContext({document:{body:{dataset:{page:'other'}}}});
});

test('real browser safely renders report, handles expired IP and sends CSRF on logout', async () => {
  const {createServer} = await import('node:http');
  const {default:puppeteer} = await import('puppeteer-core');
  const {ADMIN_CSS} = await import('../../analytics/admin-ui.mjs');
  const attack = '<img src=x onerror="window.pwned=true">';
  let revealHeaders, logoutHeaders, loginPayload;
  const server=createServer(async (req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/admin/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(ADMIN_JS);}
    if(path==='/admin/style.css'){res.setHeader('Content-Type','text/css');return res.end(ADMIN_CSS);}
    if(path==='/api/admin/config'){res.setHeader('Content-Type','application/json');return res.end('{"siteKey":"","environment":"test"}');}
    if(path==='/api/admin/login'){let body='';for await(const part of req)body+=part;loginPayload=JSON.parse(body);if(loginPayload.password!=='correct')res.statusCode=401;return res.end('{}');}
    if(path==='/api/admin/history'){return res.end(JSON.stringify({daily:[{date:'2025-10-01',pv:88,validPv:66}],note:'历史日汇总不包含跨日去重 UV/IP'}));}
    if(path==='/api/admin/report'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({username:attack,csrfToken:'test-csrf',environment:'preview',updatedAt:Date.now(),summary:{totalPv:1234,pv:2,validPv:1,uv:1,ips:1,suspicious:1},daily:[{date:'2026-09-12',pv:2,validPv:1}],pages:[{title:attack,page:'/p/a',pv:2,uv:1}],referrers:[{name:attack,count:2}],countries:[],devices:[],ips:[{key:'opaque',masked:'1.2.*.*',pv:2,visitors:1}],security:[{kind:attack,detail:attack}],health:{retentionDays:90,edgeUrl:'javascript:alert(1)'}}));}
    if(path==='/api/admin/reveal'){revealHeaders=req.headers;res.statusCode=404;return res.end('{}');}
    if(path==='/api/admin/logout'){logoutHeaders=req.headers;return res.end('{"ok":true}');}
    res.setHeader('Content-Type','text/html');res.end(path==='/admin/login'?renderLogin({}):renderDashboard({username:'admin'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port+'/admin/analytics');
    await page.waitForFunction(()=>document.querySelector('#metric-pv').textContent==='2');
    assert.equal(await page.$eval('#total-pv',el=>el.textContent),'累计 PV：1,234');
    assert.equal(await page.$eval('#collection-start',el=>el.textContent),'尚未采集');
    await page.click('#history-load');
    await page.waitForFunction(()=>document.querySelector('#history').textContent.includes('2025-10-01'));
    assert.match(await page.$eval('#history-status',el=>el.textContent),/不包含跨日去重/);
    assert.equal(await page.$eval('#metric-pv',el=>el.textContent),'2');
    assert.equal(await page.$eval('#pages',el=>el.textContent.includes('<img src=x')),true);
    assert.equal(await page.evaluate(()=>Boolean(window.pwned)),false);
    assert.equal(await page.$eval('#edge-link',el=>el.href),'https://dash.cloudflare.com/');
    assert.equal(await page.$eval('#chart svg',el=>el.getAttribute('role')),'img');
    await page.click('#ips button');
    await page.waitForFunction(()=>document.querySelector('#ips').textContent.includes('已过期'));
    assert.equal(revealHeaders['x-csrf-token'],'test-csrf');
    await page.setViewport({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await Promise.all([page.waitForNavigation(),page.click('#logout')]);
    assert.equal(logoutHeaders['x-csrf-token'],'test-csrf');
    assert.match(page.url(),/\/admin\/login$/);
    await page.waitForFunction(()=>!document.querySelector('#login-submit').disabled);
    await page.type('#username','admin');await page.type('#password','wrong');await page.click('#login-submit');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('账号或密码不正确'));
    await page.$eval('#password',el=>{el.value='correct';});
    await Promise.all([page.waitForNavigation(),page.click('#login-submit')]);
    assert.equal(loginPayload.username,'admin');assert.equal(loginPayload.password,'correct');
    assert.match(page.url(),/\/admin\/analytics$/);
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
});
