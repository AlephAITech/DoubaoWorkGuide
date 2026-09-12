// Anonymous, best-effort analytics. Importing this module has no side effects.
const validPage = (page) => typeof page === 'string' && /^(?:\/|\/intro|\/toc|\/p\/[A-Za-z0-9_-]{1,128})$/.test(page);

export function createTracker(deps = {}) {
  const location = deps.location ?? globalThis.location;
  const fetcher = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  const isVisible = deps.isVisible ?? (() => globalThis.document?.visibilityState === 'visible');
  const onVisible = deps.onVisible ?? ((cb) => globalThis.document?.addEventListener('visibilitychange', cb));
  const uuid = deps.uuid ?? (() => globalThis.crypto.randomUUID());
  const sleep = deps.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  const challenge = deps.challenge ?? showChallenge;
  const queue = [];
  let lastPage, csrfToken, excluded = (deps.navigator ?? globalThis.navigator)?.globalPrivacyControl === true, running, challengeCount = 0;
  let referrer;
  try {
    const url = new URL(deps.referrer ?? globalThis.document?.referrer);
    if (/^https?:$/.test(url.protocol)) referrer = url.host;
  } catch { /* No referrer is normal. */ }

  async function post(path, body, csrf) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetcher(`/api/analytics/${path}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Analytics-CSRF': csrf } : {}) },
        body: JSON.stringify(body), signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
  }
  async function session(turnstileToken) {
    const response = await post('session', turnstileToken ? { turnstileToken } : {});
    if (response.status === 204) { excluded = true; queue.length = 0; return false; }
    const data = await response.json();
    if (response.status === 200 && typeof data.csrfToken === 'string' && data.csrfToken) {
      csrfToken = data.csrfToken; return true;
    }
    if (response.status === 403 && data.challengeRequired && data.siteKey && challengeCount < 1) {
      challengeCount++;
      const token = await challenge(data.siteKey);
      if (token) return session(token); // A token is submitted once only.
    }
    return false;
  }
  async function drain() {
    while (queue.length && !excluded && isVisible()) {
      const event = queue[0];
      try {
        if (!csrfToken && !(await session())) { queue.shift(); return; }
        if (excluded || !queue.length) return;
        // The tab can become hidden while the session request is in flight.
        if (!isVisible()) return;
        const response = await post('event', event.body, csrfToken);
        if (response.status === 200 || response.status === 202) { queue.shift(); continue; }
        if (response.status === 403) {
          csrfToken = undefined;
          const data = await response.json().catch(() => ({}));
          if (data.challengeRequired && data.siteKey && challengeCount < 1) {
            challengeCount++;
            const token = await challenge(data.siteKey);
            if (token && await session(token)) continue;
          }
          if (!data.challengeRequired && !event.sessionRefreshed) {
            event.sessionRefreshed = true;
            if (await session()) continue;
          }
          queue.shift(); continue;
        }
        if (response.status === 429 || (response.status >= 400 && response.status < 500)) { queue.shift(); continue; }
        throw new Error('Analytics unavailable');
      } catch {
        event.attempts++;
        if (event.attempts >= 2) { if (queue[0] === event) queue.shift(); return; }
        await sleep(1000);
      }
    }
  }
  function flush() {
    if (!running && queue.length && !excluded && isVisible()) {
      running = Promise.resolve().then(drain).catch(() => {}).finally(() => { running = undefined; });
    }
    return running ?? Promise.resolve();
  }
  onVisible(() => { if (isVisible()) void flush(); });
  function trackPage(page) {
    try {
      if (!validPage(page) || (deps.isKnownPage && !deps.isKnownPage(page))) { lastPage = undefined; return; }
      if (excluded || !fetcher || !/^https?:$/.test(location?.protocol)) return;
      if (page === lastPage) return;
      lastPage = page;
      if (queue.length >= 20) return; // Bounded memory during offline or challenge states.
      queue.push({ body: { eventId: uuid(), page, ...(referrer ? { referrer } : {}) }, attempts: 0 });
      void flush();
    } catch { /* Analytics must never interfere with rendering. */ }
  }
  return { trackPage, flush };
}

let defaultTracker;
export function trackPage(page) {
  try { (defaultTracker ??= createTracker()).trackPage(page); } catch { /* Reading always wins. */ }
}

let turnstileLoading;
function loadTurnstile() {
  if (typeof globalThis.turnstile?.render === 'function') return Promise.resolve(globalThis.turnstile);
  if (!turnstileLoading) {
    turnstileLoading = new Promise((resolve, reject) => {
      const callback = '__dwgAnalyticsTurnstileReady';
      let settled = false, timer;
      const finish = (error, api) => {
        if (settled) return;
        settled = true; clearTimeout(timer); delete globalThis[callback];
        error ? reject(error) : resolve(api);
      };
      globalThis[callback] = () => {
        const api = globalThis.turnstile;
        finish(typeof api?.render === 'function' ? null : new Error('Unavailable'), api);
      };
      const script = document.createElement('script');
      script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${callback}`;
      script.async = true;
      script.onerror = () => finish(new Error('Unavailable'));
      timer = setTimeout(() => finish(new Error('Unavailable')), 10000);
      document.head.append(script);
    }).catch(error => { turnstileLoading = undefined; throw error; });
  }
  return turnstileLoading;
}

function showChallenge(siteKey) {
  if (!siteKey || !globalThis.document) return Promise.resolve(null);
  return new Promise(resolve => {
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', '匿名访问统计验证');
    Object.assign(panel.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '1000', padding: '12px', maxWidth: 'calc(100vw - 32px)', background: '#fff', color: '#222', border: '1px solid #ddd', borderRadius: '12px', boxShadow: '0 4px 20px #0002' });
    const label = document.createElement('p');
    label.textContent = '匿名访问统计需要验证。可跳过，继续阅读。';
    const verify = document.createElement('button'); verify.textContent = '验证'; verify.type = 'button';
    const skip = document.createElement('button'); skip.textContent = '跳过'; skip.type = 'button';
    const mount = document.createElement('div');
    panel.append(label, verify, skip, mount); document.body.append(panel);
    let widget, done = false;
    const finish = token => {
      if (done) return; done = true; clearTimeout(timeout);
      if (widget !== undefined) globalThis.turnstile?.remove(widget);
      panel.remove(); resolve(token);
    };
    const timeout = setTimeout(() => finish(null), 120000);
    skip.onclick = () => finish(null);
    verify.onclick = async () => {
      verify.disabled = true;
      try {
        const api = await loadTurnstile(); if (done) return;
        widget = api.render(mount, { sitekey: siteKey, action: 'analytics_session', callback: finish, 'error-callback': () => finish(null), 'expired-callback': () => finish(null) });
      } catch { finish(null); }
    };
  });
}
