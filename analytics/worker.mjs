import { AnalyticsStore, DAY, shanghaiDay, parseRange, csv } from './store.mjs';
import { canonicalIP, maskedIP, randomToken, fingerprint, signToken, readToken, verifyPassword, encryptIP, decryptIP } from './crypto.mjs';
import { renderLogin, renderDashboard, ADMIN_JS, ADMIN_CSS } from './admin-ui.mjs';
import siteIndex from '../site/content/site-index.json';
export { TrafficGate } from './guard.mjs';

const pages=new Map([['/','首页'],['/intro','导读'],['/toc','目录'],...siteIndex.documents.map(d=>[`/p/${d.nodeToken.replace(/^doc-/,'')}`,d.title])]);
const ADMIN_COOKIE='__Host-dwg_admin',VISITOR_COOKIE='__Host-dwg_visitor',OPTOUT_COOKIE='__Host-dwg_analytics_optout';
const CSP="default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const cookie=(name,value,maxAge,sameSite='Strict')=>`${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
function cookies(request) { return Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(p=>p.trim().split(/=(.*)/s).slice(0,2)).filter(p=>p.length===2)); }
function output(body,status=200,type='application/json; charset=utf-8',headers={}) {
  return new Response(type.startsWith('application/json')?JSON.stringify(body):body,{status,headers:{'Content-Type':type,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':CSP,'Permissions-Policy':'camera=(), microphone=(), geolocation=()',...headers}});
}
const error=(message,status)=>output({error:message},status);
function local(request,env) { return env.ENVIRONMENT==='local'&&env.LOCAL_TEST==='true'&&['localhost','127.0.0.1'].includes(new URL(request.url).hostname); }
function ready(request,env) {
  return env.DB&&env.TRAFFIC_GATE&&env.ADMIN_USERNAME&&env.ADMIN_PASSWORD_HASH&&env.SIGNING_KEY?.length>=32&&env.IP_ENCRYPTION_KEY?.length>=32
    &&(local(request,env)||(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY&&!/^[123]x0{18,}/.test(env.TURNSTILE_SITE_KEY)));
}
function allowedHost(request,env) { return (env.ALLOWED_HOSTS||'').split(',').map(v=>v.trim()).includes(new URL(request.url).hostname); }
function sameOrigin(request) {
  const origin=request.headers.get('Origin');
  return origin===new URL(request.url).origin && !['cross-site','none'].includes(request.headers.get('Sec-Fetch-Site'));
}
function clientIP(request,env) {
  const value=env.PSEUDO_IPV4==='overwrite'?request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP'):request.headers.get('CF-Connecting-IP');
  return canonicalIP(value);
}
async function boundedJSON(request) {
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('仅接受 JSON');
  if(Number(request.headers.get('Content-Length')||0)>4096) throw new Error('请求内容过大');
  const reader=request.body?.getReader();if(!reader) throw new Error('缺少请求内容');
  let size=0;const chunks=[];
  try {
    while(true) { const {done,value}=await reader.read();if(done) break;size+=value.byteLength;if(size>4096) {await reader.cancel();throw new Error('请求内容过大');}chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder().decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('请求格式不正确');return value;
}
async function gate(env,data) {
  const stub=env.TRAFFIC_GATE.get(env.TRAFFIC_GATE.idFromName('site'));
  const response=await stub.fetch('https://gate/',{method:'POST',body:JSON.stringify(data)});
  if(!response.ok)throw new Error('Gate unavailable');return response.json();
}
async function adminSession(request,env,store) {
  const raw=cookies(request)[ADMIN_COOKIE];if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
  const digest=await fingerprint('admin-session',raw,env.SIGNING_KEY);
  const session=await store.session(digest);return session?{...session,digest}:null;
}
async function turnstile(request,env,token,action) {
  if(local(request,env)) return true;
  if(typeof token!=='string'||token.length>2048||!token||!env.TURNSTILE_SECRET_KEY) return false;
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:clientIP(request,env)}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)return false;const data=await response.json();
  return data.success===true && data.hostname===new URL(request.url).hostname && data.action===action;
}
function source(raw,hostname) {
  if(typeof raw!=='string'||raw.length>500)return 'direct';
  try { const u=new URL(raw.includes('://')?raw:`https://${raw}`);return /^https?:$/.test(u.protocol)&&u.hostname!==hostname?u.hostname.slice(0,253):'direct'; }catch{return 'direct';}
}
const device=(ua)=>/bot|crawler|spider|headless/i.test(ua)?'bot':/iPad|Tablet/i.test(ua)?'tablet':/Mobile|Android|iPhone/i.test(ua)?'mobile':'desktop';
async function rateResponse(store,result,env) {
  if(result.sample)await store.security(result.reason,'共享限额或异常行为触发；重复请求按分钟合并记录');
  return result.challenge?output({challengeRequired:true,siteKey:env.TURNSTILE_SITE_KEY||'',error:'请完成访问验证'},403):output({error:'请求过于频繁，请稍后再试'},429,undefined,{'Retry-After':'60'});
}
async function handler(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/privacy') return output(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>访问统计说明</title><link rel="stylesheet" href="/admin/style.css"><main class="dashboard"><h1>访问统计说明</h1><p>本站使用第一方假名化 Cookie，统计页面浏览、浏览器访客和独立出口 IP。不会跨网站追踪或读取你的身份信息。</p><p>浏览记录和去重标识保留 90 天，日汇总保留 12 个月；完整 IP 加密保存并仅在最近 7 天的访问明细中供管理员查看。UV 是浏览器标识的去重估计，不代表自然人数。</p><p>疑似自动访问可能需要 Cloudflare Turnstile 验证，可跳过验证继续阅读，相关事件不纳入有效浏览。</p><p>启用 Global Privacy Control 的浏览器不会被采集。也可以使用下面的站内开关；退出设置保存一年，并可随时恢复。</p>${url.searchParams.get('status')==='disabled'?'<p><strong>当前浏览器已退出访问统计。</strong></p>':url.searchParams.get('status')==='enabled'?'<p><strong>当前浏览器已恢复访问统计。</strong></p>':''}<form method="post" action="/api/analytics/opt-out"><button type="submit">停止统计此浏览器</button></form><form method="post" action="/api/analytics/opt-in"><button type="submit">恢复统计此浏览器</button></form><p><a href="/">返回阅读</a></p></main></html>`,200,'text/html; charset=utf-8');
  if(!path.startsWith('/api/')&&!path.startsWith('/admin'))return env.ASSETS?env.ASSETS.fetch(request):error('未找到页面',404);
  if(!allowedHost(request,env))return error('未找到页面',404);
  if(request.method==='OPTIONS')return error('不支持跨域访问',403);
  if(['GET','HEAD'].includes(request.method)&&path==='/admin/style.css')return output(ADMIN_CSS,200,'text/css; charset=utf-8');
  if(['GET','HEAD'].includes(request.method)&&path==='/admin/app.js')return output(ADMIN_JS,200,'text/javascript; charset=utf-8');
  if(!ready(request,env))return error('统计服务尚未完成配置，请联系部署管理员',503);
  if(request.method!=='GET'&&request.method!=='POST')return error('不支持此请求方法',405);
  if(request.method==='POST'&&!sameOrigin(request))return error('请求来源不受信任',403);
  const store=new AnalyticsStore(env.DB),ip=clientIP(request,env);
  if(!ip)return error('无法验证请求来源',503);
  const ipKey=await fingerprint('ip',ip,env.SIGNING_KEY);
  const requestLimit=await gate(env,{action:'request',ip:ipKey});
  if(!requestLimit.allowed)return rateResponse(store,requestLimit,env);
  if(path==='/api/analytics/opt-out'&&request.method==='POST')return output('',303,'text/plain; charset=utf-8',{'Location':'/privacy?status=disabled','Set-Cookie':cookie(OPTOUT_COOKIE,'1',365*86400,'Lax')});
  if(path==='/api/analytics/opt-in'&&request.method==='POST')return output('',303,'text/plain; charset=utf-8',{'Location':'/privacy?status=enabled','Set-Cookie':cookie(OPTOUT_COOKIE,'',0,'Lax')});
  if(path==='/api/admin/config'&&request.method==='GET')return output({siteKey:env.TURNSTILE_SITE_KEY||'',environment:env.ENVIRONMENT});
  if(path==='/admin/login'&&request.method==='GET')return output(renderLogin({siteKey:env.TURNSTILE_SITE_KEY,environment:env.ENVIRONMENT}),200,'text/html; charset=utf-8');
  if(path==='/api/admin/login'&&request.method==='POST') {
    const limit=await gate(env,{action:'login',ip:ipKey});if(!limit.allowed)return rateResponse(store,limit,env);
    const body=await boundedJSON(request);
    if(!await turnstile(request,env,body.turnstileToken,'admin_login'))return output({error:'请先完成人机验证',challengeRequired:true,siteKey:env.TURNSTILE_SITE_KEY||''},403);
    const passwordValid=await verifyPassword(body.password,env.ADMIN_PASSWORD_HASH);
    if(!passwordValid||body.username!==env.ADMIN_USERNAME) {await store.security('login_failed','管理员登录失败');return error('账号或密码不正确',401);}
    const previous=await adminSession(request,env,store);if(previous)await store.revokeSession(previous.digest);
    const raw=randomToken(),csrf=randomToken();
    await store.createSession(await fingerprint('admin-session',raw,env.SIGNING_KEY),csrf,Date.now()+8*3600000);
    await store.security('login_success','管理员已登录');
    return output({ok:true},200,undefined,{'Set-Cookie':cookie(ADMIN_COOKIE,raw,8*3600)});
  }
  if(path.startsWith('/admin')||path.startsWith('/api/admin/')) {
    const session=await adminSession(request,env,store);
    if(!session)return path.startsWith('/admin')?output('',302,'text/plain',{Location:'/admin/login'}):error('请先登录',401);
    if(request.method==='POST'&&request.headers.get('X-CSRF-Token')!==session.csrf)return error('登录校验已失效，请刷新页面',403);
    if(path==='/admin/analytics'&&request.method==='GET')return output(renderDashboard({username:env.ADMIN_USERNAME,environment:env.ENVIRONMENT}),200,'text/html; charset=utf-8');
    if(path==='/api/admin/logout'&&request.method==='POST') {await store.revokeSession(session.digest);return output({ok:true},200,undefined,{'Set-Cookie':cookie(ADMIN_COOKIE,'',0)});}
    if(path==='/api/admin/reveal'&&request.method==='POST') {
      const {key}=await boundedJSON(request);if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return error('记录无效',400);
      const value=await store.ip(key);if(!value)return error('原始 IP 已超过 7 天保留期或尚未保存',404);
      const raw=await decryptIP(value.encrypted,env.IP_ENCRYPTION_KEY);
      await store.security('ip_reveal',`管理员查看 IP 记录 ${key.slice(0,12)}`);
      return output({ip:raw,expiresAt:new Date(Date.parse(value.last_seen)+7*DAY).toISOString()});
    }
    if(path==='/api/admin/history'&&request.method==='GET')return output({daily:await store.history(),note:'历史日汇总不包含跨日去重 UV/IP'});
    if(['/api/admin/report','/api/admin/export'].includes(path)&&request.method==='GET') {
      const range=parseRange(url.searchParams.get('from'),url.searchParams.get('to'));
      const report=await store.report(range);
      if(path.endsWith('/export'))return output(csv([['日期（北京时间）','PV','有效 PV','UV','独立 IP'],...report.daily.map(d=>[d.date,d.pv,d.validPv,d.uv,d.ips])]),200,'text/csv; charset=utf-8',{'Content-Disposition':`attachment; filename="doubao-traffic-${range.from}-${range.to}.csv"`});
      report.pages=report.pages.map(row=>({...row,title:pages.get(row.page)||row.page}));
      return output({...report,environment:env.ENVIRONMENT,username:env.ADMIN_USERNAME,csrfToken:session.csrf,timezone:'Asia/Shanghai',updatedAt:new Date().toISOString(),health:{retentionDays:90,edgeConnected:false,edgeUrl:'https://dash.cloudflare.com/',collectionStartedAt:report.collectionStartedAt}});
    }
    return error('未找到页面',404);
  }
  if(!['/api/analytics/session','/api/analytics/event'].includes(path)||request.method!=='POST')return error('未找到页面',404);
  if(request.headers.get('Sec-GPC')==='1'||cookies(request)[OPTOUT_COOKIE]==='1'||await adminSession(request,env,store))return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Set-Cookie':cookie(VISITOR_COOKIE,'',0,'Lax')}});
  const body=await boundedJSON(request),ua=request.headers.get('User-Agent')||'';
  const bot=/bot|crawler|spider|headless|curl|wget|python/i.test(ua);
  const existing=await readToken(cookies(request)[VISITOR_COOKIE],env.SIGNING_KEY,'visitor');
  if(path.endsWith('/session')) {
    const checked=body.turnstileToken?await turnstile(request,env,body.turnstileToken,'analytics_session'):false;
    if(body.turnstileToken&&!checked)return output({challengeRequired:true,siteKey:env.TURNSTILE_SITE_KEY||'',error:'验证失败，请重试'},403);
    const proof=checked||!!(existing?.proofUntil>Date.now());
    const limit=await gate(env,{action:'session',ip:ipKey,proof,bot});if(!limit.allowed)return rateResponse(store,limit,env);
    const visitor={type:'visitor',id:existing?.id||randomToken(),csrf:existing?.csrf||randomToken(),exp:Date.now()+90*DAY,proofUntil:checked?Date.now()+30*60000:existing?.proofUntil||0};
    return output({csrfToken:visitor.csrf,siteKey:env.TURNSTILE_SITE_KEY||'',challengeRequired:false},200,undefined,{'Set-Cookie':cookie(VISITOR_COOKIE,await signToken(visitor,env.SIGNING_KEY),90*86400,'Lax')});
  }
  if(!existing||request.headers.get('X-Analytics-CSRF')!==existing.csrf)return error('访问会话已失效',403);
  if(typeof body.eventId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId)||!pages.has(body.page))return error('浏览事件格式不正确',400);
  const visitor=await fingerprint('visitor',existing.id,env.SIGNING_KEY);
  const limit=await gate(env,{action:'event',ip:ipKey,visitor,proof:existing.proofUntil>Date.now(),bot});if(!limit.allowed)return rateResponse(store,limit,env);
  const now=new Date(),time=now.toISOString();
  // Bind the UUID to the server-signed visitor to prevent cross-visitor replay.
  const id=await fingerprint('event',`${existing.id}:${body.eventId}`,env.SIGNING_KEY);
  const accepted=await store.record({id,time,day:shanghaiDay(now),page:body.page,visitor,ip:ipKey,quality:limit.quality,referrer:source(body.referrer,url.hostname),country:request.cf?.country||'未知',device:device(ua)});
  if(!accepted)return output({duplicate:true},200);
  await store.saveIP({key:ipKey,masked:maskedIP(ip),encrypted:await encryptIP(ip,env.IP_ENCRYPTION_KEY),time});
  return output({accepted:true,quality:limit.quality},202);
}
export default {
  async fetch(request,env) {
    try { return await handler(request,env); }
    catch(e) {
      if(e instanceof SyntaxError||['仅接受 JSON','请求内容过大','缺少请求内容','请求格式不正确','日期格式不正确','请选择近 90 天内的有效日期范围'].includes(e.message))return error(e.message,400);
      console.error('analytics request failed',e.name);return error('统计服务暂时不可用，阅读不受影响',503);
    }
  },
  async scheduled(controller,env,ctx) {ctx.waitUntil(new AnalyticsStore(env.DB).cleanup(new Date(controller.scheduledTime)));},
};
