process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as db from '../server/db.js';
import { generateMaltaSupportPush, getMaltaPushFallback } from '../server/support.js';

const { server } = await import('../server/server.js');

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-user-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function registerUser(prefix) {
  const nickname = prefix + crypto.randomBytes(3).toString('hex');
  const res = await call('POST', '/api/users/register', {
    name: nickname + ' Testsson',
    nickname,
    swishNumber: '07' + String(crypto.randomInt(0, 100000000)).padStart(8, '0'),
    pin: '1111'
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test('Malta Support Push — Generates witty fallback messages for all game event types', () => {
  const events = [
    { type: 'duel_loss', details: { opponentName: 'Micke', gameType: 'Blind 10', stakeAmount: 50 } },
    { type: 'duel_win', details: { opponentName: 'Calle', gameType: 'Space Blitz', stakeAmount: 100 } },
    { type: 'duel_challenge', details: { opponentName: 'Johan', gameType: 'Tärning', stakeAmount: 20 } },
    { type: 'debt_reminder', details: { creditorName: 'Micke', netAmount: 150 } },
    { type: 'tournament_settled', details: { tournamentName: 'Golfresan 2026', netAmount: 300 } },
    { type: 'tournament_settled', details: { tournamentName: 'Golfresan 2026', netAmount: -200 } },
    { type: 'test_push', details: {} }
  ];

  for (const { type, details } of events) {
    const res = getMaltaPushFallback({ eventType: type, userName: 'Sarah', details });
    assert.ok(res.title, `Missing title for ${type}`);
    assert.ok(res.title.includes('Malta Support'), `Title should mention Malta Support for ${type}`);
    assert.ok(res.body, `Missing body for ${type}`);
    assert.ok(res.url, `Missing url for ${type}`);
    assert.equal(res.body.toLowerCase().includes('betpals'), false, 'Should never mention Whooply');
  }
});

test('Malta Support Push — generateMaltaSupportPush returns valid push object', async () => {
  const push = await generateMaltaSupportPush({
    eventType: 'duel_loss',
    user: { nickname: 'GolfKungen' },
    details: { opponentName: 'Stig', gameType: 'Space Blitz', stakeAmount: 50 },
    apiKey: null // Test offline fallback mode
  });

  assert.ok(push.title.includes('Malta Support'));
  assert.ok(push.body.length > 10);
  assert.equal(push.url, '/#arcade'); // /duels was not a route the app could open
});

test('Malta Support Push — User notification preferences include notifySupport', async () => {
  const u = await registerUser('suppuser');
  
  // Default is true
  const prefs = db.getUserNotificationPrefs(u.id);
  assert.equal(prefs.notifySupport, true);

  // Update via API
  const updateRes = await call('PUT', '/api/users/notification-prefs', {
    notifySupport: false
  }, u.token);

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.notifySupport, false);

  const updatedPrefs = db.getUserNotificationPrefs(u.id);
  assert.equal(updatedPrefs.notifySupport, false);
});

test('Malta Support Push — Push subscriptions are filtered when notifySupport is false', async () => {
  const u = await registerUser('suppfilter');

  // Insert mock push subscription
  const endpoint = `https://mock.push.test/${u.id}`;
  db.savePushSubscription(u.id, {
    endpoint,
    keys: { p256dh: 'mock-key', auth: 'mock-auth' }
  });

  // When notifySupport is true, subscription is returned
  let subs = db.getPushSubscriptionsForUsers([u.id], 'support');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].endpoint, endpoint);

  // Turn off support notifications
  db.updateUserNotificationPrefs(u.id, { notifySupport: false });

  // Now support push subscriptions should be empty
  subs = db.getPushSubscriptionsForUsers([u.id], 'support');
  assert.equal(subs.length, 0);
});

test('Malta Support Push — Cooldown prevents spamming the user', () => {
  const fakeUserId = 'cooldown-test-' + Date.now();
  
  assert.equal(db.canSendSupportPush(fakeUserId), true);
  
  db.recordSupportPushSent(fakeUserId);
  assert.equal(db.canSendSupportPush(fakeUserId), false);
  assert.equal(db.canSendSupportPush(fakeUserId, true), true); // force=true bypasses cooldown
});

test('Malta Support Push — POST /api/support/test-push works with subscription', async () => {
  const u = await registerUser('testpush');

  // Before adding push subscription: should return 400
  const failRes = await call('POST', '/api/support/test-push', {}, u.token);
  assert.equal(failRes.status, 400);

  // Add subscription
  db.savePushSubscription(u.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${u.id}`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK18WKJw5unoPqWhScqMHizU57fZThPItAn3W0nT8lxRVovG', auth: 'tBHItJI5svbpLNkp0_UQ4w==' }
  });

  // After subscription: the fake subscription cannot actually be delivered to, and the
  // endpoint must say so instead of claiming the notification was sent
  const deliveryRes = await call('POST', '/api/support/test-push', {}, u.token);
  assert.equal(deliveryRes.status, 502);
  assert.equal(deliveryRes.body.result.sent, 0);
  assert.match(deliveryRes.body.error, /kunde inte levereras/);
});
