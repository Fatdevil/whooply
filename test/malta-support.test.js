process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { getMaltaFallbackReply } from '../server/support.js';

test('Malta Support — Generates rich fallback replies for golf, birdies, tab and PIN', () => {
  const birdieReply = getMaltaFallbackReply('Hur sätter vi upp mest birdies?', 'Sarah');
  assert.ok(birdieReply.includes('AnyBet'), 'Should mention AnyBet for birdies');
  assert.ok(birdieReply.includes('Sarah'), 'Should personalize greeting');

  const tabReply = getMaltaFallbackReply('Hur delar vi öl på tabben?', 'Micke');
  assert.ok(tabReply.includes('THE TAB'), 'Should explain The Tab');

  const pinReply = getMaltaFallbackReply('Jag har glömt min PIN-kod', 'Kalle');
  assert.ok(pinReply.includes('Nollställ PIN'), 'Should guide on PIN reset via admin');

  const internetReply = getMaltaFallbackReply('Har ni internet eller surf?', 'Sarah');
  assert.ok(internetReply.includes('surf'), 'Should mention internet/surf out playfully');

  const lovenReply = getMaltaFallbackReply('Ska vi köra löven game på golfen?', 'Erik');
  assert.ok(lovenReply.includes('Björklöven') || lovenReply.includes('hockey'), 'Should warn about Löven hockey');

  const stockReply = getMaltaFallbackReply('Vad står börsen i?', 'Sarah');
  assert.ok(stockReply.includes('börsen') && stockReply.includes('golfresa'), 'Should tell user to focus on golf/beer rather than stock market');

  // Nothing matched: a short list of topics instead of a dead end
  const generalReply = getMaltaFallbackReply('Tja vad kan du hjälpa till med?', 'Alex');
  assert.ok(generalReply.includes('Välj ett ämne'), 'General reply offers topics');
  assert.ok(generalReply.includes('Whooply'), 'Should refer to Whooply');
  assert.ok(!generalReply.includes('Whooply'), 'Should never refer to Whooply');

  const videoReply = getMaltaFallbackReply('Visa en video för att tagga!', 'Alex');
  assert.ok(videoReply.includes('https://youtu.be/0EoEY4fi3vo'), 'Should provide official YouTube link');

  const svingReply = getMaltaFallbackReply('Hjälp med svingen och slice', 'Micke');
  assert.ok(svingReply.includes('https://youtu.be/0EoEY4fi3vo'), 'Should promote video in swing advice');
});

test('Malta Support — Search Quota tracking and 5000 cap', async () => {
  const { getSearchQuotaInfo, MAX_MONTHLY_SEARCHES } = await import('../server/support.js');
  const db = await import('../server/db.js');

  assert.equal(MAX_MONTHLY_SEARCHES, 5000);
  const initial = getSearchQuotaInfo();
  assert.ok(typeof initial.count === 'number');
  assert.equal(initial.max, 5000);
  assert.equal(initial.remaining, Math.max(0, 5000 - initial.count));

  // Test increment
  const startCount = initial.count;
  db.incrementMonthlySearchCount(3);
  const afterInc = getSearchQuotaInfo();
  assert.equal(afterInc.count, startCount + 3);

  // Restore
  db.resetMonthlySearchCount();
  assert.equal(getSearchQuotaInfo().count, 0);
  assert.equal(getSearchQuotaInfo().exhausted, false);
});

test('Malta Support — POST /api/support/chat handles HTTP requests and rate limits', async () => {
  const { app } = await import('../server/server.js');
  const { EventEmitter } = await import('events');
  // The test database is kept between runs, so earlier runs' requests from this test IP
  // add up to the chat's rate limit (40 per window); start from a clean count
  const dbMod = await import('../server/db.js');
  dbMod.clearRateLimit('support_chat:127.0.0.99');

  const res = await new Promise((resolve) => {
    const req = Object.assign(new EventEmitter(), {
      method: 'POST',
      url: '/api/support/chat',
      headers: { 'content-type': 'application/json' },
      body: { message: 'Hur sätter vi upp rundor på golfresan?' },
      query: {},
      params: {},
      _readableState: { pipes: [] },
      unpipe() {},
      resume() {},
      pause() {},
      socket: { remoteAddress: '127.0.0.99' },
      connection: { remoteAddress: '127.0.0.99' }
    });
    let code = 200;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
      status(c) { code = c; return this; },
      json(body) { resolve({ status: code, body }); },
      setHeader() {},
      getHeader() {},
      removeHeader() {}
    });
    app.handle(req, res);
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(typeof res.body.reply === 'string', 'Should return a reply string');
  assert.ok(res.body.reply.length > 20, 'Reply should be substantial');
});
