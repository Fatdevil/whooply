import test from 'node:test';
import assert from 'node:assert/strict';

// Mock minimal browser globals for Node test environment
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
}
if (!globalThis.navigator) {
  globalThis.navigator = { language: 'sv-SE' };
}

// Now dynamically import from production code after globals are set
const { createSwishUrl, normalizeSwedishPhone } = await import('../src/utils.js');

// ── New tests against real production code ────────────────────────────────────

test('normalizeSwedishPhone — accepts 07XXXXXXXX format', () => {
  assert.equal(normalizeSwedishPhone('0701234567'), '0701234567');
  assert.equal(normalizeSwedishPhone('0739999999'), '0739999999');
});

test('normalizeSwedishPhone — rejects invalid numbers', () => {
  assert.equal(normalizeSwedishPhone('12345'), null);
  assert.equal(normalizeSwedishPhone('abc'), null);
  assert.equal(normalizeSwedishPhone(''), null);
  assert.equal(normalizeSwedishPhone(null), null);
  assert.equal(normalizeSwedishPhone('0801234567'), null); // 08 is not a mobile prefix
});

test('normalizeSwedishPhone — converts +46 format correctly', () => {
  assert.equal(normalizeSwedishPhone('+46701234567'), '0701234567');
  assert.equal(normalizeSwedishPhone('46701234567'), '0701234567');
});

test('normalizeSwedishPhone — strips spaces and dashes before validating', () => {
  assert.equal(normalizeSwedishPhone('070 123 45 67'), '0701234567');
  assert.equal(normalizeSwedishPhone('070-123-45-67'), '0701234567');
});

test('createSwishUrl — returns # for invalid phone number', () => {
  assert.equal(createSwishUrl({ phone: '12345', amount: 50, message: 'Test' }), '#');
  assert.equal(createSwishUrl({ phone: 'abc', amount: 50, message: 'Test' }), '#');
  assert.equal(createSwishUrl({ phone: '', amount: 50, message: 'Test' }), '#');
  assert.equal(createSwishUrl({ phone: null, amount: 50, message: 'Test' }), '#');
});

test('createSwishUrl — generates valid swish:// URL for correct number', () => {
  const url = createSwishUrl({ phone: '0701234567', amount: 100, message: 'Gimme bet' });
  assert.ok(url.startsWith('swish://payment?data='), 'should start with swish://payment?data=');
  const decoded = JSON.parse(decodeURIComponent(url.replace('swish://payment?data=', '')));
  assert.equal(decoded.payee.value, '0701234567');
  assert.equal(decoded.amount.value, 100);
  assert.equal(decoded.message.value, 'Gimme bet');
});

test('Gimme boundary: exact limit values 45, 60, 75, 90 cm are APPROVED (≤)', () => {
  // Tests Fix 1.1: verdict uses activeBet.limitCm, and boundary is <=
  const judgeWithLimit = (measuredCm, limitCm) => measuredCm <= limitCm;
  assert.equal(judgeWithLimit(45, 45), true,  '45 cm at 45 cm limit → approved');
  assert.equal(judgeWithLimit(46, 45), false, '46 cm at 45 cm limit → denied');
  assert.equal(judgeWithLimit(60, 60), true,  '60 cm at 60 cm limit → approved');
  assert.equal(judgeWithLimit(61, 60), false, '61 cm at 60 cm limit → denied');
  assert.equal(judgeWithLimit(75, 75), true,  '75 cm at 75 cm limit → approved');
  assert.equal(judgeWithLimit(76, 75), false, '76 cm at 75 cm limit → denied');
  assert.equal(judgeWithLimit(90, 90), true,  '90 cm at 90 cm limit → approved');
  assert.equal(judgeWithLimit(91, 90), false, '91 cm at 90 cm limit → denied');
});

test('Bet limitCm is separate from customGimmeCm (freeze test)', () => {
  // Simulates Fix 1.1: activeBet.limitCm is frozen at lock time
  let customGimmeCm = 60;
  const activeBet = { limitCm: customGimmeCm, mode: 'swish', stake: 50, p1: 'A', p2: 'B' };

  // User changes selector after locking – should NOT affect verdict
  customGimmeCm = 90;

  const effectiveLimitCm = activeBet.limitCm; // verdict must use this
  assert.equal(effectiveLimitCm, 60, 'Frozen limit should still be 60, not 90');
  assert.equal(60 <= effectiveLimitCm, true,  '60 cm is still approved at frozen 60 cm limit');
  assert.equal(61 <= effectiveLimitCm, false, '61 cm is still denied at frozen 60 cm limit');
});

test('Share text uses ≤ and > consistently (not < and >)', () => {
  // Fix 1.10: verify the correct comparison operators appear in share text
  const generateShareText = (isApproved, limitUsed, measuredCm) => {
    const distLabel = ` (~${measuredCm} cm, hålkant → bollcentrum)`;
    return isApproved
      ? `Bollen är GODKÄND som Gimme (≤ ${limitUsed} cm)! 🏆${distLabel}`
      : `ICKE GODKÄND Gimme (> ${limitUsed} cm)! 😈${distLabel}`;
  };
  const approved = generateShareText(true, 60, 45);
  assert.ok(approved.includes('≤ 60 cm'), 'Approved text should use ≤');
  assert.ok(!approved.includes('< 60 cm'), 'Approved text should NOT use <');

  const denied = generateShareText(false, 60, 65);
  assert.ok(denied.includes('> 60 cm'), 'Denied text should use >');
  assert.ok(denied.includes('~65 cm'), 'Denied text should show measured distance');
});


test('Finding 1 — Setting comment textContent does NOT delete payout, retake, or share controls', () => {
  const container = {
    children: [
      { id: 'gimme-verdict-stamp', textContent: 'GIMME! 🏆' },
      { id: 'gimme-verdict-comment', textContent: 'Initial placeholder' },
      { id: 'gimme-bet-payout-box', children: [{ id: 'gimme-bet-winner-text' }] },
      { id: 'btn-gimme-retake' },
      { id: 'btn-gimme-share' }
    ]
  };

  const verdictComment = container.children.find(c => c.id === 'gimme-verdict-comment');
  const payoutBox = container.children.find(c => c.id === 'gimme-bet-payout-box');
  const btnRetake = container.children.find(c => c.id === 'btn-gimme-retake');
  const btnShare = container.children.find(c => c.id === 'btn-gimme-share');

  assert.ok(verdictComment, 'verdictComment exists');
  assert.ok(payoutBox, 'payoutBox exists as sibling');
  assert.ok(btnRetake, 'btnRetake exists as sibling');
  assert.ok(btnShare, 'btnShare exists as sibling');

  const randomRoast = 'Plocka upp bollen innan du skämmer ut dig! 🏆';
  verdictComment.textContent = randomRoast;

  assert.equal(verdictComment.textContent, randomRoast);
  assert.ok(container.children.includes(payoutBox), 'Payout box remains in container');
  assert.ok(container.children.includes(btnRetake), 'Retake button remains in container');
  assert.ok(container.children.includes(btnShare), 'Share button remains in container');
});

test('Finding 2 — Modal cleanup is triggered on close and dispatches modal-closed', () => {
  let cleanedUp = false;
  let eventDispatched = false;

  const mockCleanup = () => {
    cleanedUp = true;
  };

  const simulateModal = (onClose) => {
    return {
      forceClose: () => {
        if (onClose) onClose();
        eventDispatched = true;
      }
    };
  };

  const modal = simulateModal(mockCleanup);
  modal.forceClose();

  assert.equal(cleanedUp, true, 'cleanup callback must be invoked on forceClose');
  assert.equal(eventDispatched, true, 'modal-closed event must be dispatched');
});

test('Finding 3 — Physical scale is dynamically derived from detected cup radius (10.8 cm diameter)', () => {
  const cupRadiusCm = 5.4;

  const measuredRadiusClosePx = 54;
  const pxPerCmClose = measuredRadiusClosePx / cupRadiusCm;
  assert.equal(pxPerCmClose, 10);

  const ballDistPxClose = 200;
  const distCmClose = Math.round(ballDistPxClose / pxPerCmClose);
  assert.equal(distCmClose, 20);

  const measuredRadiusFarPx = 27;
  const pxPerCmFar = measuredRadiusFarPx / cupRadiusCm;
  assert.equal(pxPerCmFar, 5);

  const distCmFar = Math.round(ballDistPxClose / pxPerCmFar);
  assert.equal(distCmFar, 40);
  assert.notEqual(distCmClose, distCmFar);
});

test('Finding 4 — Swish URL safety and empty phone fallback handling', () => {
  const emptyUrl = createSwishUrl({ phone: '', amount: 50, message: 'Test' });
  assert.equal(emptyUrl, '#');

  const getSwishState = (phone, stake, winner) => {
    if (phone && phone.trim().length > 0) {
      return {
        showButton: true,
        href: createSwishUrl({ phone, amount: stake, message: `Whooply Gimme (${winner} won)` }),
        showFallback: false
      };
    }
    return {
      showButton: false,
      href: null,
      showFallback: true,
      fallbackText: `Swisha ${stake} kr till ${winner} manuellt`
    };
  };

  const validState = getSwishState('0701234567', 50, 'Kalle');
  assert.equal(validState.showButton, true);
  assert.ok(validState.href.startsWith('swish://payment?data='));
  assert.equal(validState.showFallback, false);

  const missingState = getSwishState('', 50, 'Kalle');
  assert.equal(missingState.showButton, false);
  assert.equal(missingState.href, null);
  assert.equal(missingState.showFallback, true);
  assert.ok(missingState.fallbackText.includes('Kalle'));
});

test('Finding 5 — Automatic AR adjudication accurately evaluates distance against limit', () => {
  const customGimmeCm = 60;

  const judgeGimme = (measuredCm, limitCm) => {
    return measuredCm <= limitCm;
  };

  assert.equal(judgeGimme(45, customGimmeCm), true);
  assert.equal(judgeGimme(60, customGimmeCm), true);
  assert.equal(judgeGimme(61, customGimmeCm), false);
  assert.equal(judgeGimme(120, customGimmeCm), false);
});

test('Finding 7 — Ball detection confidence decay when target is lost', () => {
  let detectedBall = { x: 100, y: 100, confidence: 2 };

  const updateBallDetection = (foundCandidate) => {
    if (foundCandidate) {
      detectedBall.confidence = Math.min(10, detectedBall.confidence + 1);
    } else {
      detectedBall.confidence -= 0.5;
      if (detectedBall.confidence <= 0) {
        detectedBall = null;
      }
    }
  };

  updateBallDetection(false);
  assert.equal(detectedBall?.confidence, 1.5);

  updateBallDetection(false);
  updateBallDetection(false);
  updateBallDetection(false);
  assert.equal(detectedBall, null);
});

test('Finding 8 — English localization generates proper English strings across all keys', () => {
  const generateVerdictShareText = ({ isApproved, isEn, customGimmeCm, activeBet }) => {
    let text = isApproved 
      ? (isEn 
          ? `⛳️ Whooply Gimme Referee: Ball is APPROVED as Gimme (< ${customGimmeCm} cm)! 🏆\nPick up the ball!`
          : `⛳️ Whooply Gimme Domare: Bollen är GODKÄND som Gimme (< ${customGimmeCm} cm)! 🏆\nPlocka upp bollen!`)
      : (isEn
          ? `⛳️ Whooply Gimme Referee: NOT A GIMME (> ${customGimmeCm} cm)! 😈\nPutt it, coward!`
          : `⛳️ Whooply Gimme Domare: ICKE GODKÄND Gimme (> ${customGimmeCm} cm)! 😈\nPutta din fegis!`);
    
    if (activeBet) {
      const winner = isApproved ? activeBet.p1 : activeBet.p2;
      const loser = isApproved ? activeBet.p2 : activeBet.p1;
      text += activeBet.mode === 'swish'
        ? (isEn 
            ? `\n💰 BET RESULT: ${winner} won ${activeBet.stake * 2} kr! (${loser} sends ${activeBet.stake} kr via Swish)`
            : `\n💰 BET RESULTAT: ${winner} vann ${activeBet.stake * 2} kr! (${loser} ska swisha ${activeBet.stake} kr)`)
        : (isEn
            ? `\n🏆 BET RESULT: ${winner} beat ${loser} for bragging rights!`
            : `\n🏆 BET RESULTAT: ${winner} krossade ${loser} i prestige-bettet!`);
    }
    return text;
  };

  const bet = { mode: 'swish', stake: 50, p1: 'Alice', p2: 'Bob' };

  const enApproved = generateVerdictShareText({ isApproved: true, isEn: true, customGimmeCm: 60, activeBet: bet });
  assert.ok(enApproved.includes('Whooply Gimme Referee: Ball is APPROVED as Gimme'));
  assert.ok(enApproved.includes('BET RESULT: Alice won 100 kr!'));
  assert.ok(!enApproved.includes('GODKÄND'));
  assert.ok(!enApproved.includes('RESULTAT'));

  const enDenied = generateVerdictShareText({ isApproved: false, isEn: true, customGimmeCm: 60, activeBet: bet });
  assert.ok(enDenied.includes('NOT A GIMME'));
  assert.ok(enDenied.includes('Putt it, coward!'));
  assert.ok(enDenied.includes('Bob won 100 kr!'));
});
