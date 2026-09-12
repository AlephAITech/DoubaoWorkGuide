// Run against `npm run analytics:dev`. Writes only local test traffic.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin='http://localhost:8787';
const login=await readFile('.secrets/local-login.txt','utf8');
const password=login.match(/^密码：(.+)$/m)?.[1];assert.ok(password,'Run npm run analytics:setup first');
await mkdir('.work/analytics',{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const adminContext=await browser.createBrowserContext(),visitorContext=await browser.createBrowserContext();
  const admin=await adminContext.newPage(),visitor=await visitorContext.newPage();
  await admin.setViewport({width:1440,height:1100});
  await admin.goto(origin+'/admin/analytics');assert.match(admin.url(),/\/admin\/login$/);
  assert.equal(await admin.evaluate(()=>fetch('/api/admin/report').then(r=>r.status)),401);
  await admin.waitForFunction(()=>!document.querySelector('#login-submit').disabled);
  await admin.screenshot({path:'.work/analytics/login.png',fullPage:true});
  await admin.type('#username','admin');await admin.type('#password',password);
  await Promise.all([admin.waitForNavigation(),admin.click('#login-submit')]);
  await admin.waitForFunction(()=>document.querySelector('#metric-pv').textContent!=='—');
  const report=()=>admin.evaluate(()=>fetch('/api/admin/report').then(r=>r.json()));
  const before=await report();
  await visitor.setUserAgent((await browser.userAgent()).replace('HeadlessChrome','Chrome'));
  const errors=[];visitor.on('pageerror',e=>errors.push(e.message));
  const routes=['/','/toc','/p/5828287b3f6d6835'];
  for(const route of routes) {
    const event=visitor.waitForResponse(r=>new URL(r.url()).pathname==='/api/analytics/event'&&r.status()===202);
    await visitor.goto(origin+'/#'+route,{waitUntil:'domcontentloaded'});await event;
  }
  const after=await report();
  assert.equal(after.summary.pv-before.summary.pv,3);
  assert.equal(after.summary.uv-before.summary.uv,1);
  assert.equal(after.summary.ips,1,'All local browser traffic shares loopback IP');
  assert.deepEqual(errors,[]);
  await admin.reload({waitUntil:'networkidle0'});
  await admin.screenshot({path:'.work/analytics/dashboard-desktop.png',fullPage:true});
  await admin.setViewport({width:390,height:844});
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await admin.screenshot({path:'.work/analytics/dashboard-mobile.png',fullPage:true});
  const csv=await admin.evaluate(()=>fetch('/api/admin/export').then(async r=>({status:r.status,type:r.headers.get('content-type'),body:await r.text()})));
  assert.equal(csv.status,200);assert.match(csv.type,/text\/csv/);assert.match(csv.body,/独立 IP/);
  await admin.goto(origin+'/#/intro');
  await admin.waitForSelector('#app:not([hidden])');
  await admin.waitForNetworkIdle();
  assert.equal((await report()).summary.pv,after.summary.pv,'Administrator browsing is excluded');
  const privacyContext=await browser.createBrowserContext(),privatePage=await privacyContext.newPage();let collections=0;
  await privatePage.evaluateOnNewDocument(()=>Object.defineProperty(navigator,'globalPrivacyControl',{value:true}));
  privatePage.on('request',r=>{if(r.url().includes('/api/analytics/'))collections++;});
  await privatePage.goto(origin+'/#/');await privatePage.waitForSelector('#app:not([hidden])');await privatePage.waitForNetworkIdle();assert.equal(collections,0);
  const failureContext=await browser.createBrowserContext(),failurePage=await failureContext.newPage();
  await failurePage.setRequestInterception(true);failurePage.on('request',r=>r.url().includes('/api/analytics/')?r.abort():r.continue());
  const failureErrors=[];failurePage.on('pageerror',e=>failureErrors.push(e.message));
  await failurePage.goto(origin+'/#/p/5828287b3f6d6835');await failurePage.waitForSelector('.article__body-frame');
  await failurePage.evaluate(()=>{location.hash='/toc';});await failurePage.waitForSelector('.toc');assert.deepEqual(failureErrors,[]);
  await admin.goto(origin+'/admin/analytics');await admin.waitForFunction(()=>document.querySelector('#metric-pv').textContent!=='—');
  await Promise.all([admin.waitForNavigation(),admin.click('#logout')]);
  assert.equal(await admin.evaluate(()=>fetch('/api/admin/report').then(r=>r.status)),401);
  const result={status:'PASS',environment:'local',newPv:3,newUv:1,localUniqueIPs:1,anonymousDenied:true,logoutRevoked:true,adminExcluded:true,gpcExcluded:true,readingWithCollectorUnavailable:true,mobileOverflow:false};
  await writeFile('.work/analytics/browser-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
