const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ADMIN_ASSET_VERSION = '20260912-turnstile-2';
const shell = (page, environment, content) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>豆包 · 私有统计</title><link rel="stylesheet" href="/admin/style.css?v=${ADMIN_ASSET_VERSION}"><script src="/admin/app.js?v=${ADMIN_ASSET_VERSION}" defer></script></head><body data-page="${page}"><header class="topbar"><a class="brand" href="/">豆包<span>工作蓝皮书 / 数据台</span></a><span class="environment">${esc(environment || '独立环境')}</span></header>${content}<footer>豆包工作蓝皮书 · 私有统计<span>日期以 Asia/Shanghai（北京时间）为准</span></footer></body></html>`;
export function renderLogin({siteKey = '', environment = ''} = {}) {
  return shell('login', environment, `<main class="login-layout"><section class="login-intro"><span class="eyebrow">PRIVATE ANALYTICS</span><h1>每一次阅读，<br>都值得被理解。</h1><p>从内容表现到访问质量，<br>在一个私有空间里，看见真实的阅读。</p><div class="intro-note">仅限管理员访问 · 无开放注册</div></section><section class="login-card"><h2>登录数据台</h2><p class="muted">使用管理员账号继续</p><form id="login-form"><label for="username">账号</label><input id="username" name="username" autocomplete="username" required maxlength="128"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><div id="turnstile-widget" data-site-key="${esc(siteKey)}"></div><p id="status" role="status" aria-live="polite"></p><button class="primary full" id="login-submit" type="submit" disabled>正在检查登录配置…</button></form><a class="back-link" href="/">← 返回工作蓝皮书</a></section></main>`);
}
const panel = (title, id, headers) => `<section class="panel"><h2>${title}</h2><div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody id="${id}"></tbody></table></div></section>`;
export function renderDashboard({username = '', environment = ''} = {}) {
  return shell('dashboard', environment, `<main class="dashboard"><div class="page-heading"><div><span class="eyebrow">READERSHIP OVERVIEW</span><h1>阅读概览</h1><p class="muted" id="updated">正在获取最新统计</p></div><div class="account"><span id="account-name">${esc(username)}</span><button id="logout" disabled>退出登录</button></div></div><form id="filters" class="filters"><div class="presets" aria-label="日期快捷选择"><button type="button" data-days="today">今日</button><button type="button" data-days="yesterday">昨日</button><button type="button" data-days="7" aria-pressed="true">近 7 天</button><button type="button" data-days="30">近 30 天</button></div><div class="date-range"><label>开始日期<input id="from" type="date" required></label><span>—</span><label>结束日期<input id="to" type="date" required></label><button class="primary" type="submit">查询</button></div><button id="export" type="button" disabled>导出 CSV ↗</button></form><p id="status" role="status" aria-live="polite">正在加载报表…</p><div id="report" aria-busy="true"><section class="metrics" aria-label="关键指标">${[['pv','浏览量 PV'],['validPv','有效 PV'],['uv','访客 UV'],['ips','独立 IP'],['suspicious','可疑 PV']].map(([id,label])=>`<article class="metric"><span>${label}</span><strong id="metric-${id}">—</strong></article>`).join('')}</section><p class="metric-note"><strong id="total-pv">累计 PV：—</strong> · 从采集开始，含可疑访问 · <span id="collection-start">正在读取采集状态</span></p><p class="metric-note">有效 PV 排除可疑事件，管理员不采集。UV 与独立 IP 按整个查询区间去重，不能将每日值直接相加。</p><section class="panel chart-panel"><div class="panel-heading"><h2>每日阅读趋势</h2><span class="legend">● PV <span>● 有效 PV</span></span></div><div id="chart"></div></section><section class="panel"><div class="panel-heading"><div><h2>历史日汇总</h2><p class="muted">近 12 个月，仅含每日 PV 与有效 PV；不包含跨日去重 UV / IP。</p></div><button id="history-load" type="button">查看历史日汇总</button></div><p id="history-status" role="status" aria-live="polite"></p><div id="history-wrap" class="table-scroll" hidden><table><thead><tr><th scope="col">日期</th><th scope="col">PV</th><th scope="col">有效 PV</th></tr></thead><tbody id="history"></tbody></table></div></section><div class="data-grid">${panel('文章表现','pages',['页面 / 文章','PV','UV'])}${panel('访问来源','referrers',['来源','访问量'])}${panel('地区分布','countries',['地区','访问量'])}${panel('设备分布','devices',['设备','访问量'])}</div>${panel('最近 7 天 IP 访问明细','ips',['IP（默认脱敏）','PV','访客','地区','最近访问','质量','操作'])}<p class="metric-note">无论所选报表范围，IP 明细仅包含最近 7×24 小时；更早事件不会重新关联完整 IP。完整 IP 不会出现在 CSV 中。</p>${panel('安全与运行记录','security',['时间','类型','说明'])}<aside class="edge-note"><strong>边缘安全数据未接入</strong><p>这里记录进入采集服务的访问。被 Cloudflare WAF 在边缘拦截的请求不包含在上方统计中。</p><a id="edge-link" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">打开 Cloudflare 安全面板 ↗</a><p id="retention" class="muted"></p></aside></div></main>`);
}
export const ADMIN_CSS = `
:root{color-scheme:light;--blue:#2563eb;--ink:#172b4d;--muted:#6b7b93;--line:#e4eaf3;--paper:#f5f8fd}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6}a{color:var(--blue);text-decoration:none}button,input{font:inherit}button{border:1px solid var(--line);border-radius:9px;padding:9px 15px;background:white;color:var(--ink);cursor:pointer;white-space:nowrap}button:hover{border-color:#91b5fa;background:#f3f7ff}button:disabled{opacity:.5;cursor:wait}button.primary{background:var(--blue);color:white;border-color:var(--blue)}input{border:1px solid #cbd6e8;border-radius:8px;background:white;color:var(--ink);padding:10px 12px;min-width:0}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #9bbffa;outline-offset:3px}.topbar{height:78px;display:flex;align-items:center;justify-content:space-between;padding:0 max(5vw,24px);border-bottom:1px solid var(--line);background:#fff}.brand{font-size:24px;font-weight:800;letter-spacing:-1px;color:var(--ink)}.brand span{font-size:13px;font-weight:500;letter-spacing:1px;margin-left:18px;color:var(--muted)}.environment{font-size:12px;background:#eaf1ff;color:#2458a8;padding:4px 11px;border-radius:5px}.dashboard{max-width:1440px;margin:auto;padding:46px max(4vw,20px) 28px}h1,h2,p{margin-top:0}h1{font-size:38px;line-height:1.25;letter-spacing:-1px;margin-bottom:12px}h2{font-size:17px;margin-bottom:20px;font-weight:650}.eyebrow{display:block;font-size:10px;letter-spacing:2.5px;color:var(--blue);font-weight:700;margin-bottom:14px}.muted{color:var(--muted)}.page-heading,.panel-heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.account{display:flex;align-items:center;gap:14px}.filters{display:flex;align-items:end;gap:20px;flex-wrap:wrap;margin:24px 0 0;padding:20px;background:#fff;border:1px solid var(--line);border-radius:12px}.presets{display:flex;gap:6px;flex-wrap:wrap}.presets button[aria-pressed=true]{background:#eaf1ff;border-color:#adc7fc;color:#174db8}.date-range{display:flex;align-items:end;gap:10px}.date-range label{font-size:11px;color:var(--muted);display:grid;gap:5px}.date-range input{font-size:13px;padding:8px}.date-range>span{padding-bottom:8px}#export{margin-left:auto}#status{min-height:25px;margin:14px 0;color:var(--muted)}#status[data-error=true]{color:#b63239}#report[aria-busy=true]{opacity:.5}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}.metric{padding:23px;background:white;border:1px solid var(--line);border-radius:12px;position:relative}.metric:first-child{background:var(--blue);color:white;border-color:var(--blue)}.metric span{font-size:12px;opacity:.8}.metric strong{display:block;font-family:"DIN Alternate","Avenir Next",sans-serif;font-size:38px;line-height:1.2;margin-top:18px;font-weight:600;letter-spacing:-1px}.metric-note{color:var(--muted);font-size:12px;margin:15px 0 24px}.panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:20px;min-width:0}.panel-heading h2{margin-bottom:0}.legend{font-size:12px;color:var(--blue)}.legend span{color:#23a5a2;margin-left:16px}#chart{min-height:220px}#chart svg{display:block;width:100%;height:250px;margin-top:18px}#chart svg text{font-size:11px;fill:#77869c}#chart .grid-line{stroke:#e8edf5}#chart .pv-line{stroke:var(--blue);stroke-width:3;fill:none}#chart .valid-line{stroke:#23a5a2;stroke-width:2;fill:none}#chart circle{fill:var(--blue)}.data-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:0 20px}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th{color:var(--muted);font-size:11px;font-weight:500;white-space:nowrap}td,th{padding:12px 12px 12px 0;border-bottom:1px solid #edf1f7;vertical-align:top}td{overflow-wrap:anywhere;max-width:440px}tbody tr:last-child td{border-bottom:0}td button{font-size:12px;padding:4px 9px}.empty{color:var(--muted);padding:35px 0;text-align:center}.edge-note{border-left:3px solid #8ab1f8;background:#eaf1ff;padding:20px 24px;font-size:13px;border-radius:0 10px 10px 0}.edge-note p{margin:8px 0}.edge-note strong{font-size:14px}footer{max-width:1440px;margin:20px auto;padding:20px max(4vw,20px);display:flex;justify-content:space-between;font-size:11px;color:var(--muted);border-top:1px solid var(--line)}.login-layout{max-width:1100px;min-height:75vh;margin:auto;display:grid;grid-template-columns:1.2fr 1fr;align-items:center;gap:80px;padding:60px 28px}.login-intro h1{font-size:48px;line-height:1.45;margin:24px 0}.login-intro p{font-size:16px;color:var(--muted);line-height:1.9}.intro-note{margin-top:56px;font-size:12px;color:var(--muted)}.login-card{background:white;border:1px solid var(--line);padding:38px;border-radius:18px;box-shadow:0 20px 65px #244e9d09}.login-card h2{font-size:24px;margin-bottom:8px}.login-card label{display:block;margin:20px 0 6px;font-size:12px}.login-card input{width:100%}.full{width:100%}.back-link{display:block;text-align:center;margin-top:24px;font-size:12px}#turnstile-widget{margin-top:20px;overflow:hidden}@media(max-width:900px){.metrics{grid-template-columns:repeat(3,1fr)}.data-grid{grid-template-columns:1fr}.login-layout{gap:30px}.login-intro h1{font-size:36px}.filters{gap:14px}.metric strong{font-size:32px}}@media(max-width:600px){.topbar{height:65px;padding:0 20px}.brand{font-size:21px}.brand span{font-size:10px;margin-left:10px}.dashboard{padding-top:30px}h1{font-size:32px}.page-heading{align-items:start;gap:8px}.account{flex-direction:column;align-items:end;font-size:12px;gap:6px}.metrics{grid-template-columns:repeat(2,1fr);gap:10px}.metric{padding:17px}.metric:first-child{grid-column:span 2}.metric strong{font-size:34px;margin-top:10px}.filters{padding:14px}.date-range{width:100%;gap:7px;flex-wrap:wrap}.date-range label{flex:1}.date-range input{width:100%}.date-range button{width:100%}#export{margin-left:0;width:100%}.panel{padding:18px}.legend{font-size:10px}.legend span{margin-left:8px}footer{display:block}footer span{display:block;margin-top:5px}.login-layout{display:block;min-height:0;padding:36px 20px}.login-intro h1{font-size:30px;margin:16px 0}.login-intro p,.intro-note{display:none}.login-card{padding:25px;margin-top:26px}}
`;
// Keep browser source literal: bundlers inject Worker-only helpers into function.toString().
export const ADMIN_JS = `(function browserApp() {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = (message, error = false) => { $('status').textContent = message; $('status').dataset.error = String(error); };
  async function request(url, options = {}) {
    const response = await fetch(url, {credentials:'same-origin',cache:'no-store',...options});
    if (response.status === 401 && document.body.dataset.page === 'dashboard') { location.assign('/admin/login'); throw new Error('登录已过期，请重新登录。'); }
    const data = await response.json().catch(()=>({}));
    if (!response.ok) {
      const error = new Error(response.status === 429 ? '请求过于频繁，请稍后再试。' : response.status === 404 ? '原始 IP 已过期或不存在，无法查看。' : response.status === 403 ? '验证未通过，请刷新后重试。' : '请求失败，请检查网络或稍后重试。');
      error.status = response.status; throw error;
    }
    return data;
  }
  const post = (url,data,token) => request(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})},body:JSON.stringify(data)});
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  const dateText = value => { if (!value) return '—'; const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}); };
  if (document.body.dataset.page === 'login') {
    let widget, challengeToken = '', challengeRequired = false, ready = false;
    const reset = () => { challengeToken = ''; if (widget !== undefined && window.turnstile) window.turnstile.reset(widget); };
    const submit = $('login-submit');
    const initialize = async () => {
      try {
        const config = await request('/api/admin/config');
        const key = config.siteKey || $('turnstile-widget').dataset.siteKey;
        challengeRequired = Boolean(key);
        if (key) {
          await new Promise((resolve,reject)=>{
            if (typeof window.turnstile?.render === 'function') { resolve(); return; }
            const callback = '__dwgAdminTurnstileReady'; let settled = false, timer;
            const finish = error => { if (settled) return; settled = true; clearTimeout(timer); delete window[callback]; error ? reject(error) : resolve(); };
            window[callback] = () => finish(typeof window.turnstile?.render === 'function' ? null : new Error('安全验证初始化失败，请刷新页面。'));
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=' + callback;
            script.onerror = () => finish(new Error('安全验证加载失败，请刷新页面。'));
            timer = setTimeout(() => finish(new Error('安全验证加载超时，请刷新页面。')), 10000);
            document.head.append(script);
          });
          widget = window.turnstile.render($('turnstile-widget'), {sitekey:key,action:'admin_login',theme:'light',callback:token=>{ challengeToken=token; },'expired-callback':()=>{challengeToken='';},'error-callback':()=>{challengeToken='';status('安全验证失败，请重新验证。',true);}});
        }
        ready = true; submit.disabled = false; submit.textContent = '登录数据台 →'; status('');
      } catch (e) { status(e.message,true); submit.textContent='配置不可用，请刷新重试'; }
    };
    $('login-form').addEventListener('submit',async event=>{
      event.preventDefault(); if (!ready) return;
      if (challengeRequired && !challengeToken) { status('请先完成安全验证。',true); return; }
      submit.disabled=true; status('正在登录…');
      try { await post('/api/admin/login',{username:$('username').value,password:$('password').value,turnstileToken:challengeToken}); $('password').value=''; location.assign('/admin/analytics'); }
      catch (e) { status(e.status===401 ? '账号或密码不正确。' : e.message,true); reset(); submit.disabled=false; }
    });
    initialize();
  }
  if (document.body.dataset.page !== 'dashboard') return;
  let csrfToken = '', activeRange = null, loadSequence = 0;
  const day = (offset=0) => { const d = new Date(Date.now()+8*3600000); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10); };
  function preset(value) { $('to').value=day(value==='yesterday'?-1:0); $('from').value=day(value==='today'?0:value==='yesterday'?-1:1-Number(value)); document.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.days===value))); }
  function table(id, rows, columns) {
    const body=$(id); body.replaceChildren();
    if (!rows?.length) { const row=document.createElement('tr'),cell=document.createElement('td'); cell.colSpan=columns.length; cell.className='empty'; cell.textContent='所选时间范围暂无数据'; row.append(cell); body.append(row); return; }
    for (const item of rows) { const row=document.createElement('tr'); for (const column of columns) { const cell=document.createElement('td'); const value=column(item); if (value instanceof Node) cell.append(value); else cell.textContent=String(value ?? '—'); row.append(cell); } body.append(row); }
  }
  function chart(rows) {
    const box=$('chart'); box.replaceChildren();
    if (!rows?.length) { const empty=document.createElement('p'); empty.className='empty'; empty.textContent='暂无趋势数据'; box.append(empty); return; }
    const make=(tag,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=String(text);return el;};
    const svg=make('svg',{viewBox:'0 0 900 250',role:'img','aria-label':'每日 PV 与有效 PV 趋势'}); svg.append(make('title',{},'每日阅读趋势；蓝色表示 PV，青色表示有效 PV'));
    const max=Math.max(1,...rows.map(r=>Number(r.pv)||0),...rows.map(r=>Number(r.validPv)||0));
    const x=i=>rows.length===1?470:55+i*815/(rows.length-1), y=v=>205-170*(Number(v)||0)/max;
    for(let i=0;i<=4;i++){const cy=35+i*42.5;svg.append(make('line',{x1:55,x2:870,y1:cy,y2:cy,class:'grid-line'}),make('text',{x:0,y:cy+4},count(Math.round(max*(4-i)/4))));}
    for(const field of ['pv','validPv']) { svg.append(make('polyline',{points:rows.map((r,i)=>x(i)+','+y(r[field])).join(' '),class:field==='pv'?'pv-line':'valid-line'})); }
    rows.forEach((r,i)=>{const dot=make('circle',{cx:x(i),cy:y(r.pv),r:3});dot.append(make('title',{},r.date+'：PV '+count(r.pv)+'，有效 PV '+count(r.validPv)));svg.append(dot);if(i===0||i===rows.length-1||i===Math.floor(rows.length/2))svg.append(make('text',{x:x(i),y:238,'text-anchor':'middle'},String(r.date).slice(5)));});
    box.append(svg);
  }
  function ipAction(row) {
    const wrap=document.createElement('div'),button=document.createElement('button'),result=document.createElement('span'); button.type='button';button.textContent='查看原始 IP';result.setAttribute('role','status');
    button.addEventListener('click',async()=>{button.disabled=true;result.textContent=' 正在验证…';try{const data=await post('/api/admin/reveal',{key:row.key},csrfToken);result.textContent=' '+String(data.ip)+'（保留至 '+dateText(data.expiresAt)+'）';button.textContent='收起';button.disabled=false;button.hidden=true;const hide=document.createElement('button');hide.type='button';hide.textContent='收起';hide.addEventListener('click',()=>{result.textContent='';hide.remove();button.hidden=false;});wrap.append(hide);}catch(e){result.textContent=' '+e.message;button.disabled=e.status===404;}});wrap.append(button,result);return wrap;
  }
  function render(data) {
    csrfToken=data.csrfToken || ''; $('logout').disabled=!csrfToken;
    $('account-name').textContent=data.username || $('account-name').textContent;
    document.querySelector('.environment').textContent=data.environment || '独立环境';
    $('updated').textContent='更新于 '+dateText(data.updatedAt)+' · 北京时间';
    for(const key of ['pv','validPv','uv','ips','suspicious']) $('metric-'+key).textContent=count(data.summary?.[key]);
    $('total-pv').textContent='累计 PV：'+count(data.summary?.totalPv);
    $('collection-start').textContent=data.health?.collectionStartedAt?'采集开始于 '+dateText(data.health.collectionStartedAt):'尚未采集';
    chart(data.daily);
    table('pages',data.pages,[r=>r.title?String(r.title)+' · '+String(r.page):r.page,r=>count(r.pv),r=>count(r.uv)]);
    for(const key of ['referrers','countries','devices'])table(key,data[key],[r=>r.name,r=>count(r.count)]);
    table('ips',data.ips,[r=>r.masked,r=>count(r.pv),r=>count(r.visitors),r=>r.country,r=>dateText(r.lastSeen),r=>r.suspicious?'可疑':'正常',ipAction]);
    table('security',data.security,[r=>dateText(r.time),r=>r.kind,r=>r.detail]);
    $('retention').textContent='明细保留 '+(data.health?.retentionDays || 90)+' 天 · 汇总保留 12 个月 · '+(data.health?.collectionStartedAt?'采集开始于 '+dateText(data.health.collectionStartedAt):'尚未采集');
    try { const url=new URL(data.health?.edgeUrl); if(url.protocol==='https:' && url.hostname==='dash.cloudflare.com')$('edge-link').href=url.href; } catch {}
  }
  async function load() {
    const from=$('from').value,to=$('to').value;
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(from)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(to)||from>to||from<day(-89)||to>day()){status('请选择最近 90 天内的有效日期，开始日期不能晚于结束日期。',true);return;}
    const sequence=++loadSequence; $('report').setAttribute('aria-busy','true');$('export').disabled=true;status('正在加载报表…');
    try{const data=await request('/api/admin/report?'+new URLSearchParams({from,to}));if(sequence!==loadSequence)return;render(data);activeRange={from,to};$('export').disabled=false;status((Number(data.summary?.pv)||0)===0?'所选时间范围暂无访问记录。':'已加载 '+from+' 至 '+to+' 的统计');}
    catch(e){if(sequence===loadSequence)status(e.message+' 可重新点击查询。',true);}
    finally{if(sequence===loadSequence)$('report').setAttribute('aria-busy','false');}
  }
  $('filters').addEventListener('submit',event=>{event.preventDefault();document.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed','false'));load();});
  document.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{preset(button.dataset.days);load();}));
  for(const id of ['from','to']){$(id).min=day(-89);$(id).max=day();}
  $('logout').addEventListener('click',async()=>{ $('logout').disabled=true;try{await post('/api/admin/logout',{},csrfToken);location.assign('/admin/login');}catch(e){status(e.message,true);$('logout').disabled=false;} });
  $('export').addEventListener('click',async()=>{
    if(!activeRange)return;$('export').disabled=true;
    try{const response=await fetch('/api/admin/export?'+new URLSearchParams(activeRange),{credentials:'same-origin',cache:'no-store'});if(response.status===401){location.assign('/admin/login');return;}if(!response.ok)throw new Error('CSV 导出失败，请稍后重试。');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='doubao-analytics-'+activeRange.from+'-'+activeRange.to+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('CSV 已导出。');}catch(e){status(e.message,true);}finally{$('export').disabled=false;}
  });
  $('history-load').addEventListener('click',async()=>{
    const button=$('history-load');button.disabled=true;$('history-status').textContent='正在加载历史日汇总…';
    try{const data=await request('/api/admin/history');table('history',data.daily,[r=>r.date,r=>count(r.pv),r=>count(r.validPv)]);$('history-wrap').hidden=false;$('history-status').textContent=data.note || '历史日汇总不包含跨日去重 UV/IP';button.textContent='刷新历史日汇总';}
    catch(e){$('history-status').textContent=e.message;}
    finally{button.disabled=false;}
  });
  preset('7');load();
})();`;
