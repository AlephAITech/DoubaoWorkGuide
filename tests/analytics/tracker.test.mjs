import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../../site/js/analytics.js';
function setup(extra = {}) {
  const events = []; let n = 0;
  const tracker = createTracker({
    location: { protocol: 'https:', origin: 'https://example.com' },
    referrer: 'https://search.example/path?q=secret', uuid: () => `id-${++n}`,
    isVisible: () => true, onVisible: () => {}, sleep: async () => {},
    fetch: async (url, options) => {
      if (url.endsWith('/session')) return { status: 200, json: async () => ({ csrfToken: 'csrf' }) };
      events.push(JSON.parse(options.body)); return { status: 202 };
    }, ...extra,
  });
  return { tracker, events };
}
test('canonical repeated render ignored; returning creates a fresh event', async () => {
  const { tracker, events } = setup();
  tracker.trackPage('/'); tracker.trackPage('/'); tracker.trackPage('/intro'); tracker.trackPage('/');
  await tracker.flush();
  assert.deepEqual(events.map(x => x.page), ['/', '/intro', '/']);
  assert.equal(new Set(events.map(x => x.eventId)).size, 3);
  assert.equal(events[0].referrer, 'search.example');
});
test('retry uses the same event ID', async () => {
  const ids = []; const { tracker } = setup({ fetch: async (url, opts) => {
    if (url.endsWith('/session')) return { status: 200, json: async () => ({ csrfToken: 'x' }) };
    ids.push(JSON.parse(opts.body).eventId); if (ids.length === 1) throw Error('offline');
    return { status: 202 };
  }});
  tracker.trackPage('/'); await tracker.flush(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
});
test('hidden pages wait and rapid navigation keeps each event', async () => {
  let visible = false; let resume;
  const { tracker, events } = setup({ isVisible: () => visible, onVisible: cb => { resume = cb; } });
  tracker.trackPage('/'); tracker.trackPage('/intro'); await tracker.flush(); assert.equal(events.length, 0);
  visible = true; resume(); await tracker.flush(); assert.equal(events.length, 2);
});
test('network failures never reject and later navigation retries session', async () => {
  let calls = 0; const { tracker } = setup({ fetch: async () => { calls++; throw Error('offline'); } });
  tracker.trackPage('/'); await assert.doesNotReject(tracker.flush()); const first = calls;
  tracker.trackPage('/intro'); await assert.doesNotReject(tracker.flush()); assert.ok(calls > first); assert.ok(calls < 10);
});
test('reject invalid routes and non HTTP environments', async () => {
  const { tracker, events } = setup();
  for (const p of ['/admin', '/privacy', '/unknown', '/p/../x', '/p/a?q=x', 'https://evil.test/', '/p/%2f']) tracker.trackPage(p);
  await tracker.flush(); assert.equal(events.length, 0);
  const local = setup({ location: { protocol: 'file:' } }); local.tracker.trackPage('/'); await local.tracker.flush(); assert.equal(local.events.length, 0);
});
test('admin session 204 excludes all events', async () => {
  let calls = 0; const { tracker } = setup({fetch: async () => { calls++; return { status: 204 }; }});
  tracker.trackPage('/'); tracker.trackPage('/intro'); await tracker.flush(); tracker.trackPage('/toc'); await tracker.flush(); assert.equal(calls, 1);
});
test('separate browser tracker instances generate distinct UUIDs', async () => {
  const a = setup({ uuid: () => globalThis.crypto.randomUUID() });
  const b = setup({ uuid: () => globalThis.crypto.randomUUID() });
  a.tracker.trackPage('/'); b.tracker.trackPage('/'); await Promise.all([a.tracker.flush(), b.tracker.flush()]);
  assert.notEqual(a.events[0].eventId, b.events[0].eventId);
});
test('event challenge renews session once and retries original event', async () => {
  const requests = []; let eventCalls = 0; let challengeCalls = 0;
  const { tracker } = setup({ challenge: async key => { assert.equal(key, 'public-key'); challengeCalls++; return 'one-use-token'; }, fetch: async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body });
    if (url.endsWith('/session')) return { status: 200, json: async () => ({ csrfToken: 'csrf' }) };
    eventCalls++;
    if (eventCalls === 1) return { status: 403, json: async () => ({ challengeRequired: true, siteKey: 'public-key' }) };
    return { status: 202 };
  }});
  tracker.trackPage('/'); await tracker.flush();
  const events = requests.filter(x => x.url.endsWith('/event'));
  assert.equal(events.length, 2); assert.equal(events[0].body.eventId, events[1].body.eventId);
  assert.equal(challengeCalls, 1); assert.equal(requests.filter(x => x.body.turnstileToken).length, 1);
});
test('session challenge must be solved before posting the event', async () => {
  let sessionCalls = 0; let events = 0;
  const { tracker } = setup({ challenge: async () => 'token', fetch: async (url, options) => {
    if (url.endsWith('/event')) { events++; return { status: 202 }; }
    sessionCalls++;
    if (sessionCalls === 1) return { status: 403, json: async () => ({ challengeRequired: true, siteKey: 'key' }) };
    assert.deepEqual(JSON.parse(options.body), { turnstileToken: 'token' });
    return { status: 200, json: async () => ({ csrfToken: 'csrf' }) };
  }});
  tracker.trackPage('/'); await tracker.flush(); assert.equal(sessionCalls, 2); assert.equal(events, 1);
});
test('hidden queue is bounded and checks known IDs when configured', async () => {
  let visible = false; const { tracker, events } = setup({ isVisible: () => visible, isKnownPage: page => page !== '/p/unknown' });
  tracker.trackPage('/p/unknown');
  for (let i = 0; i < 100; i++) tracker.trackPage(`/p/doc${i}`);
  visible = true; await tracker.flush(); assert.equal(events.length, 20); assert.equal(events[0].page, '/p/doc0');
});
test('rate limiting does not retry or trigger a challenge', async () => {
  let events = 0;
  const { tracker } = setup({ challenge: async () => { assert.fail('unexpected challenge'); }, fetch: async url => {
    if (url.endsWith('/session')) return { status: 200, json: async () => ({ csrfToken: 'csrf' }) };
    events++; return { status: 429 };
  }});
  tracker.trackPage('/'); await tracker.flush(); assert.equal(events, 1);
});
test('ordinary expired session refreshes once and preserves event identity', async () => {
  let sessions = 0; const ids = [];
  const { tracker } = setup({ fetch: async (url, options) => {
    if (url.endsWith('/session')) { sessions++; return { status: 200, json: async () => ({ csrfToken: `csrf${sessions}` }) }; }
    ids.push(JSON.parse(options.body).eventId);
    return ids.length === 1 ? { status: 403, json: async () => ({ error: 'session_expired' }) } : { status: 202 };
  }});
  tracker.trackPage('/'); await tracker.flush(); assert.equal(sessions, 2); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
});
test('persistent ordinary 403 cannot loop indefinitely', async () => {
  let events = 0; let sessions = 0;
  const { tracker } = setup({ fetch: async url => {
    if (url.endsWith('/session')) { sessions++; return { status: 200, json: async () => ({ csrfToken: 'csrf' }) }; }
    events++; return { status: 403, json: async () => ({}) };
  }});
  tracker.trackPage('/'); await tracker.flush(); assert.equal(events, 2); assert.equal(sessions, 2);
});
test('non-statistical route resets consecutive-page deduplication', async () => {
  const { tracker, events } = setup();
  tracker.trackPage('/intro'); tracker.trackPage(null); tracker.trackPage('/intro');
  tracker.trackPage('/privacy'); tracker.trackPage('/intro'); await tracker.flush();
  assert.deepEqual(events.map(e => e.page), ['/intro', '/intro', '/intro']);
});
test('Global Privacy Control prevents session and event network requests', async () => {
  let calls = 0;
  const { tracker } = setup({ navigator: { globalPrivacyControl: true }, fetch: async () => { calls++; throw Error('must not request'); } });
  tracker.trackPage('/'); await tracker.flush(); assert.equal(calls, 0);
});
