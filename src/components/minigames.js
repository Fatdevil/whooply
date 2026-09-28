// ── Components: Minigames Arcade ────────────────────────
import { showModal, closeModal, isGameInProgress } from './modal.js';
import { launchConfetti, escapeHtml, showToast, createSwishUrl, sanitizeUrl, safeImageSrc, normalizeSwedishPhone, getAppBaseUrl, parseServerDate } from '../utils.js';
import { 
  getFriends, 
  createDuel, 
  getDuel, 
  respondDuel, 
  submitDuelRoll, 
  getDuelSettlements, 
  settleDuel, 
  settleDuelsWithFriend,
  createPartyRoom,
  getPartyRoom,
  joinPartyRoom,
  inviteToParty,
  startPartyGame,
  leavePartyRoom,
  submitPartyTime,
  submitPartyScore,
  resolvePartyTie,
  submitSpaceSoloScore,
  startSpaceSoloRound,
  getServerTime,
  getSpaceLeaderboard,
  getPartyRoomQR,
  createAnyBet,
  getAnyBets,
  getAnyBet,
  joinAnyBet,
  declineAnyBet,
  cancelAnyBet,
  settleAnyBet,
  createFlashBet,
  getActiveFlashBets,
  getFlashBet,
  placeFlashBet,
  settleFlashBet,
  deleteFlashBet,
  getTournaments,
  getActiveEvent,
  getTabExpense,
  deleteTabExpense,
  startMafiaGame,
  getMyMafiaRole,
  submitMafiaNightAction,
  advanceMafiaPhase,
  voteMafiaLynch,
  createLovenGame,
  getLovenGames,
  getLovenGame,
  joinLovenGame,
  settleLovenGame,
  cancelLovenGame,
  lockLovenGame
} from '../api.js';
import { BJORKLOVEN_ROSTER, NO_GOALS_OPTION, COMMON_OPPONENTS } from '../data/bjorklovenRoster.js';

let currentActiveEvent = null;
let activeEventFetchedAt = 0;

export async function getOrFetchActiveEvent() {
  const now = Date.now();
  if (now - activeEventFetchedAt < 20000 && currentActiveEvent !== null) {
    return currentActiveEvent;
  }
  try {
    const res = await getActiveEvent();
    currentActiveEvent = res?.activeEvent || null;
    activeEventFetchedAt = now;
  } catch {
    currentActiveEvent = null;
  }
  return currentActiveEvent;
}
import { compressImage } from '../imageUtils.js';

import { getStoredUser, getToken } from '../auth.js';
import { t, getLang } from '../i18n.js';
import { openInstantLiveModal, openLiveStreamModal } from './livestream.js';

// Party results point to The Tab for paying (one place, netted with everything else)
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.btn-space-goto-tab')) return;
    closeModal();
    window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'leaderboard', tab: 'overview' } }));
  });
}

// ── Web Audio Synth SFX (Zero-dependency & instant) ───────
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq = 440, type = 'sine', duration = 0.15, gainLevel = 0.1) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainLevel, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function playCoinSound() {
  playTone(987.77, 'sine', 0.2, 0.12);
  setTimeout(() => playTone(1318.51, 'sine', 0.3, 0.1), 80);
}

function playTickSound() {
  playTone(800, 'triangle', 0.04, 0.05);
}

function playWinSound() {
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 'triangle', 0.25, 0.15), i * 90);
  });
}

function playDiceSound() {
  for (let i = 0; i < 5; i++) {
    setTimeout(() => playTone(150 + Math.random() * 200, 'square', 0.04, 0.06), i * 60);
  }
}

function playLaserSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

function playExplosionSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(50, ctx.currentTime + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  } catch (e) {}
}

function playUfoSound() {
  try {
    playTone(550, 'sawtooth', 0.08, 0.08);
    setTimeout(() => playTone(650, 'sawtooth', 0.08, 0.08), 90);
  } catch (e) {}
}

// ── Virtual Arcade Chips ────────────────────────────────
function getChips() {
  const saved = localStorage.getItem('whooply_arcade_chips');
  return saved !== null ? parseInt(saved, 10) : 100;
}

function setChips(amount) {
  localStorage.setItem('whooply_arcade_chips', String(Math.max(0, amount)));
  window.dispatchEvent(new CustomEvent('chips-updated', { detail: { chips: amount } }));
}

// ── 1. Roller Ticker HTML (2 Dynamic Rows) ─────────────────
export function renderMinigamesRoller() {
  // Row 1: Snabba Avgöranden & Vardagsbet (Fast Action, Instant Settle)
  const row1Games = [
    {
      id: 'gimme',
      name: t('arcade.gimme'),
      tag: t('arcade.gimmeTag'),
      title: t('arcade.gimmeTitle'),
      iconHtml: `<img src="/golf-gimme.png" alt="${t('arcade.gimme')}" style="width: 42px; height: 38px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'flashbet',
      name: t('arcade.flashbet'),
      tag: t('arcade.flashbetTag'),
      title: t('arcade.flashbetTitle'),
      iconHtml: `<span style="font-size: 1.75rem; line-height: 1; display: inline-block; filter: drop-shadow(0 2px 6px rgba(255,215,0,0.7));">⚡</span>`
    },
    {
      id: 'coin-flip',
      name: t('arcade.coinFlip'),
      tag: t('arcade.coinFlipTag'),
      title: t('arcade.coinFlipTitle'),
      iconHtml: `<img src="/coin-head.jpg" alt="${t('arcade.coinFlip')}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; box-shadow: 0 2px 6px rgba(0,0,0,0.5); border: 1px solid var(--gold);" />`
    },
    {
      id: 'anybet',
      name: t('arcade.anybet'),
      tag: t('arcade.anybetTag'),
      title: t('arcade.anybetTitle'),
      iconHtml: `<img src="/handshake-gold.png" alt="${t('arcade.anybet')}" style="width: 38px; height: 38px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'flashlive',
      name: t('arcade.flashlive'),
      tag: t('arcade.flashliveTag'),
      title: t('arcade.flashliveTitle'),
      iconHtml: `<span style="font-size: 2.2rem; line-height: 1; filter: drop-shadow(0 0 10px rgba(255, 51, 75, 0.9)); animation: pulse 1.5s infinite;">🔴</span>`
    }
  ];

  // Row 2: Party, Häng & Större Tävlingar (Group Entertainment & Jackpot)
  const row2Games = [
    {
      id: 'mafia',
      name: t('arcade.mafia'),
      tag: t('arcade.mafiaTag'),
      title: t('arcade.mafiaTitle'),
      iconHtml: `<img src="/mafia-gold.png" alt="${t('arcade.mafia')}" style="width: 40px; height: 40px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'blind10',
      name: t('arcade.blind10'),
      tag: t('arcade.blind10Tag'),
      title: t('arcade.blind10Title'),
      iconHtml: `<img src="/stopwatch-gold.png" alt="${t('arcade.blind10')}" style="width: 36px; height: 36px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'wheel',
      name: t('arcade.wheel'),
      tag: t('arcade.wheelTag'),
      title: t('arcade.wheelTitle'),
      iconHtml: `<img src="/tab-roulette-card.png" alt="${t('arcade.wheel')}" style="width: 44px; height: 30px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'space-invaders',
      name: t('arcade.spaceInvaders'),
      tag: t('arcade.spaceInvadersTag'),
      title: t('arcade.spaceInvadersTitle'),
      iconHtml: `<img src="/space-invaders.png" alt="${t('arcade.spaceInvaders')}" style="width: 38px; height: 38px; object-fit: contain; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'slots',
      name: t('arcade.slots'),
      tag: t('arcade.slotsTag'),
      title: t('arcade.slotsTitle'),
      iconHtml: `<img src="/slots-machine.png" alt="${t('arcade.slots')}" style="width: 36px; height: 36px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'loven-game',
      name: t('arcade.lovenGame'),
      tag: t('arcade.lovenGameTag'),
      title: t('arcade.lovenGameTitle'),
      iconHtml: `<img src="/loven-game.png" alt="${t('arcade.lovenGame')}" style="width: 38px; height: 38px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    }
  ];

  const byId = Object.fromEntries([...row1Games, ...row2Games].map(g => [g.id, g]));
  // Swipe-yourself rows (no auto-scroll): quick bets first, party games second
  const quickRow = ['flashbet', 'flashlive', 'anybet', 'coin-flip', 'gimme'].map(id => byId[id]).filter(Boolean);
  const partyRow = ['mafia', 'blind10', 'wheel', 'space-invaders', 'slots', 'loven-game'].map(id => byId[id]).filter(Boolean);

  const renderCard = (g) => `
    <button type="button" class="minigame-card arcade-card" data-game="${g.id}" title="${g.title}">
      <span class="minigame-card-icon">${g.iconHtml}</span>
      <span class="minigame-card-name">${g.name}</span>
      <span class="minigame-card-tag">${g.tag}</span>
    </button>
  `;

  return `
    <div class="minigames-section animate-in">
      <div class="minigames-header">
        <div class="minigames-title">
          <span>${t('arcade.title')}</span>
        </div>
        <button type="button" id="btn-arcade-view-all" class="arcade-view-all-btn" title="${t('arcade.allTitle')}">
          ${t('arcade.viewAll')}
        </button>
      </div>

      <div class="arcade-row-label">⚡ ${t('arcade.rowQuick')}</div>
      <div class="arcade-row" id="minigames-row-quick">
        ${quickRow.map(renderCard).join('')}
      </div>

      <div class="arcade-row-label">🎉 ${t('arcade.rowParty')}</div>
      <div class="arcade-row" id="minigames-row-party">
        ${partyRow.map(renderCard).join('')}
      </div>
    </div>
  `;
}

// ── 2. "All Games" Grid Modal ────────────────────────────
export function openAllArcadeGamesModal() {
  const isEn = getLang() === 'en';
  const games = [
    {
      id: 'flashlive',
      name: t('arcade.flashlive'),
      tag: t('arcade.flashliveTag'),
      desc: t('arcade.flashliveDesc'),
      iconHtml: `<span style="font-size: 2.4rem; line-height: 1; filter: drop-shadow(0 0 10px rgba(255, 51, 75, 0.9)); animation: pulse 1.5s infinite;">🔴</span>`
    },
    {
      id: 'coin-flip',
      name: t('arcade.coinFlip'),
      tag: t('arcade.coinFlipTag'),
      desc: t('arcade.coinFlipDesc'),
      iconHtml: `<img src="/coin-head.jpg" alt="${t('arcade.coinFlip')}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.5); border: 2px solid var(--gold);" />`
    },
    {
      id: 'slots',
      name: t('arcade.slots'),
      tag: t('arcade.slotsTag'),
      desc: t('arcade.slotsDesc'),
      iconHtml: `<img src="/slots-machine.png" alt="${t('arcade.slots')}" style="width: 42px; height: 42px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'wheel',
      name: t('arcade.wheel'),
      tag: t('arcade.wheelTag'),
      desc: t('arcade.wheelDesc'),
      iconHtml: `<img src="/tab-roulette-card.png" alt="${t('arcade.wheel')}" style="width: 48px; height: 32px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'blind10',
      name: t('arcade.blind10'),
      tag: t('arcade.blind10Tag'),
      desc: t('arcade.blind10Desc'),
      iconHtml: `<img src="/stopwatch-gold.png" alt="${t('arcade.blind10')}" style="width: 40px; height: 40px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'anybet',
      name: t('arcade.anybet'),
      tag: t('arcade.anybetTag'),
      desc: t('arcade.anybetDesc'),
      iconHtml: `<img src="/handshake-gold.png" alt="${t('arcade.anybet')}" style="width: 42px; height: 42px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'flashbet',
      name: t('arcade.flashbet'),
      tag: t('arcade.flashbetTag'),
      desc: t('arcade.flashbetDesc'),
      iconHtml: `<span style="font-size: 2.1rem; line-height: 1; display: inline-block; filter: drop-shadow(0 2px 8px rgba(255,215,0,0.7));">⚡</span>`
    },
    {
      id: 'space-invaders',
      name: t('arcade.spaceInvaders'),
      tag: t('arcade.spaceInvadersTag'),
      desc: t('arcade.spaceInvadersDesc'),
      iconHtml: `<img src="/space-invaders.png" alt="${t('arcade.spaceInvaders')}" style="width: 44px; height: 44px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'mafia',
      name: t('arcade.mafia'),
      tag: t('arcade.mafiaTag'),
      desc: t('arcade.mafiaDesc'),
      iconHtml: `<img src="/mafia-gold.png" alt="${t('arcade.mafia')}" style="width: 44px; height: 44px; object-fit: contain; filter: drop-shadow(0 3px 8px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'gimme',
      name: t('arcade.gimme'),
      tag: t('arcade.gimmeTag'),
      desc: t('arcade.gimmeDesc'),
      iconHtml: `<img src="/golf-gimme.png" alt="${t('arcade.gimme')}" style="width: 48px; height: 44px; object-fit: contain; filter: drop-shadow(0 3px 8px rgba(0,0,0,0.6));" />`
    },
    {
      id: 'loven-game',
      name: t('arcade.lovenGame'),
      tag: t('arcade.lovenGameTag'),
      desc: t('arcade.lovenGameDesc'),
      iconHtml: `<img src="/loven-game.png" alt="${t('arcade.lovenGame')}" style="width: 44px; height: 44px; object-fit: contain; filter: drop-shadow(0 3px 8px rgba(0,0,0,0.6));" />`
    }
  ];

  const contentHtml = `
    <div class="arcade-all-modal">
      <p class="text-secondary mb-md" style="font-size: 0.85rem; text-align: center;">
        ${t('arcade.allDesc')}
      </p>
      <div class="arcade-all-grid">
        ${games.map(g => `
          <div class="arcade-grid-card" data-arcade-launch="${g.id}">
            <div class="arcade-grid-icon">
              ${g.iconHtml}
            </div>
            <div class="arcade-grid-info">
              <div class="arcade-grid-title-row">
                <span class="arcade-grid-name">${g.name}</span>
                <span class="arcade-grid-tag">${g.tag}</span>
              </div>
              <p class="arcade-grid-desc">${escapeHtml(g.desc)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const { close, root } = showModal(
    `${t('arcade.allTitle')}`, 
    contentHtml, 
    { isGame: true, preventBackdropClose: true, confirmClose: false }
  );

  root.querySelectorAll('[data-arcade-launch]').forEach(card => {
    card.addEventListener('click', () => {
      const game = card.getAttribute('data-arcade-launch');
      close();
      launchGameById(game);
    });
  });
}

// Helper to launch any game by ID
export function launchGameById(game) {
  if (game === 'flashlive') openInstantLiveModal();
  else if (game === 'coin-flip') openCoinFlipModal();
  else if (game === 'slots') openSlotsModal();
  else if (game === 'wheel') openWheelModal();
  else if (game === 'blind10') openBlind10Modal();
  else if (game === 'anybet') openAnyBetModal();
  else if (game === 'flashbet') openFlashBetModal();
  else if (game === 'space-invaders') openSpaceInvadersModal();
  else if (game === 'mafia') openMafiaModal();
  else if (game === 'gimme') openGimmeModal();
  else if (game === 'loven-game') openLovenGameModal();
}

// ── 3. Event Listeners for Roller (Native Swipe + Drag + Click for both rows) ──
export function attachMinigamesListeners() {
  // "Visa alla ⊞" button
  document.getElementById('btn-arcade-view-all')?.addEventListener('click', () => {
    openAllArcadeGamesModal();
  });

  // The rows scroll natively (swipe); a tap on a card starts the game. No auto-scroll
  // loop any more: it kept running forever after leaving the page and drained battery.
  document.querySelectorAll('.arcade-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const card = e.target.closest('.minigame-card');
      const game = card?.getAttribute('data-game');
      if (game) launchGameById(game);
    });
  });

  // Open Swishlistan modal
  document.getElementById('btn-open-swishlist')?.addEventListener('click', openSwishlistModal);

  // Initialize global real-time duel incoming challenge listener
  setupGlobalDuelListener();
}

// ────────────────────────────────────────────────────────
// 🪙 GAME 1: SINGLA SLANT (Coin Flip - Social Utility Tool)
// ────────────────────────────────────────────────────────
function openCoinFlipModal() {
  const isEn = getLang() === 'en';

  let streak = 0;
  let isFlipping = false;
  let currentRotation = 0;
  let chosenSide = 'head'; // 'head' | 'tails'

  function buildModalHtml() {
    return `
      <div class="text-center" style="padding: var(--space-xs) 0;">
        <p class="game-modal-subheading">${t('arcade.coinFlipDesc')}</p>
        <!-- Side Picker -->
        <div id="coin-side-picker-box" class="mb-sm">
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;" id="coin-side-prompt-label">
            ${isEn ? 'Choose your side:' : 'Välj sida:'}
          </div>
          <div class="flex gap-sm mb-xs" style="justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary coin-pick-btn ${chosenSide === 'head' ? 'active' : ''}" data-side="head" style="flex: 1 1 120px; min-width: 0; ${chosenSide === 'head' ? 'border-color: var(--gold); background: rgba(255,215,0,0.15);' : ''} font-weight: 700; white-space: nowrap;">
              🪙 HEAD (Krona)
            </button>
            <button type="button" class="btn btn-secondary coin-pick-btn ${chosenSide === 'tails' ? 'active' : ''}" data-side="tails" style="flex: 1 1 120px; min-width: 0; ${chosenSide === 'tails' ? 'border-color: var(--gold); background: rgba(255,215,0,0.15);' : ''} font-weight: 700; white-space: nowrap;">
              🪙 TAILS (Klave)
            </button>
          </div>
        </div>

        <!-- Coin 3D Stage -->
        <div class="coin-stage">
          <div class="coin-flip-coin" id="game-coin">
            <div class="coin-side coin-front">
              <img src="/coin-head.jpg" alt="HEAD" class="coin-chip-img" />
            </div>
            <div class="coin-side coin-back">
              <img src="/coin-tail.jpg" alt="TAILS" class="coin-chip-img" />
            </div>
          </div>
        </div>

        <!-- Result / Prompt Banner -->
        <div id="coin-result-banner" class="mb-sm" style="font-family: var(--font-heading); font-size: 1.05rem; font-weight: 800; min-height: 28px; color: var(--gold); padding: 0 8px;">
          ${t('arcade.coinFlipPrompt')}
        </div>

        <!-- Main Action Button -->
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-do-coin-flip" style="font-size: 1rem; padding: 12px; font-weight: 800;">
          ${t('arcade.coinFlipBtn')}
        </button>

        <!-- Footer / Streak -->
        <div class="flex-between" style="padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); font-size: 0.75rem;">
          <span class="text-muted">${t('arcade.coinFlipStreak')}</span>
          <span class="text-gold font-bold" id="coin-streak-val">🔥 0 ${isEn ? 'in a row' : 'i rad'}</span>
        </div>
      </div>
    `;
  }

  const coinTitleHtml = `<img src="/coin-head.jpg" alt="Coin" style="width: 22px; height: 22px; border-radius: 50%; vertical-align: -3px; margin-right: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.5);" />${t('arcade.coinFlipTitle')}`;
  const modal = showModal(coinTitleHtml, buildModalHtml(), null, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => isFlipping || streak > 0,
    confirmTexts: {
      title: isEn ? 'Exit Coin Flip?' : 'Avsluta Singla Slant?',
      message: isEn 
        ? 'Are you sure you want to leave? Your streak will be reset.' 
        : 'Är du säker på att du vill avsluta? Din vinstsvit nollställs.'
    }
  });
  modal.setBusy(() => isFlipping);

  const coinEl = document.getElementById('game-coin');
  const banner = document.getElementById('coin-result-banner');
  const streakVal = document.getElementById('coin-streak-val');
  const flipBtn = document.getElementById('btn-do-coin-flip');

  // Side selection buttons
  const pickBtns = document.querySelectorAll('.coin-pick-btn');
  pickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pickBtns.forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = '';
        b.style.background = '';
      });
      btn.classList.add('active');
      btn.style.borderColor = 'var(--gold)';
      btn.style.background = 'rgba(255,215,0,0.15)';
      chosenSide = btn.dataset.side;
    });
  });

  function spinCoinAnimation(outcome, targetDeg) {
    if (isFlipping) return;
    isFlipping = true;
    flipBtn.disabled = true;
    banner.textContent = t('arcade.coinFlipSpinning');
    banner.style.color = 'var(--text-secondary)';
    playCoinSound();

    currentRotation += targetDeg;
    coinEl.style.transform = `rotateY(${currentRotation}deg)`;

    return new Promise(resolve => {
      setTimeout(() => {
        isFlipping = false;
        resolve();
      }, 1800);
    });
  }

  flipBtn?.addEventListener('click', async () => {
    if (isFlipping) return;

    const isHead = Math.random() < 0.5;
    const outcome = isHead ? 'head' : 'tails';
    const extraTurns = 5 + Math.floor(Math.random() * 3);
    const targetDeg = (extraTurns * 360) + (isHead ? 0 : 180);

    await spinCoinAnimation(outcome, targetDeg);

    const won = chosenSide === outcome;
    const sideName = isHead ? 'HEAD' : 'TAILS';
    if (won) {
      streak++;
      playWinSound();
      launchConfetti();
      banner.textContent = isEn 
        ? `🎉 It landed on ${sideName}! You guessed RIGHT!` 
        : `🎉 Det blev ${sideName}! Du gissade RÄTT!`;
      banner.style.color = '#4ade80';
    } else {
      streak = 0;
      banner.textContent = isEn
        ? `It landed on ${sideName}! Better luck next flip!`
        : `Det blev ${sideName}! Bättre lycka nästa kast!`;
      banner.style.color = 'var(--text-primary)';
    }
    streakVal.textContent = `🔥 ${streak} ${isEn ? 'in a row' : 'i rad'}`;
    flipBtn.disabled = false;
  });
}

// ────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────
// 🎰 GAME 2: ENARMAD BANDIT (Vegas 777 Slots)
// ────────────────────────────────────────────────────────
function openSlotsModal() {
  const isEn = getLang() === 'en';
  const symbols = ['🍒', '🍋', '🍺', '🔔', '💎', '7️⃣', 'WHOOPLY'];
  let currentChips = getChips();
  let currentBet = 10;
  let isSpinning = false;

  function formatSymbol(symbol) {
    if (symbol === 'WHOOPLY') {
      return `<img src="/chip-malta.png" alt="Whooply" class="slot-chip-img" />`;
    }
    return symbol;
  }

  const slotsTitleHtml = `<img src="/slots-machine.png" alt="Slots" style="width: 24px; height: 24px; vertical-align: -4px; margin-right: 6px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));" />${t('arcade.slotsTitle')}`;
  const { close, root, setBusy } = showModal(slotsTitleHtml, `
    <div class="text-center" style="padding: var(--space-xs) 0;">
      <p class="game-modal-subheading">${t('arcade.slotsDesc')}</p>
      <!-- Chips & Bet Bar -->
      <div class="flex-between mb-sm" style="align-items: center; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: var(--radius-md);">
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${t('arcade.slotsChips')}</span>
          <span class="text-gold font-bold" id="slot-chips-display" style="font-size: 1rem; margin-left: 4px;">💰 ${currentChips}</span>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" id="btn-refill-chips" style="font-size: 0.7rem; padding: 2px 8px;">
          ${t('arcade.slotsRefill')}
        </button>
      </div>

      <!-- Slots Cabinet -->
      <div class="slots-cabinet mb-md">
        <div class="slots-window">
          <div class="slot-reel" id="reel-1"><div class="slot-symbol-wrap">${formatSymbol('WHOOPLY')}</div></div>
          <div class="slot-reel" id="reel-2"><div class="slot-symbol-wrap">7️⃣</div></div>
          <div class="slot-reel" id="reel-3"><div class="slot-symbol-wrap">${formatSymbol('WHOOPLY')}</div></div>
        </div>
      </div>

      <!-- Result Banner -->
      <div id="slot-banner" class="mb-md" style="font-family: var(--font-heading); font-size: 1rem; font-weight: 700; min-height: 24px; color: var(--gold);">
        ${t('arcade.slotsPrompt')}
      </div>

      <!-- Bet Selector -->
      <div class="flex gap-xs mb-md" style="justify-content: center; align-items: center;">
        <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 4px;">${t('arcade.slotsBet')}</span>
        <button type="button" class="btn btn-secondary btn-sm slot-bet-btn active" data-bet="10" style="border-color: var(--gold);">10</button>
        <button type="button" class="btn btn-secondary btn-sm slot-bet-btn" data-bet="25">25</button>
        <button type="button" class="btn btn-secondary btn-sm slot-bet-btn" data-bet="50">50</button>
      </div>

      <!-- Spin Button -->
      <button type="button" class="btn btn-primary btn-block" id="btn-slot-spin" style="font-size: 1.1rem; padding: 14px; font-weight: 800; letter-spacing: 0.05em;">
        ${t('arcade.slotsBtn')}
      </button>

      <!-- Paytable note -->
      <div class="text-muted mt-sm" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;">
        <span style="color: var(--gold); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
          <img src="/chip-malta.png" style="width: 14px; height: 14px; object-fit: contain;" /> x3 Jackpot 50x
        </span> · 
        <span>7️⃣7️⃣7️⃣ 30x</span> · 
        <span>${isEn ? '3 of a kind 15x' : '3 lika 15x'}</span> · 
        <span>${isEn ? 'Pair 3-5x' : '2 lika 3-5x'}</span>
      </div>
    </div>
  `, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: true,
    confirmTexts: {
      title: isEn ? 'Exit Slots?' : 'Lämna Slotmaskinen?',
      message: isEn 
        ? 'Are you sure you want to leave the slot machine?' 
        : 'Vill du avsluta och lämna slotmaskinen?'
    }
  });
  setBusy(() => isSpinning);

  const chipsDisplay = document.getElementById('slot-chips-display');
  const banner = document.getElementById('slot-banner');
  const spinBtn = document.getElementById('btn-slot-spin');
  const refillBtn = document.getElementById('btn-refill-chips');
  const reels = [
    document.getElementById('reel-1'),
    document.getElementById('reel-2'),
    document.getElementById('reel-3')
  ];

  // Bet buttons
  document.querySelectorAll('.slot-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.slot-bet-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = '';
      });
      btn.classList.add('active');
      btn.style.borderColor = 'var(--gold)';
      currentBet = parseInt(btn.dataset.bet, 10);
    });
  });

  // Refill chips
  refillBtn?.addEventListener('click', () => {
    currentChips += 100;
    setChips(currentChips);
    chipsDisplay.textContent = `💰 ${currentChips}`;
    banner.textContent = t('arcade.slotsRefilled');
  });

  // Spin
  spinBtn?.addEventListener('click', () => {
    if (isSpinning) return;
    if (currentChips < currentBet) {
      banner.textContent = t('arcade.slotsOutOfChips');
      banner.style.color = '#ef4444';
      return;
    }

    currentChips -= currentBet;
    setChips(currentChips);
    chipsDisplay.textContent = `💰 ${currentChips}`;

    isSpinning = true;
    spinBtn.disabled = true;
    banner.textContent = t('arcade.slotsSpinning');
    banner.style.color = 'var(--text-secondary)';

    // Start spin animation
    reels.forEach(r => r.classList.add('spinning'));

    // Sound intervals while spinning
    const spinAudioInterval = setInterval(playTickSound, 120);

    // Results
    const finalSymbols = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];

    // Staggered stop
    setTimeout(() => {
      stopReel(0, finalSymbols[0]);
    }, 700);

    setTimeout(() => {
      stopReel(1, finalSymbols[1]);
    }, 1100);

    setTimeout(() => {
      stopReel(2, finalSymbols[2]);
      clearInterval(spinAudioInterval);
      evaluateSlotWin(finalSymbols);
      isSpinning = false;
      spinBtn.disabled = false;
    }, 1500);
  });

  function stopReel(index, symbol) {
    reels[index].classList.remove('spinning');
    reels[index].querySelector('.slot-symbol-wrap').innerHTML = formatSymbol(symbol);
    playTone(300 + index * 100, 'triangle', 0.1, 0.15);
  }

  function evaluateSlotWin(results) {
    const [s1, s2, s3] = results;
    let multiplier = 0;
    let winMessage = '';

    if (s1 === s2 && s2 === s3) {
      if (s1 === 'WHOOPLY') {
        multiplier = 50;
        winMessage = isEn 
          ? `🔥 WHOOPLY MEGA JACKPOT! +${currentBet * multiplier} CHIPS! 🔥`
          : `🔥 WHOOPLY MEGA JACKPOT! +${currentBet * multiplier} MARKER! 🔥`;
      } else if (s1 === '7️⃣') {
        multiplier = 30;
        winMessage = isEn
          ? `7️⃣ 7️⃣ 7️⃣ VEGAS JACKPOT! +${currentBet * multiplier} CHIPS! 🎉`
          : `7️⃣ 7️⃣ 7️⃣ VEGAS JACKPOT! +${currentBet * multiplier} MARKER! 🎉`;
      } else {
        multiplier = 15;
        winMessage = isEn
          ? `🎉 3 OF A KIND! 3x ${s1}! +${currentBet * multiplier} CHIPS!`
          : `🎉 TRIPLAR! 3x ${s1}! +${currentBet * multiplier} MARKER!`;
      }
    } else if (s1 === s2 || s2 === s3 || s1 === s3) {
      const match = (s1 === s2) ? s1 : (s2 === s3 ? s2 : s1);
      multiplier = (match === 'WHOOPLY') ? 5 : 3;
      const matchLabel = match === 'WHOOPLY' ? (isEn ? 'Whooply chips' : 'Whooply-chips') : match;
      winMessage = isEn
        ? `✨ Pair of ${matchLabel}! Won +${currentBet * multiplier} chips!`
        : `✨ Par i ${matchLabel}! Vinst +${currentBet * multiplier} marker!`;
    }

    if (multiplier > 0) {
      const winAmount = currentBet * multiplier;
      currentChips += winAmount;
      setChips(currentChips);
      chipsDisplay.textContent = `💰 ${currentChips}`;
      banner.textContent = winMessage;
      banner.style.color = '#4ade80';
      playWinSound();
      if (multiplier >= 15) launchConfetti();
    } else {
      banner.textContent = t('arcade.slotsNoWin');
      banner.style.color = 'var(--text-muted)';
    }
  }
}

// ────────────────────────────────────────────────────────
// 💳 GAME 3: NOT-ROULETTE / TAB-ROULETTE (Party & Wheel)
// ────────────────────────────────────────────────────────
function openWheelModal() {
  const isEn = getLang() === 'en';
  const currentUser = getStoredUser();
  const PALETTE = [
    '#e63946', '#f59e0b', '#10b981', '#3b82f6',
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
    '#f97316', '#6366f1', '#14b8a6', '#d946ef'
  ];
  const SIZE = 280;
  const R = SIZE / 2;
  const TAU = Math.PI * 2;
  const POINTER = -Math.PI / 2; // the needle sits at the top
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function getSavedParticipants() {
    try {
      const raw = localStorage.getItem('whooply_wheel_participants');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : null;
    } catch {
      return null;
    }
  }

  function saveParticipants(list) {
    try {
      localStorage.setItem('whooply_wheel_participants', JSON.stringify(list || []));
    } catch {}
  }

  let savedMode = null;
  try { savedMode = localStorage.getItem('whooply_wheel_mode'); } catch {}
  let activePresetKey = (savedMode === 'beer' || savedMode === 'choice') ? savedMode : 'tab';
  let participants = getSavedParticipants() || [];
  let rotation = 0;         // radians, drawn straight onto the canvas
  let isSpinning = false;
  let winnerIndex = null;   // lit up after a spin until the wheel changes
  let userFriends = null;

  // Plain names on the wheel; the mode shows in the hub and the result
  function getActiveItems() {
    if (activePresetKey === 'choice') return isEn ? ['YES', 'NO'] : ['JA', 'NEJ'];
    return participants;
  }

  function getPromptText() {
    if (activePresetKey === 'choice') return t('arcade.wheelPromptChoice');
    if (participants.length < 2) return t('arcade.wheelEmpty');
    return activePresetKey === 'beer' ? t('arcade.wheelPromptBeer') : t('arcade.wheelPromptTab');
  }

  const wheelTitleHtml = `<img src="/tab-roulette-card.png" alt="Not-Roulette" style="width: 32px; height: 22px; object-fit: contain; vertical-align: -3px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));" />${t('arcade.wheelTitle')}`;
  const { close, root, setBusy } = showModal(wheelTitleHtml, `
    <div class="text-center" style="padding: var(--space-xs) 0;">
      <p class="game-modal-subheading">${t('arcade.wheelDesc')}</p>

      <div class="wheel-preset-pills" id="wheel-presets-container">
        <button type="button" class="wheel-preset-pill ${activePresetKey === 'tab' ? 'active' : ''}" data-preset="tab">
          💳 ${isEn ? 'The Bill' : 'Krognotan'}
        </button>
        <button type="button" class="wheel-preset-pill ${activePresetKey === 'beer' ? 'active' : ''}" data-preset="beer">
          🍻 ${isEn ? 'Beer Round' : 'Ölrunda'}
        </button>
        <button type="button" class="wheel-preset-pill ${activePresetKey === 'choice' ? 'active' : ''}" data-preset="choice">
          🪙 ${isEn ? 'Yes / No' : 'Ja / Nej'}
        </button>
      </div>

      <div class="wheel-container">
        <div class="wheel-pointer" id="wheel-pointer"></div>
        <canvas id="wheel-canvas" class="wheel-canvas" role="img" aria-label="${isEn ? 'Spinning wheel' : 'Lyckohjul'}"></canvas>
        <button type="button" class="wheel-center-hub" id="wheel-center-hub" aria-label="${isEn ? 'Spin' : 'Snurra'}">💳</button>
      </div>

      <div id="wheel-result" aria-live="polite">
        <div id="wheel-result-banner" class="wheel-prompt">${escapeHtml(getPromptText())}</div>
      </div>

      <button type="button" class="btn btn-primary btn-block mb-md" id="btn-spin-wheel" style="font-size: 1.1rem; padding: 12px; font-weight: 800; letter-spacing: 0.05em;">
        ${t('arcade.wheelBtn')}
      </button>

      <div id="wheel-participants-box" class="wheel-people" style="display: ${activePresetKey === 'choice' ? 'none' : 'block'};">
        <div class="flex-between mb-xs" style="align-items: center;">
          <span class="wheel-people-title">
            ${t('arcade.wheelItemsCount')} (<span id="wheel-items-count">${participants.length}</span>)
          </span>
          <button type="button" class="btn btn-ghost btn-xs" id="wheel-clear-btn" style="color: var(--text-muted); font-size: 0.72rem; padding: 2px 6px;">
            ${t('arcade.wheelClearAll')}
          </button>
        </div>
        <div id="wheel-tags-wrap" class="wheel-tags-wrap"></div>

        <div class="flex gap-xs" style="margin: 4px 0 10px;">
          <input type="text" id="wheel-new-item-input" class="form-input" placeholder="${t('arcade.wheelInputPlaceholder')}" maxlength="20" style="padding: 6px 10px; font-size: 0.85rem; flex: 1;" />
          <button type="button" class="btn btn-secondary btn-sm" id="wheel-add-item-btn" style="padding: 6px 12px; font-size: 0.8rem; white-space: nowrap; font-weight: 700;">
            ${t('arcade.wheelAddBtn')}
          </button>
        </div>

        <div id="wheel-friends-drawer" style="display: none;">
          <div class="flex-between mb-xs" style="align-items: center;">
            <span class="wheel-people-title">${isEn ? 'Add friends' : 'Lägg till vänner'}</span>
            <button type="button" class="btn btn-ghost btn-xs" id="wheel-add-all-friends-btn" style="font-size: 0.7rem; padding: 2px 6px; color: var(--gold);">
              ${t('arcade.wheelAddAllFriendsBtn')}
            </button>
          </div>
          <div id="wheel-friends-list" class="wheel-tags-wrap"></div>
        </div>
      </div>
    </div>
  `, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: true,
    confirmTexts: {
      title: isEn ? 'Leave Tab-Roulette?' : 'Lämna Not-Roulette?',
      message: isEn
        ? 'Are you sure you want to leave Tab-Roulette?'
        : 'Vill du avsluta och lämna Not-Roulette?'
    }
  });
  setBusy(() => isSpinning);

  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas.getContext('2d');
  const resultEl = document.getElementById('wheel-result');
  const spinBtn = document.getElementById('btn-spin-wheel');
  const pointerEl = document.getElementById('wheel-pointer');
  const tagsWrap = document.getElementById('wheel-tags-wrap');
  const countSpan = document.getElementById('wheel-items-count');
  const itemInput = document.getElementById('wheel-new-item-input');
  const addBtn = document.getElementById('wheel-add-item-btn');
  const clearBtn = document.getElementById('wheel-clear-btn');
  const friendsDrawer = document.getElementById('wheel-friends-drawer');
  const friendsList = document.getElementById('wheel-friends-list');
  const addAllFriendsBtn = document.getElementById('wheel-add-all-friends-btn');
  const presetsContainer = document.getElementById('wheel-presets-container');
  const participantsBox = document.getElementById('wheel-participants-box');
  const hubEl = document.getElementById('wheel-center-hub');

  // Sharp on retina: draw at device resolution, show at 280 css px
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  function updateHub() {
    hubEl.textContent = activePresetKey === 'choice' ? '🪙' : activePresetKey === 'beer' ? '🍻' : '💳';
  }

  function sectorColor(i) {
    if (activePresetKey === 'choice') return i === 0 ? '#10b981' : '#ef4444';
    return PALETTE[i % PALETTE.length];
  }

  // Which sector is under the needle for a given rotation
  function sectorAt(rot, n) {
    const a = (((POINTER - rot) % TAU) + TAU) % TAU;
    return Math.floor(a / (TAU / n)) % n;
  }

  function fitLabel(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  function drawWheel() {
    const items = getActiveItems();
    const n = items.length;
    ctx.clearRect(0, 0, SIZE, SIZE);

    if (n === 0) {
      ctx.beginPath();
      ctx.fillStyle = '#161622';
      ctx.arc(R, R, R - 1, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#9ca3af';
      ctx.font = '600 12px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isEn ? 'Add participants below 👇' : 'Lägg till deltagare nedan 👇', R, R + 40);
      return;
    }

    const arc = TAU / n;
    const fontSize = n > 14 ? 11 : n > 8 ? 12 : n > 4 ? 14 : 16;
    items.forEach((label, i) => {
      const start = rotation + i * arc;
      const lit = winnerIndex === i;
      const dimmed = winnerIndex !== null && !lit;

      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.arc(R, R, R - 2, start, start + arc);
      ctx.closePath();
      ctx.fillStyle = sectorColor(i);
      ctx.fill();
      // Soft depth: lighter towards the rim
      const g = ctx.createRadialGradient(R, R, 20, R, R, R);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = g;
      ctx.fill();
      if (dimmed) {
        ctx.fillStyle = 'rgba(8,8,14,0.62)';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label along the radius, flipped on the left half so it never reads upside down
      const mid = start + arc / 2;
      const flip = Math.cos(mid) < 0;
      ctx.save();
      ctx.translate(R, R);
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.font = `${lit ? 800 : 700} ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.fillStyle = dimmed ? 'rgba(255,255,255,0.45)' : '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 3;
      const text = fitLabel(String(label), R - 44);
      ctx.fillText(text, flip ? -(R - 16) : R - 16, 0);
      ctx.restore();
    });

    // Winner sector outline
    if (winnerIndex !== null && winnerIndex < n) {
      const start = rotation + winnerIndex * arc;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.arc(R, R, R - 4, start, start + arc);
      ctx.closePath();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,215,0,0.95)';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.restore();
    }

    // Gold rim with pegs at every sector border
    ctx.beginPath();
    ctx.arc(R, R, R - 3, 0, TAU);
    ctx.strokeStyle = 'rgba(255,215,0,0.9)';
    ctx.lineWidth = 5;
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = rotation + i * arc;
      ctx.beginPath();
      ctx.arc(R + Math.cos(a) * (R - 3), R + Math.sin(a) * (R - 3), 2.6, 0, TAU);
      ctx.fillStyle = '#fff8dc';
      ctx.fill();
    }
  }

  function showPrompt() {
    resultEl.innerHTML = `<div class="wheel-prompt${activePresetKey !== 'choice' && participants.length < 2 ? ' muted' : ''}">${escapeHtml(getPromptText())}</div>`;
  }

  // Anything that changes the wheel clears the last result
  function wheelChanged() {
    winnerIndex = null;
    saveParticipants(participants);
    renderTags();
    if (userFriends) renderFriendsList();
    drawWheel();
    showPrompt();
  }

  function renderTags() {
    countSpan.textContent = participants.length;
    tagsWrap.innerHTML = participants.length
      ? participants.map((name, idx) => `
        <span class="wheel-tag" style="--dot: ${PALETTE[idx % PALETTE.length]};">
          <span class="wheel-tag-dot"></span>${escapeHtml(name)}
          <button type="button" class="wheel-tag-remove" data-index="${idx}" aria-label="${isEn ? 'Remove' : 'Ta bort'} ${escapeHtml(name)}">✕</button>
        </span>
      `).join('')
      : `<span class="text-muted" style="font-size: 0.75rem;">${escapeHtml(t('arcade.wheelEmpty'))}</span>`;

    tagsWrap.querySelectorAll('.wheel-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isSpinning) return;
        participants.splice(Number(btn.dataset.index), 1);
        wheelChanged();
      });
    });
  }

  function addItem(rawName) {
    const name = (rawName || '').trim();
    if (!name) return;
    if (participants.length >= 20) {
      showToast(isEn ? 'Max 20 participants on the wheel!' : 'Max 20 deltagare på hjulet!', 'warning');
      return;
    }
    if (participants.some(p => p.toLowerCase() === name.toLowerCase())) {
      showToast(isEn ? 'Participant already on the wheel!' : 'Deltagaren finns redan på hjulet!', 'info');
      return;
    }
    participants.push(name);
    wheelChanged();
    itemInput.value = '';
    itemInput.focus();
  }

  const friendName = (f) => f.nickname || f.realName || '';

  // Only friends who are not on the wheel yet, so nobody shows up twice
  function renderFriendsList() {
    const rest = (userFriends || []).filter(f => {
      const name = friendName(f);
      return name && !participants.some(p => p.toLowerCase() === name.toLowerCase());
    });
    friendsDrawer.style.display = rest.length ? 'block' : 'none';
    friendsList.innerHTML = rest.map(f => `
      <button type="button" class="wheel-friend-pick-btn" data-friend="${escapeHtml(friendName(f))}">
        ${f.avatarUrl ? `<img src="${sanitizeUrl(f.avatarUrl)}" alt="" />` : `<span>${escapeHtml(f.avatarEmoji) || '👤'}</span>`}
        <span>${escapeHtml(friendName(f))}</span><strong>+</strong>
      </button>
    `).join('');
    friendsList.querySelectorAll('.wheel-friend-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isSpinning) return;
        addItem(btn.dataset.friend);
      });
    });
  }

  presetsContainer.querySelectorAll('.wheel-preset-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      if (isSpinning) return;
      const key = pill.dataset.preset;
      if (key === activePresetKey) return;
      activePresetKey = key;
      try { localStorage.setItem('whooply_wheel_mode', key); } catch {}
      presetsContainer.querySelectorAll('.wheel-preset-pill').forEach(p => p.classList.toggle('active', p.dataset.preset === key));
      participantsBox.style.display = key === 'choice' ? 'none' : 'block';
      updateHub();
      wheelChanged();
    });
  });

  getFriends().then(friends => {
    userFriends = friends || [];
    // First time: start with me and a few friends
    if (participants.length === 0) {
      const initial = [];
      const myName = currentUser?.nickname || currentUser?.realName;
      if (myName) initial.push(myName);
      userFriends.slice(0, 6).forEach(f => {
        const fn = friendName(f);
        if (fn && !initial.some(n => n.toLowerCase() === fn.toLowerCase())) initial.push(fn);
      });
      if (initial.length > 0) participants = initial;
    }
    if (!isSpinning) wheelChanged();
  }).catch(() => {
    userFriends = [];
    renderFriendsList();
  });

  addAllFriendsBtn.addEventListener('click', () => {
    if (isSpinning || !userFriends?.length) return;
    let added = 0;
    userFriends.forEach(f => {
      const name = friendName(f);
      if (name && participants.length < 20 && !participants.some(p => p.toLowerCase() === name.toLowerCase())) {
        participants.push(name);
        added++;
      }
    });
    if (added) wheelChanged();
  });

  clearBtn.addEventListener('click', () => {
    if (isSpinning) return;
    participants = [];
    wheelChanged();
  });

  addBtn.addEventListener('click', () => addItem(itemInput.value));
  itemInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(itemInput.value);
    }
  });

  updateHub();
  renderTags();
  drawWheel();

  function bouncePointer() {
    pointerEl.classList.remove('tick');
    void pointerEl.offsetWidth; // restart the animation
    pointerEl.classList.add('tick');
  }

  function fairRandom(n) {
    try {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / n) * n;
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    } catch {
      return Math.floor(Math.random() * n);
    }
  }

  function showResult(items, idx) {
    const name = items[idx];
    const color = sectorColor(idx);
    let title, sub;
    if (activePresetKey === 'choice') {
      const yes = idx === 0;
      title = `${yes ? '🟢' : '🔴'} ${escapeHtml(name)}!`;
      sub = isEn ? 'The wheel has spoken.' : 'Hjulet har talat.';
    } else if (activePresetKey === 'beer') {
      title = escapeHtml(name);
      sub = escapeHtml(t('arcade.wheelWinnerBeer'));
    } else {
      title = escapeHtml(name);
      sub = isEn ? 'takes the whole bill – card out! 💳' : 'tar hela notan – fram med kortet! 💳';
    }
    resultEl.innerHTML = `
      <div class="wheel-winner-card" style="--win: ${color};">
        <div class="wheel-winner-kicker">${activePresetKey === 'choice' ? (isEn ? 'Result' : 'Resultat') : (isEn ? 'The wheel picked' : 'Hjulet valde')}</div>
        <div class="wheel-winner-name">${title}</div>
        <div class="wheel-winner-sub">${sub}</div>
        <div class="wheel-winner-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="wheel-again-btn">🔄 ${isEn ? 'Spin again' : 'Snurra igen'}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="wheel-share-btn">📤 ${isEn ? 'Share' : 'Dela'}</button>
        </div>
      </div>
    `;
    resultEl.querySelector('#wheel-again-btn').addEventListener('click', spin);
    resultEl.querySelector('#wheel-share-btn').addEventListener('click', async () => {
      const text = activePresetKey === 'choice'
        ? `🪙 Not-Roulette: ${name}!`
        : activePresetKey === 'beer'
          ? `🍻 Not-Roulette: ${name} ${t('arcade.wheelWinnerBeer')}`
          : (isEn ? `💳 Tab-Roulette: ${name} takes the whole bill!` : `💳 Not-Roulette: ${name} tar hela notan!`);
      try {
        if (navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(text);
          showToast(isEn ? 'Copied! 📋' : 'Kopierat! 📋', 'success');
        }
      } catch {}
    });
  }

  function spin() {
    if (isSpinning) return;
    const items = getActiveItems();
    const n = items.length;
    if (n < 2) {
      showToast(t('arcade.wheelMinWarning'), 'warning');
      return;
    }

    isSpinning = true;
    spinBtn.disabled = true;
    hubEl.disabled = true;
    winnerIndex = null;
    resultEl.innerHTML = `<div class="wheel-prompt spinning">${escapeHtml(t('arcade.wheelSpinning'))}</div>`;

    const arc = TAU / n;
    const idx = fairRandom(n);
    // Land somewhere inside the sector, not always dead centre
    const inside = 0.15 + Math.random() * 0.7;
    const turns = reducedMotion ? 1 : 5 + Math.floor(Math.random() * 3);
    const base = POINTER - (idx + inside) * arc;
    let end = base;
    while (end < rotation + turns * TAU) end += TAU;
    const from = rotation;
    const duration = reducedMotion ? 900 : 4800 + Math.random() * 900;
    const t0 = performance.now();
    let lastSector = sectorAt(rotation, n);
    const ease = (x) => 1 - Math.pow(1 - x, 4); // quick start, long nervous finish

    function frame(now) {
      // The dialog was closed (or replaced by a new wheel): stop quietly
      if (!canvas.isConnected) {
        isSpinning = false;
        return;
      }
      const p = Math.min(1, (now - t0) / duration);
      rotation = from + (end - from) * ease(p);
      drawWheel();
      const s = sectorAt(rotation, n);
      if (s !== lastSector) {
        lastSector = s;
        playTickSound();
        bouncePointer();
        if (p > 0.55) navigator.vibrate?.(6);
      }
      if (p < 1) {
        requestAnimationFrame(frame);
        return;
      }
      rotation = ((end % TAU) + TAU) % TAU;
      winnerIndex = sectorAt(rotation, n);
      isSpinning = false;
      spinBtn.disabled = false;
      hubEl.disabled = false;
      drawWheel();
      showResult(items, winnerIndex);
      if (activePresetKey === 'choice' && winnerIndex === 1) {
        playTone(300, 'sawtooth', 0.25, 0.1);
      } else {
        playWinSound();
        launchConfetti();
      }
      navigator.vibrate?.([30, 40, 60]);
    }
    requestAnimationFrame(frame);
  }

  spinBtn.addEventListener('click', spin);
  hubEl.addEventListener('click', spin);
}

// ────────────────────────────────────────────────────────
// 📱 PARTY ROOM QR CODE MODAL
// ────────────────────────────────────────────────────────
export async function showPartyRoomQRModal(roomCode, gameType = 'party') {
  const isEn = getLang() === 'en';
  try {
    const res = await getPartyRoomQR(roomCode, getAppBaseUrl());
    if (!res || !res.qr) throw new Error('Ingen QR');

    const isMafia = gameType === 'mafia';
    const gameName = isMafia ? 'Maffia' : 'The Blind 10.00';
    const gameIcon = isMafia ? '/mafia-gold.png' : '/stopwatch-gold.png';

    const { close, root } = showModal(`📱 ${isEn ? 'Scan QR to Join' : 'Skanna QR för att gå med'}`, `
      <div class="text-center" style="padding: 6px 0;">
        <img src="${gameIcon}" alt="" style="width: 48px; height: 48px; margin: 0 auto 10px auto; display: block; filter: drop-shadow(0 2px 10px rgba(255,215,0,0.5));" />
        <h3 style="color: var(--gold); margin-bottom: 4px; font-size: 1.15rem;">
          ${gameName}
        </h3>
        <p class="text-muted" style="font-size: 0.82rem; margin: 0 auto 14px auto; max-width: 280px;">
          ${isEn ? 'Point your phone camera at the QR code to join instantly!' : 'Rikta mobilkameran mot QR-koden för att gå med i rummet direkt!'}
        </p>

        <div style="background: #07070e; border: 2px solid var(--gold); border-radius: var(--radius-lg); padding: 14px; display: inline-block; box-shadow: 0 8px 32px rgba(255,215,0,0.25); margin-bottom: 12px;">
          <img src="${res.qr}" alt="QR Code" style="width: 210px; height: 210px; display: block; border-radius: 8px;" />
        </div>

        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">
          ${isEn ? 'Room Code' : 'Rumskod'}: <strong style="color: var(--gold); font-family: monospace; font-size: 1.2rem; letter-spacing: 3px;">${res.code || roomCode}</strong>
        </div>

        <button type="button" class="btn btn-secondary btn-block mt-md" id="btn-copy-party-qr-url" style="font-size: 0.85rem;">
          🔗 ${isEn ? 'Copy Direct Link' : 'Kopiera direktlänk'}
        </button>
      </div>
    `);

    root.querySelector('#btn-copy-party-qr-url')?.addEventListener('click', () => {
      navigator.clipboard.writeText(res.url).then(() => {
        showToast(isEn ? 'Link copied to clipboard!' : 'Länk kopierad till urklipp!', 'success');
      }).catch(() => {
        showToast(res.url, 'info');
      });
    });
  } catch (err) {
    showToast(isEn ? 'Failed to load QR code' : 'Kunde inte ladda QR-kod', 'error');
  }
}

// ────────────────────────────────────────────────────────
// ⏱️ THE BLIND 10.00 SKILLS GAME & PARTY ROOMS
// ────────────────────────────────────────────────────────
export async function openBlind10Modal(initialRoom = null) {
  const isEn = getLang() === 'en';
  const user = getStoredUser();

  let activeWs = null;
  let activeAnimationId = null;
  let activeTimeoutId = null;
  let waitingPollId = null;
  let resultsShown = false;
  let lastResultsRoom = null;
  let currentRoom = initialRoom || null;
  let selectedStake = 20;
  let invitedFriendIds = new Set();
  let currentMode = initialRoom ? 'party' : 'party'; // 'party' | 'pass'
  let friendsList = [];

  function cleanup() {
    if (activeWs) {
      try {
        activeWs.send(JSON.stringify({ action: 'leave_party', partyId: currentRoom?.id }));
        activeWs.close();
      } catch (e) {}
      activeWs = null;
    }
    if (activeAnimationId) {
      cancelAnimationFrame(activeAnimationId);
      activeAnimationId = null;
    }
    if (activeTimeoutId) {
      clearTimeout(activeTimeoutId);
      activeTimeoutId = null;
    }
    stopWaitingPoll();
  }

  const modalTitle = `<img src="/stopwatch-gold.png" alt="Stopwatch" style="width: 24px; height: 24px; vertical-align: -3px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(255,215,0,0.4));" />${t('arcade.blind10Title')}`;

  const { close, root, setBusy } = showModal(modalTitle, `
    <div id="blind10-container" style="padding: 4px 0; min-height: 380px;">
      <p class="game-modal-subheading">${t('arcade.blind10Desc')}</p>
      <div class="text-center text-muted" style="padding: 40px 0;">
        <span class="spinner">⏳</span>
      </div>
    </div>
  `, () => {
    // Closing also leaves the room, so a later round can't count you as a no-show.
    // The server refuses mid-round, so quitting a running round still counts as a DNF.
    const roomId = currentRoom?.id;
    cleanup();
    if (roomId) leavePartyRoom(roomId).catch(() => {});
  }, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => currentRoom !== null || activeAnimationId !== null || activeTimeoutId !== null,
    confirmTexts: {
      title: isEn ? 'Exit Blind 10.00?' : 'Lämna Blind 10.00?',
      message: isEn 
        ? 'Are you sure you want to leave? Any active game or party room will be closed.' 
        : 'Är du säker på att du vill avsluta? Pågående spel eller partyrum avbryts.'
    }
  });

  setBusy(() => currentRoom !== null || activeAnimationId !== null || activeTimeoutId !== null);

  const container = document.getElementById('blind10-container');
  if (!container) return;

  if (initialRoom) {
    setupPartyLobby(initialRoom);
  } else {
    try {
      if (user) {
        friendsList = await getFriends().catch(() => []);
      }
    } catch (e) {}
    renderSetupView();
  }

  // ── VIEW 1: SETUP VIEW (PARTY OR PASS & PLAY) ─────────
  function renderSetupView() {
    cleanup();

    container.innerHTML = `
      <div class="the-tab-nav" style="margin-bottom: 14px;">
        <button type="button" class="tab-nav-btn ${currentMode === 'party' ? 'active' : ''}" id="btn-mode-party">
          ${t('arcade.blind10ModeParty')}
        </button>
        <button type="button" class="tab-nav-btn ${currentMode === 'pass' ? 'active' : ''}" id="btn-mode-pass">
          ${t('arcade.blind10ModePass')}
        </button>
      </div>

      <!-- Quick How-To Card -->
      <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
        <img src="/stopwatch-gold.png" alt="Stopwatch" style="width: 44px; height: 44px; flex-shrink: 0; filter: drop-shadow(0 2px 6px rgba(255,215,0,0.3));" />
        <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-secondary);">
          ${t('arcade.blind10Desc')}
        </div>
      </div>

      ${currentMode === 'party' ? renderPartySetupHtml() : renderPassSetupHtml()}
    `;

    // Tab mode switch listeners
    document.getElementById('btn-mode-party')?.addEventListener('click', () => {
      currentMode = 'party';
      renderSetupView();
    });
    document.getElementById('btn-mode-pass')?.addEventListener('click', () => {
      currentMode = 'pass';
      renderSetupView();
    });

    // Attach sub-listeners
    if (currentMode === 'party') {
      attachPartySetupListeners();
    } else {
      attachPassSetupListeners();
    }
  }

  // ── PARTY SETUP HTML ─────────────────────────────────
  function renderPartySetupHtml() {
    if (!user) {
      return `
        <div class="text-center" style="padding: 24px 12px;">
          <div style="font-size: 2.5rem; margin-bottom: 8px;">🔐</div>
          <p class="text-muted mb-md">${isEn ? 'Log in to create party rooms and challenge friends on their own phones.' : 'Logga in för att skapa partyrum och utmana vänner på deras egna mobiler.'}</p>
          <button type="button" class="btn btn-secondary btn-block" id="btn-switch-to-pass">
            🍻 ${isEn ? 'Play Pass & Play instead' : 'Kör på samma telefon istället'}
          </button>
        </div>
      `;
    }

    const friendsHtml = friendsList && friendsList.length > 0 ? `
      <div style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
          👥 ${t('arcade.blind10InviteFriends')} (${isEn ? 'optional' : 'valfritt'}):
        </label>
        <div style="max-height: 130px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
          ${friendsList.map(f => `
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); cursor: pointer;">
              <span style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
                <span style="font-size: 1.1rem;">${escapeHtml(f.avatar_emoji) || '👤'}</span>
                <strong>${escapeHtml(f.nickname)}</strong>
              </span>
              <input type="checkbox" class="friend-invite-cb" value="${f.id}" ${invitedFriendIds.has(f.id) ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--gold);" />
            </label>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      <!-- Stake Selector -->
      <div style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
          💰 ${t('arcade.blind10StakeLabel')}
        </label>
        <div class="flex gap-xs" style="flex-wrap: wrap;">
          <button type="button" class="btn ${selectedStake === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="0">0 kr (Ära)</button>
          <button type="button" class="btn ${selectedStake === 10 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="10">10 kr</button>
          <button type="button" class="btn ${selectedStake === 20 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="20">20 kr</button>
          <button type="button" class="btn ${selectedStake === 50 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="50">50 kr</button>
          <button type="button" class="btn ${![0, 10, 20, 50].includes(selectedStake) ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="custom">
            ${![0, 10, 20, 50].includes(selectedStake) ? `${selectedStake} kr` : 'Valfritt'}
          </button>
        </div>
        <div id="custom-stake-wrap" style="display: ${![0, 10, 20, 50].includes(selectedStake) ? 'block' : 'none'}; margin-top: 8px;">
          <input type="number" inputmode="numeric" step="1" id="custom-stake-input" class="form-input" placeholder="Ange belopp i kr (max 500)" value="${selectedStake || 30}" min="1" max="500" style="padding: 8px 12px; font-size: 0.9rem;" />
        </div>
      </div>

      ${friendsHtml}

      <button type="button" class="btn btn-primary btn-block mb-lg" id="btn-create-party" style="padding: 14px; font-weight: 700; font-size: 1rem; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);">
        ${t('arcade.blind10CreateRoomBtn')}
      </button>

      <!-- Join with code section -->
      <div style="position: relative; text-align: center; margin: 18px 0 14px 0;">
        <hr style="border: 0; border-top: 1px solid var(--border-glass);" />
        <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #14141e; padding: 0 10px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">
          ${isEn ? 'or join with code' : 'eller gå med via kod'}
        </span>
      </div>

      <div class="flex gap-sm">
        <input type="text" id="party-join-code" class="form-input" placeholder="AB12" maxlength="6" autocapitalize="characters" autocomplete="off" style="text-transform: uppercase; font-family: monospace; font-size: 1.1rem; text-align: center; font-weight: 700; letter-spacing: 3px;" />
        <button type="button" class="btn btn-secondary" id="btn-join-party" style="white-space: nowrap; padding: 0 18px; font-weight: 700;">
          ${t('arcade.blind10JoinBtn')}
        </button>
      </div>
    `;
  }

  function attachPartySetupListeners() {
    document.getElementById('btn-switch-to-pass')?.addEventListener('click', () => {
      currentMode = 'pass';
      renderSetupView();
    });

    // Stake selector buttons
    container.querySelectorAll('.party-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.stake;
        if (val === 'custom') {
          selectedStake = parseInt(document.getElementById('custom-stake-input')?.value, 10) || 30;
          document.getElementById('custom-stake-wrap').style.display = 'block';
        } else {
          selectedStake = parseInt(val, 10);
          document.getElementById('custom-stake-wrap').style.display = 'none';
        }
        container.querySelectorAll('.party-stake-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      });
    });

    document.getElementById('custom-stake-input')?.addEventListener('input', (e) => {
      // The server allows at most 500 kr per person
      selectedStake = Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 1));
    });

    // Friend checkboxes
    container.querySelectorAll('.friend-invite-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          invitedFriendIds.add(cb.value);
        } else {
          invitedFriendIds.delete(cb.value);
        }
      });
    });

    // Create room button
    document.getElementById('btn-create-party')?.addEventListener('click', async () => {
      const createBtn = document.getElementById('btn-create-party');
      if (createBtn) createBtn.disabled = true;
      try {
        const res = await createPartyRoom({
          gameType: 'blind10',
          stakeAmount: selectedStake
        });

        if (res && res.room) {
          currentRoom = res.room;
          if (invitedFriendIds.size > 0) {
            try {
              await inviteToParty(currentRoom.id, Array.from(invitedFriendIds));
              showToast(isEn ? 'Invites sent to friends!' : 'Inbjudningar skickade!', 'success');
            } catch (e) {}
          }
          setupPartyLobby(currentRoom);
        }
      } catch (err) {
        showToast(err.message || (isEn ? 'Failed to create party room' : 'Kunde inte skapa partyrum'), 'error');
        if (createBtn) createBtn.disabled = false;
      }
    });

    // Join room button
    document.getElementById('btn-join-party')?.addEventListener('click', async () => {
      const codeInput = document.getElementById('party-join-code');
      const code = (codeInput?.value || '').trim().toUpperCase();
      if (!code) {
        showToast(isEn ? 'Please enter the 4-character room code' : 'Ange rummets kod (4 tecken)', 'warning');
        return;
      }

      try {
        const res = await joinPartyRoom({ code });
        if (res && res.room) {
          currentRoom = res.room;
          setupPartyLobby(currentRoom);
        }
      } catch (err) {
        showToast(err.message || (isEn ? 'Room not found or game in progress' : 'Hittade inte rummet eller spelet har startat'), 'error');
      }
    });
  }

  // ── PASS & PLAY SETUP HTML & LISTENERS ────────────────
  let passPlayers = [
    user ? user.nickname : (isEn ? 'Player 1' : 'Spelare 1'),
    isEn ? 'Player 2' : 'Spelare 2'
  ];

  function renderPassSetupHtml() {
    return `
      <!-- Stake Selector -->
      <div style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
          💰 ${t('arcade.blind10StakeLabel')}
        </label>
        <div class="flex gap-xs" style="flex-wrap: wrap;">
          <button type="button" class="btn ${selectedStake === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="0">0 kr (Ära)</button>
          <button type="button" class="btn ${selectedStake === 10 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="10">10 kr</button>
          <button type="button" class="btn ${selectedStake === 20 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="20">20 kr</button>
          <button type="button" class="btn ${selectedStake === 50 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="50">50 kr</button>
        </div>
      </div>

      <!-- Player List -->
      <div style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span>👥 ${isEn ? 'Players taking turns' : 'Deltagare (turas om)'}:</span>
          <span style="font-weight: normal; color: var(--text-muted); font-size: 0.75rem;">${passPlayers.length}/8</span>
        </label>
        <div id="pass-players-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          ${passPlayers.map((p, idx) => `
            <div class="flex gap-xs align-center">
              <span style="font-weight: 700; color: var(--gold); min-width: 22px;">#${idx + 1}</span>
              <input type="text" class="form-input pass-player-input" data-idx="${idx}" value="${escapeHtml(p)}" placeholder="Spelarnamn" style="padding: 8px 12px; font-size: 0.88rem;" />
              ${passPlayers.length > 2 ? `
                <button type="button" class="btn btn-secondary btn-sm pass-remove-btn" data-idx="${idx}" style="padding: 6px 10px; color: #ef4444;">✕</button>
              ` : ''}
            </div>
          `).join('')}
        </div>
        ${passPlayers.length < 8 ? `
          <button type="button" class="btn btn-secondary btn-sm" id="btn-add-pass-player" style="font-size: 0.8rem; width: 100%;">
            ➕ ${isEn ? 'Add Player' : 'Lägg till spelare'}
          </button>
        ` : ''}
      </div>

      <button type="button" class="btn btn-primary btn-block" id="btn-start-pass-play" style="padding: 14px; font-weight: 700; font-size: 1rem; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
        🚀 ${isEn ? 'Start Pass & Play Challenge!' : 'Starta tävlingen på telefonen!'}
      </button>
    `;
  }

  function attachPassSetupListeners() {
    container.querySelectorAll('.pass-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedStake = parseInt(btn.dataset.stake, 10) || 0;
        container.querySelectorAll('.pass-stake-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      });
    });

    container.querySelectorAll('.pass-player-input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(inp.dataset.idx, 10);
        passPlayers[idx] = e.target.value;
      });
    });

    container.querySelectorAll('.pass-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        passPlayers.splice(idx, 1);
        renderSetupView();
      });
    });

    document.getElementById('btn-add-pass-player')?.addEventListener('click', () => {
      if (passPlayers.length < 8) {
        passPlayers.push(`${isEn ? 'Player' : 'Spelare'} ${passPlayers.length + 1}`);
        renderSetupView();
      }
    });

    document.getElementById('btn-start-pass-play')?.addEventListener('click', () => {
      const cleanPlayers = passPlayers.map(p => (p || '').trim()).filter(Boolean);
      if (cleanPlayers.length < 2) {
        showToast(isEn ? 'At least 2 players are required' : 'Minst 2 spelare krävs', 'warning');
        return;
      }
      passPlayers = cleanPlayers;
      startPassAndPlayRun(passPlayers, selectedStake);
    });
  }

  // ── VIEW 2: PARTY LOBBY (WEBSOCKET REALTIME) ─────────
  function setupPartyLobby(room) {
    currentRoom = room;
    cleanup();

    // Establish WebSocket for live room events
    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?party=${room.id}`;

    try {
      activeWs = new WebSocket(wsUrl);
      activeWs.onopen = () => {
        if (token) {
          activeWs.send(JSON.stringify({ type: 'auth', token }));
        }
        activeWs.send(JSON.stringify({ action: 'join_party', partyId: room.id }));
      };
      activeWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handlePartyWsMessage(data);
        } catch (e) {}
      };
      activeWs.onclose = () => {
        activeWs = null;
      };
    } catch (e) {}

    renderPartyLobbyView();
  }

  function stopWaitingPoll() {
    if (waitingPollId) {
      clearInterval(waitingPollId);
      waitingPollId = null;
    }
  }

  // Shows the results once per round. Later "waiting" renders must not cover them.
  function showPartyResults(room, isTie, tiedPlayerIds) {
    resultsShown = true;
    stopWaitingPoll();
    currentRoom = room;
    lastResultsRoom = room;
    renderPartyResultsView(room, isTie, tiedPlayerIds);
  }

  function handlePartyWsMessage(data) {
    if (data.type === 'party_updated' && data.room) {
      const hostChanged = currentRoom && currentRoom.hostId !== data.room.hostId;
      currentRoom = data.room;
      // Only the lobby re-renders; never throw players out of a round in progress.
      // On the results screen a new host needs the "new round" button.
      if (data.room.status === 'lobby') renderPartyLobbyView();
      else if (data.room.status === 'completed' && resultsShown && hostChanged && lastResultsRoom) {
        // Keep the finished round's players and pot; only the host changes
        renderPartyResultsView({ ...lastResultsRoom, hostId: data.room.hostId }, false, []);
      }
    } else if (data.type === 'party_started' && data.room) {
      currentRoom = data.room;
      resultsShown = false;
      stopWaitingPoll();
      runPartyStopwatchRound(data.countdownSec || 3);
    } else if (data.type === 'party_player_stopped') {
      const waitingStatus = document.getElementById('party-waiting-status');
      if (waitingStatus) {
        waitingStatus.textContent = `${data.stoppedCount} / ${data.totalCount} ${isEn ? 'finished' : 'har stannat'}`;
      }
    } else if (data.type === 'party_results' && data.room) {
      showPartyResults(data.room, data.isTie, data.tiedPlayerIds);
    } else if (data.type === 'party_pot_split' && data.room) {
      showToast(isEn ? '🤝 The pot was split between the tied players' : '🤝 Potten delades mellan de som låg lika', 'info');
      showPartyResults(data.room, false, []);
    } else if (data.type === 'party_sudden_death_start' && data.room) {
      currentRoom = data.room;
      resultsShown = false;
      stopWaitingPoll();
      const inRound = user && (data.room.tiedPlayerIds || []).includes(user.id);
      if (inRound) {
        runPartyStopwatchRound(data.countdownSec || 3);
      } else {
        renderWaitingForOthers(null, null, false, { spectator: true });
      }
    }
  }

  function renderPartyLobbyView() {
    if (!currentRoom) return;
    const isHost = user && currentRoom.hostId === user.id;
    const totalPot = currentRoom.stakeAmount * (currentRoom.players ? currentRoom.players.length : 0);

    container.innerHTML = `
      <div class="text-center" style="margin-bottom: 14px;">
        <img src="/stopwatch-gold.png" alt="Stopwatch" style="width: 64px; height: 64px; margin: 0 auto 10px auto; display: block; filter: drop-shadow(0 4px 14px rgba(255,215,0,0.45));" />
        <div style="background: rgba(255, 215, 0, 0.08); border: 2px dashed var(--gold); border-radius: var(--radius-lg); padding: 14px 10px; margin-bottom: 12px;">
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">
            ${t('arcade.blind10CodePrompt')}
          </div>
          <div style="font-size: 2.4rem; font-weight: 900; letter-spacing: 6px; color: var(--gold); font-family: monospace; margin: 4px 0;">
            ${currentRoom.code}
          </div>
          <div class="flex gap-xs justify-center" style="margin-top: 6px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-party-code" style="font-size: 0.8rem; padding: 4px 12px;">
              📋 ${isEn ? 'Copy Code' : 'Kopiera kod'}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-show-party-qr" style="font-size: 0.8rem; padding: 4px 12px; border-color: var(--gold); color: var(--gold); font-weight: 700;">
              📱 ${isEn ? 'Show QR' : 'Visa QR-kod'}
            </button>
          </div>
        </div>

        <div class="flex justify-between align-center" style="justify-content: space-between; gap: 10px; flex-wrap: wrap; background: rgba(255,255,255,0.04); border-radius: var(--radius-md); padding: 8px 14px; margin-bottom: 14px; border: 1px solid var(--border-glass);">
          <span style="font-size: 0.85rem; color: var(--text-secondary);">
            ${isEn ? 'Stake per person' : 'Insats/pers'}: <strong>${currentRoom.stakeAmount} kr</strong>
          </span>
          <span style="font-size: 0.88rem; font-weight: 700; color: #10b981;">
            💰 ${t('arcade.blind10TotalPot')} ${totalPot} kr
          </span>
        </div>
        ${currentRoom.stakeAmount > 0 ? `
          <div class="text-muted" style="font-size: 0.72rem; margin: -6px 0 12px; line-height: 1.4;">
            ${isEn
              ? '⚖️ The server measures the official time. Anyone who hasn\'t stopped within 30 s loses their stake.'
              : '⚖️ Servern mäter den officiella tiden. Den som inte stoppat inom 30 s förlorar sin insats.'}
          </div>
        ` : ''}
      </div>

      <!-- Player List -->
      <div style="margin-bottom: 18px;">
        <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 8px; color: var(--text-muted);">
          👥 ${t('arcade.blind10PlayersJoined')} (${currentRoom.players ? currentRoom.players.length : 0}):
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${(currentRoom.players || []).map(p => `
            <div class="party-player-chip ${p.isHost ? 'host' : ''}">
              <span>${escapeHtml(p.avatarEmoji) || (p.isHost ? '👑' : '👤')}</span>
              <span>${escapeHtml(p.nickname)}</span>
              ${p.isHost ? `<span style="font-size: 0.7rem; opacity: 0.8;">(${isEn ? 'Host' : 'Värd'})</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Action Area -->
      ${isHost && currentRoom.stakeAmount > 0 && currentRoom.players.length < 2 ? `
        <div class="text-center text-muted mb-md" style="padding: 14px; border: 1px dashed var(--border-glass); border-radius: var(--radius-md); font-size: 0.88rem;">
          ⏳ ${isEn ? 'Waiting for at least one more player – share the code!' : 'Väntar på minst en till spelare – dela koden!'}
        </div>
      ` : isHost ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-start-party-game" style="padding: 16px; font-size: 1.05rem; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 16px rgba(16, 185, 129, 0.45);">
          ${t('arcade.blind10StartGameBtn')}
        </button>
      ` : `
        <div class="text-center" style="padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); margin-bottom: 12px;">
          <span class="spinner" style="margin-bottom: 6px;">⏳</span>
          <div style="font-size: 0.9rem; font-weight: 600; color: var(--gold);">
            ${isEn ? 'Waiting for host to start the game...' : 'Väntar på att värden ska starta spelet...'}
          </div>
        </div>
      `}

      <button type="button" class="btn btn-secondary btn-block btn-sm" id="btn-leave-party">
        🚪 ${isEn ? 'Leave Room' : 'Lämna rummet'}
      </button>
    `;

    document.getElementById('btn-copy-party-code')?.addEventListener('click', () => {
      navigator.clipboard.writeText(currentRoom.code).then(() => {
        showToast(isEn ? 'Code copied to clipboard!' : 'Rumskod kopierad!', 'success');
      }).catch(() => {
        showToast(currentRoom.code, 'info');
      });
    });

    document.getElementById('btn-show-party-qr')?.addEventListener('click', () => {
      showPartyRoomQRModal(currentRoom.code, 'blind10');
    });

    document.getElementById('btn-start-party-game')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-start-party-game');
      if (btn) btn.disabled = true;
      try {
        await startPartyGame(currentRoom.id);
      } catch (err) {
        showToast(err.message || (isEn ? 'Failed to start game' : 'Kunde inte starta spelet'), 'error');
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById('btn-leave-party')?.addEventListener('click', async () => {
      const roomId = currentRoom?.id;
      cleanup();
      currentRoom = null;
      if (roomId) await leavePartyRoom(roomId).catch(() => {});
      renderSetupView();
    });
  }

  // ── VIEW 3: COUNTDOWN & STOPWATCH CHALLENGE ───────────
  function runStopwatchGame(countdownSec, onFinished, onImmediateStop) {
    let currentCountdown = countdownSec;
    let gameStartTime = 0;
    let isStopped = false;
    let finalStoppedTime = 0;
    let finalDiff = 0;

    container.innerHTML = `
      <div id="blind10-game-screen" style="padding: 10px 0; text-align: center;">
        <div id="countdown-overlay" style="padding: 40px 0;">
          <div style="font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">
            ${isEn ? 'Get Ready...' : 'Gör dig redo...'}
          </div>
          <div id="countdown-digits" style="font-size: 5rem; font-weight: 900; color: var(--gold); text-shadow: 0 0 30px rgba(255,215,0,0.5);">
            ${currentCountdown}
          </div>
        </div>

        <div id="stopwatch-active-wrap" style="display: none;">
          <div class="blind10-timer-display" id="blind10-display">
            <div class="blind10-timer-digits" id="blind10-digits">00.000s</div>
            <div class="blind10-timer-hint" id="blind10-hint">
              ${isEn ? 'Clock blacks out at 03:00s!' : 'Klockan släcks vid 03:00s!'}
            </div>
          </div>

          <div style="margin-top: 26px;">
            <button type="button" class="blind10-stop-btn" id="btn-blind10-stop">
              ${t('arcade.blind10StopBtn')}
            </button>
          </div>
        </div>
      </div>
    `;

    playTone(440, 'sine', 0.2, 0.15); // Countdown 3

    // The clock starts exactly countdownSec after the start signal, in sync with the
    // server, which measures the official time from the same moment.
    const clockZero = performance.now() + countdownSec * 1000;

    const countdownInterval = setInterval(() => {
      currentCountdown--;
      const digitsEl = document.getElementById('countdown-digits');
      if (currentCountdown > 0) {
        if (digitsEl) digitsEl.textContent = currentCountdown;
        playTone(440, 'sine', 0.2, 0.15);
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);

    activeTimeoutId = setTimeout(() => {
      const digitsEl = document.getElementById('countdown-digits');
      if (digitsEl) {
        digitsEl.textContent = isEn ? 'GO!' : 'KÖR!';
        digitsEl.style.color = '#10b981';
      }
      playTone(880, 'sine', 0.35, 0.25);
      startActualClock();
    }, Math.max(0, clockZero - performance.now()));

    function startActualClock() {
      const overlay = document.getElementById('countdown-overlay');
      const activeWrap = document.getElementById('stopwatch-active-wrap');
      if (overlay) overlay.style.display = 'none';
      if (activeWrap) activeWrap.style.display = 'block';

      const displayEl = document.getElementById('blind10-display');
      const digitsEl = document.getElementById('blind10-digits');
      const hintEl = document.getElementById('blind10-hint');
      const stopBtn = document.getElementById('btn-blind10-stop');

      gameStartTime = clockZero;

      function updateClock() {
        if (isStopped) return;
        const now = performance.now();
        const elapsedSec = (now - gameStartTime) / 1000;

        if (elapsedSec >= 3.0) {
          if (!displayEl.classList.contains('blind')) {
            displayEl.classList.add('blind');
            digitsEl.innerHTML = `<span class="blind-text">👁️ BLIND MODE</span>`;
            hintEl.textContent = t('arcade.blind10BlindActive');
          }
        } else {
          digitsEl.textContent = elapsedSec.toFixed(3) + 's';
        }

        activeAnimationId = requestAnimationFrame(updateClock);
      }

      activeAnimationId = requestAnimationFrame(updateClock);

      // Stop when the finger lands (pointerdown), not when it lifts: a tap takes ~100 ms
      const onStop = (ev) => {
        ev?.preventDefault?.();
        if (isStopped) return;
        isStopped = true;
        cancelAnimationFrame(activeAnimationId);

        const stopTimeMs = performance.now();
        finalStoppedTime = Math.round(((stopTimeMs - gameStartTime) / 1000) * 1000) / 1000;
        finalDiff = Math.round(Math.abs(finalStoppedTime - 10.000) * 1000) / 1000;

        if (typeof onImmediateStop === 'function') {
          onImmediateStop(finalStoppedTime, finalDiff);
        }

        playTone(587.33, 'sine', 0.15, 0.25);
        setTimeout(() => playTone(783.99, 'sine', 0.2, 0.2), 90);

        stopBtn.disabled = true;
        displayEl.classList.remove('blind');
        digitsEl.textContent = finalStoppedTime.toFixed(3) + 's';
        const sign = finalStoppedTime >= 10.000 ? '+' : '-';
        hintEl.innerHTML = `<strong style="color: var(--gold); font-size: 1.1rem;">Diff: ${sign}${finalDiff.toFixed(3)}s</strong>`;

        activeTimeoutId = setTimeout(() => {
          onFinished(finalStoppedTime, finalDiff);
        }, 1200);
      };
      stopBtn?.addEventListener('pointerdown', onStop);
      stopBtn?.addEventListener('click', onStop);
    }
  }

  // Party round: the server measures the official time; the local time is only a preview
  function runPartyStopwatchRound(countdownSec) {
    let official = null;
    let waitingShown = false;
    runStopwatchGame(countdownSec, (time, diff) => {
      // The round may already be decided (the last player's stop brings the results)
      if (resultsShown) return;
      waitingShown = true;
      if (official) {
        renderWaitingForOthers(official.stoppedTime, official.diff, true);
      } else {
        renderWaitingForOthers(time, diff, false);
      }
    }, (time) => {
      submitPartyTime(currentRoom.id, time)
        .then((res) => {
          if (typeof res?.stoppedTime !== 'number') return;
          official = { stoppedTime: res.stoppedTime, diff: res.diff };
          if (res.room && (res.room.status === 'completed' || res.room.status === 'tie') && !resultsShown) {
            showPartyResults(res.room, res.room.status === 'tie', res.room.tiedPlayerIds);
            return;
          }
          if (!resultsShown && waitingShown && document.getElementById('party-my-time')) {
            renderWaitingForOthers(official.stoppedTime, official.diff, true);
          }
        })
        .catch((err) => showToast(err.message || (isEn ? 'Could not submit your time' : 'Kunde inte skicka din tid'), 'error'));
    });
  }

  // ── VIEW 4: PARTY WAITING FOR OTHERS ─────────────────
  function renderWaitingForOthers(myTime, myDiff, isOfficial = false, { spectator = false } = {}) {
    const sign = myTime >= 10.000 ? '+' : '-';
    container.innerHTML = spectator ? `
      <div class="text-center" style="padding: 20px 0;">
        <div style="font-size: 2.6rem; margin-bottom: 6px;">🔥</div>
        <h3 style="color: var(--gold); margin-bottom: 6px;">${isEn ? 'Sudden death!' : 'Avgörande omgång!'}</h3>
        <p class="text-muted" id="party-waiting-status" style="font-size: 0.88rem;">
          ${isEn ? 'The tied players are stopping the clock once more…' : 'De som låg lika stoppar klockan en gång till…'}
        </p>
        <div id="party-my-time" hidden></div>
      </div>
    ` : `
      <div class="text-center" style="padding: 20px 0;">
        <img src="/stopwatch-gold.png" alt="Stopwatch" style="width: 64px; height: 64px; margin: 0 auto 10px auto; display: block; filter: drop-shadow(0 4px 14px rgba(255,215,0,0.45));" />
        <h3 style="color: var(--gold); margin-bottom: 6px;">
          ${isEn ? 'Time Logged!' : 'Tid registrerad!'}
        </h3>
        <div id="party-my-time" style="font-size: 2.2rem; font-family: monospace; font-weight: 800; color: #ffffff; margin-bottom: 4px;">
          ${myTime.toFixed(3)}s
        </div>
        <div class="badge badge-accent" style="font-size: 0.95rem; padding: 4px 14px;">
          Diff mot 10:00: ${sign}${myDiff.toFixed(3)}s
        </div>
        <div class="text-muted mb-lg" style="font-size: 0.72rem; margin-top: 6px;">
          ${isOfficial
            ? (isEn ? '✓ Official time, measured by the server' : '✓ Officiell tid, mätt av servern')
            : (isEn ? 'Your local time – waiting for the official time…' : 'Din lokala tid – väntar på officiell tid…')}
        </div>

        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 18px; max-width: 320px; margin: 0 auto;">
          <span class="spinner" style="margin-bottom: 10px;">⏳</span>
          <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);" id="party-waiting-status">
            ${t('arcade.blind10StoppedWaiting')}
          </div>
        </div>
      </div>
    `;

    // If the live connection dropped (e.g. the phone locked), ask the server instead,
    // so nobody is left waiting forever
    if (!waitingPollId && currentRoom?.id) {
      waitingPollId = setInterval(async () => {
        if (resultsShown || !document.getElementById('party-my-time')) {
          stopWaitingPoll();
          return;
        }
        try {
          const res = await getPartyRoom(currentRoom.id);
          const room = res?.room;
          if (room && (room.status === 'completed' || room.status === 'tie') && !resultsShown) {
            showPartyResults(room, room.status === 'tie', room.tiedPlayerIds);
          }
        } catch {}
      }, 3000);
    }
  }

  // ── VIEW 5: PARTY RESULTS & PODIUM ───────────────────
  function renderPartyResultsView(room, isTie, tiedPlayerIds) {
    const isHost = user && room.hostId === user.id;
    const totalPot = room.stakeAmount * (room.players ? room.players.length : 0);

    // Tie breaker on 1st place!
    if (isTie && tiedPlayerIds && tiedPlayerIds.length > 1) {
      playTone(440, 'triangle', 0.3, 0.2);
      const tiedPlayers = room.players.filter(p => tiedPlayerIds.includes(p.id));
      const tiedNames = tiedPlayers.map(p => escapeHtml(p.nickname)).join(' & ');

      container.innerHTML = `
        <div class="text-center" style="padding: 10px 0;">
          <div style="font-size: 3.2rem; margin-bottom: 8px;">🔥</div>
          <h2 style="color: #ef4444; font-size: 1.4rem; font-weight: 800; margin-bottom: 6px;">
            ${t('arcade.blind10TieTitle')}
          </h2>
          <p style="font-size: 0.95rem; color: var(--text-secondary); max-width: 320px; margin: 0 auto 16px auto;">
            <strong>${tiedNames}</strong> ${isEn ? 'have the exact same diff!' : 'stannade med exakt samma diff!'} (${tiedPlayers[0]?.diff?.toFixed(3)}s)
          </p>

          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 12px; margin-bottom: 18px;">
            ${room.results.map((p, idx) => `
              <div class="blind10-podium-item ${tiedPlayerIds.includes(p.id) ? 'rank-1' : ''}">
                <div class="flex align-center gap-xs" style="flex: 1 1 auto; min-width: 0;">
                  <span style="font-weight: 700; font-size: 1.1rem; flex-shrink: 0;">${tiedPlayerIds.includes(p.id) ? '🔥' : `#${idx + 1}`}</span>
                  <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.avatarEmoji || '👤'} <strong>${escapeHtml(p.nickname)}</strong></span>
                </div>
                <div class="text-right" style="flex-shrink: 0;">
                  <div style="font-family: monospace; font-weight: 700; color: #fff;">${p.stoppedTime?.toFixed(3)}s</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">Diff: ${p.diff?.toFixed(3)}s</div>
                </div>
              </div>
            `).join('')}
          </div>

          ${isHost ? `
            <div class="flex flex-col gap-sm">
              <button type="button" class="btn btn-primary btn-block" id="btn-party-sudden-death" style="padding: 14px; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; font-weight: 700;">
                ${t('arcade.blind10SuddenDeathBtn')}
              </button>
              ${room.stakeAmount > 0 ? `
                <button type="button" class="btn btn-secondary btn-block" id="btn-party-split-pot" style="padding: 12px;">
                  ${t('arcade.blind10SplitPotBtn')}
                </button>
              ` : ''}
            </div>
          ` : `
            <div class="text-muted" style="font-size: 0.88rem; padding: 10px;">
              <span class="spinner">⏳</span> ${isEn ? 'Waiting for host to choose Sudden Death or Split...' : 'Väntar på att värden ska välja Sudden Death eller dela potten...'}
            </div>
          `}
        </div>
      `;

      document.getElementById('btn-party-sudden-death')?.addEventListener('click', async () => {
        try {
          await resolvePartyTie(room.id, 'sudden_death');
        } catch (e) {
          showToast(e.message || 'Kunde inte starta sudden death', 'error');
        }
      });

      document.getElementById('btn-party-split-pot')?.addEventListener('click', async () => {
        try {
          await resolvePartyTie(room.id, 'split_pot');
        } catch (e) {
          showToast(e.message || 'Kunde inte dela potten', 'error');
        }
      });

      return;
    }

    // Nobody finished the round in time: no winner, no debts
    if (room.results && room.results.length > 0 && room.results.every(r => r.dnf)) {
      container.innerHTML = `
        <div class="text-center" style="padding: 20px 0;">
          <div style="font-size: 2.6rem; margin-bottom: 6px;">⏱️</div>
          <h3 style="color: var(--gold); margin-bottom: 6px;">${isEn ? 'No one stopped the clock in time' : 'Ingen stoppade klockan i tid'}</h3>
          <p class="text-muted" style="font-size: 0.85rem;">${isEn ? 'No winner and no debts this round.' : 'Ingen vinnare och inga skulder den här omgången.'}</p>
        </div>
      `;
      return;
    }

    // Single winner decided!
    launchConfetti();
    playCoinSound();

    const winner = room.results && room.results[0] ? room.results[0] : room.players[0];
    const isWinner = user && winner && user.id === winner.id;
    const losers = room.players.filter(p => p.id !== winner.id);


    container.innerHTML = `
      <div class="text-center" style="padding: 10px 0;">
        <div style="font-size: 3.2rem; margin-bottom: 6px;">👑</div>
        <h2 style="color: var(--gold); font-size: 1.35rem; font-weight: 800; margin-bottom: 4px;">
          ${escapeHtml(winner.nickname)} ${t('arcade.blind10WinnerWins')}
        </h2>
        ${room.stakeAmount > 0 ? `
          <div style="font-size: 1.6rem; font-weight: 900; color: #10b981; margin-bottom: 12px;">
            💰 ${totalPot} kr
          </div>
        ` : `
          <div class="badge badge-accent mb-md" style="font-size: 0.85rem; padding: 4px 14px;">
            ✨ Ren och skär ära!
          </div>
        `}

        <!-- Results Podium -->
        <div style="margin-bottom: 18px; text-align: left;">
          ${(room.results || room.players).map((p, idx) => {
            const isFirst = idx === 0;
            return `
              <div class="blind10-podium-item ${isFirst ? 'rank-1' : ''}">
                <div class="flex align-center gap-xs">
                  <span style="font-weight: 800; font-size: 1.1rem; min-width: 24px;">
                    ${isFirst ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`))}
                  </span>
                  <span>${p.avatarEmoji || '👤'} <strong>${escapeHtml(p.nickname)}</strong></span>
                </div>
                <div class="text-right">
                  <div style="font-family: monospace; font-weight: 800; color: ${isFirst ? 'var(--gold)' : '#fff'}; font-size: 1rem;">
                    ${p.dnf ? (isEn ? 'DNF' : 'Ej klar') : (p.stoppedTime !== null && p.stoppedTime !== undefined ? p.stoppedTime.toFixed(3) + 's' : '-')}
                  </div>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">
                    Diff: ${p.diff !== null && p.diff !== undefined ? p.diff.toFixed(3) + 's' : '-'}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- 💸 Swish Action Box -->
        ${room.stakeAmount > 0 ? (
          isWinner ? `
            <div style="background: rgba(16,185,129,0.1); border: 1px solid #10b981; border-radius: var(--radius-md); padding: 12px; margin-bottom: 16px;">
              <div style="font-weight: 700; color: #34d399; margin-bottom: 4px;">🎉 Grattis! Du är mästaren!</div>
              <div style="font-size: 0.82rem; color: var(--text-secondary);">
                ${losers.length} deltagare är skyldiga dig ${room.stakeAmount} kr vardera. Uppgörelsen är sparad i <strong>Swishlistan / Notan</strong>!
              </div>
            </div>
          ` : `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-md); padding: 14px; margin-bottom: 16px;">
              <div style="font-size: 0.88rem; margin-bottom: 10px; color: var(--text-secondary);">
                Du förlorade mot <strong>${escapeHtml(winner.nickname)}</strong> och är skyldig <strong>${room.stakeAmount} kr</strong>.
              </div>
              <button type="button" class="btn btn-secondary btn-block btn-space-goto-tab">${isEn ? 'Pay under The Tab →' : 'Betala under THE TAB →'}</button>
            </div>
          `
        ) : ''}

        ${isHost ? `
          <button type="button" class="btn btn-primary btn-block mb-sm" id="btn-party-play-again" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; font-weight: 800;">
            🔄 ${isEn ? 'New round – same group' : 'Ny omgång – samma gäng'}
          </button>
        ` : `
          <div class="text-muted mb-sm" style="font-size: 0.82rem;">${isEn ? 'The host can start a new round with the same group.' : 'Värden kan starta en ny omgång med samma gäng.'}</div>
        `}
        <div class="flex gap-sm">
          <button type="button" class="btn btn-secondary btn-block" id="btn-party-leave-after">
            🚪 ${isEn ? 'Leave room' : 'Lämna rummet'}
          </button>
          <button type="button" class="btn btn-secondary btn-block" id="btn-party-close">
            ❌ ${isEn ? 'Close' : 'Stäng'}
          </button>
        </div>
      </div>
    `;

    // Closing leaves the room too, so you can't be counted as a no-show in the next round
    document.getElementById('btn-party-close')?.addEventListener('click', () => {
      cleanup();
      currentRoom = null;
      leavePartyRoom(room.id).catch(() => {});
      closeModal();
    });

    // Same room, same people: the start message brings everyone into the new round
    document.getElementById('btn-party-play-again')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-party-play-again');
      if (btn) btn.disabled = true;
      try {
        await startPartyGame(room.id);
      } catch (err) {
        showToast(err.message || (isEn ? 'Could not start' : 'Kunde inte starta'), 'error');
        if (btn) btn.disabled = false;
      }
    });
    document.getElementById('btn-party-leave-after')?.addEventListener('click', async () => {
      cleanup();
      currentRoom = null;
      await leavePartyRoom(room.id).catch(() => {});
      renderSetupView();
    });
  }

  // ── PASS & PLAY LOGIC (SEQUENCE OF TURNS ON ONE PHONE) ─
  function startPassAndPlayRun(players, stake, alreadyPlaced = []) {
    let playerIdx = 0;
    const results = [];

    function nextTurn() {
      if (playerIdx >= players.length) {
        finishPassAndPlayRun(results, stake, alreadyPlaced);
        return;
      }

      const currentPlayer = players[playerIdx];

      container.innerHTML = `
        <div class="text-center" style="padding: 24px 0;">
          <div style="font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">
            ${isEn ? `Turn ${playerIdx + 1} of ${players.length}` : `Runda ${playerIdx + 1} av ${players.length}`}
          </div>
          <div style="font-size: 3rem; margin-bottom: 8px;">👤</div>
          <h2 style="color: var(--gold); font-size: 1.5rem; font-weight: 800; margin-bottom: 12px;">
            ${escapeHtml(currentPlayer)}
          </h2>
          <p class="text-muted mb-lg" style="max-width: 280px; margin: 0 auto 20px auto; font-size: 0.88rem;">
            ${isEn ? 'Take the phone and get ready to stop at 10.00s!' : 'Ta telefonen och gör dig redo att stanna på 10:00!'}
          </p>

          <button type="button" class="btn btn-primary btn-block" id="btn-start-single-turn" style="padding: 16px; font-size: 1.1rem; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none;">
            🚀 ${isEn ? 'Start My Turn' : 'Starta min runda!'}
          </button>
        </div>
      `;

      document.getElementById('btn-start-single-turn')?.addEventListener('click', () => {
        runStopwatchGame(3, (time, diff) => {
          results.push({
            name: currentPlayer,
            stoppedTime: time,
            diff: diff
          });

          playerIdx++;
          container.innerHTML = `
            <div class="text-center" style="padding: 20px 0;">
              <div style="font-size: 2.4rem; margin-bottom: 6px;">🎯</div>
              <h3 style="color: var(--gold);">${escapeHtml(currentPlayer)}</h3>
              <div style="font-size: 2rem; font-family: monospace; font-weight: 900; margin: 8px 0;">
                ${time.toFixed(3)}s
              </div>
              <div class="badge badge-accent mb-lg" style="font-size: 0.95rem; padding: 4px 14px;">
                Diff: ${diff.toFixed(3)}s
              </div>
              <button type="button" class="btn btn-primary btn-block" id="btn-pass-continue" style="padding: 14px; font-weight: 700;">
                ${playerIdx < players.length ? `Nästa spelare (${players[playerIdx]}) ➡️` : 'Visa slutresultat! 🏆'}
              </button>
            </div>
          `;

          document.getElementById('btn-pass-continue')?.addEventListener('click', () => {
            nextTurn();
          });
        });
      });
    }

    nextTurn();
  }

  function finishPassAndPlayRun(roundResults, stake, alreadyPlaced = []) {
    // After a sudden death, the tied players' new times decide first place; the others
    // keep their places behind them and still count for the pot
    roundResults.sort((a, b) => a.diff - b.diff);
    const results = [...roundResults, ...alreadyPlaced.slice().sort((a, b) => a.diff - b.diff)];
    const bestDiff = roundResults[0].diff;
    const tied = roundResults.filter(r => r.diff === bestDiff);

    if (tied.length > 1) {
      playTone(440, 'triangle', 0.3, 0.2);
      const tiedNames = tied.map(t => escapeHtml(t.name)).join(' & ');

      container.innerHTML = `
        <div class="text-center" style="padding: 10px 0;">
          <div style="font-size: 3rem; margin-bottom: 8px;">🔥</div>
          <h2 style="color: #ef4444; font-weight: 800; font-size: 1.35rem; margin-bottom: 4px;">
            ${t('arcade.blind10TieTitle')}
          </h2>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 14px;">
            <strong>${tiedNames}</strong> stannade med exakt samma diff (${bestDiff.toFixed(3)}s)!
          </p>

          <div class="flex flex-col gap-sm">
            <button type="button" class="btn btn-primary btn-block" id="btn-pass-sudden-death" style="padding: 14px; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; font-weight: 700;">
              ${t('arcade.blind10SuddenDeathBtn')}
            </button>
            <button type="button" class="btn btn-secondary btn-block" id="btn-pass-split-pot" style="padding: 12px;">
              ${t('arcade.blind10SplitPotBtn')}
            </button>
          </div>
        </div>
      `;

      document.getElementById('btn-pass-sudden-death')?.addEventListener('click', () => {
        const others = roundResults.filter(r => !tied.includes(r));
        startPassAndPlayRun(tied.map(t => t.name), stake, [...alreadyPlaced, ...others.filter(r => !alreadyPlaced.includes(r))]);
      });

      document.getElementById('btn-pass-split-pot')?.addEventListener('click', () => {
        showFinalPassPodium(results, stake, true, tied);
      });
      return;
    }

    showFinalPassPodium(results, stake, false, []);
  }

  function showFinalPassPodium(results, stake, isSplit, tied) {
    launchConfetti();
    playCoinSound();

    const winner = results[0];
    const totalPot = stake * results.length;

    container.innerHTML = `
      <div class="text-center" style="padding: 10px 0;">
        <div style="font-size: 3.2rem; margin-bottom: 4px;">🏆</div>
        <h2 style="color: var(--gold); font-size: 1.4rem; font-weight: 800; margin-bottom: 4px;">
          ${isSplit ? `Delad seger mellan ${tied.map(t => escapeHtml(t.name)).join(' & ')}!` : `${escapeHtml(winner.name)} tar hem segern!`}
        </h2>
        ${stake > 0 ? `
          <div style="font-size: 1.6rem; font-weight: 900; color: #10b981; margin-bottom: 12px;">
            💰 Pott: ${totalPot} kr ${isSplit ? `(${Math.round(totalPot / tied.length)} kr/vinnare)` : ''}
          </div>
        ` : ''}

        <div style="margin-bottom: 16px; text-align: left;">
          ${results.map((r, idx) => `
            <div class="blind10-podium-item ${idx === 0 ? 'rank-1' : ''}">
              <div class="flex align-center gap-xs">
                <span style="font-weight: 800; font-size: 1.1rem; min-width: 24px;">
                  ${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`))}
                </span>
                <strong>${escapeHtml(r.name)}</strong>
              </div>
              <div class="text-right">
                <div style="font-family: monospace; font-weight: 800; color: ${idx === 0 ? 'var(--gold)' : '#fff'};">
                  ${r.stoppedTime.toFixed(3)}s
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">
                  Diff: ${r.diff.toFixed(3)}s
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        ${stake > 0 ? `
          <div class="blind10-pay-list">
            <div class="blind10-pay-title">💸 ${isEn ? 'Who pays whom' : 'Vem betalar vem'}</div>
            ${(isSplit
              ? results.filter(r => !tied.includes(r)).map(r => `<div>${escapeHtml(r.name)} → ${tied.map(t => escapeHtml(t.name)).join(' & ')}: ${stake} kr (${isEn ? 'shared' : 'delas'})</div>`)
              : results.slice(1).map(r => `<div>${escapeHtml(r.name)} → ${escapeHtml(winner.name)}: ${stake} kr</div>`)
            ).join('')}
            <small>${isEn ? 'Same phone: settle it among yourselves (not on The Tab).' : 'Samma telefon: gör upp sinsemellan (hamnar inte på THE TAB).'}</small>
          </div>
        ` : ''}

        <div class="flex gap-sm">
          <button type="button" class="btn btn-secondary btn-block" id="btn-finish-pass-close">
            ❌ ${isEn ? 'Close' : 'Stäng'}
          </button>
          <button type="button" class="btn btn-primary btn-block" id="btn-finish-pass-again">
            🔄 ${isEn ? 'Play Again' : 'Ny omgång'}
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-finish-pass-close')?.addEventListener('click', () => {
      closeModal();
    });
    document.getElementById('btn-finish-pass-again')?.addEventListener('click', () => {
      renderSetupView();
    });
  }
}

// ────────────────────────────────────────────────────────
// 🔔 INCOMING PARTY INVITATION MODAL
// ────────────────────────────────────────────────────────
export function showIncomingPartyModal(room) {
  const isEn = getLang() === 'en';
  // Don't throw the player out of a game they are playing right now
  if (isGameInProgress()) {
    showToast(isEn
      ? `🎉 ${room.hostNickname || 'A friend'} invited you to room #${room.code}. Open it from the push notification when you're done.`
      : `🎉 ${room.hostNickname || 'En polare'} bjöd in dig till rum #${room.code}. Öppna inbjudan när du är klar.`, 'info');
    return;
  }
  playTone(587.33, 'sine', 0.25, 0.15); // D5 chime
  setTimeout(() => playTone(880, 'sine', 0.3, 0.15), 150);

  const isMafia = room.gameType === 'mafia';

  const titleHtml = isMafia
    ? `<img src="/mafia-gold.png" alt="Mafia" style="width: 24px; height: 24px; vertical-align: -4px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(255,215,0,0.4));" />${t('arcade.mafiaTitle')}`
    : `<img src="/stopwatch-gold.png" alt="Stopwatch" style="width: 24px; height: 24px; vertical-align: -3px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(255,215,0,0.4));" />${t('arcade.blind10Title')}`;

  const iconHtml = isMafia
    ? `<img src="/mafia-gold.png" alt="Mafia" style="width: 72px; height: 72px; margin: 0 auto 12px auto; display: block; filter: drop-shadow(0 4px 16px rgba(255,215,0,0.5));" />`
    : `<img src="/stopwatch-gold.png" alt="Stopwatch" style="width: 72px; height: 72px; margin: 0 auto 12px auto; display: block; filter: drop-shadow(0 4px 16px rgba(255,215,0,0.5));" />`;

  const inviteText = isMafia
    ? (isEn ? 'invited you to Mafia (Werewolf)!' : 'bjöd in dig till Maffia (Varulv)!')
    : (isEn ? 'invited you to The Blind 10.00!' : 'bjöd in dig till The Blind 10.00!');

  const descText = isMafia
    ? (isEn ? 'Secret roles, night murders, deception and town square voting on your phone!' : 'Hemliga roller, nattmord, manipulation och lynchning på torget direkt i mobilen!')
    : (isEn ? 'Stop the clock as close to 10.00s as possible. At 3.00s the display turns black!' : 'Stanna klockan så nära 10:00.00s som möjligt. Vid 3.00s blir skärmen kolsvart!');

  showModal(titleHtml, `
    <div class="text-center" style="padding: 10px 0;">
      ${iconHtml}
      <h3 style="color: var(--gold); margin-bottom: 6px; font-size: 1.2rem;">
        ${escapeHtml(room.hostNickname)} ${inviteText}
      </h3>
      <div class="badge badge-accent mb-md" style="font-size: 0.95rem; padding: 6px 16px;">
        ${room.stakeAmount > 0 ? `💰 ${room.stakeAmount} kr ${isEn ? 'per player' : 'per deltagare'}` : '✨ Bara ära (0 kr)'}
      </div>
      <p class="text-muted mb-lg" style="font-size: 0.85rem; max-width: 300px; margin: 0 auto 16px auto;">
        ${descText}
      </p>

      <div class="flex gap-sm">
        <button type="button" class="btn btn-secondary btn-block" id="btn-decline-party" style="padding: 12px;">
          ❌ ${isEn ? 'Decline' : 'Neka'}
        </button>
        <button type="button" class="btn btn-primary btn-block" id="btn-accept-party" style="padding: 12px; background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 700;">
          🚀 ${isEn ? 'Join Party' : 'Gå med i rummet'}
        </button>
      </div>
    </div>
  `);

  document.getElementById('btn-decline-party')?.addEventListener('click', () => {
    closeModal();
  });

  document.getElementById('btn-accept-party')?.addEventListener('click', async () => {
    try {
      const res = await joinPartyRoom({ roomId: room.id });
      if (res && res.room) {
        closeModal();
        if (isMafia) {
          openMafiaModal(res.room);
        } else {
          openBlind10Modal(res.room);
        }
      }
    } catch (e) {
      showToast(isEn ? 'Failed to join party room' : 'Kunde inte gå med i rummet', 'error');
    }
  });
}

// ────────────────────────────────────────────────────────
// 🕵️‍♂️ MAFFIA (VARULV / WEREWOLF) PARTY GAME
// ────────────────────────────────────────────────────────
export async function openMafiaModal(initialRoom = null) {
  const isEn = getLang() === 'en';
  const user = getStoredUser();

  let activeWs = null;
  let currentRoom = initialRoom || null;
  let selectedStake = 20;
  let narratorMode = 'ai'; // 'ai' | 'human'
  let invitedFriendIds = new Set();
  let friendsList = [];
  let mySecretData = null; // { role, isAlive, fellowMafia, godModeRoles, phase, subPhase, nightActions }
  let myNightActionDone = false;
  let myInvestigateResult = null;
  let myDayVoteTargetId = null;

  function cleanup() {
    if (activeWs) {
      try {
        activeWs.send(JSON.stringify({ action: 'leave_party', partyId: currentRoom?.id }));
        activeWs.close();
      } catch (e) {}
      activeWs = null;
    }
  }

  const modalTitle = `<img src="/mafia-gold.png" alt="Mafia" style="width: 24px; height: 24px; vertical-align: -4px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(255,215,0,0.4));" />${t('arcade.mafiaTitle')}`;

  const { close, root, setBusy } = showModal(modalTitle, `
    <div id="mafia-container" class="mafia-container">
      <p class="game-modal-subheading">${t('arcade.mafiaDesc')}</p>
      <div class="text-center text-muted" style="padding: 40px 0;">
        <span class="spinner">⏳</span>
      </div>
    </div>
  `, () => {
    cleanup();
  }, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => currentRoom !== null,
    confirmTexts: {
      title: isEn ? 'Exit Mafia?' : 'Lämna Maffia?',
      message: isEn 
        ? 'Are you sure you want to leave Mafia? Any active game or party room will be closed.' 
        : 'Är du säker på att du vill avsluta Maffia? Pågående spel eller partyrum avbryts.'
    }
  });

  setBusy(() => currentRoom !== null);

  const container = document.getElementById('mafia-container');
  if (!container) return;

  if (initialRoom) {
    setupMafiaLobby(initialRoom);
  } else {
    try {
      if (user) {
        friendsList = await getFriends().catch(() => []);
      }
    } catch (e) {}
    renderSetupView();
  }

  // ── VIEW 1: CREATION / JOIN SETUP ────────────────────────
  function renderSetupView() {
    const friendsHtml = (friendsList && friendsList.length > 0) ? `
      <div style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
          👥 ${t('arcade.blind10InviteFriends')} (${isEn ? 'optional' : 'valfritt'}):
        </label>
        <div style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 8px; background: rgba(0,0,0,0.2);">
          ${friendsList.map(f => `
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; cursor: pointer; border-radius: var(--radius-sm); margin-bottom: 4px; background: rgba(255,255,255,0.02);">
              <span style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
                <span style="font-size: 1.1rem;">${escapeHtml(f.avatar_emoji) || '👤'}</span>
                <strong>${escapeHtml(f.nickname)}</strong>
              </span>
              <input type="checkbox" class="mafia-friend-invite-cb" value="${f.id}" ${invitedFriendIds.has(f.id) ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--gold);" />
            </label>
          `).join('')}
        </div>
      </div>
    ` : '';

    container.innerHTML = `
      <div class="text-center" style="margin-bottom: 16px;">
        <img src="/mafia-gold.png" alt="Mafia" style="width: 76px; height: 76px; margin: 0 auto 8px auto; display: block; filter: drop-shadow(0 4px 16px rgba(255,215,0,0.5));" />
        <p class="text-muted" style="font-size: 0.85rem; margin: 0 auto 14px auto; max-width: 320px;">
          ${t('arcade.mafiaDesc')}
        </p>
      </div>

      <!-- Spelledarläge Selector -->
      <div style="margin-bottom: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 12px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; font-weight: 700; color: var(--gold); display: block;">
          ⚙️ ${t('arcade.mafiaNarratorModeLabel')}
        </label>
        <div class="flex gap-xs" style="flex-direction: column;">
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: var(--radius-sm); background: ${narratorMode === 'ai' ? 'rgba(255,215,0,0.1)' : 'transparent'}; border: 1px solid ${narratorMode === 'ai' ? 'var(--gold)' : 'transparent'};">
            <input type="radio" name="mafia-narrator" value="ai" ${narratorMode === 'ai' ? 'checked' : ''} style="margin-top: 3px; accent-color: var(--gold);" />
            <div>
              <div style="font-size: 0.88rem; font-weight: 700; color: var(--text-primary);">
                ${t('arcade.mafiaNarratorAI')}
              </div>
              <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                ${isEn ? 'Automated night/day phases. Everyone at the table gets a secret role, including you!' : 'Automatiserade faser. Alla vid bordet får en hemlig spelarroll, inklusive du!'}
              </div>
            </div>
          </label>
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: var(--radius-sm); background: ${narratorMode === 'human' ? 'rgba(255,215,0,0.1)' : 'transparent'}; border: 1px solid ${narratorMode === 'human' ? 'var(--gold)' : 'transparent'};">
            <input type="radio" name="mafia-narrator" value="human" ${narratorMode === 'human' ? 'checked' : ''} style="margin-top: 3px; accent-color: var(--gold);" />
            <div>
              <div style="font-size: 0.88rem; font-weight: 700; color: var(--text-primary);">
                ${t('arcade.mafiaNarratorHuman')}
              </div>
              <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                ${isEn ? 'You get "God Mode" and see all roles. You narrate the story aloud for the room!' : 'Du får "Gudavy" och ser allas roller. Du leder snacket och berättar storyn högt!'}
              </div>
            </div>
          </label>
        </div>
      </div>

      <!-- Stake Selector -->
      <div style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
          💰 ${t('arcade.blind10StakeLabel')}
        </label>
        <div class="flex gap-xs" style="flex-wrap: wrap;">
          <button type="button" class="btn ${selectedStake === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm mafia-stake-btn" data-stake="0">0 kr (Ära)</button>
          <button type="button" class="btn ${selectedStake === 20 ? 'btn-primary' : 'btn-secondary'} btn-sm mafia-stake-btn" data-stake="20">20 kr</button>
          <button type="button" class="btn ${selectedStake === 50 ? 'btn-primary' : 'btn-secondary'} btn-sm mafia-stake-btn" data-stake="50">50 kr</button>
          <button type="button" class="btn ${selectedStake === 100 ? 'btn-primary' : 'btn-secondary'} btn-sm mafia-stake-btn" data-stake="100">100 kr</button>
        </div>
      </div>

      ${friendsHtml}

      <button type="button" class="btn btn-primary btn-block mb-lg" id="btn-create-mafia" style="padding: 14px; font-weight: 800; font-size: 1rem; background: linear-gradient(135deg, #ef4444, #b91c1c); border: none; box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4);">
        ➕ ${isEn ? 'Create Mafia Room' : 'Skapa Maffiarum'}
      </button>

      <!-- Join with code section -->
      <div style="position: relative; text-align: center; margin: 18px 0 14px 0;">
        <hr style="border: 0; border-top: 1px solid var(--border-glass);" />
        <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #14141e; padding: 0 10px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">
          ${isEn ? 'or join with room code' : 'eller gå med via kod'}
        </span>
      </div>

      <div class="flex gap-sm">
        <input type="text" id="mafia-join-code" class="form-input" placeholder="AB12" maxlength="6" autocapitalize="characters" autocomplete="off" style="text-transform: uppercase; font-family: monospace; font-size: 1.1rem; text-align: center; font-weight: 700; letter-spacing: 3px;" />
        <button type="button" class="btn btn-secondary" id="btn-join-mafia" style="white-space: nowrap; padding: 0 18px; font-weight: 700;">
          ${t('arcade.blind10JoinBtn')}
        </button>
      </div>
    `;

    // Narrator Mode Radios
    container.querySelectorAll('input[name="mafia-narrator"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        narratorMode = e.target.value;
        renderSetupView();
      });
    });

    // Stake Buttons
    container.querySelectorAll('.mafia-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedStake = parseInt(btn.dataset.stake, 10);
        container.querySelectorAll('.mafia-stake-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      });
    });

    // Friend checkboxes
    container.querySelectorAll('.mafia-friend-invite-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          invitedFriendIds.add(cb.value);
        } else {
          invitedFriendIds.delete(cb.value);
        }
      });
    });

    // Create Mafia Room
    document.getElementById('btn-create-mafia')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-create-mafia');
      if (btn) btn.disabled = true;
      try {
        const res = await createPartyRoom({
          gameType: 'mafia',
          stakeAmount: selectedStake
        });

        if (res && res.room) {
          currentRoom = res.room;
          if (invitedFriendIds.size > 0) {
            try {
              await inviteToParty(currentRoom.id, Array.from(invitedFriendIds));
              showToast(isEn ? 'Invites sent to friends!' : 'Inbjudningar skickade till vännerna!', 'success');
            } catch (e) {}
          }
          setupMafiaLobby(currentRoom);
        }
      } catch (err) {
        showToast(err.message || (isEn ? 'Failed to create room' : 'Kunde inte skapa rum'), 'error');
        if (btn) btn.disabled = false;
      }
    });

    // Join with Code
    document.getElementById('btn-join-mafia')?.addEventListener('click', async () => {
      const codeInput = document.getElementById('mafia-join-code');
      const code = (codeInput?.value || '').trim().toUpperCase();
      if (!code) {
        showToast(isEn ? 'Please enter a room code' : 'Ange en rumskod', 'warning');
        return;
      }
      try {
        const res = await joinPartyRoom({ code });
        if (res && res.room) {
          setupMafiaLobby(res.room);
        }
      } catch (err) {
        showToast(err.message || (isEn ? 'Failed to join room' : 'Kunde inte gå med i rummet'), 'error');
      }
    });
  }

  // ── VIEW 2: LOBBY & WEBSOCKET SYNC ──────────────────────
  function setupMafiaLobby(room) {
    currentRoom = room;
    cleanup();

    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?party=${room.id}`;

    try {
      activeWs = new WebSocket(wsUrl);
      activeWs.onopen = () => {
        if (token) {
          activeWs.send(JSON.stringify({ type: 'auth', token }));
        }
        activeWs.send(JSON.stringify({ action: 'join_party', partyId: room.id }));
      };
      activeWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMafiaWsMessage(data);
        } catch (e) {}
      };
      activeWs.onclose = () => {
        activeWs = null;
      };
    } catch (e) {}

    if (currentRoom.status === 'mafia_running' && currentRoom.mafiaState) {
      loadRoleAndRenderPhase();
    } else {
      renderLobbyView();
    }
  }

  function handleMafiaWsMessage(data) {
    if (data.type === 'party_updated' && data.room) {
      currentRoom = data.room;
      renderLobbyView();
    } else if (data.type === 'mafia_game_started' && data.room) {
      currentRoom = data.room;
      loadRoleAndShowCardReveal();
    } else if (data.type === 'mafia_night_progress') {
      // Someone submitted their night action
      const statusEl = document.getElementById('mafia-night-status');
      if (statusEl) {
        statusEl.textContent = isEn ? 'Actions are being taken in secret...' : 'Hemliga drag registreras i mörkret...';
      }
    } else if (data.type === 'mafia_morning' && data.room) {
      currentRoom = data.room;
      if (user && currentRoom.mafiaState?.roles?.[user.id]) {
        if (!mySecretData) mySecretData = {};
        mySecretData.isAlive = currentRoom.mafiaState.roles[user.id].isAlive !== false;
      }
      playTone(523.25, 'triangle', 0.25, 0.12);
      renderMorningView(data.killedPlayer, data.saved, data.winner);
    } else if (data.type === 'mafia_day_started' && data.room) {
      currentRoom = data.room;
      if (user && currentRoom.mafiaState?.roles?.[user.id]) {
        if (!mySecretData) mySecretData = {};
        mySecretData.isAlive = currentRoom.mafiaState.roles[user.id].isAlive !== false;
      }
      myDayVoteTargetId = null;
      renderDayView();
    } else if (data.type === 'mafia_vote_cast') {
      updateDayVoteChip(data.targetId, data.totalVotes, data.aliveCount, data.voteCounts);
    } else if (data.type === 'mafia_lynch_result' && data.room) {
      currentRoom = data.room;
      if (user && currentRoom.mafiaState?.roles?.[user.id]) {
        if (!mySecretData) mySecretData = {};
        mySecretData.isAlive = currentRoom.mafiaState.roles[user.id].isAlive !== false;
      }
      playTone(130, 'square', 0.5, 0.2);
      renderLynchResultView(data.lynchedPlayer, data.isTie, data.winner);
    } else if (data.type === 'mafia_night_started' && data.room) {
      currentRoom = data.room;
      if (user && currentRoom.mafiaState?.roles?.[user.id]) {
        if (!mySecretData) mySecretData = {};
        mySecretData.isAlive = currentRoom.mafiaState.roles[user.id].isAlive !== false;
      }
      myNightActionDone = false;
      myInvestigateResult = null;
      playTone(180, 'sawtooth', 0.4, 0.15);
      renderNightView();
    }
  }

  function renderLobbyView() {
    if (!currentRoom) return;
    const isHost = user && currentRoom.hostId === user.id;
    const players = currentRoom.players || [];
    const count = players.length;
    const minNeeded = narratorMode === 'human' ? 5 : 4;
    const canStart = count >= minNeeded;
    const totalPot = currentRoom.stakeAmount * count;

    container.innerHTML = `
      <div class="text-center" style="margin-bottom: 14px;">
        <img src="/mafia-gold.png" alt="Mafia" style="width: 68px; height: 68px; margin: 0 auto 6px auto; display: block; filter: drop-shadow(0 4px 14px rgba(255,215,0,0.45));" />
        <div style="background: rgba(239, 68, 68, 0.08); border: 2px dashed #ef4444; border-radius: var(--radius-lg); padding: 12px 10px; margin-bottom: 12px;">
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">
            ${t('arcade.blind10CodePrompt')}
          </div>
          <div style="font-size: 2.4rem; font-weight: 900; letter-spacing: 6px; color: #ef4444; font-family: monospace; margin: 4px 0;">
            ${currentRoom.code}
          </div>
          <div class="flex gap-xs justify-center" style="margin-top: 6px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-mafia-code" style="font-size: 0.8rem; padding: 4px 12px;">
              📋 ${isEn ? 'Copy Code' : 'Kopiera kod'}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-show-mafia-qr" style="font-size: 0.8rem; padding: 4px 12px; border-color: #ef4444; color: #ef4444; font-weight: 700;">
              📱 ${isEn ? 'Show QR' : 'Visa QR-kod'}
            </button>
          </div>
        </div>

        <div class="flex justify-between align-center" style="background: rgba(255,255,255,0.04); border-radius: var(--radius-md); padding: 8px 14px; margin-bottom: 12px; border: 1px solid var(--border-glass);">
          <span style="font-size: 0.85rem; color: var(--text-secondary);">
            ${isEn ? 'Stake' : 'Insats'}: <strong>${currentRoom.stakeAmount} kr</strong>
          </span>
          <span style="font-size: 0.88rem; font-weight: 700; color: #10b981;">
            💰 ${t('arcade.blind10TotalPot')} ${totalPot} kr
          </span>
        </div>
      </div>

      <!-- Player List -->
      <div style="margin-bottom: 16px;">
        <div class="flex justify-between align-center" style="margin-bottom: 8px;">
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">
            👥 ${t('arcade.blind10PlayersJoined')} (${count}/${minNeeded}+):
          </div>
          <span class="badge ${canStart ? 'badge-success' : 'badge-warning'}" style="font-size: 0.72rem;">
            ${canStart ? (isEn ? 'Ready to Start' : 'Klar att starta') : (isEn ? `Need ${minNeeded - count} more` : `Behöver ${minNeeded - count} till`)}
          </span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${players.map(p => `
            <div class="party-player-chip ${p.isHost ? 'host' : ''}">
              <span>${escapeHtml(p.avatarEmoji) || (p.isHost ? '👑' : '👤')}</span>
              <span>${escapeHtml(p.nickname)}</span>
              ${p.isHost ? `<span style="font-size: 0.7rem; opacity: 0.8;">(${isEn ? 'Host' : 'Värd'})</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Roles distribution guide -->
      <div style="background: rgba(0,0,0,0.25); border-radius: var(--radius-md); padding: 10px 12px; margin-bottom: 16px; border: 1px solid var(--border-glass); font-size: 0.78rem; color: var(--text-secondary);">
        <div style="font-weight: 700; color: var(--gold); margin-bottom: 4px;">🃏 ${isEn ? 'Role Balance' : 'Rollfördelning'}${narratorMode === 'human' ? ` (${isEn ? 'Host is Narrator' : 'Värden är spelledare'} + ${Math.max(0, count - 1)} ${isEn ? 'active' : 'aktiva'})` : ''}:</div>
        <div>🗡️ <strong>${t('arcade.mafiaRoleMafia')}</strong>: ${(() => {
          const act = narratorMode === 'human' ? Math.max(0, count - 1) : count;
          if (act >= 15) return 4;
          if (act >= 10) return 3;
          if (act >= 7) return 2;
          return 1;
        })()} ${isEn ? 'players' : 'spelare'}</div>
        <div>🔍 <strong>${t('arcade.mafiaRoleDetective')}</strong>: 1 ${isEn ? 'player' : 'spelare'}</div>
        <div>💉 <strong>${t('arcade.mafiaRoleDoctor')}</strong>: ${(narratorMode === 'human' ? Math.max(0, count - 1) : count) >= 5 ? 1 : 0} ${isEn ? 'player' : 'spelare'}</div>
        <div>🌾 <strong>${t('arcade.mafiaRoleVillager')}</strong>: ${(() => {
          const act = narratorMode === 'human' ? Math.max(0, count - 1) : count;
          const maf = act >= 15 ? 4 : (act >= 10 ? 3 : (act >= 7 ? 2 : 1));
          const doc = act >= 5 ? 1 : 0;
          return Math.max(0, act - maf - 1 - doc);
        })()} ${isEn ? 'players' : 'spelare'}</div>
      </div>

      <!-- Action Button -->
      ${isHost ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-start-mafia-game" ${!canStart ? 'disabled' : ''} style="padding: 16px; font-size: 1.05rem; font-weight: 800; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; box-shadow: 0 4px 16px rgba(239, 68, 68, 0.45);">
          🚀 ${isEn ? 'START MAFIA GAME!' : 'STARTA MAFFIA!'}
        </button>
      ` : `
        <div class="text-center" style="padding: 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); margin-bottom: 12px;">
          <span class="spinner" style="margin-bottom: 6px;">⏳</span>
          <div style="font-size: 0.88rem; font-weight: 600; color: var(--gold);">
            ${isEn ? 'Waiting for host to start the game...' : 'Väntar på att värden ska starta spelet...'}
          </div>
        </div>
      `}

      <button type="button" class="btn btn-secondary btn-block btn-sm" id="btn-leave-mafia">
        🚪 ${isEn ? 'Leave Room' : 'Lämna rummet'}
      </button>
    `;

    document.getElementById('btn-copy-mafia-code')?.addEventListener('click', () => {
      navigator.clipboard.writeText(currentRoom.code).then(() => {
        showToast(isEn ? 'Code copied!' : 'Rumskod kopierad!', 'success');
      }).catch(() => {
        showToast(currentRoom.code, 'info');
      });
    });

    document.getElementById('btn-show-mafia-qr')?.addEventListener('click', () => {
      showPartyRoomQRModal(currentRoom.code, 'mafia');
    });

    document.getElementById('btn-start-mafia-game')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-start-mafia-game');
      if (btn) btn.disabled = true;
      try {
        await startMafiaGame(currentRoom.id, { narratorMode });
      } catch (err) {
        showToast(err.message || (isEn ? 'Failed to start game' : 'Kunde inte starta spelet'), 'error');
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById('btn-leave-mafia')?.addEventListener('click', () => {
      cleanup();
      renderSetupView();
    });
  }

  // ── VIEW 3: SECRET ROLE PEEK (HOLD-TO-REVEAL) ───────────
  async function loadRoleAndShowCardReveal() {
    try {
      mySecretData = await getMyMafiaRole(currentRoom.id);
    } catch (e) {
      showToast(isEn ? 'Could not load your role' : 'Kunde inte hämta din roll', 'error');
      return;
    }

    const role = mySecretData.role;
    let roleTitle = t('arcade.mafiaRoleVillager');
    let roleDesc = t('arcade.mafiaRoleVillagerDesc');
    let roleIcon = '🌾';
    let roleClass = 'role-villager';

    if (role === 'mafia') {
      roleTitle = t('arcade.mafiaRoleMafia');
      roleDesc = t('arcade.mafiaRoleMafiaDesc');
      roleIcon = '🗡️';
      roleClass = 'role-mafia';
    } else if (role === 'detective') {
      roleTitle = t('arcade.mafiaRoleDetective');
      roleDesc = t('arcade.mafiaRoleDetectiveDesc');
      roleIcon = '🔍';
      roleClass = 'role-detective';
    } else if (role === 'doctor') {
      roleTitle = t('arcade.mafiaRoleDoctor');
      roleDesc = t('arcade.mafiaRoleDoctorDesc');
      roleIcon = '💉';
      roleClass = 'role-doctor';
    } else if (role === 'narrator') {
      roleTitle = t('arcade.mafiaGodModeTitle');
      roleDesc = t('arcade.mafiaGodModeDesc');
      roleIcon = '👁️';
      roleClass = 'role-narrator';
    }

    const teammatesHtml = (mySecretData.fellowMafia && mySecretData.fellowMafia.length > 1) ? `
      <div style="margin-top: 10px; padding: 6px; background: rgba(239,68,68,0.2); border-radius: var(--radius-sm); font-size: 0.75rem;">
        <span style="font-weight: 700; color: #ef4444;">${t('arcade.mafiaTeammates')}</span>
        <div>${mySecretData.fellowMafia.map(m => escapeHtml(m.nickname)).join(', ')}</div>
      </div>
    ` : '';

    container.innerHTML = `
      <div class="text-center" style="margin-bottom: 12px;">
        <h3 style="color: var(--gold); font-size: 1.15rem; margin-bottom: 4px;">
          🃏 ${isEn ? 'Your Secret Role' : 'Din Hemliga Roll'}
        </h3>
        <p class="text-muted" style="font-size: 0.8rem; margin: 0;">
          ${isEn ? 'Keep your screen hidden from nearby players!' : 'Se till att ingen bredvid kan kika på din skärm!'}
        </p>
      </div>

      <!-- 3D Card Flip Wrap -->
      <div class="mafia-card-reveal-wrap" id="mafia-card-wrap">
        <div class="mafia-card-inner" id="mafia-card-inner">
          <!-- Card Front (Covered / Mystery) -->
          <div class="mafia-card-front">
            <div style="font-size: 3.5rem; margin-bottom: 12px; filter: drop-shadow(0 2px 8px rgba(255,215,0,0.6));">🔒</div>
            <div style="font-size: 0.85rem; font-weight: 800; color: var(--gold); letter-spacing: 1px; text-transform: uppercase;">
              ${t('arcade.mafiaRoleCardPrompt')}
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 8px;">
              ${isEn ? 'Press and hold down to view' : 'Håll fingret nedtryckt'}
            </div>
          </div>

          <!-- Card Back (Revealed Identity) -->
          <div class="mafia-card-back ${roleClass}">
            <div style="font-size: 4rem; margin-bottom: 8px;">${roleIcon}</div>
            <div style="font-size: 1.4rem; font-weight: 900; color: var(--gold); margin-bottom: 6px;">
              ${roleTitle}
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 6px;">
              ${roleDesc}
            </div>
            ${teammatesHtml}
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 10px;">
              ${t('arcade.mafiaRoleCardRelease')}
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="btn btn-primary btn-block mb-md" id="btn-continue-to-night" style="padding: 14px; font-weight: 700; background: linear-gradient(135deg, #4f46e5, #3730a3); border: none;">
        🌙 ${isEn ? 'I memorized my role 👉 Continue to Night' : 'Jag har sett min roll 👉 Fortsätt till natten'}
      </button>
    `;

    const cardInner = document.getElementById('mafia-card-inner');
    const cardWrap = document.getElementById('mafia-card-wrap');

    const reveal = () => {
      cardInner?.classList.add('revealed');
      playTone(400, 'sine', 0.1, 0.08);
    };
    const hide = () => {
      cardInner?.classList.remove('revealed');
    };

    if (cardWrap) {
      cardWrap.addEventListener('mousedown', reveal);
      cardWrap.addEventListener('mouseup', hide);
      cardWrap.addEventListener('mouseleave', hide);
      cardWrap.addEventListener('touchstart', (e) => { e.preventDefault(); reveal(); });
      cardWrap.addEventListener('touchend', hide);
      cardWrap.addEventListener('touchcancel', hide);
    }

    document.getElementById('btn-continue-to-night')?.addEventListener('click', () => {
      renderNightView();
    });
  }

  async function loadRoleAndRenderPhase() {
    try {
      mySecretData = await getMyMafiaRole(currentRoom.id);
    } catch (e) {}

    if (user && currentRoom.mafiaState?.roles?.[user.id]) {
      if (!mySecretData) mySecretData = {};
      mySecretData.isAlive = currentRoom.mafiaState.roles[user.id].isAlive !== false;
    }

    const phase = currentRoom.mafiaState?.phase || 'night';
    if (phase === 'night') renderNightView();
    else if (phase === 'morning') renderMorningView(currentRoom.mafiaState?.lastKilled, false, currentRoom.mafiaState?.winner);
    else if (phase === 'day') renderDayView();
    else if (phase === 'lynch_result') renderLynchResultView(currentRoom.mafiaState?.lastLynched, !!currentRoom.mafiaState?.lastLynchTie, currentRoom.mafiaState?.winner);
    else if (phase === 'ended') renderVictoryView(currentRoom.mafiaState?.winner);
  }

  // ── VIEW 4: NIGHT PHASE ──────────────────────────────────
  function renderNightView() {
    const isHost = user && currentRoom.hostId === user.id;
    const state = currentRoom.mafiaState || {};
    const roles = state.roles || {};
    const roundNumber = state.roundNumber || 1;
    const myRole = mySecretData?.role || 'villager';
    const isAlive = mySecretData?.isAlive !== false;
    const isNarrator = myRole === 'narrator';

    let actionCardHtml = '';

    if (!isAlive) {
      actionCardHtml = `
        <div class="text-center" style="padding: 20px; background: rgba(0,0,0,0.4); border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 2.5rem; margin-bottom: 6px;">👻</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text-muted);">
            ${isEn ? 'You are dead' : 'Du är död'}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            ${isEn ? 'Spirits can observe in silence...' : 'Spöken kan bara betrakta spelet i tystnad...'}
          </div>
        </div>
      `;
    } else if (isNarrator) {
      // Narrator God Mode View
      const allPlayers = Object.entries(roles);
      actionCardHtml = `
        <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid #a855f7; border-radius: var(--radius-md); padding: 12px; margin-bottom: 12px;">
          <div style="font-size: 0.9rem; font-weight: 800; color: #c084fc; margin-bottom: 6px;">
            👁️ ${t('arcade.mafiaGodModeTitle')}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 10px;">
            ${t('arcade.mafiaGodModeDesc')}
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${allPlayers.map(([pId, p]) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); font-size: 0.82rem;">
                <span>${p.avatarEmoji || '👤'} <strong>${escapeHtml(p.nickname)}</strong></span>
                <span class="mafia-badge-pill" style="background: ${p.role === 'mafia' ? '#ef4444' : (p.role === 'detective' ? '#3b82f6' : (p.role === 'doctor' ? '#10b981' : '#f59e0b'))}; color: #fff;">
                  ${p.role} ${!p.isAlive ? '(Död)' : ''}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else if (myRole === 'mafia') {
      // Mafia Kill Target (excluding self and fellow mafia members)
      const fellowMafiaIds = new Set((mySecretData?.fellowMafia || []).map(m => m.id));
      if (user?.id) fellowMafiaIds.add(user.id);
      const aliveTargets = Object.entries(roles).filter(([id, p]) => p.isAlive && p.role !== 'narrator' && !fellowMafiaIds.has(id));
      if (myNightActionDone) {
        actionCardHtml = `
          <div class="text-center" style="padding: 16px; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: var(--radius-md);">
            <div style="font-size: 2rem; margin-bottom: 4px;">🗡️</div>
            <div style="font-size: 0.9rem; font-weight: 700; color: #ef4444;">
              ${t('arcade.mafiaActionSubmitted')}
            </div>
          </div>
        `;
      } else {
        actionCardHtml = `
          <div style="margin-bottom: 12px;">
            <div style="font-size: 0.88rem; font-weight: 700; color: #ef4444; margin-bottom: 8px;">
              🗡️ ${t('arcade.mafiaNightVictimPrompt')}
            </div>
            <div class="mafia-player-action-list">
              ${aliveTargets.map(([id, p]) => `
                <button type="button" class="mafia-player-btn btn-night-target" data-target="${id}">
                  <span>${p.avatarEmoji || '👤'} ${escapeHtml(p.nickname)}</span>
                  <span style="font-size: 0.78rem; color: #ef4444; font-weight: 700;">Likvidera 🎯</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }
    } else if (myRole === 'detective') {
      // Detective Inspect Target
      const aliveTargets = Object.entries(roles).filter(([id, p]) => p.isAlive && p.role !== 'narrator' && id !== user.id);
      if (myInvestigateResult) {
        actionCardHtml = `
          <div class="text-center" style="padding: 16px; background: rgba(59, 130, 246, 0.15); border: 1px solid #3b82f6; border-radius: var(--radius-md);">
            <div style="font-size: 2rem; margin-bottom: 4px;">🔍</div>
            <div style="font-size: 1rem; font-weight: 800; color: ${myInvestigateResult === 'mafia' ? '#ef4444' : '#10b981'};">
              ${myInvestigateResult === 'mafia' ? t('arcade.mafiaInvestigateResultMafia') : t('arcade.mafiaInvestigateResultInnocent')}
            </div>
          </div>
        `;
      } else {
        actionCardHtml = `
          <div style="margin-bottom: 12px;">
            <div style="font-size: 0.88rem; font-weight: 700; color: #3b82f6; margin-bottom: 8px;">
              🔍 ${t('arcade.mafiaNightInvestigatePrompt')}
            </div>
            <div class="mafia-player-action-list">
              ${aliveTargets.map(([id, p]) => `
                <button type="button" class="mafia-player-btn btn-investigate-target" data-target="${id}">
                  <span>${p.avatarEmoji || '👤'} ${escapeHtml(p.nickname)}</span>
                  <span style="font-size: 0.78rem; color: #3b82f6; font-weight: 700;">Undersök 🔍</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }
    } else if (myRole === 'doctor') {
      // Doctor Protect Target
      const aliveTargets = Object.entries(roles).filter(([id, p]) => p.isAlive && p.role !== 'narrator');
      if (myNightActionDone) {
        actionCardHtml = `
          <div class="text-center" style="padding: 16px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: var(--radius-md);">
            <div style="font-size: 2rem; margin-bottom: 4px;">💉</div>
            <div style="font-size: 0.9rem; font-weight: 700; color: #10b981;">
              ${t('arcade.mafiaActionSubmitted')}
            </div>
          </div>
        `;
      } else {
        actionCardHtml = `
          <div style="margin-bottom: 12px;">
            <div style="font-size: 0.88rem; font-weight: 700; color: #10b981; margin-bottom: 8px;">
              💉 ${t('arcade.mafiaNightHealPrompt')}
            </div>
            <div class="mafia-player-action-list">
              ${aliveTargets.map(([id, p]) => `
                <button type="button" class="mafia-player-btn btn-heal-target" data-target="${id}">
                  <span>${p.avatarEmoji || '👤'} ${escapeHtml(p.nickname)} ${id === user.id ? `(${isEn ? 'You' : 'Dig själv'})` : ''}</span>
                  <span style="font-size: 0.78rem; color: #10b981; font-weight: 700;">Skydda 🛡️</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }
    } else {
      // Villager Sleeping
      actionCardHtml = `
        <div class="text-center" style="padding: 24px 16px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-md);">
          <div style="font-size: 3rem; margin-bottom: 6px;">😴💤</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: var(--gold);">
            ${isEn ? 'You are fast asleep...' : 'Byn sover sött...'}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            ${isEn ? 'Pray the doctor and detective do their jobs!' : 'Hoppas läkaren och polisen gör sitt jobb inatt!'}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="mafia-night-theme mb-md text-center">
        <div style="font-size: 2.8rem; line-height: 1; margin-bottom: 6px; filter: drop-shadow(0 0 14px rgba(255,255,255,0.7));">
          🌙
        </div>
        <h3 style="color: #fff; font-size: 1.15rem; margin-bottom: 4px;">
          ${t('arcade.mafiaPhaseNight')} (${isEn ? 'Round' : 'Runda'} ${roundNumber})
        </h3>
        <p class="text-muted" style="font-size: 0.8rem; margin: 0 auto 10px auto; max-width: 320px;">
          ${t('arcade.mafiaPhaseNightDesc')}
        </p>
        <div id="mafia-night-status" style="font-size: 0.75rem; color: var(--gold); font-weight: 600;">
          ${isEn ? 'Night actions underway...' : 'Nattens hemliga handlingar pågår...'}
        </div>
      </div>

      ${actionCardHtml}

      ${isHost ? `
        <button type="button" class="btn btn-primary btn-block mt-md" id="btn-advance-to-morning" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);">
          ${t('arcade.mafiaAdvanceNightBtn')}
        </button>
      ` : ''}
    `;

    // Hook Mafia Kill
    container.querySelectorAll('.btn-night-target').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        btn.disabled = true;
        try {
          await submitMafiaNightAction(currentRoom.id, { actionType: 'mafia_kill', targetId });
          myNightActionDone = true;
          showToast(isEn ? 'Target marked for elimination' : 'Offer markerat för likvidering', 'success');
          renderNightView();
        } catch (e) {
          showToast(e.message || 'Error', 'error');
          btn.disabled = false;
        }
      });
    });

    // Hook Detective Inspect
    container.querySelectorAll('.btn-investigate-target').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        btn.disabled = true;
        try {
          const res = await submitMafiaNightAction(currentRoom.id, { actionType: 'detective_check', targetId });
          myInvestigateResult = res?.detectiveResult || 'innocent';
          renderNightView();
        } catch (e) {
          showToast(e.message || 'Error', 'error');
          btn.disabled = false;
        }
      });
    });

    // Hook Doctor Heal
    container.querySelectorAll('.btn-heal-target').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        btn.disabled = true;
        try {
          await submitMafiaNightAction(currentRoom.id, { actionType: 'doctor_protect', targetId });
          myNightActionDone = true;
          showToast(isEn ? 'Protection administered' : 'Skydd administrerat', 'success');
          renderNightView();
        } catch (e) {
          showToast(e.message || 'Error', 'error');
          btn.disabled = false;
        }
      });
    });

    // Advance to Morning (Host only)
    document.getElementById('btn-advance-to-morning')?.addEventListener('click', async () => {
      const advBtn = document.getElementById('btn-advance-to-morning');
      if (advBtn) advBtn.disabled = true;
      try {
        await advanceMafiaPhase(currentRoom.id, { expectedPhase: 'night' });
      } catch (e) {
        showToast(e.message || 'Error', 'error');
        if (advBtn) advBtn.disabled = false;
      }
    });
  }

  // ── VIEW 5: MORNING REPORT ───────────────────────────────
  function renderMorningView(killedPlayer, saved, winner) {
    const isHost = user && currentRoom.hostId === user.id;
    const isEnded = !!(winner || currentRoom.mafiaState?.winner || currentRoom.mafiaState?.phase === 'ended');
    const winningSide = winner || currentRoom.mafiaState?.winner;

    let headlineHtml = '';
    if (killedPlayer) {
      headlineHtml = `
        <div style="padding: 14px 0;">
          <div style="font-size: 2.4rem; margin-bottom: 4px;">🩸</div>
          <div style="font-size: 1.15rem; font-weight: 900; color: #b91c1c; margin-bottom: 4px;">
            ${t('arcade.mafiaMorningMurdered')}
          </div>
          <div style="font-size: 1.4rem; font-weight: 900; color: #111;">
            ${escapeHtml(killedPlayer.nickname)}
          </div>
          <div class="badge badge-error mt-xs" style="font-size: 0.8rem; padding: 4px 12px; margin-top: 6px;">
            ${isEn ? 'Role revealed' : 'Avslöjad roll'}: ${killedPlayer.role}
          </div>
        </div>
      `;
    } else {
      headlineHtml = `
        <div style="padding: 14px 0;">
          <div style="font-size: 2.4rem; margin-bottom: 4px;">🕊️</div>
          <div style="font-size: 1.15rem; font-weight: 900; color: #059669; margin-bottom: 4px;">
            ${isEn ? 'PEACEFUL NIGHT!' : 'INGEN MÖRDADES!'}
          </div>
          <div style="font-size: 0.88rem; color: #333; line-height: 1.4;">
            ${t('arcade.mafiaMorningNoDeaths')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="mafia-newspaper text-center mb-md">
        <div style="font-size: 0.72rem; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; color: #666; margin-bottom: 2px;">
          📰 THE DAILY VILLAGE DISPATCH · MORGONBLADET
        </div>
        <h3>${t('arcade.mafiaPhaseMorning')}</h3>
        ${headlineHtml}
      </div>

      ${isEnded ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-show-mafia-victory" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
          🏆 ${isEn ? 'Game Over - View Winner!' : 'Spelet slut - Visa vinnare!'}
        </button>
      ` : (isHost ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-advance-to-day" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
          ${t('arcade.mafiaAdvanceDayBtn')}
        </button>
      ` : `
        <div class="text-center text-muted" style="font-size: 0.82rem; padding: 12px;">
          <span class="spinner">⏳</span> ${isEn ? 'Waiting for host to begin town meeting...' : 'Väntar på att värden ska samla bymötet...'}
        </div>
      `)}
    `;

    document.getElementById('btn-show-mafia-victory')?.addEventListener('click', () => {
      renderVictoryView(winningSide);
    });

    document.getElementById('btn-advance-to-day')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-advance-to-day');
      if (btn) btn.disabled = true;
      try {
        await advanceMafiaPhase(currentRoom.id, { expectedPhase: 'morning' });
      } catch (e) {
        showToast(e.message || 'Error', 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  // ── VIEW 6: DAY TOWN MEETING & VOTING ─────────────────────
  function renderDayView() {
    const isHost = user && currentRoom.hostId === user.id;
    const state = currentRoom.mafiaState || {};
    const roles = state.roles || {};
    if (user && roles[user.id]) {
      if (!mySecretData) mySecretData = {};
      mySecretData.isAlive = roles[user.id].isAlive !== false;
    }
    const isAlive = mySecretData?.isAlive !== false;
    const isNarrator = mySecretData?.role === 'narrator';
    const alivePlayers = Object.entries(roles).filter(([id, p]) => p.isAlive && p.role !== 'narrator');
    const voteCounts = state.voteCounts || {};

    container.innerHTML = `
      <div class="text-center" style="margin-bottom: 14px;">
        <div style="font-size: 3rem; line-height: 1; margin-bottom: 6px;">🏛️</div>
        <h3 style="color: var(--gold); font-size: 1.15rem; margin-bottom: 4px;">
          ${t('arcade.mafiaPhaseDay')}
        </h3>
        <p class="text-muted" style="font-size: 0.8rem; margin: 0 auto 12px auto; max-width: 320px;">
          ${t('arcade.mafiaPhaseDayDesc')}
        </p>
      </div>

      <!-- Voting booth -->
      <div style="margin-bottom: 16px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--gold); margin-bottom: 8px;">
          ⚖️ ${isEn ? 'Vote for execution in the square' : 'Rösta för lynchning på torget'}:
        </div>
        <div class="mafia-player-action-list" id="mafia-day-player-list">
          ${alivePlayers.map(([id, p]) => `
            <div class="mafia-player-btn ${myDayVoteTargetId === id ? 'selected' : ''}" id="mafia-vote-row-${id}">
              <span>${p.avatarEmoji || '👤'} <strong>${escapeHtml(p.nickname)}</strong></span>
              <div class="flex align-center gap-xs">
                <span class="badge badge-accent" id="vote-count-${id}" style="font-size: 0.72rem; padding: 2px 8px;">
                  ${voteCounts[id] || 0} ${isEn ? 'votes' : 'röster'}
                </span>
                ${(isAlive && !isNarrator) ? `
                  <button type="button" class="btn btn-sm ${myDayVoteTargetId === id ? 'btn-primary' : 'btn-secondary'} btn-mafia-vote" data-target="${id}" style="padding: 4px 10px; font-size: 0.78rem;">
                    ${myDayVoteTargetId === id ? (isEn ? '✅ Voted' : '✅ Röst lagd') : (isEn ? '🗳️ Vote' : '🗳️ Rösta')}
                  </button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${isHost ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-resolve-day-votes" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);">
          ${t('arcade.mafiaResolveVotesBtn')}
        </button>
      ` : `
        <div class="text-center text-muted" style="font-size: 0.82rem; padding: 10px;">
          <span class="spinner">⏳</span> ${isEn ? 'Voting is live. Host will announce the verdict...' : 'Röstning pågår. Värden avslutar och tillkännager domslutet...'}
        </div>
      `}
    `;

    // Hook Day Vote Buttons
    container.querySelectorAll('.btn-mafia-vote').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        btn.disabled = true;
        try {
          const res = await voteMafiaLynch(currentRoom.id, targetId);
          myDayVoteTargetId = targetId;
          showToast(isEn ? 'Vote registered!' : 'Röst registrerad!', 'success');
          if (res?.voteCounts) {
            updateDayVoteChip(targetId, 0, 0, res.voteCounts);
          }
          container.querySelectorAll('.mafia-player-btn').forEach(row => row.classList.remove('selected'));
          document.getElementById(`mafia-vote-row-${targetId}`)?.classList.add('selected');
          container.querySelectorAll('.btn-mafia-vote').forEach(b => {
            const bTarget = b.dataset.target;
            if (bTarget === targetId) {
              b.classList.remove('btn-secondary');
              b.classList.add('btn-primary');
              b.textContent = isEn ? '✅ Voted' : '✅ Röst lagd';
            } else {
              b.classList.remove('btn-primary');
              b.classList.add('btn-secondary');
              b.textContent = isEn ? '🗳️ Vote' : '🗳️ Rösta';
              b.disabled = false;
            }
          });
        } catch (e) {
          showToast(e.message || 'Error', 'error');
          btn.disabled = false;
        }
      });
    });

    document.getElementById('btn-resolve-day-votes')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-resolve-day-votes');
      if (btn) btn.disabled = true;
      try {
        await advanceMafiaPhase(currentRoom.id, { expectedPhase: 'day' });
      } catch (e) {
        showToast(e.message || 'Error', 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  function updateDayVoteChip(targetId, totalVotes, aliveCount, voteCounts) {
    if (voteCounts && typeof voteCounts === 'object') {
      const state = currentRoom?.mafiaState || {};
      const roles = state.roles || {};
      for (const tId of Object.keys(roles)) {
        const count = voteCounts[tId] || 0;
        const chip = document.getElementById(`vote-count-${tId}`);
        if (chip) chip.textContent = `${count} ${isEn ? 'votes' : 'röster'}`;
      }
    } else {
      const chip = document.getElementById(`vote-count-${targetId}`);
      if (chip) {
        const current = parseInt(chip.textContent, 10) || 0;
        chip.textContent = `${current + 1} ${isEn ? 'votes' : 'röster'}`;
      }
    }
  }

  // ── VIEW 7: LYNCH RESULT / VERDICT ────────────────────────
  function renderLynchResultView(lynchedPlayer, isTie, winner) {
    const isHost = user && currentRoom.hostId === user.id;
    const isEnded = !!(winner || currentRoom.mafiaState?.winner || currentRoom.mafiaState?.phase === 'ended');
    const winningSide = winner || currentRoom.mafiaState?.winner;

    let verdictHtml = '';
    if (lynchedPlayer) {
      verdictHtml = `
        <div style="padding: 16px 0;">
          <div style="font-size: 3rem; margin-bottom: 6px;">⚖️</div>
          <div style="font-size: 1.15rem; font-weight: 900; color: #ef4444; margin-bottom: 4px;">
            ${t('arcade.mafiaLynchedDesc')}
          </div>
          <div style="font-size: 1.5rem; font-weight: 900; color: #fff; margin-bottom: 4px;">
            ${escapeHtml(lynchedPlayer.nickname)}
          </div>
          <div class="badge badge-accent mt-xs" style="font-size: 0.85rem; padding: 4px 14px;">
            ${isEn ? 'True Identity' : 'Sann identitet'}: ${lynchedPlayer.role}
          </div>
        </div>
      `;
    } else {
      verdictHtml = `
        <div style="padding: 16px 0;">
          <div style="font-size: 3rem; margin-bottom: 6px;">🤝</div>
          <div style="font-size: 1.15rem; font-weight: 900; color: var(--gold); margin-bottom: 4px;">
            ${isEn ? 'NO ONE WAS LYNCHED' : 'INGEN LYNCHADES'}
          </div>
          <div style="font-size: 0.85rem; color: var(--text-secondary);">
            ${t('arcade.mafiaLynchedTie')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="text-center" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px;">
        ${verdictHtml}
      </div>

      ${isEnded ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-show-mafia-victory" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
          🏆 ${isEn ? 'Game Over - View Winner!' : 'Spelet slut - Visa vinnare!'}
        </button>
      ` : (isHost ? `
        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-next-night" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #4f46e5, #3730a3); border: none; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
          ${t('arcade.mafiaNextNightBtn')}
        </button>
      ` : `
        <div class="text-center text-muted" style="font-size: 0.82rem; padding: 10px;">
          <span class="spinner">⏳</span> ${isEn ? 'Waiting for the next night to fall...' : 'Väntar på att natten ska falla...'}
        </div>
      `)}
    `;

    document.getElementById('btn-show-mafia-victory')?.addEventListener('click', () => {
      renderVictoryView(winningSide);
    });

    document.getElementById('btn-next-night')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-next-night');
      if (btn) btn.disabled = true;
      try {
        await advanceMafiaPhase(currentRoom.id, { expectedPhase: 'lynch_result' });
      } catch (e) {
        showToast(e.message || 'Error', 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  // ── VIEW 8: VICTORY & SWISH SETTLEMENT ───────────────────
  function renderVictoryView(winner) {
    launchConfetti();
    playTone(523.25, 'triangle', 0.2, 0.2);
    setTimeout(() => playTone(659.25, 'triangle', 0.2, 0.2), 150);
    setTimeout(() => playTone(783.99, 'triangle', 0.4, 0.25), 300);

    const isMafiaWin = winner === 'mafia';
    const state = currentRoom.mafiaState || {};
    const roles = state.roles || {};
    const stake = currentRoom.stakeAmount || 0;

    container.innerHTML = `
      <div class="text-center" style="margin-bottom: 16px;">
        <div style="font-size: 4rem; line-height: 1; margin-bottom: 8px; filter: drop-shadow(0 4px 16px ${isMafiaWin ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.5)'});">
          ${isMafiaWin ? '🗡️' : '🌾'}
        </div>
        <h2 style="font-size: 1.5rem; font-weight: 900; color: ${isMafiaWin ? '#ef4444' : '#10b981'}; margin-bottom: 6px;">
          ${isMafiaWin ? t('arcade.mafiaWinnerMafia') : t('arcade.mafiaWinnerVillagers')}
        </h2>
        <p class="text-muted" style="font-size: 0.85rem; margin: 0 auto 14px auto;">
          ${isMafiaWin 
            ? (isEn ? 'The mafia outnumbered the town and took over!' : 'Maffian tog kontroll över staden!') 
            : (isEn ? 'The village worked together and eradicated the mafia!' : 'Byn avslöjade och utplånade all maffia!')}
        </p>
      </div>

      <!-- Full Table Role Reveal -->
      <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 12px; margin-bottom: 16px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--gold); margin-bottom: 8px;">
          🎭 ${isEn ? 'All Players Revealed' : 'Samtliga roller vid bordet'}:
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${Object.entries(roles).map(([id, p]) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); font-size: 0.82rem;">
              <span>${p.avatarEmoji || '👤'} <strong>${escapeHtml(p.nickname)}</strong></span>
              <span class="mafia-badge-pill" style="background: ${p.role === 'mafia' ? '#ef4444' : (p.role === 'detective' ? '#3b82f6' : (p.role === 'doctor' ? '#10b981' : '#f59e0b'))}; color: #fff;">
                ${p.role} ${!p.isAlive ? '(Död)' : '(Överlevde)'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      ${stake > 0 ? `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: var(--radius-md); padding: 12px; text-align: center; margin-bottom: 16px;">
          <div style="font-weight: 800; color: #10b981; margin-bottom: 4px;">
            💰 ${isEn ? 'Stakes Settled via Duels' : 'Swish-uppgörelse skapad!'}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-secondary);">
            ${isEn ? 'Check your active Duels tab to settle payments with friends.' : 'Förlorarna har tilldelats förluster i Duell-fliken för enkel Swish-betalning.'}
          </div>
        </div>
      ` : ''}

      <button type="button" class="btn btn-primary btn-block" id="btn-mafia-play-again" style="padding: 14px; font-weight: 800; background: linear-gradient(135deg, #f59e0b, #d97706); border: none;">
        ${t('arcade.mafiaPlayAgain')}
      </button>
    `;

    document.getElementById('btn-mafia-play-again')?.addEventListener('click', () => {
      cleanup();
      renderSetupView();
    });
  }
}

// ────────────────────────────────────────────────────────
// 🤝 ANYBET (KOMPISBETTET MED GYLLENE HANDSLAG)
// ────────────────────────────────────────────────────────
function formatAnyBetDate(dateStr) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T12:00:00`) : new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'sv-SE', { day: 'numeric', month: 'short' });
}

export async function openAnyBetModal(initialBetId = null) {
  const isEn = getLang() === 'en';
  const user = getStoredUser();

  let activeTab = initialBetId ? 'active' : 'create'; // 'create' | 'active' | 'finished'
  let friendsList = [];
  let selectedStake = 20;
  let selectedModel = 'winner_takes_all'; // 'winner_takes_all' | 'yes_no'
  let invitedFriendIds = new Set();
  let proofImageData = null;

  const modalTitle = `<img src="/handshake-gold.png" alt="AnyBet" style="width: 26px; height: 26px; vertical-align: -4px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(255,215,0,0.4));" />${t('arcade.anybetTitle')}`;

  showModal(modalTitle, `
    <div id="anybet-container" style="padding: 4px 0; min-height: 380px;">
      <p class="game-modal-subheading">${t('arcade.anybetDesc')}</p>
      <div class="text-center text-muted" style="padding: 40px 0;">
        <span class="spinner">⏳</span>
      </div>
    </div>
  `, null, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => Boolean(document.getElementById('anybet-question')?.value?.trim()),
    confirmTexts: {
      title: isEn ? 'Exit AnyBet?' : 'Lämna AnyBet?',
      message: isEn
        ? 'Are you sure you want to leave? Your entered bet question will be discarded.'
        : 'Är du säker på att du vill lämna? Ditt påbörjade AnyBet sparas inte.'
    }
  });

  const container = document.getElementById('anybet-container');
  if (!container) return;

  try {
    if (user) {
      friendsList = await getFriends().catch(() => []);
    }
  } catch (e) {}

  renderMainView();

  function renderMainView() {
    container.innerHTML = `
      <div class="the-tab-nav" style="margin-bottom: 14px;">
        <button type="button" class="tab-nav-btn ${activeTab === 'create' ? 'active' : ''}" id="tab-anybet-create">
          ${t('arcade.anybetCreateTab')}
        </button>
        <button type="button" class="tab-nav-btn ${activeTab === 'active' ? 'active' : ''}" id="tab-anybet-active">
          ${t('arcade.anybetActiveTab')}
        </button>
        <button type="button" class="tab-nav-btn ${activeTab === 'finished' ? 'active' : ''}" id="tab-anybet-finished">
          ${t('arcade.anybetFinishedTab')}
        </button>
      </div>

      <div id="anybet-tab-content"></div>
    `;

    document.getElementById('tab-anybet-create')?.addEventListener('click', () => {
      activeTab = 'create';
      renderMainView();
    });
    document.getElementById('tab-anybet-active')?.addEventListener('click', () => {
      activeTab = 'active';
      renderMainView();
    });
    document.getElementById('tab-anybet-finished')?.addEventListener('click', () => {
      activeTab = 'finished';
      renderMainView();
    });

    const tabContent = document.getElementById('anybet-tab-content');
    if (!tabContent) return;

    if (activeTab === 'create') {
      renderCreateTab(tabContent);
    } else if (activeTab === 'active') {
      renderActiveTab(tabContent);
    } else {
      renderFinishedTab(tabContent);
    }
  }

  // ── FLIK 1: SKAPA NYTT BET ────────────────────────────
  function renderCreateTab(tabContent) {
    if (!user) {
      tabContent.innerHTML = `
        <div class="text-center" style="padding: 30px 10px;">
          <img src="/handshake-gold.png" alt="Handshake" style="width: 72px; height: 72px; margin: 0 auto 12px auto; display: block; opacity: 0.8;" />
          <h3 style="color: var(--gold); margin-bottom: 8px;">Logga in för AnyBet</h3>
          <p class="text-muted mb-lg" style="font-size: 0.9rem;">
            ${isEn ? 'Log in to create custom bets, challenge friends, and track debts in Swishlistan.' : 'Logga in för att skapa kompisbet, utmana vänner och hålla koll på skulder i Swishlistan.'}
          </p>
        </div>
      `;
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    tabContent.innerHTML = `
      <div style="background: rgba(255, 215, 0, 0.05); border: 1px solid rgba(255, 215, 0, 0.2); border-radius: var(--radius-md); padding: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
        <img src="/handshake-gold.png" alt="AnyBet" style="width: 48px; height: 48px; flex-shrink: 0; filter: drop-shadow(0 2px 6px rgba(255,215,0,0.3));" />
        <div style="font-size: 0.82rem; line-height: 1.4; color: var(--text-secondary);">
          ${t('arcade.anybetDesc')}
        </div>
      </div>

      <!-- 1. Vad handlar bettet om? -->
      <div style="margin-bottom: 14px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: block;">
          💬 ${isEn ? 'What is the bet about?' : 'Vad handlar bettet om?'} *
        </label>
        <input type="text" id="anybet-title-input" class="form-input" placeholder="${t('arcade.anybetTitlePlaceholder')}" maxlength="120" style="padding: 10px 12px; font-size: 0.92rem; font-weight: 600;" />
        <textarea id="anybet-desc-input" class="form-input" placeholder="${t('arcade.anybetRulesPlaceholder')}" rows="2" style="font-size: 0.82rem; resize: none; margin-top: 6px; padding: 8px 12px;"></textarea>
      </div>

      <!-- 2. Typ av bet (Vinnarpott vs Ja/Nej) -->
      <div style="margin-bottom: 14px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: block;">
          ⚖️ ${t('arcade.anybetModelLabel')}
        </label>
        <div class="flex gap-xs">
          <button type="button" class="btn ${selectedModel === 'winner_takes_all' ? 'btn-primary' : 'btn-secondary'} btn-sm btn-block anybet-model-btn" data-model="winner_takes_all" style="font-size: 0.8rem; padding: 8px 6px;">
            ${t('arcade.anybetModelWinner')}
          </button>
          <button type="button" class="btn ${selectedModel === 'yes_no' ? 'btn-primary' : 'btn-secondary'} btn-sm btn-block anybet-model-btn" data-model="yes_no" style="font-size: 0.8rem; padding: 8px 6px;">
            ${t('arcade.anybetModelYesNo')}
          </button>
        </div>
      </div>

      <!-- 3. Insats per person -->
      <div style="margin-bottom: 14px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: block;">
          💰 ${isEn ? 'Stake per person' : 'Insats per person'}
        </label>
        <div class="flex gap-xs" style="flex-wrap: wrap;">
          <button type="button" class="btn ${selectedStake === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm anybet-stake-btn" data-stake="0">0 kr (Ära)</button>
          <button type="button" class="btn ${selectedStake === 10 ? 'btn-primary' : 'btn-secondary'} btn-sm anybet-stake-btn" data-stake="10">10 kr</button>
          <button type="button" class="btn ${selectedStake === 20 ? 'btn-primary' : 'btn-secondary'} btn-sm anybet-stake-btn" data-stake="20">20 kr</button>
          <button type="button" class="btn ${selectedStake === 50 ? 'btn-primary' : 'btn-secondary'} btn-sm anybet-stake-btn" data-stake="50">50 kr</button>
          <button type="button" class="btn ${selectedStake === 100 ? 'btn-primary' : 'btn-secondary'} btn-sm anybet-stake-btn" data-stake="100">100 kr</button>
          <button type="button" class="btn ${![0, 10, 20, 50, 100].includes(selectedStake) ? 'btn-primary' : 'btn-secondary'} btn-sm anybet-stake-btn" data-stake="custom">
            ${![0, 10, 20, 50, 100].includes(selectedStake) ? `${selectedStake} kr` : (isEn ? 'Custom' : 'Valfritt')}
          </button>
        </div>
        <div id="anybet-custom-stake-wrap" style="display: ${![0, 10, 20, 50, 100].includes(selectedStake) ? 'block' : 'none'}; margin-top: 8px;">
          <input type="number" inputmode="numeric" step="1" id="anybet-custom-stake-input" class="form-input" placeholder="Ange belopp i kr" value="${selectedStake || 30}" min="1" max="10000" style="padding: 8px 12px; font-size: 0.88rem;" />
        </div>
      </div>

      <!-- 4. Slutdatum / Kalender (Valfritt) -->
      <div style="margin-bottom: 14px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: block;">
          📅 ${t('arcade.anybetDeadlineLabel')}
        </label>
        <input type="date" lang="sv-SE" id="anybet-deadline-input" class="form-input" min="${todayStr}" style="padding: 8px 12px; font-size: 0.88rem;" />
      </div>

      <!-- 5. Bjud in deltagare -->
      <div style="margin-bottom: 14px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>👥 ${isEn ? 'Invite participants' : 'Bjud in deltagare'}:</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${friendsList.length} ${isEn ? 'friends available' : 'vänner'}</span>
        </label>
        ${friendsList.length > 0 ? `
          <div style="max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
            ${friendsList.map(f => `
              <label style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); cursor: pointer;">
                <span style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
                  <span>${escapeHtml(f.avatar_emoji) || '👤'}</span>
                  <strong>${escapeHtml(f.nickname)}</strong>
                </span>
                <input type="checkbox" class="anybet-friend-cb" value="${f.id}" ${invitedFriendIds.has(f.id) ? 'checked' : ''} style="width: 17px; height: 17px; accent-color: var(--gold);" />
              </label>
            `).join('')}
          </div>
        ` : `
          <div class="text-muted" style="font-size: 0.8rem; padding: 8px 0;">
            ${isEn ? 'No friends added yet. Add friends via Profile to challenge them!' : 'Du har inga vänner tillagda än. Lägg till vänner under Profil för att utmana dem!'}
          </div>
        `}
      </div>

      <label class="anybet-event-link" style="margin-bottom: 14px;">
        <input type="checkbox" id="anybet-creator-plays" checked />
        <span>🙋 ${isEn ? 'I play myself' : 'Jag spelar själv'}
          <small>${isEn ? 'Untick to only organise or judge.' : 'Bocka ur om du bara ordnar bettet eller är domare.'}</small></span>
      </label>

      <!-- 6. Vem är domare? -->
      <div style="margin-bottom: 18px;">
        <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: block;">
          ⚖️ ${t('arcade.anybetJudgeLabel')}
        </label>
        <select id="anybet-judge-select" class="form-input" style="padding: 8px 12px; font-size: 0.88rem;">
          <option value="${user.id}">👑 ${isEn ? 'Me (Creator)' : 'Jag själv (Skaparen)'} – ${escapeHtml(user.nickname)}</option>
          ${friendsList.map(f => `
            <option value="${f.id}">⚖️ ${escapeHtml(f.nickname)}</option>
          `).join('')}
        </select>
        <div id="anybet-judge-note" class="anybet-judge-note" style="display: none;"></div>
      </div>

      <div id="anybet-event-link-slot"></div>

      <button type="button" class="btn btn-primary btn-block" id="btn-create-anybet-submit" style="padding: 14px; font-weight: 800; font-size: 1rem; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);">
        ${t('arcade.anybetCreateBtn')}
      </button>
    `;

    // Which event the bet belongs to is a choice you see, not something decided behind your back
    let linkEvent = null;
    getOrFetchActiveEvent().then(evt => {
      const slot = document.getElementById('anybet-event-link-slot');
      if (!evt || !slot) return;
      linkEvent = evt;
      slot.innerHTML = `
        <label class="anybet-event-link">
          <input type="checkbox" id="anybet-link-event" checked />
          <span>🏆 ${isEn ? 'Count it in' : 'Räkna in i'} <b>${escapeHtml(evt.name)}</b>
            <small>${isEn ? 'The result ends up in the event’s settlement on The Tab.' : 'Resultatet hamnar i eventets avräkning på THE TAB.'}</small></span>
        </label>`;
    }).catch(() => {});

    // Tell the creator up front how the judge rule plays out for their choices
    const updateJudgeNote = () => {
      const note = document.getElementById('anybet-judge-note');
      if (!note) return;
      const judgeId = document.getElementById('anybet-judge-select')?.value || user.id;
      const creatorPlays = document.getElementById('anybet-creator-plays')?.checked !== false;
      const judgePlays = judgeId === user.id ? creatorPlays : invitedFriendIds.has(judgeId);
      let text = '';
      if (selectedModel === 'yes_no' && judgePlays) {
        text = isEn ? 'ℹ️ The judge decides the answer and does not pick a side.' : 'ℹ️ Domaren avgör svaret och väljer ingen sida.';
      } else if (selectedModel === 'winner_takes_all' && judgePlays) {
        text = isEn ? '⚠️ The judge also plays – everyone will see that on the bet.' : '⚠️ Domaren spelar själv – det syns för alla på bettet.';
      }
      note.textContent = text;
      note.style.display = text ? 'block' : 'none';
    };
    document.getElementById('anybet-judge-select')?.addEventListener('change', updateJudgeNote);
    document.getElementById('anybet-creator-plays')?.addEventListener('change', updateJudgeNote);
    updateJudgeNote();

    // Listeners for Model buttons
    tabContent.querySelectorAll('.anybet-model-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedModel = btn.dataset.model;
        tabContent.querySelectorAll('.anybet-model-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
        updateJudgeNote();
      });
    });

    // Listeners for Stake buttons
    tabContent.querySelectorAll('.anybet-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.stake;
        if (val === 'custom') {
          selectedStake = parseInt(document.getElementById('anybet-custom-stake-input')?.value, 10) || 30;
          document.getElementById('anybet-custom-stake-wrap').style.display = 'block';
        } else {
          selectedStake = parseInt(val, 10);
          document.getElementById('anybet-custom-stake-wrap').style.display = 'none';
        }
        tabContent.querySelectorAll('.anybet-stake-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      });
    });

    document.getElementById('anybet-custom-stake-input')?.addEventListener('input', (e) => {
      selectedStake = Math.min(10000, Math.max(1, parseInt(e.target.value, 10) || 1));
    });

    // Friend checkboxes
    tabContent.querySelectorAll('.anybet-friend-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          invitedFriendIds.add(cb.value);
        } else {
          invitedFriendIds.delete(cb.value);
        }
        updateJudgeNote();
      });
    });

    // Submit AnyBet
    document.getElementById('btn-create-anybet-submit')?.addEventListener('click', async () => {
      const title = (document.getElementById('anybet-title-input')?.value || '').trim();
      const description = (document.getElementById('anybet-desc-input')?.value || '').trim();
      const deadline = document.getElementById('anybet-deadline-input')?.value || null;
      const judgeId = document.getElementById('anybet-judge-select')?.value || user.id;

      if (!title) {
        showToast(isEn ? 'Please describe what the bet is about' : 'Ange vad bettet handlar om', 'warning');
        return;
      }
      const creatorPlays = document.getElementById('anybet-creator-plays')?.checked !== false;
      if (invitedFriendIds.size + (creatorPlays ? 1 : 0) < 2) {
        showToast(creatorPlays
          ? (isEn ? 'Invite at least one friend' : 'Bjud in minst en kompis')
          : (isEn ? 'Invite at least two friends when you do not play' : 'Bjud in minst två kompisar när du inte spelar själv'), 'warning');
        return;
      }

      const submitBtn = document.getElementById('btn-create-anybet-submit');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const linkChecked = document.getElementById('anybet-link-event')?.checked;
        const activeEvt = linkEvent && linkChecked ? linkEvent : null;
        const res = await createAnyBet({
          title,
          description,
          judgeId,
          stakeAmount: selectedStake,
          betType: selectedModel,
          deadline,
          participantIds: Array.from(invitedFriendIds),
          creatorPlays,
          tournamentId: activeEvt?.id || null
        });

        if (res && res.ok) {
          showToast(isEn ? 'AnyBet created successfully!' : 'AnyBet skapat! Handslaget är slutet 🤝', 'success');
          playTone(587.33, 'sine', 0.2, 0.2);
          setTimeout(() => playTone(880, 'sine', 0.25, 0.2), 100);
          activeTab = 'active';
          renderMainView();
        }
      } catch (err) {
        showToast(err.message || (isEn ? 'Failed to create bet' : 'Kunde inte skapa bettet'), 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // ── FLIK 2: AKTIVA BET ────────────────────────────────
  async function renderActiveTab(tabContent) {
    if (!user) {
      tabContent.innerHTML = `<div class="text-center text-muted" style="padding: 30px;">Logga in för att se dina aktiva AnyBets.</div>`;
      return;
    }

    tabContent.innerHTML = `
      <div class="text-center text-muted" style="padding: 30px 0;">
        <span class="spinner">⏳</span>
      </div>
    `;

    try {
      const res = await getAnyBets();
      const allBets = res.bets || [];
      const activeBets = allBets.filter(b => b.status === 'open');

      if (activeBets.length === 0) {
        tabContent.innerHTML = `
          <div class="text-center" style="padding: 30px 10px;">
            <img src="/handshake-gold.png" alt="Handshake" style="width: 60px; height: 60px; margin: 0 auto 10px auto; display: block; opacity: 0.5;" />
            <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 14px;">${t('arcade.anybetNoActive')}</p>
            <button type="button" class="btn btn-primary btn-sm" id="btn-goto-create-anybet" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none;">
              ➕ ${isEn ? 'Create First Bet' : 'Skapa första kompisbettet'}
            </button>
          </div>
        `;
        document.getElementById('btn-goto-create-anybet')?.addEventListener('click', () => {
          activeTab = 'create';
          renderMainView();
        });
        return;
      }

      tabContent.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${activeBets.map(bet => {
            const isJudge = user.id === bet.judge_id;
            const isCreator = user.id === bet.creator_id;
            const myPart = (bet.participants || []).find(p => p.user_id === user.id);
            const isYesNo = bet.bet_type === 'yes_no';
            const acceptedParticipants = (bet.participants || []).filter(p => p.status === 'accepted');
            const invitedParticipants = (bet.participants || []).filter(p => p.status === 'invited');
            // Yes/no: only people who picked a side put money in
            const inPot = isYesNo ? acceptedParticipants.filter(p => p.choice === 'yes' || p.choice === 'no') : acceptedParticipants;
            const totalPot = bet.stake_amount * inPot.length;
            const mySide = myPart && (myPart.choice === 'yes' || myPart.choice === 'no') ? myPart.choice : null;
            const judgePlays = acceptedParticipants.some(p => String(p.user_id) === String(bet.judge_id));
            const deadlineText = bet.deadline ? formatAnyBetDate(bet.deadline) : '';

            return `
              <div class="anybet-card" data-bet-id="${escapeHtml(bet.id)}">
                <div class="flex justify-between align-center" style="margin-bottom: 6px;">
                  <span class="badge ${isYesNo ? 'badge-accent' : 'badge-gold'}" style="font-size: 0.72rem; padding: 2px 8px;">
                    ${isYesNo ? (isEn ? '⚖️ Yes or no' : '⚖️ Ja eller nej') : (isEn ? '🏆 Winner takes all' : '🏆 Vinnaren tar allt')}
                  </span>
                  ${deadlineText ? `
                    <span style="font-size: 0.75rem; color: var(--text-muted);">
                      📅 ${isEn ? 'Join by' : 'Gå med senast'} ${deadlineText}
                    </span>
                  ` : ''}
                </div>

                <h4 style="color: #fff; font-size: 1.05rem; font-weight: 700; margin-bottom: 4px;">
                  ${escapeHtml(bet.title)}
                </h4>

                ${bet.description ? `
                  <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.3;">
                    ${escapeHtml(bet.description)}
                  </p>
                ` : ''}

                <div class="anybet-meta">
                  <span>⚖️ ${isEn ? 'Judge' : 'Domare'}: <strong>${escapeHtml(bet.judge_nickname || bet.creator_nickname)}</strong></span>
                  <span class="anybet-pot">${bet.stake_amount > 0
                    ? `${bet.stake_amount} kr/${isEn ? 'person' : 'person'} · ${isEn ? 'pot' : 'pott'} ${totalPot} kr`
                    : (isEn ? '✨ For glory' : '✨ För äran')}</span>
                </div>

                ${!isYesNo && judgePlays ? `<div class="anybet-judge-note">⚠️ ${isEn ? 'The judge also plays' : 'Domaren spelar själv'}</div>` : ''}

                <!-- Participants list -->
                <div style="margin-bottom: 10px;">
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">
                    👥 ${isYesNo
                      ? (isEn ? `${inPot.length} picked a side` : `${inPot.length} har valt sida`)
                      : (isEn ? `${acceptedParticipants.length} in` : `${acceptedParticipants.length} med`)}${invitedParticipants.length > 0 ? ` · ${invitedParticipants.length} ${isEn ? 'invited' : 'inbjudna'}` : ''}:
                  </div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${(bet.participants || []).filter(p => p.status !== 'declined').map(p => `
                      <span class="party-player-chip" style="font-size: 0.75rem; padding: 3px 8px; ${p.status === 'invited' ? 'opacity: 0.65; border-style: dashed;' : ''}">
                        <span>${escapeHtml(p.avatar_emoji) || '👤'}</span>
                        <span>${escapeHtml(p.nickname)}</span>
                        ${p.status === 'invited' ? `<span style="font-size: 0.7rem; color: var(--text-muted);">(${isEn ? 'invited' : 'inbjuden'})</span>` : ''}
                        ${isYesNo && (p.choice === 'yes' || p.choice === 'no') ? `
                          <strong style="color: ${p.choice === 'yes' ? '#34d399' : '#f87171'}; margin-left: 2px;">
                            ${p.choice === 'yes' ? (isEn ? 'YES' : 'JA') : (isEn ? 'NO' : 'NEJ')}
                          </strong>
                        ` : ''}
                        ${String(p.user_id) === String(bet.judge_id) ? '<span title="Domare">⚖️</span>' : ''}
                      </span>
                    `).join('')}
                  </div>
                </div>

                <!-- Yes / No: pick a side once; it cannot be changed afterwards -->
                ${isYesNo && isJudge && !mySide ? `
                  <div class="anybet-judge-note">⚖️ ${isEn ? 'You are the judge – you decide the answer and pick no side.' : 'Du är domare – du avgör svaret och väljer ingen sida.'}</div>
                ` : isYesNo && myPart ? (mySide ? `
                  <div class="anybet-my-side ${mySide}">
                    🔒 ${isEn ? 'You picked' : 'Du har valt'} <strong>${mySide === 'yes' ? (isEn ? 'YES' : 'JA') : (isEn ? 'NO' : 'NEJ')}</strong>${bet.stake_amount > 0 ? ` · ${bet.stake_amount} kr` : ''}
                  </div>
                ` : `
                  <div style="background: rgba(255,255,255,0.02); border: 1px dashed var(--border-glass); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 10px;">
                    <div style="font-size: 0.78rem; font-weight: 700; margin-bottom: 6px; color: var(--text-secondary);">
                      ${t('arcade.anybetPickSidePrompt')} <span class="text-muted" style="font-weight: 500;">(${isEn ? 'final' : 'går inte att ändra'})</span>
                    </div>
                    <div class="flex gap-xs">
                      <button type="button" class="btn btn-secondary btn-sm btn-block btn-pick-side" data-bet-id="${escapeHtml(bet.id)}" data-side="yes">✅ ${isEn ? 'YES' : 'JA'}</button>
                      <button type="button" class="btn btn-secondary btn-sm btn-block btn-pick-side" data-bet-id="${escapeHtml(bet.id)}" data-side="no">❌ ${isEn ? 'NO' : 'NEJ'}</button>
                    </div>
                  </div>
                `) : isYesNo ? '' : `
                  ${(myPart && myPart.status === 'invited') ? `
                    <div style="background: rgba(255,255,255,0.02); border: 1px dashed var(--border-glass); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 10px;">
                      <div style="font-size: 0.78rem; font-weight: 700; margin-bottom: 6px; color: var(--text-secondary);">
                        ${isEn ? 'You are invited! Accept the challenge to join the pot:' : 'Du är inbjuden! Acceptera utmaningen för att delta:'}
                      </div>
                      <div class="flex gap-xs">
                        <button type="button" class="btn btn-secondary btn-sm btn-block btn-decline-part" data-bet-id="${bet.id}">
                          ❌ ${isEn ? 'Decline' : 'Avböj'}
                        </button>
                        <button type="button" class="btn btn-primary btn-sm btn-block btn-accept-wta" data-bet-id="${bet.id}" style="background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 700; padding: 9px;">
                          🤝 ${isEn ? `Accept (${bet.stake_amount > 0 ? bet.stake_amount + ' kr' : '0 kr'})` : `Acceptera (${bet.stake_amount > 0 ? bet.stake_amount + ' kr' : '0 kr'})`}
                        </button>
                      </div>
                    </div>
                  ` : ''}
                  ${(myPart && myPart.status === 'accepted' && !isJudge) ? `
                    <div style="padding: 6px 10px; margin-bottom: 10px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); font-size: 0.78rem; color: #34d399; font-weight: 700; text-align: center;">
                      ✅ ${isEn ? 'You are participating in this bet!' : 'Du deltar i detta vad!'}
                    </div>
                  ` : ''}
                `}

                <!-- Judge Settle Button -->
                ${isJudge ? `
                  <button type="button" class="btn btn-primary btn-block btn-sm btn-open-settle" data-bet-id="${bet.id}" style="padding: 10px; font-weight: 700; background: linear-gradient(135deg, #f59e0b, #d97706); border: none;">
                    ${t('arcade.anybetSettleBtn')}
                  </button>
                ` : ''}

                <!-- Creator cancel button -->
                ${isCreator ? `
                  <div style="margin-top: 8px; text-align: right;">
                    <button type="button" class="btn-cancel-bet" data-bet-id="${bet.id}" style="font-size: 0.72rem; text-decoration: underline; background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px;">
                      🗑️ ${isEn ? 'Cancel bet' : 'Avbryt vad'}
                    </button>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Pick side listeners
      tabContent.querySelectorAll('.btn-pick-side').forEach(btn => {
        btn.addEventListener('click', async () => {
          const betId = btn.dataset.betId;
          const side = btn.dataset.side;
          const label = side === 'yes' ? (isEn ? 'YES' : 'JA') : (isEn ? 'NO' : 'NEJ');
          if (!confirm(isEn ? `Pick ${label}? You cannot change it later.` : `Välja ${label}? Du kan inte ändra dig sen.`)) return;
          try {
            await joinAnyBet(betId, side);
            showToast(isEn ? `You picked ${label}!` : `Du valde ${label}!`, 'success');
            renderActiveTab(tabContent);
          } catch (e) {
            showToast(e.message || 'Kunde inte välja sida', 'error');
          }
        });
      });

      // Accept WTA listeners
      tabContent.querySelectorAll('.btn-accept-wta').forEach(btn => {
        btn.addEventListener('click', async () => {
          const betId = btn.dataset.betId;
          btn.disabled = true;
          try {
            await joinAnyBet(betId, 'participant');
            showToast(isEn ? 'Bet accepted! Good luck!' : 'Vadet accepterat! Lycka till 🤝', 'success');
            renderActiveTab(tabContent);
          } catch (e) {
            showToast(e.message || 'Kunde inte acceptera vadet', 'error');
            btn.disabled = false;
          }
        });
      });

      // Decline listeners
      tabContent.querySelectorAll('.btn-decline-part').forEach(btn => {
        btn.addEventListener('click', async () => {
          const betId = btn.dataset.betId;
          try {
            await declineAnyBet(betId);
            showToast(isEn ? 'Bet declined.' : 'Vadet avböjdes.', 'info');
            renderActiveTab(tabContent);
          } catch (e) {
            showToast(e.message || 'Kunde inte avböja vadet', 'error');
          }
        });
      });

      // Cancel bet listeners
      tabContent.querySelectorAll('.btn-cancel-bet').forEach(btn => {
        btn.addEventListener('click', async () => {
          const betId = btn.dataset.betId;
          if (!confirm(isEn ? 'Are you sure you want to cancel this bet?' : 'Är du säker på att du vill avbryta vadet?')) return;
          try {
            await cancelAnyBet(betId);
            showToast(isEn ? 'Bet cancelled.' : 'Vadet avbröts.', 'info');
            renderActiveTab(tabContent);
          } catch (e) {
            showToast(e.message || 'Kunde inte avbryta vadet', 'error');
          }
        });
      });

      // Settle button listeners
      tabContent.querySelectorAll('.btn-open-settle').forEach(btn => {
        btn.addEventListener('click', () => {
          const betId = btn.dataset.betId;
          const targetBet = activeBets.find(b => b.id === betId);
          if (targetBet) openSettleModal(targetBet);
        });
      });

    } catch (err) {
      tabContent.innerHTML = `<div class="text-danger text-center" style="padding: 20px;">${escapeHtml(err.message) || 'Kunde inte ladda bet'}</div>`;
    }
  }

  // ── FLIK 3: AVSLUTADE BET ────────────────────────────
  async function renderFinishedTab(tabContent) {
    tabContent.innerHTML = `
      <div class="text-center text-muted" style="padding: 30px 0;">
        <span class="spinner">⏳</span>
      </div>
    `;

    try {
      const res = await getAnyBets();
      const allBets = res.bets || [];
      const finishedBets = allBets.filter(b => b.status === 'completed');

      if (finishedBets.length === 0) {
        tabContent.innerHTML = `
          <div class="text-center" style="padding: 30px 10px;">
            <div style="font-size: 2.8rem; margin-bottom: 8px;">🏁</div>
            <p class="text-muted" style="font-size: 0.9rem;">${t('arcade.anybetNoFinished')}</p>
          </div>
        `;
        return;
      }

      tabContent.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${finishedBets.map(bet => {
            const isYesNo = bet.bet_type === 'yes_no';
            const winnerText = isYesNo 
              ? (bet.winning_side === 'yes' ? (isEn ? '✅ YES won!' : '✅ JA vann!') : (isEn ? '❌ NO won!' : '❌ NEJ vann!'))
              : `👑 ${escapeHtml(bet.winner_nickname || 'Vinnare')} vann!`;

            const acceptedParticipants = (bet.participants || []).filter(p => p.status === 'accepted');
            const inPot = isYesNo ? acceptedParticipants.filter(p => p.choice === 'yes' || p.choice === 'no') : acceptedParticipants;
            const totalPot = bet.stake_amount * inPot.length;
            const settlement = bet.settlement || {};
            const outcome = settlement.outcome;
            const amountWon = settlement.amountWon || 0;
            const amountOwed = settlement.amountOwed || 0;
            const creditors = settlement.creditors || [];

            return `
              <div class="anybet-card completed">
                <div class="flex justify-between align-center" style="margin-bottom: 6px;">
                  <span class="badge badge-success" style="font-size: 0.72rem;">✅ Avslutat</span>
                  <span style="font-size: 0.82rem; font-weight: 700; color: #10b981;">
                    ${bet.stake_amount > 0 ? `💰 ${isEn ? 'Pot' : 'Pott'} ${totalPot} kr` : (isEn ? '✨ For glory' : '✨ För äran')}
                  </span>
                </div>

                <h4 style="color: #fff; font-size: 1.05rem; font-weight: 700; margin-bottom: 4px;">
                  ${escapeHtml(bet.title)}
                </h4>

                <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid #10b981; border-radius: var(--radius-sm); padding: 8px 12px; margin: 8px 0;">
                  <div style="font-size: 0.95rem; font-weight: 800; color: #34d399;">
                    ${winnerText}
                  </div>
                </div>

                ${safeImageSrc(bet.proof_image_url) ? `
                  <div style="margin: 8px 0;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">📸 ${isEn ? 'Proof from the judge' : 'Bildbevis från domaren'}:</div>
                    <img src="${escapeHtml(safeImageSrc(bet.proof_image_url))}" class="anybet-proof-img" alt="" />
                  </div>
                ` : ''}

                <!-- Settlement display -->
                ${outcome === 'winner' ? `
                  <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 10px; margin-top: 8px;">
                    <div style="font-size: 0.85rem; font-weight: 700; color: #34d399; margin-bottom: 2px;">
                      🎉 Grattis! Du vann!
                    </div>
                    ${amountWon > 0 ? `
                      <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        ${isEn ? 'You get' : 'Du får'} <strong>${Math.round(amountWon)} kr</strong> – ${isEn ? 'see The Tab.' : 'syns på THE TAB.'}
                      </div>
                    ` : ''}
                  </div>
                ` : ''}

                ${outcome === 'loser' && amountOwed > 0 ? `
                  <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-sm); padding: 10px; margin-top: 8px;">
                    <div style="font-size: 0.82rem; color: var(--text-secondary);">
                      ${isEn ? 'You lost' : 'Du förlorade'} <strong>${Math.round(amountOwed)} kr</strong>${creditors.length > 0 ? ` ${isEn ? 'to' : 'till'} ${creditors.map(c => escapeHtml(c.nickname || c.realName || '')).join(', ')}` : ''}.
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm btn-block mt-sm btn-anybet-goto-tab">
                      ${isEn ? 'Pay under The Tab →' : 'Betala under THE TAB →'}
                    </button>
                  </div>
                ` : ''}

                ${outcome === 'not_accepted' ? `
                  <div style="background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); padding: 8px 10px; margin-top: 8px; font-size: 0.78rem; color: var(--text-muted); text-align: center;">
                    Du accepterade inte detta vad.
                  </div>
                ` : ''}

                ${outcome === 'neutral' ? `
                  <div style="background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); padding: 8px 10px; margin-top: 8px; font-size: 0.78rem; color: var(--text-muted); text-align: center;">
                    ${isYesNo ? 'Du valde ingen sida och påverkades inte ekonomiskt.' : 'Du påverkades inte ekonomiskt av detta vad.'}
                  </div>
                ` : ''}

                ${outcome === 'observer' ? `
                  <div style="background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); padding: 8px 10px; margin-top: 8px; font-size: 0.78rem; color: var(--text-muted); text-align: center;">
                    ${isEn ? 'You organised or judged this bet and did not play.' : 'Du ordnade eller dömde bettet och spelade inte själv.'}
                  </div>
                ` : ''}

                ${outcome === 'declined' ? `
                  <div style="background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); padding: 8px 10px; margin-top: 8px; font-size: 0.78rem; color: var(--text-muted); text-align: center;">
                    Du avböjde detta vad.
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
      // Paying happens in one place, netted with everything else, so nobody pays twice
      tabContent.querySelectorAll('.btn-anybet-goto-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          closeModal();
          window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'leaderboard', tab: 'overview' } }));
        });
      });
    } catch (err) {
      tabContent.innerHTML = `<div class="text-danger text-center" style="padding: 20px;">${escapeHtml(err.message) || 'Kunde inte ladda avslutade bet'}</div>`;
    }
  }

  // ── MODAL: DOMARENS AVGÖRANDE ─────────────────────────
  function openSettleModal(bet) {
    const isYesNo = bet.bet_type === 'yes_no';
    const acceptedParticipants = (bet.participants || []).filter(p => p.status === 'accepted');
    // Nothing is preselected: the judge must actively pick, so one tap never settles the wrong way
    let chosenWinnerId = null;
    let chosenSide = null;
    proofImageData = null;

    showModal(`⚖️ ${isEn ? 'Settle AnyBet' : 'Avgör AnyBet'}`, `
      <div style="padding: 6px 0;">
        <h4 style="color: var(--gold); font-size: 1.1rem; margin-bottom: 8px;">
          ${escapeHtml(bet.title)}
        </h4>
        <p class="text-muted" style="font-size: 0.82rem; margin-bottom: 14px;">
          ${isEn ? 'As judge, select the winner to distribute the pot and log settlements.' : 'Som domare utser du vinnaren för att fördela potten och bokföra uppgörelser.'}
        </p>

        ${isYesNo ? `
          <div style="margin-bottom: 16px;">
            <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
              Vilken sida vann?
            </label>
            <div class="flex gap-xs">
              <button type="button" class="btn btn-secondary btn-block btn-settle-side-btn" data-side="yes" style="padding: 12px; font-weight: 700;">
                ✅ JA vann!
              </button>
              <button type="button" class="btn btn-secondary btn-block btn-settle-side-btn" data-side="no" style="padding: 12px; font-weight: 700;">
                ❌ NEJ vann!
              </button>
            </div>
          </div>
        ` : `
          <div style="margin-bottom: 16px;">
            <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: block;">
              🏆 Välj vem som vann bland deltagarna:
            </label>
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto;">
              ${acceptedParticipants.length > 0 ? acceptedParticipants.map(p => `
                <label style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); cursor: pointer;">
                  <span style="display: flex; align-items: center; gap: 8px; font-size: 0.9rem;">
                    <span>${escapeHtml(p.avatar_emoji) || '👤'}</span>
                    <strong>${escapeHtml(p.nickname)}</strong>
                  </span>
                  <input type="radio" name="settle-winner" value="${escapeHtml(p.user_id)}" style="width: 18px; height: 18px; accent-color: var(--gold);" />
                </label>
              `).join('') : `
                <div class="text-muted text-center" style="padding: 12px;">Inga deltagare har accepterat vadet än.</div>
              `}
            </div>
          </div>
        `}

        <!-- Bildbevis (Valfritt) -->
        <div style="margin-bottom: 18px;">
          <label class="form-label" style="font-size: 0.85rem; margin-bottom: 6px; display: block;">
            ${t('arcade.anybetUploadProof')}
          </label>
          <input type="file" id="settle-proof-file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" class="form-input" style="padding: 6px 10px; font-size: 0.82rem;" />
          <div id="settle-proof-preview-wrap" style="display: none; margin-top: 8px;">
            <img id="settle-proof-preview" style="max-height: 140px; border-radius: var(--radius-sm); border: 1px solid var(--border-glass); display: block;" />
          </div>
        </div>

        <div id="settle-summary" class="anybet-settle-summary" style="display: none;"></div>

        <div class="flex gap-sm">
          <button type="button" class="btn btn-secondary btn-block" id="btn-cancel-settle">
            ❌ Avbryt
          </button>
          <button type="button" class="btn btn-primary btn-block" id="btn-confirm-settle" disabled style="background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 800;">
            ${t('arcade.anybetConfirmWinner')}
          </button>
        </div>
      </div>
    `);

    // Plain-language preview of who pays whom, shown before the judge confirms
    const nameOf = (p) => escapeHtml(p.nickname || p.realName || '');
    const updateSummary = () => {
      const box = document.getElementById('settle-summary');
      const btn = document.getElementById('btn-confirm-settle');
      const ready = isYesNo ? Boolean(chosenSide) : Boolean(chosenWinnerId);
      if (btn) btn.disabled = !ready;
      if (!box) return;
      if (!ready) { box.style.display = 'none'; return; }
      const stake = bet.stake_amount || 0;
      let lines = [];
      if (isYesNo) {
        const winners = acceptedParticipants.filter(p => p.choice === chosenSide);
        const losers = acceptedParticipants.filter(p => (p.choice === 'yes' || p.choice === 'no') && p.choice !== chosenSide);
        if (stake <= 0) lines.push(isEn ? 'No money involved – just glory.' : 'Inga pengar – bara äran.');
        else if (winners.length === 0 || losers.length === 0) lines.push(isEn ? 'Nobody on the other side – no money changes hands.' : 'Ingen på andra sidan – inga pengar byter ägare.');
        else {
          const each = Math.round(stake / winners.length);
          losers.forEach(l => lines.push(`${nameOf(l)} → ${winners.map(nameOf).join(', ')}: ${winners.length > 1 ? `${each} kr ${isEn ? 'each' : 'var'}` : `${stake} kr`}`));
        }
      } else {
        const winner = acceptedParticipants.find(p => String(p.user_id) === String(chosenWinnerId));
        const losers = acceptedParticipants.filter(p => String(p.user_id) !== String(chosenWinnerId));
        if (stake <= 0 || losers.length === 0) lines.push(isEn ? 'No money changes hands.' : 'Inga pengar byter ägare.');
        else lines.push(`${losers.map(nameOf).join(', ')} → ${winner ? nameOf(winner) : ''}: ${stake} kr ${isEn ? 'each' : 'var'} (${stake * losers.length} kr)`);
      }
      box.innerHTML = `<b>${isEn ? 'This will happen' : 'Det här händer'}:</b>${lines.map(l => `<div>${l}</div>`).join('')}<small>${isEn ? 'Cannot be undone.' : 'Kan inte ångras.'}</small>`;
      box.style.display = 'block';
    };

    // Settle side listeners
    document.querySelectorAll('.btn-settle-side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chosenSide = btn.dataset.side;
        document.querySelectorAll('.btn-settle-side-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
          b.style.background = '';
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
        btn.style.background = chosenSide === 'yes' ? '#10b981' : '#ef4444';
        updateSummary();
      });
    });

    // Winner radio listener
    document.querySelectorAll('input[name="settle-winner"]').forEach(radio => {
      radio.addEventListener('change', () => {
        chosenWinnerId = radio.value;
        updateSummary();
      });
    });

    // Proof file handler
    document.getElementById('settle-proof-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // A full-size phone photo is several MB; shrink it before it is sent
      compressImage(file, 1000, 0.8).then(data => {
        proofImageData = data;
        const previewEl = document.getElementById('settle-proof-preview');
        const previewWrap = document.getElementById('settle-proof-preview-wrap');
        if (previewEl && previewWrap) {
          previewEl.src = proofImageData;
          previewWrap.style.display = 'block';
        }
      }).catch(() => showToast(isEn ? 'Could not read the picture' : 'Kunde inte läsa bilden', 'error'));
    });

    document.getElementById('btn-cancel-settle')?.addEventListener('click', () => {
      closeModal();
      openAnyBetModal();
    });

    document.getElementById('btn-confirm-settle')?.addEventListener('click', async () => {
      const confirmBtn = document.getElementById('btn-confirm-settle');
      if (isYesNo ? !chosenSide : !chosenWinnerId) return;
      if (confirmBtn) confirmBtn.disabled = true;

      try {
        await settleAnyBet(bet.id, {
          winnerId: isYesNo ? null : chosenWinnerId,
          winningSide: isYesNo ? chosenSide : null,
          proofImageUrl: proofImageData
        });

        launchConfetti();
        playCoinSound();
        showToast(isEn ? 'Bet settled! The pot has been distributed.' : 'Bettet är avgjort! Potten och Notan har uppdaterats 🏆', 'success');

        closeModal();
        openAnyBetModal();
      } catch (err) {
        showToast(err.message || 'Kunde inte avgöra bettet', 'error');
        if (confirmBtn) confirmBtn.disabled = false;
      }
    });
  }
}

// ────────────────────────────────────────────────────────
// 🔔 INCOMING ANYBET INVITATION MODAL
// ────────────────────────────────────────────────────────
export function showIncomingAnyBetModal(bet) {
  const isEn = getLang() === 'en';
  if (isGameInProgress()) {
    showToast(isEn ? `🤝 New AnyBet: "${bet.title}"` : `🤝 Nytt AnyBet: "${bet.title}"`, 'info');
    return;
  }
  playTone(587.33, 'sine', 0.25, 0.15);
  setTimeout(() => playTone(880, 'sine', 0.3, 0.15), 150);

  const titleHtml = `<img src="/handshake-gold.png" alt="Handshake" style="width: 24px; height: 24px; vertical-align: -3px; margin-right: 8px; filter: drop-shadow(0 2px 4px rgba(255,215,0,0.4));" />${t('arcade.anybetTitle')}`;

  showModal(titleHtml, `
    <div class="text-center" style="padding: 10px 0;">
      <img src="/handshake-gold.png" alt="Handshake" style="width: 72px; height: 72px; margin: 0 auto 12px auto; display: block; filter: drop-shadow(0 4px 16px rgba(255,215,0,0.5));" />
      <h3 style="color: var(--gold); margin-bottom: 6px; font-size: 1.2rem;">
        ${escapeHtml(bet.creatorNickname)} ${isEn ? 'invited you to an AnyBet!' : 'bjöd in dig till ett AnyBet!'}
      </h3>
      <div style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 8px 0 10px 0;">
        "${escapeHtml(bet.title)}"
      </div>
      <div class="badge badge-accent mb-md" style="font-size: 0.95rem; padding: 6px 16px;">
        ${bet.stakeAmount > 0 ? `💰 ${bet.stakeAmount} kr ${isEn ? 'stake' : 'i insats'}` : '✨ Bara ära (0 kr)'}
      </div>

      <div class="flex gap-sm" style="margin-top: 14px;">
        <button type="button" class="btn btn-secondary btn-block" id="btn-decline-anybet" style="padding: 12px;">
          ❌ ${isEn ? 'Decline' : 'Avböj'}
        </button>
        <button type="button" class="btn btn-primary btn-block" id="btn-open-anybet-invite" style="padding: 12px; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; font-weight: 700;">
          🤝 ${isEn ? 'View AnyBet' : 'Öppna AnyBet'}
        </button>
      </div>
    </div>
  `);

  document.getElementById('btn-decline-anybet')?.addEventListener('click', async () => {
    try {
      await declineAnyBet(bet.id);
      showToast(isEn ? 'You declined the bet invitation' : 'Du avböjde inbjudan till vadet', 'info');
    } catch (e) {}
    closeModal();
  });

  document.getElementById('btn-open-anybet-invite')?.addEventListener('click', () => {
    closeModal();
    openAnyBetModal(bet.id);
  });
}

// ────────────────────────────────────────────────────────
// 📱 SWISHLISTAN & UPPGÖRELSER MODAL
// ────────────────────────────────────────────────────────
export async function openSwishlistModal() {
  const isEn = getLang() === 'en';
  const user = getStoredUser();
  if (!user) {
    showToast(isEn ? 'Please log in to view settlements' : 'Logga in för att se uppgörelser', 'warning');
    return;
  }

  showModal(t('arcade.swishListTitle'), `
    <div id="swishlist-content" style="padding: 6px 0;">
      <div class="text-center text-muted" style="padding: 20px 0;">
        <span class="spinner" style="margin-bottom: 8px;">⏳</span>
        <div>${isEn ? 'Loading settlements...' : 'Hämtar uppgörelser...'}</div>
      </div>
    </div>
  `);

  try {
    const summary = await getDuelSettlements();
    const content = document.getElementById('swishlist-content');
    if (!content) return;

    if (!summary || !summary.friends || summary.friends.length === 0) {
      content.innerHTML = `
        <div class="text-center" style="padding: 25px 10px;">
          <div style="font-size: 2.5rem; margin-bottom: 8px;">🥂</div>
          <div style="font-weight: 700; font-size: 1rem; color: #4ade80; margin-bottom: 4px;">
            ${t('arcade.swishListEmpty')}
          </div>
          <p class="text-muted" style="font-size: 0.8rem; max-width: 280px; margin: 0 auto;">
            ${isEn ? 'Challenge a friend in Dice Duel to start a Swish duel!' : 'Utmana en vän i Tärningsduell för att spela om Swish!'}
          </p>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="mb-sm flex-between" style="align-items: center; padding: 0 4px;">
        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">
          ${isEn ? 'Net settlements per friend' : 'Nettoavstämning per vän'}
        </span>
        <span class="badge" style="background: ${summary.totalNet >= 0 ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${summary.totalNet >= 0 ? '#4ade80' : '#ef4444'}; font-weight: 700; font-size: 0.78rem;">
          ${summary.totalNet >= 0 ? `+${summary.totalNet} kr` : `${summary.totalNet} kr`}
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto;">
        ${summary.friends.map(f => {
          const owesYou = f.netAmount > 0;
          const absAmount = Math.abs(f.netAmount);
          const swishUrl = createSwishUrl({
            phone: f.friendSwish,
            amount: absAmount,
            message: 'Whooply Duell'
          });

          return `
            <div class="swish-settlement-item" style="border-left: 3px solid ${owesYou ? '#4ade80' : '#ef4444'};">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 140px;">
                <div style="width: 34px; height: 34px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0; border: 1px solid var(--border-glass);">
                  ${f.friendAvatarUrl ? `<img src="${f.friendAvatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />` : (f.friendAvatarEmoji || '👤')}
                </div>
                <div style="min-width: 0; flex: 1 1 auto;">
                  <div style="font-weight: 700; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(f.friendName || f.friendNickname)}
                  </div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${owesYou 
                      ? (isEn ? `Owes you ${absAmount} kr (${f.duelsCount} duels)` : `Ska swisha dig ${absAmount} kr (${f.duelsCount} dueller)`) 
                      : (isEn ? `You owe ${absAmount} kr (${f.duelsCount} duels)` : `Du ska swisha ${absAmount} kr (${f.duelsCount} dueller)`)}
                  </div>
                </div>
              </div>

              <div class="flex gap-xs" style="align-items: center; flex-shrink: 0;">
                ${!owesYou ? `
                  <a href="${swishUrl}" class="swish-pay-btn" style="padding: 5px 10px; font-size: 0.75rem; white-space: nowrap;" target="_blank" rel="noopener">
                    📱 ${isEn ? 'Swish' : 'Swisha'} ${absAmount} kr
                  </a>
                ` : `
                  <button type="button" class="btn btn-ghost btn-xs btn-remind-friend" data-phone="${f.friendSwish || ''}" data-name="${escapeHtml(f.friendName)}" data-amount="${absAmount}" style="color: var(--gold); font-size: 0.75rem; padding: 4px 8px; white-space: nowrap;">
                    💬 ${isEn ? 'Remind' : 'Påminn'}
                  </button>
                `}
                <button type="button" class="btn btn-secondary btn-xs btn-settle-friend" data-friend-id="${f.friendId}" data-name="${escapeHtml(f.friendName)}" title="${isEn ? 'Mark as settled' : 'Kvittera som betald'}" style="padding: 5px 8px; font-size: 0.75rem; flex-shrink: 0;">
                  ✅
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Attach settle listeners
    content.querySelectorAll('.btn-settle-friend').forEach(btn => {
      btn.addEventListener('click', async () => {
        const friendId = btn.getAttribute('data-friend-id');
        const name = btn.getAttribute('data-name');
        btn.disabled = true;
        try {
          await settleDuelsWithFriend(friendId);
          showToast(isEn ? `Settled with ${name}! ✅` : `Uppgörelse med ${name} kvitterad! ✅`, 'success');
          openSwishlistModal();
        } catch (e) {
          showToast(isEn ? 'Failed to settle' : 'Kunde inte kvittera', 'error');
          btn.disabled = false;
        }
      });
    });

    // Remind via share or clipboard
    content.querySelectorAll('.btn-remind-friend').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-name');
        const amount = btn.getAttribute('data-amount');
        const text = isEn
          ? `Hey ${name}! You owe me ${amount} kr from Whooply Dice Duel 🎲`
          : `Tjena ${name}! Du är skyldig mig ${amount} kr från Whooply Tärningsduell 🎲`;
        if (navigator.share) {
          navigator.share({ text }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text);
          showToast(isEn ? 'Reminder copied to clipboard! 📋' : 'Påminnelsetext kopierad till urklipp! 📋', 'info');
        }
      });
    });

  } catch (err) {
    const content = document.getElementById('swishlist-content');
    if (content) {
      content.innerHTML = `<div class="text-center text-muted" style="padding: 20px;">${isEn ? 'Error loading settlements' : 'Kunde inte hämta uppgörelser'}</div>`;
    }
  }
}

// ────────────────────────────────────────────────────────
// 🔔 GLOBAL DUEL INCOMING CHALLENGE LISTENER
// ────────────────────────────────────────────────────────
let globalDuelWs = null;
export function setupGlobalDuelListener() {
  const token = getToken();
  if (!token) return;
  if (globalDuelWs && (globalDuelWs.readyState === WebSocket.OPEN || globalDuelWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    globalDuelWs = new WebSocket(wsUrl);
    
    globalDuelWs.onopen = () => {
      if (token) {
        globalDuelWs.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    globalDuelWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'party_invitation' && data.room) {
          showIncomingPartyModal(data.room);
        } else if (data.type === 'anybet_invitation' && data.bet) {
          showIncomingAnyBetModal(data.bet);
        } else if (data.type === 'flashlive_started' && data.live) {
          const user = getStoredUser();
          if (user && data.live.hostId !== user.id) {
            playTone(880, 'sine', 0.2, 0.15); // High beep
            showToast(`🔴 ${data.live.hostName} sänder live! "${data.live.question}"`, 'info');
            window.dispatchEvent(new CustomEvent('flashlive-stream-updated', { detail: data }));
          }
        } else if (data.type === 'flashlive_stopped') {
          window.dispatchEvent(new CustomEvent('flashlive-stream-updated', { detail: data }));
        }
      } catch (e) {}
    };

    globalDuelWs.onclose = () => {
      globalDuelWs = null;
      setTimeout(setupGlobalDuelListener, 6000);
    };
  } catch (e) {}
}

// ── ⚡ BLIXTBET (FLASHBET) MODAL & LOGIC ──────────────────
let flashBetTimerInterval = null;

export async function openFlashBetModal(initialFlashBetId = null, defaultTournamentId = null) {
  const isEn = getLang() === 'en';
  const currentUser = getStoredUser();
  if (!defaultTournamentId) {
    const activeEvt = await getOrFetchActiveEvent();
    if (activeEvt?.id) defaultTournamentId = activeEvt.id;
  }
  let activeTab = initialFlashBetId ? 'active' : 'active';
  let countdowns = new Map(); // id -> secondsLeft

  function cleanupTimer() {
    if (flashBetTimerInterval) {
      clearInterval(flashBetTimerInterval);
      flashBetTimerInterval = null;
    }
  }

  const formatFlashBetTime = (s) => {
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const rem = s % 60;
      return `${h}h ${m < 10 ? '0' : ''}${m}m ${rem < 10 ? '0' : ''}${rem}s`;
    }
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  const modalTitle = `<span style="display: inline-flex; align-items: center; gap: 6px;"><span style="font-size: 1.15rem; line-height: 1;">⚡</span><span>${t('arcade.flashbet')}</span></span>`;
  showModal(modalTitle, `
    <div id="flashbet-container" style="padding: 2px 0; min-height: 380px;">
      <p class="game-modal-subheading">${t('arcade.flashbetDesc')}</p>

      <!-- Nav Tabs -->
      <div class="tab-nav mb-md" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" class="btn ${activeTab === 'active' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="tab-flashbet-active" style="font-weight: 700;">
          ${t('arcade.flashbetActiveTitle')}
        </button>
        <button type="button" class="btn ${activeTab === 'create' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="tab-flashbet-create" style="font-weight: 700;">
          ➕ ${t('arcade.flashbetCreateBtn')}
        </button>
      </div>

      <div id="flashbet-tab-content"></div>
    </div>
  `, () => {
    cleanupTimer();
  }, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => Boolean(document.getElementById('flashbet-question')?.value?.trim()),
    confirmTexts: {
      title: isEn ? 'Exit FlashBet?' : 'Lämna FlashBet?',
      message: isEn
        ? 'Are you sure you want to leave? Your entered FlashBet question will be lost.'
        : 'Är du säker på att du vill lämna? Ditt påbörjade FlashBet sparas inte.'
    }
  });

  const tabContent = document.getElementById('flashbet-tab-content');

  document.getElementById('tab-flashbet-active')?.addEventListener('click', () => {
    activeTab = 'active';
    updateTabs();
    renderActiveTab();
  });

  document.getElementById('tab-flashbet-create')?.addEventListener('click', () => {
    activeTab = 'create';
    updateTabs();
    renderCreateTab();
  });

  function updateTabs() {
    const btnActive = document.getElementById('tab-flashbet-active');
    const btnCreate = document.getElementById('tab-flashbet-create');
    if (activeTab === 'active') {
      btnActive.className = 'btn btn-primary btn-sm';
      btnCreate.className = 'btn btn-secondary btn-sm';
    } else {
      btnActive.className = 'btn btn-secondary btn-sm';
      btnCreate.className = 'btn btn-primary btn-sm';
    }
  }

  // ── Render Active Tab ──────────────────────────────
  async function renderActiveTab() {
    cleanupTimer();
    tabContent.innerHTML = `<div class="text-center text-muted" style="padding: 30px;">Laddar BlixtBets... ⚡</div>`;

    try {
      let flashBets = await getActiveFlashBets(defaultTournamentId);
      // Bets outside any event (e.g. from a live stream) must stay reachable to vote on and settle
      if (defaultTournamentId) {
        const allBets = await getActiveFlashBets().catch(() => []);
        flashBets = flashBets || [];
        for (const fb of allBets || []) {
          if (!(fb.tournamentId || fb.tournament_id) && !flashBets.some(x => x.id === fb.id)) flashBets.push(fb);
        }
      }
      if (initialFlashBetId && (!flashBets || !flashBets.some(fb => fb.id === initialFlashBetId))) {
        try {
          const specific = await getFlashBet(initialFlashBetId);
          if (specific && specific.status !== 'settled') {
            flashBets = [specific, ...(flashBets || [])];
          }
        } catch {}
      }
      countdowns.clear();

      if (!flashBets || flashBets.length === 0) {
        tabContent.innerHTML = `
          <div class="card text-center" style="padding: 30px 16px;">
            <div style="font-size: 2.8rem; margin-bottom: 8px;">⚡</div>
            <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 6px;">${t('arcade.flashbet')}</h3>
            <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 16px; max-width: 280px; margin-left: auto; margin-right: auto;">
              ${t('arcade.flashbetNoActive')}
            </p>
            <button type="button" class="btn btn-primary btn-block" id="btn-empty-start-flashbet">
              ⚡ ${t('arcade.flashbetCreateBtn')}
            </button>
          </div>
        `;
        document.getElementById('btn-empty-start-flashbet')?.addEventListener('click', () => {
          activeTab = 'create';
          updateTabs();
          renderCreateTab();
        });
        return;
      }

      // Running bets first, results last
      flashBets.sort((x, y) => (x.status === 'settled') - (y.status === 'settled'));
      flashBets.forEach(fb => {
        flashBetsById.set(fb.id, fb);
        if (fb.status !== 'settled') countdowns.set(fb.id, fb.secondsLeft);
      });

      tabContent.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px;">
          ${flashBets.map(fb => renderFlashBetCard(fb)).join('')}
        </div>
      `;

      attachActiveCardHandlers();
      startCountdownLoop();
    } catch (err) {
      tabContent.innerHTML = `<div class="text-red text-center" style="padding: 20px;">${escapeHtml(err.message)}</div>`;
    }
  }

  const flashBetsById = new Map();

  // What settling will do, in words, before the creator confirms
  function settlePreview(fb, winner) {
    const label = winner === 'yes' ? (isEn ? 'YES' : 'JA') : (isEn ? 'NO' : 'NEJ');
    if (!fb) return isEn ? `Did ${label} win?` : `Vann ${label}?`;
    const winners = winner === 'yes' ? fb.yesCount : fb.noCount;
    const losers = winner === 'yes' ? fb.noCount : fb.yesCount;
    const stake = fb.stakeAmount;
    let money;
    if (!winners || !losers) {
      money = isEn ? 'Nobody on the other side – no money changes hands.' : 'Ingen på andra sidan – inga pengar byter ägare.';
    } else {
      const each = Math.round((losers * stake) / winners);
      money = isEn
        ? `${losers} pay ${stake} kr each. ${winners} winner(s) get about ${each} kr each.`
        : `${losers} betalar ${stake} kr var. ${winners} vinnare får ca ${each} kr var.`;
    }
    return isEn
      ? `${label} won?\n\n${money}\n\nThis cannot be undone.`
      : `${label} vann?\n\n${money}\n\nDet går inte att ångra.`;
  }

  // A settled bet stays visible for a while with its result
  function renderSettledCard(fb) {
    const winLabel = fb.winningChoice === 'yes' ? (isEn ? '👍 YES won' : '👍 JA vann') : (isEn ? '👎 NO won' : '👎 NEJ vann');
    const mine = fb.myEntry;
    const won = mine && mine.choice === fb.winningChoice;
    const sum = fb.settlementSummary || {};
    const amount = Math.round(Math.abs(sum.netAmount ?? sum.amountWon ?? sum.amountOwed ?? 0));
    const myLine = !mine
      ? (isEn ? 'You hosted this bet.' : 'Du ledde bettet.')
      : won
        ? (isEn ? `You won${amount ? ` +${amount} kr` : ''}!` : `Du vann${amount ? ` +${amount} kr` : ''}!`)
        : (isEn ? `You lost${amount ? ` ${amount} kr` : ''}.` : `Du förlorade${amount ? ` ${amount} kr` : ''}.`);
    return `
      <div class="card flashbet-card" style="padding: 14px; border: 1px solid var(--border-glass);">
        <div class="flex-between" style="align-items: center; margin-bottom: 6px;">
          <span class="badge badge-success" style="font-size: 0.72rem;">🏁 ${isEn ? 'Settled' : 'Avgjort'}</span>
          <span class="text-muted" style="font-size: 0.75rem;">${isEn ? 'Pot' : 'Pott'} ${fb.totalPool} kr</span>
        </div>
        <div style="font-weight: 800; margin-bottom: 8px;">"${escapeHtml(fb.question)}"</div>
        <div class="fb-result ${fb.winningChoice === 'yes' ? 'yes' : 'no'}">${winLabel}</div>
        <div style="font-size: 0.85rem; margin-top: 8px;">${myLine}</div>
        ${mine ? `<button type="button" class="btn btn-secondary btn-sm btn-block mt-sm fb-goto-tab">${isEn ? 'See The Tab →' : 'Se THE TAB →'}</button>` : ''}
      </div>`;
  }

  function renderFlashBetCard(fb) {
    const isCreator = currentUser && fb.creatorId === currentUser.id;
    const hasVoted = !!fb.myEntry;
    const seconds = countdowns.get(fb.id) ?? fb.secondsLeft;
    const isExpired = seconds <= 0 || fb.status !== 'open';
    if (fb.status === 'settled') return renderSettledCard(fb);
    const entries = fb.entriesCount || fb.betCount || 0;

    return `
      <div class="card flashbet-card" data-fb-id="${fb.id}" style="border: 1.5px solid ${isExpired ? 'var(--border-light)' : 'var(--gold)'}; background: var(--bg-card); position: relative; overflow: hidden; padding: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0;">
            <span style="font-size: 1.3rem; flex-shrink: 0;">${escapeHtml(fb.creatorAvatar || '👤')}</span>
            <div style="flex: 1 1 auto; min-width: 0;">
              <div style="font-weight: 700; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(fb.creatorRealName || fb.creatorNickname)}</div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">Insats: <strong>${fb.stakeAmount} kr</strong></div>
            </div>
          </div>
          <div class="flashbet-timer-badge" id="timer-${fb.id}" style="padding: 4px 8px; border-radius: var(--radius-full); font-size: 0.8rem; font-weight: 800; font-family: monospace; letter-spacing: 0.05em; flex-shrink: 0; white-space: nowrap; text-align: center; background: ${seconds <= 15 ? 'rgba(231,76,60,0.2)' : 'rgba(245,166,35,0.15)'}; color: ${seconds <= 15 ? '#e74c3c' : 'var(--gold)'}; border: 1px solid ${seconds <= 15 ? '#e74c3c' : 'var(--gold)'};">
            ⏱️ ${formatFlashBetTime(seconds)}
          </div>
        </div>

        <div style="font-size: 1.1rem; font-weight: 800; line-height: 1.3; margin-bottom: 12px; color: var(--text-primary);">
          "${escapeHtml(fb.question)}"
        </div>

        <!-- Votes & Pool Bar -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; margin-bottom: 4px;">
            <span style="color: #2ecc71;">👍 JA: ${fb.yesCount}</span>
            <span style="color: var(--text-muted);">${isEn ? 'Pot' : 'Pott'}: ${fb.totalPool} kr</span>
            <span style="color: #e74c3c;">👎 NEJ: ${fb.noCount}</span>
          </div>
          <div style="height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); overflow: hidden; display: flex;">
            <div style="height: 100%; width: ${fb.entriesCount > 0 ? (fb.yesCount / fb.entriesCount * 100) : 50}%; background: #2ecc71; transition: width 0.3s;"></div>
            <div style="height: 100%; width: ${fb.entriesCount > 0 ? (fb.noCount / fb.entriesCount * 100) : 50}%; background: #e74c3c; transition: width 0.3s;"></div>
          </div>
        </div>

        <div class="fb-money-note">${isEn
          ? `Everyone stakes ${fb.stakeAmount} kr. The winners share the losers' stakes.`
          : `Alla satsar ${fb.stakeAmount} kr. Vinnarna delar på förlorarnas insatser.`}</div>

        <!-- User Voting Controls -->
        ${hasVoted ? `
          <div style="padding: 10px; border-radius: var(--radius-md); background: rgba(255,255,255,0.04); text-align: center; font-size: 0.85rem; font-weight: 700;">
            ${fb.myEntry.choice === 'yes' ? '✅ Du röstade: <span style="color: #2ecc71;">👍 JA</span>' : '✅ Du röstade: <span style="color: #e74c3c;">👎 NEJ</span>'}
          </div>
        ` : isCreator ? (isExpired ? '' : `
          <div style="padding: 8px; text-align: center; font-size: 0.8rem; color: var(--text-muted); background: rgba(255,255,255,0.02); border-radius: var(--radius-sm);">
            🏌️ Ditt vad – vännerna röstar.
          </div>
        `) : !isExpired ? `
          <div class="fb-lock-note">${isEn ? 'Your vote cannot be changed.' : 'Din röst går inte att ändra.'}</div>
          <div class="flex gap-sm" style="margin-top: 6px;">
            <button type="button" class="btn btn-block flashbet-vote-btn" data-fb-id="${fb.id}" data-choice="yes" style="flex: 1; padding: 10px; background: rgba(46,204,113,0.15); border: 1.5px solid #2ecc71; color: #2ecc71; font-weight: 800; font-size: 0.95rem;">
              👍 JA (${fb.stakeAmount} kr)
            </button>
            <button type="button" class="btn btn-block flashbet-vote-btn" data-fb-id="${fb.id}" data-choice="no" style="flex: 1; padding: 10px; background: rgba(231,76,60,0.15); border: 1.5px solid #e74c3c; color: #e74c3c; font-weight: 800; font-size: 0.95rem;">
              👎 NEJ (${fb.stakeAmount} kr)
            </button>
          </div>
        ` : `
          <div style="padding: 8px; text-align: center; font-size: 0.8rem; color: var(--text-muted); background: rgba(255,255,255,0.02); border-radius: var(--radius-sm);">
            ${t('arcade.flashbetTimeExpired')}
          </div>
        `}

        <!-- Settle Controls (Only for creator) -->
        ${isCreator && isExpired && entries === 0 ? `
          <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-glass); text-align: center;">
            <div class="text-muted" style="font-size: 0.8rem; margin-bottom: 8px;">${isEn ? 'Nobody voted in time.' : 'Ingen hann rösta.'}</div>
            <button type="button" class="btn btn-sm flashbet-delete-btn" data-fb-id="${escapeHtml(fb.id)}" data-question="${escapeHtml(fb.question || '')}" data-votes="0" style="width: 100%;">🗑️ ${isEn ? 'Remove and start a new one' : 'Ta bort och starta ett nytt'}</button>
          </div>
        ` : isCreator && fb.status !== 'settled' ? `
          <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-glass);">
            <div style="font-size: 0.78rem; font-weight: 800; color: ${isExpired ? '#f59e0b' : 'var(--gold)'}; margin-bottom: 6px; text-align: center;">
              ${isExpired ? '⏱️ Tiden har gått ut – dags att rätta vadet:' : `⚖️ ${t('arcade.flashbetSettlePrompt')}`}
            </div>
            <div class="flex gap-xs">
              <button type="button" class="btn btn-sm flashbet-settle-btn" data-fb-id="${fb.id}" data-winner="yes" style="flex: 1; background: #2ecc71; color: #000; font-weight: 700; padding: 6px;">
                ${t('arcade.flashbetSettleYes')}
              </button>
              <button type="button" class="btn btn-sm flashbet-settle-btn" data-fb-id="${fb.id}" data-winner="no" style="flex: 1; background: #e74c3c; color: #fff; font-weight: 700; padding: 6px;">
                ${t('arcade.flashbetSettleNo')}
              </button>
            </div>
            ${((fb.entriesCount || fb.betCount || 0) <= 1) ? `
              <div style="margin-top: 10px; text-align: center;">
                <button type="button" class="btn btn-sm flashbet-delete-btn" data-fb-id="${fb.id}" data-question="${escapeHtml(fb.question || '')}" data-votes="${fb.entriesCount || fb.betCount || 0}" style="background: rgba(231,76,60,0.12); border: 1px dashed rgba(231,76,60,0.45); color: #e74c3c; font-size: 0.78rem; font-weight: 700; padding: 6px 12px; width: 100%; border-radius: var(--radius-sm); transition: all 0.2s; cursor: pointer;">
                  ${(fb.entriesCount || fb.betCount || 0) === 0 ? '🗑️ Ta bort vad (inga bet lagda)' : '🗑️ Ta bort vad (bara 1 bet lagt)'}
                </button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  function startCountdownLoop() {
    flashBetTimerInterval = setInterval(() => {
      let anyOpen = false;
      for (const [id, seconds] of countdowns.entries()) {
        const next = Math.max(0, seconds - 1);
        countdowns.set(id, next);
        if (next > 0) anyOpen = true;

        const badge = document.getElementById(`timer-${id}`);
        if (badge) {
          badge.textContent = `⏱️ ${formatFlashBetTime(next)}`;
          if (next <= 15) {
            badge.style.background = 'rgba(231,76,60,0.2)';
            badge.style.color = '#e74c3c';
            badge.style.borderColor = '#e74c3c';
          }
          if (next === 0) {
            badge.textContent = '⏱️ STÄNGT';
            badge.style.opacity = '0.7';
            // Disable voting buttons
            document.querySelectorAll(`.flashbet-vote-btn[data-fb-id="${id}"]`).forEach(b => {
              b.disabled = true;
              b.style.opacity = '0.5';
            });
          }
        }
      }
      if (!anyOpen) cleanupTimer();
    }, 1000);
  }

  function attachActiveCardHandlers() {
    // Voting
    document.querySelectorAll('.flashbet-vote-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fbId = btn.dataset.fbId;
        const choice = btn.dataset.choice;
        btn.disabled = true;
        btn.textContent = '...';

        try {
          await placeFlashBet(fbId, choice);
          showToast(choice === 'yes' ? '👍 Röst lagd på JA!' : '👎 Röst lagd på NEJ!', 'success');
          renderActiveTab();
        } catch (err) {
          showToast(err.message, 'error');
          renderActiveTab();
        }
      });
    });

    document.querySelectorAll('.fb-goto-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        cleanupTimer();
        closeModal();
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'leaderboard', tab: 'overview' } }));
      });
    });

    // Settling
    document.querySelectorAll('.flashbet-settle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fbId = btn.dataset.fbId;
        const winner = btn.dataset.winner;
        const card = flashBetsById.get(fbId);
        if (!confirm(settlePreview(card, winner))) return;

        btn.disabled = true;
        try {
          await settleFlashBet(fbId, winner);
          launchConfetti();
          showToast(`🏁 BlixtBet avgjort! ${winner === 'yes' ? 'JA' : 'NEJ'} vann!`, 'success');
          renderActiveTab();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    // Deleting (while at most one friend has bet) and starting over
    document.querySelectorAll('.flashbet-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fbId = btn.dataset.fbId;
        const originalText = btn.textContent;
        const message = btn.dataset.votes === '1'
          ? 'Vill du ta bort detta BlixtBet? Den som har lagt bet får en notis om att det inte räknas. Du kan sedan skapa ett nytt.'
          : 'Vill du ta bort detta BlixtBet? Ingen har lagt bet än. Du kan sedan skapa ett nytt.';
        if (!confirm(message)) return;

        btn.disabled = true;
        btn.textContent = 'Tar bort...';
        try {
          await deleteFlashBet(fbId);
          showToast('🗑️ BlixtBet borttaget – skapa ett nytt!', 'info');
          activeTab = 'create';
          updateTabs();
          renderCreateTab(btn.dataset.question || '');
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = originalText;
          renderActiveTab();
        }
      });
    });
  }

  // ── Render Create Tab ──────────────────────────────
  async function renderCreateTab(prefillQuestion = '') {
    cleanupTimer();
    let selectedDurationMinutes = 2;
    let selectedDuration = 120;
    let selectedStake = 20;
    let tournaments = [];
    let friends = [];
    let selectedFriendIds = new Set();
    let isAllFriends = true;

    try {
      const [fetchedTournaments, fetchedFriends] = await Promise.all([
        getTournaments().catch(() => []),
        getFriends().catch(() => [])
      ]);
      tournaments = fetchedTournaments || [];
      friends = fetchedFriends || [];
      selectedFriendIds = new Set(friends.map(f => f.id));
    } catch {}

    tabContent.innerHTML = `
      <form id="create-flashbet-form" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="form-group mb-xs">
          <label class="form-label" style="font-weight: 700; font-size: 0.85rem;">⚡ Vad gäller bettet?</label>
          <input type="text" class="form-input" id="fb-question-input" placeholder="${t('arcade.flashbetQuestionPlaceholder')}" value="${escapeHtml(prefillQuestion)}" required maxlength="120" style="padding: 10px 12px; font-weight: 700; font-size: 0.95rem;" />
        </div>

        <!-- Duration Picker (Custom minutes field + shortcuts) -->
        <div class="form-group mb-xs">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
            <label class="form-label" style="font-size: 0.8rem; font-weight: 700; margin-bottom: 0;">⏱️ ${t('arcade.flashbetDurationLabel') || 'Tid att rösta:'}</label>
            <span style="font-size: 0.72rem; color: var(--text-muted);">Ange valfritt antal minuter</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
            <div style="position: relative; width: 110px;">
              <input type="number" class="form-input" id="fb-duration-minutes-input" min="1" max="1440" step="1" value="${selectedDurationMinutes}" style="padding: 8px 12px; font-weight: 800; font-size: 1.05rem; text-align: center; border-color: var(--gold);" />
            </div>
            <span style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 700;">minuter</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;">
            <button type="button" class="btn btn-sm fb-quick-min-btn ${selectedDurationMinutes === 1 ? 'btn-primary' : 'btn-secondary'}" data-min="1" style="padding: 6px 2px; font-size: 0.78rem; font-weight: 700;">1 min</button>
            <button type="button" class="btn btn-sm fb-quick-min-btn ${selectedDurationMinutes === 2 ? 'btn-primary' : 'btn-secondary'}" data-min="2" style="padding: 6px 2px; font-size: 0.78rem; font-weight: 700;">2 min</button>
            <button type="button" class="btn btn-sm fb-quick-min-btn ${selectedDurationMinutes === 5 ? 'btn-primary' : 'btn-secondary'}" data-min="5" style="padding: 6px 2px; font-size: 0.78rem; font-weight: 700;">5 min</button>
            <button type="button" class="btn btn-sm fb-quick-min-btn ${selectedDurationMinutes === 10 ? 'btn-primary' : 'btn-secondary'}" data-min="10" style="padding: 6px 2px; font-size: 0.78rem; font-weight: 700;">10 min</button>
            <button type="button" class="btn btn-sm fb-quick-min-btn ${selectedDurationMinutes === 30 ? 'btn-primary' : 'btn-secondary'}" data-min="30" style="padding: 6px 2px; font-size: 0.78rem; font-weight: 700;">30 min</button>
          </div>
        </div>

        <!-- Stake Picker -->
        <div class="form-group mb-xs">
          <label class="form-label" style="font-size: 0.8rem;">💰 ${t('arcade.flashbetStakeLabel')}</label>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
            <button type="button" class="btn btn-sm btn-secondary fb-stake-btn" data-stake="10" style="padding: 8px 4px; font-size: 0.8rem; font-weight: 700;">10 kr</button>
            <button type="button" class="btn btn-sm btn-primary fb-stake-btn" data-stake="20" style="padding: 8px 4px; font-size: 0.8rem; font-weight: 700;">20 kr</button>
            <button type="button" class="btn btn-sm btn-secondary fb-stake-btn" data-stake="50" style="padding: 8px 4px; font-size: 0.8rem; font-weight: 700;">50 kr</button>
            <button type="button" class="btn btn-sm btn-secondary fb-stake-btn" data-stake="100" style="padding: 8px 4px; font-size: 0.8rem; font-weight: 700;">100 kr</button>
          </div>
        </div>

        <div class="fb-host-note">🎙️ ${isEn ? 'You host the bet and decide the answer – you do not vote yourself.' : 'Du leder bettet och avgör svaret – du röstar inte själv.'}</div>

        <!-- Optional Tournament Link -->
        ${tournaments && tournaments.length > 0 ? `
          <div class="form-group mb-xs">
            <label class="form-label" style="font-size: 0.8rem;">🏆 ${t('arcade.flashbetTournamentLink')}</label>
            <select class="form-input" id="fb-tournament-select" style="font-size: 0.85rem; padding: 8px 10px;">
              <option value="">${isEn ? '— No event (friends) —' : '— Inget event (vänner) —'}</option>
              ${tournaments.map(t => `<option value="${t.id}" ${defaultTournamentId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <div id="fb-event-hint" class="fb-host-note" style="display: none;">🏆 ${isEn ? 'Everyone in the event can vote and gets a notification.' : 'Alla som är med i eventet kan rösta och får en notis.'}</div>

        <!-- Friends Selection -->
        <div class="form-group mb-xs" id="fb-friends-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label class="form-label" style="font-size: 0.85rem; font-weight: 700; margin-bottom: 0;">👥 ${isEn ? 'Who can vote?' : 'Vilka får rösta?'}</label>
            ${friends && friends.length > 0 ? `
              <label style="font-size: 0.78rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; color: var(--text-secondary);">
                <input type="checkbox" id="fb-toggle-all-friends" ${isAllFriends ? 'checked' : ''} style="cursor: pointer;" />
                Alla vänner (${friends.length})
              </label>
            ` : ''}
          </div>
          ${friends && friends.length > 0 ? `
            <div id="fb-friends-list" style="display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto; padding: 2px;">
              ${friends.map(f => {
                const checked = selectedFriendIds.has(f.id);
                return `
                  <div class="friend-chip fb-friend-chip" data-friend-id="${f.id}" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: ${checked ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 255, 255, 0.05)'};
                    border: 1px solid ${checked ? '#00e676' : 'rgba(255, 255, 255, 0.15)'};
                    border-radius: 16px;
                    padding: 4px 10px;
                    font-size: 0.8rem;
                    cursor: pointer;
                    user-select: none;
                    transition: all 0.2s;
                  ">
                    <span>${escapeHtml(f.avatarEmoji || f.avatar_emoji || '🏌️')}</span>
                    <span style="font-weight: 600; color: #fff;">${escapeHtml(f.nickname || f.realName || f.real_name || 'Vän')}</span>
                    <span class="fb-chip-status" style="font-size: 0.75rem;">${checked ? '✓' : '+'}</span>
                  </div>
                `;
              }).join('')}
            </div>
            <div id="fb-friends-count-hint" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
              ${isAllFriends ? 'Notis skickas till alla vänner' : `${selectedFriendIds.size} ${selectedFriendIds.size === 1 ? 'vän vald' : 'vänner valda'}`}
            </div>
          ` : `
            <div style="font-size: 0.78rem; color: var(--text-muted); padding: 4px 0;">
              💡 Tips: Lägg till vänner i menyn så kan du skicka snabb-bets direkt till deras mobiler!
            </div>
          `}
        </div>

        <button type="submit" class="btn btn-primary btn-block mt-xs" id="btn-submit-flashbet" style="padding: 12px; font-size: 1rem; font-weight: 800; background: linear-gradient(135deg, var(--gold), #e67e22); border: none;">
          ⚡ Starta BlixtBet & Skicka Notis!
        </button>
      </form>
    `;

    // Minutes input & quick buttons
    const minutesInput = document.getElementById('fb-duration-minutes-input');
    const updateDurationFromMinutes = (val) => {
      let mins = Math.max(1, Math.min(1440, Number(val) || 1));
      selectedDurationMinutes = mins;
      selectedDuration = Math.round(mins * 60);
      document.querySelectorAll('.fb-quick-min-btn').forEach(b => {
        const bMin = Number(b.dataset.min);
        if (bMin === mins) {
          b.className = 'btn btn-sm btn-primary fb-quick-min-btn';
        } else {
          b.className = 'btn btn-sm btn-secondary fb-quick-min-btn';
        }
      });
    };

    minutesInput?.addEventListener('input', (e) => {
      updateDurationFromMinutes(e.target.value);
    });

    minutesInput?.addEventListener('blur', (e) => {
      let mins = Math.max(1, Math.min(1440, Number(e.target.value) || 1));
      e.target.value = mins;
      updateDurationFromMinutes(mins);
    });

    document.querySelectorAll('.fb-quick-min-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = Number(btn.dataset.min);
        if (minutesInput) minutesInput.value = mins;
        updateDurationFromMinutes(mins);
      });
    });

    // Friend selection chips & toggle
    const updateFriendChipsUI = () => {
      const toggleAll = document.getElementById('fb-toggle-all-friends');
      if (toggleAll) {
        toggleAll.checked = isAllFriends;
      }
      document.querySelectorAll('.fb-friend-chip').forEach(chip => {
        const fId = chip.dataset.friendId;
        const isSelected = selectedFriendIds.has(fId);
        chip.style.background = isSelected ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 255, 255, 0.05)';
        chip.style.borderColor = isSelected ? '#00e676' : 'rgba(255, 255, 255, 0.15)';
        const statusSpan = chip.querySelector('.fb-chip-status');
        if (statusSpan) statusSpan.textContent = isSelected ? '✓' : '+';
      });
      const hint = document.getElementById('fb-friends-count-hint');
      if (hint) {
        hint.textContent = isAllFriends
          ? 'Notis skickas till alla vänner'
          : (selectedFriendIds.size === 0
              ? 'Välj minst en vän'
              : `${selectedFriendIds.size} ${selectedFriendIds.size === 1 ? 'vän vald' : 'vänner valda'}`);
      }
    };

    document.getElementById('fb-toggle-all-friends')?.addEventListener('change', (e) => {
      isAllFriends = e.target.checked;
      if (isAllFriends) {
        selectedFriendIds = new Set(friends.map(f => f.id));
      } else {
        selectedFriendIds.clear();
      }
      updateFriendChipsUI();
    });

    document.querySelectorAll('.fb-friend-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const fId = chip.dataset.friendId;
        if (selectedFriendIds.has(fId)) {
          selectedFriendIds.delete(fId);
          isAllFriends = false;
        } else {
          selectedFriendIds.add(fId);
          if (friends.length > 0 && selectedFriendIds.size === friends.length) {
            isAllFriends = true;
          }
        }
        updateFriendChipsUI();
      });
    });

    // Stake buttons
    document.querySelectorAll('.fb-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fb-stake-btn').forEach(b => b.className = 'btn btn-sm btn-secondary fb-stake-btn');
        btn.className = 'btn btn-sm btn-primary fb-stake-btn';
        selectedStake = Number(btn.dataset.stake);
      });
    });

    // In an event everyone in it is asked, so the friend picker only matters outside events
    const eventSelect = document.getElementById('fb-tournament-select');
    const syncAudience = () => {
      const inEvent = Boolean(eventSelect?.value);
      const group = document.getElementById('fb-friends-group');
      const hint = document.getElementById('fb-event-hint');
      if (group) group.style.display = inEvent ? 'none' : '';
      if (hint) hint.style.display = inEvent ? 'block' : 'none';
    };
    eventSelect?.addEventListener('change', syncAudience);
    syncAudience();

    // Form submit
    document.getElementById('create-flashbet-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = document.getElementById('fb-question-input').value.trim();
      // The dropdown decides: "no event" really means no event
      const tournamentId = eventSelect ? (eventSelect.value || null) : null;
      if (!tournamentId && !isAllFriends && selectedFriendIds.size === 0) {
        showToast(isEn ? 'Pick at least one friend' : 'Välj minst en vän som kan rösta', 'warning');
        return;
      }
      const submitBtn = document.getElementById('btn-submit-flashbet');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Skapar BlixtBet... ⚡';

      try {
        await createFlashBet({
          question,
          durationSeconds: selectedDuration,
          durationMinutes: selectedDurationMinutes,
          stakeAmount: selectedStake,
          tournamentId,
          targetFriendIds: Array.from(selectedFriendIds),
          notifyAllFriends: isAllFriends
        });

        showToast('⚡ BlixtBet startat! Klockan tickar!', 'success');
        activeTab = 'active';
        updateTabs();
        renderActiveTab();
      } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '⚡ Starta BlixtBet & Skicka Notis!';
      }
    });
  }

  // Initial render
  renderActiveTab();
}

// ────────────────────────────────────────────────────────
// 🧾 NOTAN / RECEIPT VIEWER (DELA UTLÄGG)
// ────────────────────────────────────────────────────────

export async function openReceiptModal(expenseId) {
  const isEn = getLang() === 'en';
  try {
    const expense = await getTabExpense(expenseId);
    if (!expense) {
      showToast(isEn ? 'Receipt not found' : 'Kvittot hittades inte', 'error');
      return;
    }

    const dateStr = expense.created_at ? parseServerDate(expense.created_at).toLocaleString(isEn ? 'en-US' : 'sv-SE', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '';

    const payerName = expense.payer_real_name || expense.payer_nickname || (isEn ? 'A friend' : 'En vän');
    const receiptViewerId = getStoredUser()?.id;
    const isReceiptPayer = Boolean(receiptViewerId) && expense.payer_id === receiptViewerId;
    const isReceiptParticipant = !isReceiptPayer && (expense.participants || []).some(p => p.user_id === receiptViewerId);

    showModal(`
      <div class="notan-receipt-viewer animate-in" style="max-width: 420px; margin: 0 auto; text-align: left;">
        <div class="flex-between mb-sm" style="align-items: center;">
          <span class="badge badge-primary" style="font-size: 0.75rem; font-weight: 800; padding: 4px 8px;">
            ${isEn ? '🛒 SPLIT EXPENSE' : '🛒 DELA UTLÄGG'}
          </span>
          <span class="text-muted" style="font-size: 0.75rem;">${dateStr}</span>
        </div>

        <h3 class="font-heading" style="color: var(--gold); margin: 0 0 4px; font-size: 1.25rem;">
          ${escapeHtml(expense.title || (isEn ? 'Split Expense' : 'Dela utlägg'))}
        </h3>
        
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">
          ${isEn ? 'Paid by' : 'Betalades av'}: <strong style="color: #fff;">${escapeHtml(payerName)}</strong>
        </div>

        <!-- Total Amount Card -->
        <div class="card mb-sm text-center" style="background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.3); padding: 12px;">
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--gold); text-transform: uppercase;">
            ${isEn ? 'Total Tab' : 'Total Krognota'}
          </div>
          <div style="font-size: 1.6rem; font-weight: 900; color: var(--gold);">
            ${Math.round(expense.total_amount)} kr
          </div>
        </div>

        ${expense.notes ? `
          <div class="card mb-sm" style="padding: 10px 12px; background: rgba(255,255,255,0.03); font-size: 0.85rem;">
            <div style="font-weight: 700; color: var(--text-muted); font-size: 0.75rem; margin-bottom: 4px;">📝 ${isEn ? 'Notes' : 'Anteckning'}:</div>
            <div style="white-space: pre-wrap; color: var(--text-secondary);">${escapeHtml(expense.notes)}</div>
          </div>
        ` : ''}

        <!-- Attached Receipt Photo -->
        ${expense.receipt_image ? `
          <div class="mb-md">
            <div style="font-weight: 700; font-size: 0.8rem; color: var(--gold); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              <span>🧾 ${isEn ? 'Receipt Photo' : 'Fotat Kvitto'}</span>
            </div>
            <div style="position: relative; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-glass); background: #000; cursor: pointer;" id="receipt-photo-container">
              <img src="${expense.receipt_image}" alt="Kvitto" style="width: 100%; max-height: 280px; object-fit: contain; display: block; background: #0d1117;" />
              <div style="position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,0.75); color: #fff; font-size: 0.7rem; padding: 3px 8px; border-radius: 4px; pointer-events: none;">
                🔍 ${isEn ? 'Click to zoom' : 'Klicka för fullskärm'}
              </div>
            </div>
          </div>
        ` : `
          <div class="text-muted text-center mb-md" style="font-size: 0.8rem; font-style: italic; padding: 8px;">
            ${isEn ? 'No receipt photo attached' : 'Inget kvittofoto bifogat'}
          </div>
        `}

        <!-- Participants & Debts -->
        <div class="mb-md">
          <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">
            👥 ${isEn ? 'Participants & Breakdown' : 'Deltagare & Fördelning'}:
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${(expense.participants || []).map(p => {
              const isPayer = p.user_id === expense.payer_id;
              const name = p.real_name || p.nickname || (isEn ? 'Participant' : 'Deltagare');
              const amountText = isPayer ? `Lade ut (${Math.round(p.amount)} kr egen del)` : `Skyldig ${Math.round(p.amount)} kr`;
              const badgeColor = isPayer ? '#4ade80' : 'var(--gold)';

              return `
                <div class="flex-between align-center" style="padding: 6px 10px; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); border-left: 3px solid ${badgeColor}; font-size: 0.85rem; flex-wrap: wrap; gap: 6px;">
                  <div class="flex align-center gap-xs" style="flex: 1 1 auto; min-width: 0;">
                    <span style="flex-shrink: 0;">${escapeHtml(p.avatar_emoji || '👤')}</span>
                    <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</span>
                    ${isPayer ? `<span class="badge badge-warning" style="font-size: 0.65rem; padding: 1px 4px; flex-shrink: 0; white-space: nowrap;">${isEn ? 'Payer' : 'Lade ut'}</span>` : ''}
                  </div>
                  <div style="font-weight: 700; color: ${badgeColor}; font-size: 0.8rem; flex-shrink: 0; white-space: nowrap;">
                    ${amountText}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>

        ${isReceiptPayer ? `
          <button type="button" class="btn btn-block mb-sm" id="btn-remove-tab-expense" style="padding: 10px; font-weight: 700; background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.4);">
            🗑️ ${isEn ? 'Delete expense' : 'Ta bort notan'}
          </button>
        ` : isReceiptParticipant ? `
          <button type="button" class="btn btn-block mb-sm" id="btn-remove-tab-expense" style="padding: 10px; font-weight: 700; background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.4);">
            ⚠️ ${isEn ? 'Dispute my share' : 'Bestrid min del'}
          </button>
        ` : ''}

        <button type="button" class="btn btn-secondary btn-block" id="btn-close-receipt-modal" style="padding: 10px; font-weight: 700;">
          ${isEn ? 'Close' : 'Stäng'}
        </button>
      </div>
    `);

    document.getElementById('btn-close-receipt-modal')?.addEventListener('click', () => {
      closeModal();
    });

    document.getElementById('btn-remove-tab-expense')?.addEventListener('click', async () => {
      const question = isReceiptPayer
        ? (isEn ? 'Delete this expense for everyone?' : 'Ta bort notan för alla deltagare?')
        : (isEn ? 'Dispute your share? It will be removed from your debts and the payer is notified.' : 'Bestrida din del? Den tas bort från dina skulder och den som lade ut får en notis.');
      if (!confirm(question)) return;
      try {
        await deleteTabExpense(expenseId);
        showToast(isReceiptPayer ? (isEn ? 'Expense deleted' : 'Notan är borttagen') : (isEn ? 'Your share was disputed' : 'Din del är bestriden'), 'success');
        closeModal();
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'leaderboard' } }));
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Zoom receipt modal
    document.getElementById('receipt-photo-container')?.addEventListener('click', () => {
      showModal(`
        <div style="text-align: center;">
          <img src="${expense.receipt_image}" alt="Kvitto Fullskärm" style="max-width: 100%; max-height: 80vh; border-radius: var(--radius-md); object-fit: contain;" />
          <div class="mt-sm">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-close-zoom-receipt">${isEn ? 'Close' : 'Stäng'}</button>
          </div>
        </div>
      `);
      document.getElementById('btn-close-zoom-receipt')?.addEventListener('click', () => {
        openReceiptModal(expenseId);
      });
    });

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ────────────────────────────────────────────────────────
// 👾 GAME 10: SPACE BLITZ (Retro Space Invaders)
// ────────────────────────────────────────────────────────
export function openSpaceInvadersModal(initialOptions = {}) {
  const isEn = getLang() === 'en';
  const currentUser = getStoredUser();

  // Mode: 'solo' | 'duel' | 'party' | 'pass'
  let activeMode = initialOptions.mode === 'duel' ? 'party' : (initialOptions.mode || 'solo');
  let selectedStake = initialOptions.stake || 0;
  let partyRoom = initialOptions.room || null;

  // Pass & play players state
  let passPlayers = [
    currentUser ? currentUser.nickname : (isEn ? 'Player 1' : 'Spelare 1'),
    isEn ? 'Player 2' : 'Spelare 2'
  ];
  let passCurrentIndex = 0;
  let passScores = [];

  const modalTitle = `<img src="/space-invaders.png" alt="Space Invaders" style="width: 24px; height: 24px; object-fit: contain; vertical-align: -3px; margin-right: 6px;" />${t('arcade.spaceInvadersTitle')}`;
  let soloGameStarted = false;
  // The server times each solo round so only real rounds reach the friends' leaderboard
  let soloRoundId = null;
  const beginSoloRound = () => {
    soloRoundId = null;
    if (!currentUser) return;
    startSpaceSoloRound().then(r => { soloRoundId = r?.roundId || null; }).catch(() => {});
  };

  function renderContent() {
    return `
      <div class="space-blitz-modal">
        <p class="game-modal-subheading">${t('arcade.spaceInvadersDesc')}</p>
        <!-- Top Mode Tabs -->
        <div class="flex gap-xs mb-md" style="justify-content: center; flex-wrap: wrap;">
          <button type="button" class="btn ${activeMode === 'solo' ? 'btn-primary' : 'btn-secondary'} btn-sm space-tab-btn" data-tab="solo">
            ${t('arcade.spaceModeSolo')}
          </button>
          <button type="button" class="btn ${activeMode === 'party' ? 'btn-primary' : 'btn-secondary'} btn-sm space-tab-btn" data-tab="party">
            ${t('arcade.spaceModeParty')}
          </button>
          <button type="button" class="btn ${activeMode === 'pass' ? 'btn-primary' : 'btn-secondary'} btn-sm space-tab-btn" data-tab="pass">
            ${t('arcade.spaceModePass')}
          </button>
        </div>

        <div id="space-stage-content">
          ${renderStageContent()}
        </div>
      </div>
    `;
  }

  function renderSoloSetupHtml() {
    return `
      <div class="card p-md text-center animate-in" id="space-solo-start-card">
        <div style="display: flex; justify-content: center; margin-bottom: 8px;">
          <img src="/space-invaders.png" alt="Space Blitz" style="width: 58px; height: 58px; object-fit: contain; filter: drop-shadow(0 0 12px rgba(245, 158, 11, 0.6));" />
        </div>
        <h3 style="color: var(--gold); font-family: var(--font-heading); font-size: 1.2rem; margin-bottom: 4px;">
          Space Blitz (60s)
        </h3>
        <p class="text-secondary" style="font-size: 0.82rem; max-width: 320px; margin: 0 auto 12px auto;">
          ${isEn ? '60s retro arcade mission! Blast waves of aliens, dodge bombs and beat your highscore.' : '60s retro-arkad! Skjut ner vågor av rymdinvasörer, ducka bomber och sätt nytt highscore.'}
        </p>

        <div class="flex gap-xs justify-center mb-md" style="flex-wrap: wrap;">
          <span class="badge badge-accent">⏱️ 60s Blitz</span>
          <span class="badge badge-success">❤️❤️❤️ ${isEn ? '3 Lives' : '3 Liv'}</span>
          <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);">🪙 ${isEn ? 'Earn chips for Slots' : 'Tjäna marker till Enarmad bandit'}</span>
          <span class="badge badge-accent">🌊 ${isEn ? '+300 per wave' : '+300 per våg'}</span>
        </div>

        <div class="card p-sm mb-md text-left" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); font-size: 0.78rem;">
          <div style="font-weight: 700; color: #10b981; margin-bottom: 4px;">🎮 ${isEn ? 'Controls' : 'Styrning'}:</div>
          <div class="text-secondary" style="line-height: 1.4;">
            ${isEn ? '• Tap ◀ ▶ or drag your thumb to move your ship' : '• Tryck ◀ ▶ eller dra med tummen för att styra skeppet'}<br/>
            ${isEn ? '• Tap 🔥 FIRE or Spacebar to shoot' : '• Tryck 🔥 FIRE eller Mellanslag för att skjuta'}
          </div>
        </div>

        <div id="space-solo-leaderboard" class="space-lb"></div>

        <button type="button" class="btn btn-primary btn-block" id="btn-start-solo-game" style="font-weight: 800; font-size: 1.05rem; padding: 12px; box-shadow: 0 0 16px rgba(16, 185, 129, 0.4);">
          🚀 ${isEn ? 'Start Blitz! (60s)' : 'Starta Spelet (60s) 🚀'}
        </button>
      </div>
    `;
  }

  function renderStageContent() {
    if (activeMode === 'solo') {
      return soloGameStarted ? renderPlayStageHtml() : renderSoloSetupHtml();
    } else if (activeMode === 'duel') {
      return renderDuelSetupHtml();
    } else if (activeMode === 'party') {
      return renderPartySetupHtml();
    } else if (activeMode === 'pass') {
      return renderPassSetupHtml();
    }
    return '';
  }

  function renderPlayStageHtml(playerName = '') {
    return `
      <div class="space-arcade-container">
        <div class="space-hud">
          <div>${playerName ? `<span style="color:#fff;">${escapeHtml(playerName)}</span> · ` : ''}${t('arcade.spaceScore')}: <span id="space-score-val" style="color:var(--gold);">0</span></div>
          <div>${t('arcade.spaceTime')}: <span id="space-timer-val" style="color:#ef4444;">60s</span></div>
          <div>${t('arcade.spaceLives')}: <span id="space-lives-val">❤️❤️❤️</span></div>
        </div>

        <div class="space-arcade-bezel">
          <canvas id="space-canvas" class="space-arcade-canvas" width="320" height="300" role="img" aria-label="${isEn ? 'Space Blitz arcade gameplay screen' : 'Space Blitz spelskärm'}"></canvas>
        </div>

        <!-- Touch / Mouse Controls -->
        <div class="space-touch-controls">
          <button type="button" class="space-btn-ctrl" id="btn-space-left" aria-label="${isEn ? 'Move Left' : 'Styr Vänster'}">◀</button>
          <button type="button" class="space-btn-ctrl space-btn-fire" id="btn-space-fire" aria-label="${isEn ? 'Fire' : 'Skjut'}">🔥 FIRE</button>
          <button type="button" class="space-btn-ctrl" id="btn-space-right" aria-label="${isEn ? 'Move Right' : 'Styr Höger'}">▶</button>
        </div>

        <div class="text-muted mt-sm text-center" style="font-size: 0.72rem;">
          ${isEn ? 'Use buttons, touch-drag ship, or Arrow keys + Space' : 'Styr med knapparna, dra med tummen, eller piltangenter + Mellanslag'}
        </div>
      </div>
    `;
  }

  function renderDuelSetupHtml() {
    return `
      <div class="card p-md text-center">
        <div style="font-size: 2.5rem; margin-bottom: 6px;">⚔️</div>
        <h4 style="color: var(--gold);">${t('arcade.spaceModeDuel')}</h4>
        <p class="text-secondary" style="font-size: 0.85rem; margin-bottom: 14px;">
          ${isEn ? 'Multiplayer missions against friends are played in realtime in Party Mode!' : 'Realtidsmatcher mot kompisar körs via Partyläget!'}
        </p>

        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 12px; margin: 12px 0; font-size: 0.82rem; text-align: left;">
          <div style="color: var(--gold); font-weight: 700; margin-bottom: 4px;">💡 ${isEn ? 'How to challenge friends:' : 'Så här utmanar du dina vänner:'}</div>
          <div class="text-muted" style="line-height: 1.4;">
            ${isEn 
              ? '1. Open the <strong>Party</strong> tab.<br/>2. Create a room (choose stake or honor).<br/>3. Share the 4-letter room code or QR code with your friend to play 60s Blitz together!' 
              : '1. Klicka på fliken <strong>Party</strong>.<br/>2. Skapa ett rum med eller utan insats.<br/>3. Dela 4-bokstavskoden eller QR-koden med kompisen för att köra 60s Blitz samtidigt!'}
          </div>
        </div>

        <button type="button" class="btn btn-primary btn-block" id="btn-switch-to-party" style="font-weight: 800;">
          🚀 ${isEn ? 'Go to Party Mode' : 'Gå till Partyläget'}
        </button>
      </div>
    `;
  }

  function renderPartySetupHtml() {
    return `
      <div class="card p-md">
        <h4 style="color: var(--gold); text-align: center;">${t('arcade.spaceModeParty')} (3-10+ ${isEn ? 'players' : 'spelare'})</h4>
        <p class="text-secondary text-center" style="font-size: 0.85rem;">
          ${isEn ? 'Create an arcade room with 4-letter code! Everyone plays 60s Blitz and the live leaderboard crowns the winner.' : 'Skapa ett arkadrum med rumskod! Alla kör 60s Blitz och live-leaderboarden korar mästaren.'}
        </p>

        <div class="my-md">
          <label class="form-label" style="font-size: 0.8rem; display: block; margin-bottom: 6px;">
            ${t('arcade.blind10StakeLabel')}
          </label>
          <div class="flex gap-xs" style="justify-content: center;">
            <button type="button" class="btn ${selectedStake === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="0">0 kr (${isEn ? 'Honor' : 'Ära'})</button>
            <button type="button" class="btn ${selectedStake === 20 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="20">20 kr</button>
            <button type="button" class="btn ${selectedStake === 50 ? 'btn-primary' : 'btn-secondary'} btn-sm party-stake-btn" data-stake="50">50 kr</button>
          </div>
        </div>

        <button type="button" class="btn btn-primary btn-block mb-md" id="btn-create-space-party" style="font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none;">
          🚀 ${isEn ? 'Create Group Room' : 'Skapa Grupp-Rum'}
        </button>

        <div style="position: relative; text-align: center; margin: 14px 0;">
          <hr style="border: 0; border-top: 1px solid var(--border-glass);" />
          <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #14141e; padding: 0 10px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">
            ${isEn ? 'or join room' : 'eller gå med i rum'}
          </span>
        </div>

        <div class="flex gap-sm">
          <input type="text" id="space-party-code-input" class="form-input" placeholder="KOD (T.EX. BLTZ)" maxlength="6" style="text-transform: uppercase; font-family: monospace; font-size: 1.1rem; text-align: center; font-weight: 700; letter-spacing: 3px;" />
          <button type="button" class="btn btn-secondary" id="btn-join-space-party" style="white-space: nowrap; padding: 0 16px; font-weight: 700;">
            ${t('arcade.blind10JoinBtn')}
          </button>
        </div>
      </div>
    `;
  }

  function renderPassSetupHtml() {
    return `
      <div class="card p-md">
        <h4 style="color: var(--gold); text-align: center;">${t('arcade.spaceModePass')}</h4>
        <p class="text-secondary text-center" style="font-size: 0.85rem;">
          ${isEn ? 'Pass the phone around the table! Each player plays their 60s turn. Highest score wins the round.' : 'Skicka runt telefonen bland kompisarna i baren! Varje spelare kör 60s. Högst poäng vinner.'}
        </p>

        <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 0.78rem; color: var(--text-secondary); text-align: center;">
          ℹ️ ${isEn ? 'Local table mode on this device. No automatic charges or database debts are created.' : 'Lokalt sällskapsläge på denna telefon. Inga automatiska skulder eller dragningar skapas.'}
        </div>

        <div class="my-md">
          <label class="form-label" style="font-size: 0.8rem; display: block; margin-bottom: 6px;">
            ${t('arcade.blind10StakeLabel')}
          </label>
          <div class="flex gap-xs" style="justify-content: center;">
            <button type="button" class="btn ${selectedStake === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="0">0 kr (${isEn ? 'Honor' : 'Ära'})</button>
            <button type="button" class="btn ${selectedStake === 20 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="20">20 kr</button>
            <button type="button" class="btn ${selectedStake === 50 ? 'btn-primary' : 'btn-secondary'} btn-sm pass-stake-btn" data-stake="50">50 kr</button>
          </div>
        </div>

        <div class="my-md">
          <label class="form-label" style="font-size: 0.85rem; margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span>👥 ${isEn ? 'Players taking turns' : 'Deltagare'}:</span>
            <span style="color: var(--text-muted);">${passPlayers.length}/8</span>
          </label>
          <div id="space-pass-players-list" style="display: flex; flex-direction: column; gap: 8px;">
            ${passPlayers.map((p, idx) => `
              <div class="flex gap-xs align-center">
                <span style="font-weight: 700; color: var(--gold); min-width: 22px;">#${idx + 1}</span>
                <input type="text" class="form-input space-pass-name" data-idx="${idx}" value="${escapeHtml(p)}" style="padding: 8px 12px;" />
                ${passPlayers.length > 2 ? `
                  <button type="button" class="btn btn-secondary btn-sm space-remove-pass-btn" data-idx="${idx}" style="color: #ef4444;">✕</button>
                ` : ''}
              </div>
            `).join('')}
          </div>
          ${passPlayers.length < 8 ? `
            <button type="button" class="btn btn-secondary btn-sm mt-sm" id="btn-add-space-pass-player" style="width: 100%;">
              ➕ ${isEn ? 'Add Player' : 'Lägg till spelare'}
            </button>
          ` : ''}
        </div>

        <button type="button" class="btn btn-primary btn-block mt-md" id="btn-start-pass-game" style="font-weight: 700;">
          🚀 ${isEn ? 'Start Table Battle!' : 'Starta Bordskampen!'}
        </button>
      </div>
    `;
  }

  let activeSpaceEngineCleanup = null;
  let partyWs = null;

  function disconnectPartyWs() {
    if (partyWs) {
      try { partyWs.close(); } catch (_) {}
      partyWs = null;
    }
  }

  const { close, root, setBusy } = showModal(modalTitle, renderContent(), () => {
    if (activeSpaceEngineCleanup) {
      activeSpaceEngineCleanup();
      activeSpaceEngineCleanup = null;
    }
    disconnectPartyWs();
  }, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => activeSpaceEngineCleanup !== null,
    confirmTexts: {
      title: isEn ? 'Exit Space Invaders?' : 'Avsluta Space Invaders?',
      message: isEn 
        ? 'Are you sure you want to exit? Ongoing space mission and score will be lost.' 
        : 'Är du säker på att du vill avsluta? Ditt pågående rymduppdrag och poäng går förlorade.'
    }
  });

  setBusy(() => activeSpaceEngineCleanup !== null);

  function switchTab(tabName) {
    if (activeSpaceEngineCleanup) {
      activeSpaceEngineCleanup();
      activeSpaceEngineCleanup = null;
    }
    if (tabName !== 'party') {
      disconnectPartyWs();
    }
    activeMode = tabName;
    soloGameStarted = false;
    root.querySelectorAll('.space-tab-btn').forEach(b => {
      if (b.dataset.tab === tabName) {
        b.classList.add('btn-primary');
        b.classList.remove('btn-secondary');
      } else {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      }
    });

    const stage = root.querySelector('#space-stage-content');
    if (stage) {
      stage.innerHTML = renderStageContent();
      attachStageListeners();
    }
  }

  // Attach tab switching
  function attachTabs() {
    root.querySelectorAll('.space-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });
  }

  function attachStageListeners() {
    if (activeMode === 'solo') {
      if (!soloGameStarted) {
        const stage = root.querySelector('#space-stage-content');
        stage?.querySelector('#btn-start-solo-game')?.addEventListener('click', () => {
          soloGameStarted = true;
          beginSoloRound();
          stage.innerHTML = renderPlayStageHtml();
          initSpaceEngine({
            onGameOver: (result) => {
              soloGameStarted = false;
              showSoloResults(result);
            }
          });
        });
      } else {
        initSpaceEngine({
          onGameOver: (result) => {
            soloGameStarted = false;
            showSoloResults(result);
          }
        });
      }
      loadSoloLeaderboard();
    } else if (activeMode === 'duel') {
      attachDuelListeners();
    } else if (activeMode === 'party') {
      attachPartyListeners();
    } else if (activeMode === 'pass') {
      attachPassListeners();
    }
  }

  async function loadSoloLeaderboard() {
    const box = root.querySelector('#space-solo-leaderboard');
    if (!box || !currentUser) return;
    try {
      const lb = await getSpaceLeaderboard();
      if (!lb || !lb.players || lb.players.length === 0) {
        box.innerHTML = `<div class="text-muted" style="font-size: 0.8rem;">${isEn ? 'Set the first score among your friends!' : 'Sätt första rekordet bland dina vänner!'}</div>`;
        return;
      }
      box.innerHTML = `
        <div class="space-lb-title">🏅 ${isEn ? 'Top among friends' : 'Topplista bland vänner'}</div>
        ${lb.players.slice(0, 5).map((p, i) => `
          <div class="space-lb-row ${p.isMe ? 'is-me' : ''}">
            <span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${escapeHtml(p.avatar)} ${escapeHtml(p.isMe ? (isEn ? 'You' : 'Du') : p.nickname)}</span>
            <strong>${p.best.toLocaleString()}</strong>
          </div>`).join('')}`;
    } catch (_) {}
  }

  // Clock offset to the server, measured with a round trip (half of it is transit), so a
  // message that arrives late does not make this phone start late
  let measuredClockOffset = null;
  async function measureClockOffset() {
    let best = null;
    for (let i = 0; i < 3; i++) {
      const sentAt = Date.now();
      try {
        const r = await getServerTime();
        const receivedAt = Date.now();
        const rtt = receivedAt - sentAt;
        if (typeof r?.now === 'number' && (!best || rtt < best.rtt)) {
          best = { rtt, offset: r.now + rtt / 2 - receivedAt };
        }
      } catch (_) {}
    }
    if (best) measuredClockOffset = best.offset;
    return measuredClockOffset;
  }

  // The server says when the round starts; count down to that moment on every phone
  function countdownFromServer(data) {
    if (typeof data.startTime === 'number') {
      if (measuredClockOffset !== null) return { startAtLocal: data.startTime - measuredClockOffset };
      if (typeof data.serverNow === 'number') {
        // Until the offset is measured: assume the message just arrived (refined below)
        return { startAtLocal: data.startTime - (data.serverNow - Date.now()), serverStartTime: data.startTime };
      }
    }
    return { startAtLocal: Date.now() + (data.countdownSec || 3) * 1000 };
  }

  // ── 1. SOLO RESULTS ─────────────────────────────────────
  function showSoloResults(result) {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;
    playWinSound();
    launchConfetti();

    // Reward virtual arcade chips (capped to prevent infinite farming, SB-10)
    const chipsEarned = Math.min(50, Math.max(10, Math.floor(result.score / 100)));
    setChips(getChips() + chipsEarned);

    stage.innerHTML = `
      <div class="card p-lg text-center animate-in">
        <div style="font-size: 3rem; margin-bottom: 8px;">🏆</div>
        <h3 style="font-family: var(--font-heading); color: var(--gold);">${t('arcade.spaceGameOver')}</h3>
        <div id="space-solo-record" class="space-record"></div>
        <p class="text-secondary" style="font-size: 0.85rem;">
          ${isEn ? 'Great flying, Captain!' : 'Grymt flugit, Kapten!'}
        </p>

        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 16px; margin: 16px 0;">
          <div style="font-size: 2.2rem; font-weight: 800; color: #10b981; font-family: monospace;">
            ${result.score.toLocaleString()} PTS
          </div>
          <div class="text-muted" style="font-size: 0.8rem; margin-top: 4px;">
            👾 ${result.aliensKilled} ${isEn ? 'aliens blasted' : 'invasörer besegrade'} · ${isEn ? 'Wave' : 'Våg'} ${result.wave}
          </div>
          <div style="color: var(--gold); font-weight: 700; margin-top: 8px; font-size: 0.85rem;">
            +${chipsEarned} ${isEn ? 'Arcade Chips Earned! 🪙' : 'Arkadmarker intjänade! 🪙'}
          </div>
        </div>

        <div class="flex gap-sm">
          <button type="button" class="btn btn-primary btn-block" id="btn-space-play-again" style="font-weight: 700;">
            🔄 ${isEn ? 'Play Again' : 'Spela igen'}
          </button>
          <button type="button" class="btn btn-secondary" id="btn-space-close">
            ${isEn ? 'Done' : 'Klar'}
          </button>
        </div>
      </div>
    `;

    // Your best counts on the friends' leaderboard
    if (currentUser && soloRoundId) {
      const roundId = soloRoundId;
      soloRoundId = null;
      submitSpaceSoloScore({ roundId, score: result.score, aliensKilled: result.aliensKilled, waveReached: result.wave })
        .then(r => {
          const el = stage.querySelector('#space-solo-record');
          if (!el || !r) return;
          el.innerHTML = r.isNewBest
            ? `🏅 ${isEn ? 'New personal best!' : 'Nytt personligt rekord!'}${r.previousBest ? ` <span class="text-muted">(${isEn ? 'was' : 'förut'} ${r.previousBest.toLocaleString()})</span>` : ''}`
            : `${isEn ? 'Your best' : 'Ditt rekord'}: <strong>${r.best.toLocaleString()}</strong>`;
        })
        .catch(() => {});
    }

    stage.querySelector('#btn-space-play-again')?.addEventListener('click', () => {
      soloGameStarted = true;
      beginSoloRound();
      stage.innerHTML = renderPlayStageHtml();
      initSpaceEngine({
        onGameOver: (res) => {
          soloGameStarted = false;
          showSoloResults(res);
        }
      });
    });

    stage.querySelector('#btn-space-close')?.addEventListener('click', close);
  }

  // ── 2. DUEL LISTENERS ───────────────────────────────────
  function attachDuelListeners() {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;
    stage.querySelector('#btn-switch-to-party')?.addEventListener('click', () => {
      switchTab('party');
    });
  }

  // ── 3. GROUP PARTY LISTENERS ────────────────────────────
  function attachPartyListeners() {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;

    stage.querySelectorAll('.party-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedStake = parseInt(btn.dataset.stake, 10);
        stage.querySelectorAll('.party-stake-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      });
    });

    stage.querySelector('#btn-create-space-party')?.addEventListener('click', async () => {
      try {
        const res = await createPartyRoom({
          gameType: 'space_invaders',
          stakeAmount: selectedStake
        });
        if (res && res.room) {
          partyRoom = res.room;
          setupPartyLobbyView(partyRoom);
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    });

    stage.querySelector('#btn-join-space-party')?.addEventListener('click', async () => {
      const code = (stage.querySelector('#space-party-code-input')?.value || '').trim().toUpperCase();
      if (!code) {
        showToast(isEn ? 'Enter room code' : 'Ange rumskod', 'warning');
        return;
      }
      try {
        const res = await joinPartyRoom({ code });
        if (res && res.room) {
          partyRoom = res.room;
          setupPartyLobbyView(partyRoom);
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  function setupPartyLobbyView(room) {
    partyRoom = room;
    disconnectPartyWs();

    // Establish WebSocket for live room events
    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?party=${room.id}`;

    try {
      partyWs = new WebSocket(wsUrl);
      partyWs.onopen = () => {
        if (token) {
          partyWs.send(JSON.stringify({ type: 'auth', token }));
        }
        partyWs.send(JSON.stringify({ action: 'join_party', partyId: room.id }));
      };
      partyWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleSpacePartyWsMessage(data);
        } catch (_) {}
      };
      partyWs.onclose = () => {
        partyWs = null;
      };
    } catch (_) {}

    renderPartyLobbyView();
  }

  function handleSpacePartyWsMessage(data) {
    if (data.type === 'party_updated' && data.room) {
      partyRoom = data.room;
      // Only the lobby re-renders; never throw pilots out of a round in progress
      if (data.room.status === 'lobby') renderPartyLobbyView();
    } else if ((data.type === 'party_started' || data.type === 'party_sudden_death_start') && data.room) {
      partyRoom = data.room;
      // Only players in the round (all, or the tied ones in a sudden death) fly
      const inRound = data.type === 'party_started'
        || (currentUser && (data.room.tiedPlayerIds || []).includes(currentUser.id));
      if (inRound) runPartyGameStartCountdown(countdownFromServer(data));
      else renderPartyWaitingScreen(null);
    } else if (data.type === 'party_pot_split' && data.room) {
      partyRoom = data.room;
      showPartyResultsView(data.room, true, (data.tiedWinners || []).map(p => p.id), { split: true });
    } else if (data.type === 'party_player_stopped') {
      const waitingStatus = root.querySelector('#space-party-waiting-status');
      if (waitingStatus) {
        waitingStatus.textContent = `${data.stoppedCount} / ${data.totalCount} ${isEn ? 'pilots finished' : 'piloter klara'}`;
      }
    } else if (data.type === 'party_results' && data.room) {
      partyRoom = data.room;
      showPartyResultsView(data.room, data.isTie, data.tiedPlayerIds);
    }
  }

  function renderPartyLobbyView() {
    const stage = root.querySelector('#space-stage-content');
    if (!stage || !partyRoom) return;
    if (measuredClockOffset === null) measureClockOffset();

    const isHost = currentUser && partyRoom.hostId === currentUser.id;
    const totalPot = (partyRoom.players.length || 0) * (partyRoom.stakeAmount || 0);

    stage.innerHTML = `
      <div class="card p-md animate-in">
        <div class="flex-between align-center mb-sm">
          <div>
            <span class="badge badge-accent" style="font-size: 0.7rem;">${t('arcade.blind10WaitingLobby')}</span>
            <h4 style="color: var(--gold); margin-top: 4px;">KOD: <span style="font-family: monospace; font-size: 1.4rem; letter-spacing: 2px;">${escapeHtml(partyRoom.code)}</span></h4>
          </div>
          <div class="text-right">
            <span style="font-size: 0.75rem; color: var(--text-muted);">${t('arcade.blind10TotalPot')}</span>
            <div style="font-size: 1.2rem; font-weight: 800; color: #10b981;">${totalPot} kr</div>
          </div>
        </div>
        ${partyRoom.stakeAmount > 0 ? `
          <div class="text-muted" style="font-size: 0.72rem; margin-top: 8px; line-height: 1.4;">
            ${isEn
              ? '⚖️ Results are checked against the game rules; impossible scores count as 0. Anyone who doesn\'t finish loses their stake.'
              : '⚖️ Resultaten kontrolleras mot spelets regler – omöjliga poäng räknas som 0. Den som inte spelar klart förlorar sin insats.'}
          </div>
        ` : ''}

        <div class="my-md">
          <label class="form-label" style="font-size: 0.8rem; display: block; margin-bottom: 6px;">
            👥 ${t('arcade.blind10PlayersJoined')} (${partyRoom.players.length}):
          </label>
          <div id="space-party-lobby-players" style="display: flex; flex-direction: column; gap: 6px;">
            ${partyRoom.players.map(p => `
              <div class="space-leaderboard-card">
                <span>${escapeHtml(p.nickname || 'Spelare')} ${p.isHost ? '👑' : ''}</span>
                <span class="badge badge-secondary">${p.score !== undefined && p.score !== null ? `${p.score} pts` : (isEn ? 'Ready' : 'Redo')}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="flex gap-sm">
          ${isHost ? `
            <button type="button" class="btn btn-primary btn-block" id="btn-start-space-party-run" style="font-weight: 800; padding: 12px; font-size: 1.05rem;">
              🚀 ${isEn ? 'START 60S BLITZ FOR EVERYONE!' : 'STARTA 60S BLITZ FÖR ALLA!'}
            </button>
          ` : `
            <div class="btn btn-secondary btn-block text-center" style="cursor: default; opacity: 0.85; font-size: 0.85rem; padding: 12px;">
              ⏳ ${isEn ? 'Waiting for host to start...' : 'Väntar på att hosten ska starta...'}
            </div>
          `}
        </div>
      </div>
    `;

    if (isHost) {
      stage.querySelector('#btn-start-space-party-run')?.addEventListener('click', async () => {
        const btn = stage.querySelector('#btn-start-space-party-run');
        if (btn) btn.disabled = true;
        try {
          await startPartyGame(partyRoom.id);
        } catch (err) {
          showToast(err.message || 'Kunde inte starta spelet', 'error');
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function runPartyGameStartCountdown(timing = {}) {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;
    let startAtLocal = typeof timing === 'object' && timing.startAtLocal
      ? timing.startAtLocal
      : Date.now() + (Number(timing) || 3) * 1000;
    // Refine with a measured offset if we did not have one yet
    if (typeof timing === 'object' && timing.serverStartTime) {
      measureClockOffset().then(offset => {
        if (offset !== null) startAtLocal = timing.serverStartTime - offset;
      });
    }
    let sec = Math.max(0, Math.ceil((startAtLocal - Date.now()) / 1000));

    const renderCountdown = () => {
      stage.innerHTML = `
        <div class="card p-lg text-center animate-in" style="min-height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
          <div style="font-size: 1.1rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px;">
            ${isEn ? 'Get Ready!' : 'Gör dig redo!'}
          </div>
          <div style="font-size: 5rem; font-weight: 900; color: var(--gold); font-family: var(--font-heading); margin: 12px 0;">
            ${sec > 0 ? sec : '🚀'}
          </div>
          <div style="font-size: 0.9rem; color: #10b981; font-weight: 700;">
            ${isEn ? '60s Space Blitz starting...' : '60s Space Blitz startar...'}
          </div>
        </div>
      `;
    };

    renderCountdown();
    const countTimer = setInterval(() => {
      const left = startAtLocal - Date.now();
      const nextSec = Math.max(0, Math.ceil(left / 1000));
      if (left > 0) {
        if (nextSec !== sec) { sec = nextSec; renderCountdown(); }
      } else {
        clearInterval(countTimer);
        // Launch canvas engine for synchronized party run!
        stage.innerHTML = renderPlayStageHtml(currentUser ? currentUser.nickname : 'Du');
        initSpaceEngine({
          onGameOver: async (result) => {
            renderPartyWaitingScreen(result);
            try {
              const submitRes = await submitPartyScore(partyRoom.id, {
                score: result.score,
                aliensKilled: result.aliensKilled,
                waveReached: result.wave
              });
              if (submitRes && submitRes.invalidated) {
                showToast(isEn ? 'Your result did not match the game rules and counts as 0 points' : 'Ditt resultat gick inte ihop med spelets regler och räknas som 0 poäng', 'error');
              }
              if (submitRes && submitRes.room) {
                partyRoom = submitRes.room;
                if (partyRoom.status === 'completed' || partyRoom.status === 'tie') {
                  showPartyResultsView(partyRoom, partyRoom.status === 'tie', partyRoom.tiedPlayerIds);
                }
              }
            } catch (err) {
              showToast(err.message || 'Kunde inte skicka resultat', 'error');
            }
          }
        });
      }
    }, 100);
  }

  function renderPartyWaitingScreen(myResult) {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;
    if (!myResult) {
      // Watching a sudden death between the tied players
      stage.innerHTML = `
        <div class="card p-lg text-center animate-in">
          <div style="font-size: 3rem; margin-bottom: 8px;">⚡</div>
          <h3 style="font-family: var(--font-heading); color: var(--gold);">${isEn ? 'Sudden death!' : 'Avgörande omgång!'}</h3>
          <p class="text-secondary" id="space-party-waiting-status" style="font-size: 0.85rem;">
            ${isEn ? 'The tied players fly one more round. Results in about a minute.' : 'De som delade förstaplatsen flyger en omgång till. Resultat om ungefär en minut.'}
          </p>
        </div>`;
      pollForPartyResult();
      return;
    }
    stage.innerHTML = `
      <div class="card p-lg text-center animate-in">
        <div style="font-size: 3rem; margin-bottom: 8px;">🛸</div>
        <h3 style="font-family: var(--font-heading); color: var(--gold);">
          ${isEn ? 'Mission Complete!' : 'Uppdrag Slutfört!'}
        </h3>
        <p class="text-secondary" style="font-size: 0.85rem;">
          ${isEn ? 'You recorded:' : 'Ditt resultat:'}
        </p>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 12px; margin: 12px auto; max-width: 240px;">
          <div style="font-size: 1.8rem; font-weight: 800; color: #10b981; font-family: monospace;">
            ${myResult.score.toLocaleString()} PTS
          </div>
          <div class="text-muted" style="font-size: 0.75rem;">
            👾 ${myResult.aliensKilled} · ${isEn ? 'Wave' : 'Våg'} ${myResult.wave}
          </div>
        </div>
        <div class="my-md">
          <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.2); border-top-color: var(--gold); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 8px;"></div>
          <div id="space-party-waiting-status" style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">
            ${isEn ? 'Waiting for all pilots to finish their 60s mission...' : 'Väntar på att alla piloter ska landa sina skepp...'}
          </div>
        </div>
      </div>
    `;

    pollForPartyResult();
  }

  // Fallback if the live connection dropped: ask the server until the round is decided
  function pollForPartyResult() {
    const roomId = partyRoom?.id;
    if (!roomId) return;
    const poll = setInterval(async () => {
      if (!root.querySelector('#space-party-waiting-status')) {
        clearInterval(poll);
        return;
      }
      try {
        const res = await getPartyRoom(roomId);
        const room = res?.room;
        if (room && (room.status === 'completed' || room.status === 'tie')) {
          clearInterval(poll);
          partyRoom = room;
          showPartyResultsView(room, room.status === 'tie', room.tiedPlayerIds);
        }
      } catch {}
    }, 3000);
  }

  function showPartyResultsView(room, isTie = false, tiedPlayerIds = [], { split = false } = {}) {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;
    playWinSound();
    launchConfetti();

    const sorted = [...(room.results && room.results.length > 0 ? room.results : room.players)].sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = sorted[0];

    if (sorted.length > 0 && sorted.every(p => p.dnf)) {
      stage.innerHTML = `
        <div class="card p-md animate-in text-center">
          <div style="font-size: 2.6rem; margin-bottom: 4px;">⏱️</div>
          <h3 style="color: var(--gold);">${isEn ? 'Nobody finished in time' : 'Ingen blev klar i tid'}</h3>
          <p class="text-muted" style="font-size: 0.85rem;">${isEn ? 'No winner and no debts this round.' : 'Ingen vinnare och inga skulder den här omgången.'}</p>
          <button type="button" class="btn btn-secondary btn-block mt-sm" id="btn-space-party-done">${isEn ? 'Close' : 'Stäng'}</button>
        </div>
      `;
      const resolveTie = async (decision) => {
      stage.querySelectorAll('#btn-space-sudden-death, #btn-space-split-pot').forEach(b => { b.disabled = true; });
      try {
        await resolvePartyTie(room.id, decision);
      } catch (err) {
        showToast(err.message || 'Något gick fel', 'error');
        stage.querySelectorAll('#btn-space-sudden-death, #btn-space-split-pot').forEach(b => { b.disabled = false; });
      }
    };
    stage.querySelector('#btn-space-sudden-death')?.addEventListener('click', () => resolveTie('sudden_death'));
    stage.querySelector('#btn-space-split-pot')?.addEventListener('click', () => resolveTie('split_pot'));

    stage.querySelector('#btn-space-party-done')?.addEventListener('click', close);
      return;
    }
    const isUserWinner = currentUser && winner && winner.id === currentUser.id;
    const isRoomTie = isTie || room.status === 'tie';
    // A tie waits for the host: one more round, or share the pot
    const awaitingHost = isRoomTie && !split && room.status === 'tie';
    const isHostHere = currentUser && room.hostId === currentUser.id;

    stage.innerHTML = `
      <div class="card p-md animate-in text-center">
        <div style="font-size: 2.8rem; margin-bottom: 4px;">${isRoomTie ? '🤝' : '🏆'}</div>
        <h3 style="color: var(--gold); font-family: var(--font-heading);">
          ${isRoomTie
            ? (split ? (isEn ? 'The pot is shared' : 'Potten delas') : (isEn ? 'IT\'S A TIE!' : 'DET BLEV OAVGJORT!'))
            : (isUserWinner ? (isEn ? 'YOU WON THE POT!' : 'DU VANN HELA POTTEN!') : `${escapeHtml(winner.nickname)} ${t('arcade.blind10WinnerWins')}`)}
        </h3>
        <div style="font-size: 1.8rem; font-weight: 800; color: #10b981; margin-bottom: 12px;">
          ${(room.players.length || 0) * (room.stakeAmount || 0)} kr ${isRoomTie && split ? (isEn ? '(shared)' : '(delas)') : ''}
        </div>

        <div class="my-md text-left">
          ${sorted.map((p, idx) => {
            const isPlayerTieWinner = isRoomTie && Array.isArray(tiedPlayerIds) && tiedPlayerIds.includes(p.id);
            return `
              <div class="space-leaderboard-card ${idx === 0 && !isRoomTie ? 'winner' : (isPlayerTieWinner ? 'winner' : '')}">
                <div class="flex gap-xs align-center">
                  <span style="font-weight: 800; color: ${idx === 0 ? 'var(--gold)' : 'var(--text-muted)'}; min-width: 24px;">#${p.rank || idx + 1}</span>
                  <span>${escapeHtml(p.nickname || 'Spelare')} ${idx === 0 && !isRoomTie ? '👑' : (isPlayerTieWinner ? '🤝' : '')}</span>
                </div>
                <span style="font-family: monospace; font-weight: 700; color: ${p.invalidated || p.dnf ? '#f87171' : '#10b981'};">
                  ${p.dnf
                    ? (isEn ? 'DNF' : 'Ej klar')
                    : p.invalidated
                      ? (isEn ? '⚠️ Invalid result' : '⚠️ Ogiltigt resultat')
                      : `${(p.score || 0).toLocaleString()} PTS`}
                </span>
              </div>
            `;
          }).join('')}
        </div>

        ${awaitingHost ? (isHostHere ? `
          <div class="my-md">
            <div class="text-muted" style="font-size: 0.82rem; margin-bottom: 8px;">${isEn ? 'You are the host – decide the tie:' : 'Du är värd – avgör oavgjort:'}</div>
            <button type="button" class="btn btn-primary btn-block" id="btn-space-sudden-death" style="font-weight: 800;">⚡ ${isEn ? 'Sudden death round' : 'Avgörande omgång'}</button>
            <button type="button" class="btn btn-secondary btn-block mt-sm" id="btn-space-split-pot">🤝 ${isEn ? 'Share the pot' : 'Dela potten'}</button>
          </div>
        ` : `
          <div class="my-md text-muted" style="font-size: 0.85rem;">⏳ ${isEn ? 'Waiting for the host to decide the tie…' : 'Väntar på att värden avgör oavgjort…'}</div>
        `) : ''}

        ${!isRoomTie && room.stakeAmount > 0 && !isUserWinner ? `
          <div class="my-md">
            <div class="text-muted" style="font-size: 0.82rem; margin-bottom: 6px;">${isEn ? `You owe ${escapeHtml(winner.nickname)} ${room.stakeAmount} kr – it is on The Tab.` : `Du är skyldig ${escapeHtml(winner.nickname)} ${room.stakeAmount} kr – det ligger på THE TAB.`}</div>
            <button type="button" class="btn btn-secondary btn-block btn-space-goto-tab">${isEn ? 'Pay under The Tab →' : 'Betala under THE TAB →'}</button>
          </div>
        ` : ''}

        ${!awaitingHost && !isUserWinner && winner ? `
          <div class="my-sm">
            <button type="button" class="btn btn-warning btn-block animate-pulse" id="btn-space-party-rematch" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-weight: 800; padding: 12px; font-size: 0.95rem; border: none; border-radius: 12px; box-shadow: 0 4px 15px rgba(245,158,11,0.35);">
              🔥 REVANSCH! (Utmana ${escapeHtml(winner.nickname)} igen)
            </button>
          </div>
        ` : ''}

        <button type="button" class="btn btn-secondary btn-block mt-sm" id="btn-space-party-done">
          ${isEn ? 'Close' : 'Stäng'}
        </button>
      </div>
    `;

    stage.querySelector('#btn-space-party-rematch')?.addEventListener('click', async () => {
      const btn = stage.querySelector('#btn-space-party-rematch');
      if (btn) btn.disabled = true;
      try {
        const newRoomRes = await createPartyRoom({
          gameType: room.gameType,
          stakeAmount: room.stakeAmount || 0
        });
        if (newRoomRes && newRoomRes.room) {
          partyRoom = newRoomRes.room;
          showToast('🔥 Revansch-rum skapat! Bjuder in...', 'success');
          if (winner && winner.id) {
            inviteToParty(partyRoom.id, winner.id).catch(() => {});
          }
          renderPartyLobbyView();
        }
      } catch (err) {
        showToast(err.message || 'Kunde inte starta revansch', 'error');
        if (btn) btn.disabled = false;
      }
    });

    const resolveTie = async (decision) => {
      stage.querySelectorAll('#btn-space-sudden-death, #btn-space-split-pot').forEach(b => { b.disabled = true; });
      try {
        await resolvePartyTie(room.id, decision);
      } catch (err) {
        showToast(err.message || 'Något gick fel', 'error');
        stage.querySelectorAll('#btn-space-sudden-death, #btn-space-split-pot').forEach(b => { b.disabled = false; });
      }
    };
    stage.querySelector('#btn-space-sudden-death')?.addEventListener('click', () => resolveTie('sudden_death'));
    stage.querySelector('#btn-space-split-pot')?.addEventListener('click', () => resolveTie('split_pot'));

    stage.querySelector('#btn-space-party-done')?.addEventListener('click', close);
  }

  // ── 4. PASS & PLAY (TABLE MODE) ─────────────────────────
  function attachPassListeners() {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;

    stage.querySelectorAll('.pass-stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedStake = parseInt(btn.dataset.stake, 10);
        stage.querySelectorAll('.pass-stake-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      });
    });

    stage.querySelectorAll('.space-pass-name').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        passPlayers[idx] = e.target.value.trim() || `Spelare ${idx + 1}`;
      });
    });

    stage.querySelectorAll('.space-remove-pass-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (passPlayers.length > 2) {
          passPlayers.splice(idx, 1);
          stage.innerHTML = renderPassSetupHtml();
          attachPassListeners();
        }
      });
    });

    stage.querySelector('#btn-add-space-pass-player')?.addEventListener('click', () => {
      if (passPlayers.length < 8) {
        passPlayers.push(isEn ? `Player ${passPlayers.length + 1}` : `Spelare ${passPlayers.length + 1}`);
        stage.innerHTML = renderPassSetupHtml();
        attachPassListeners();
      }
    });

    stage.querySelector('#btn-start-pass-game')?.addEventListener('click', () => {
      passCurrentIndex = 0;
      passScores = [];
      runPassTurn();
    });
  }

  function runPassTurn() {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;

    const currentPlayerName = passPlayers[passCurrentIndex];

    stage.innerHTML = `
      <div class="card p-lg text-center animate-in">
        <span class="badge badge-accent mb-sm">${isEn ? `Turn ${passCurrentIndex + 1} of ${passPlayers.length}` : `Runda ${passCurrentIndex + 1} av ${passPlayers.length}`}</span>
        <h3 style="font-family: var(--font-heading); color: var(--gold); font-size: 1.5rem; margin-bottom: 8px;">
          📱 ${escapeHtml(currentPlayerName)}
        </h3>
        <p class="text-secondary" style="font-size: 0.9rem; margin-bottom: 20px;">
          ${isEn ? 'Pass the phone! Tap start when you are ready for your 60s Blitz wave.' : 'Ge telefonen till spelaren! Tryck start när du är redo för din 60s Blitz.'}
        </p>

        <button type="button" class="btn btn-primary btn-block" id="btn-pass-turn-start" style="font-weight: 800; padding: 14px; font-size: 1.1rem;">
          🚀 ${t('arcade.spaceStartBtn')}
        </button>
      </div>
    `;

    stage.querySelector('#btn-pass-turn-start')?.addEventListener('click', () => {
      stage.innerHTML = renderPlayStageHtml(currentPlayerName);
      initSpaceEngine({
        onGameOver: (result) => {
          passScores.push({
            name: currentPlayerName,
            score: result.score,
            aliensKilled: result.aliensKilled,
            wave: result.wave
          });

          passCurrentIndex++;
          if (passCurrentIndex < passPlayers.length) {
            runPassTurn();
          } else {
            showPassFinalResults();
          }
        }
      });
    });
  }

  function showPassFinalResults() {
    const stage = root.querySelector('#space-stage-content');
    if (!stage) return;
    playWinSound();
    launchConfetti();

    const sorted = [...passScores].sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    const pot = passScores.length * selectedStake;

    stage.innerHTML = `
      <div class="card p-md animate-in text-center">
        <div style="font-size: 3rem; margin-bottom: 4px;">👑</div>
        <h3 style="color: var(--gold); font-family: var(--font-heading);">
          ${escapeHtml(winner.name)} ${isEn ? 'WINS THE TABLE BATTLE!' : 'VANN BORDSKAMPEN!'}
        </h3>
        ${selectedStake > 0 ? `
          <div style="font-size: 1.8rem; font-weight: 800; color: #10b981; margin-bottom: 12px;">
            ${pot} kr i potten!
          </div>
        ` : ''}

        <div class="my-md text-left">
          ${sorted.map((p, idx) => `
            <div class="space-leaderboard-card ${idx === 0 ? 'winner' : ''}">
              <div class="flex gap-xs align-center">
                <span style="font-weight: 800; color: ${idx === 0 ? 'var(--gold)' : 'var(--text-muted)'}; min-width: 24px;">#${idx + 1}</span>
                <span>${escapeHtml(p.name)} ${idx === 0 ? '🏆' : ''}</span>
              </div>
              <span style="font-family: monospace; font-weight: 700; color: #10b981;">
                ${p.score.toLocaleString()} PTS
              </span>
            </div>
          `).join('')}
        </div>

        <div class="flex gap-sm mt-md">
          <button type="button" class="btn btn-primary btn-block" id="btn-pass-rematch" style="font-weight: 700;">
            🔄 ${isEn ? 'Rematch!' : 'Kör om!'}
          </button>
          <button type="button" class="btn btn-secondary" id="btn-pass-close">
            ${isEn ? 'Done' : 'Klar'}
          </button>
        </div>
      </div>
    `;

    stage.querySelector('#btn-pass-rematch')?.addEventListener('click', () => {
      passCurrentIndex = 0;
      passScores = [];
      runPassTurn();
    });

    stage.querySelector('#btn-pass-close')?.addEventListener('click', close);
  }

  // Initial tab setup
  attachTabs();
  attachStageListeners();

  // ── 5. CANVAS RETRO SPACE INVADERS ENGINE ─────────────────
  function initSpaceEngine({ onGameOver }) {
    if (activeSpaceEngineCleanup) {
      activeSpaceEngineCleanup();
      activeSpaceEngineCleanup = null;
    }

    const canvas = root.querySelector('#space-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const width = 320;
    const height = 300;
    // Draw at the screen's real pixel density so the game is sharp on iPhone
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    let score = 0;
    let wave = 1;
    let lives = 3;
    let timeLeft = 60; // 60s Blitz
    let aliensKilled = 0;
    let isRunning = true;
    let animId = null;
    let timerInterval = null;
    let fireInterval = null;

    // Player ship
    const player = {
      x: width / 2 - 14,
      y: height - 26,
      w: 28,
      h: 18,
      speed: 6.0,
      isMovingLeft: false,
      isMovingRight: false,
      lastShotTime: 0
    };

    // Projectiles
    let bullets = [];
    let alienBullets = [];
    let particles = [];

    // Mystery UFO
    let ufo = null;
    let nextUfoTime = Date.now() + 12000;

    // Aliens grid
    let aliens = [];
    let alienDirection = 1;
    let alienMoveTimer = 0;
    let alienMoveInterval = 35; // frames

    function spawnAliens() {
      aliens = [];
      const rows = 4;
      const cols = 7;
      const startX = 28;
      const startY = 30;
      const spacingX = 38;
      const spacingY = 22;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let points = 10;
          let color = '#10b981'; // green bottom
          if (r === 0) { points = 30; color = '#f59e0b'; } // yellow top
          else if (r === 1 || r === 2) { points = 20; color = '#3b82f6'; } // blue middle

          aliens.push({
            x: startX + c * spacingX,
            y: startY + r * spacingY,
            w: 22,
            h: 16,
            points,
            color,
            row: r
          });
        }
      }
      alienDirection = 1;
      alienMoveInterval = Math.max(12, 35 - wave * 4);
    }

    // Shield bunkers (3 bunkers)
    let shields = [];
    function spawnShields() {
      shields = [];
      const numShields = 3;
      const shieldW = 44;
      const shieldH = 18;
      const spacing = (width - numShields * shieldW) / (numShields + 1);

      for (let i = 0; i < numShields; i++) {
        shields.push({
          x: spacing + i * (shieldW + spacing),
          y: height - 56,
          w: shieldW,
          h: shieldH,
          hp: 8
        });
      }
    }

    function fireBullet() {
      if (!isRunning) return;
      const now = Date.now();
      if (now - player.lastShotTime < 220) return; // rate limit
      player.lastShotTime = now;
      bullets.push({
        x: player.x + player.w / 2 - 2,
        y: player.y - 6,
        w: 4,
        h: 10,
        speed: 7
      });
      playLaserSound();
    }

    function spawnExplosion(x, y, color = '#10b981', count = 12) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3.5;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 18 + Math.random() * 10,
          maxLife: 28,
          color
        });
      }
    }

    // Keyboard controls (Arrow keys, WASD, Space, Enter)
    const handleKeyDown = (e) => {
      const code = e.code || '';
      const key = e.key || '';
      if (code === 'ArrowLeft' || key === 'ArrowLeft' || key === 'Left' || code === 'KeyA' || key === 'a' || key === 'A') {
        e.preventDefault();
        player.isMovingLeft = true;
      }
      if (code === 'ArrowRight' || key === 'ArrowRight' || key === 'Right' || code === 'KeyD' || key === 'd' || key === 'D') {
        e.preventDefault();
        player.isMovingRight = true;
      }
      if (code === 'Space' || key === ' ' || key === 'Spacebar' || code === 'ArrowUp' || key === 'ArrowUp' || code === 'KeyW' || key === 'w' || key === 'W' || code === 'Enter' || key === 'Enter') {
        e.preventDefault();
        fireBullet();
      }
    };
    const handleKeyUp = (e) => {
      const code = e.code || '';
      const key = e.key || '';
      if (code === 'ArrowLeft' || key === 'ArrowLeft' || key === 'Left' || code === 'KeyA' || key === 'a' || key === 'A') {
        e.preventDefault();
        player.isMovingLeft = false;
      }
      if (code === 'ArrowRight' || key === 'ArrowRight' || key === 'Right' || code === 'KeyD' || key === 'd' || key === 'D') {
        e.preventDefault();
        player.isMovingRight = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // On-screen Button Controls (Left, Right, Fire)
    const btnLeft = root.querySelector('#btn-space-left');
    const btnRight = root.querySelector('#btn-space-right');
    const btnFire = root.querySelector('#btn-space-fire');

    const startMovingLeft = (e) => {
      if (e) e.preventDefault();
      player.x = Math.max(6, player.x - 18);
      player.isMovingLeft = true;
    };
    const stopMovingLeft = (e) => {
      if (e) e.preventDefault();
      player.isMovingLeft = false;
    };

    const startMovingRight = (e) => {
      if (e) e.preventDefault();
      player.x = Math.min(width - player.w - 6, player.x + 18);
      player.isMovingRight = true;
    };
    const stopMovingRight = (e) => {
      if (e) e.preventDefault();
      player.isMovingRight = false;
    };

    const startFiring = (e) => {
      if (e) e.preventDefault();
      fireBullet();
      if (!fireInterval) {
        fireInterval = setInterval(fireBullet, 220);
      }
    };
    const stopFiring = (e) => {
      if (e) e.preventDefault();
      if (fireInterval) {
        clearInterval(fireInterval);
        fireInterval = null;
      }
    };

    const bindControlBtn = (btn, onStart, onEnd) => {
      if (!btn) return;
      btn.addEventListener('pointerdown', (e) => {
        try { btn.setPointerCapture?.(e.pointerId); } catch (_) {}
        onStart(e);
      });
      btn.addEventListener('pointerup', (e) => {
        try { btn.releasePointerCapture?.(e.pointerId); } catch (_) {}
        onEnd(e);
      });
      btn.addEventListener('pointercancel', onEnd);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    bindControlBtn(btnLeft, startMovingLeft, stopMovingLeft);
    bindControlBtn(btnRight, startMovingRight, stopMovingRight);
    bindControlBtn(btnFire, startFiring, stopFiring);
    btnFire?.addEventListener('click', (e) => {
      e.preventDefault();
      fireBullet();
    });

    // Direct touch-slide & mouse dragging on canvas
    let isPointerDragging = false;
    const updateShipPositionFromPointer = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = width / rect.width;
      const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : width / 2);
      const touchX = (clientX - rect.left) * scaleX;
      player.x = Math.max(6, Math.min(width - player.w - 6, touchX - player.w / 2));
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isPointerDragging = true;
      try { canvas.setPointerCapture?.(e.pointerId); } catch (_) {}
      updateShipPositionFromPointer(e);
      fireBullet();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (isPointerDragging) {
        e.preventDefault();
        updateShipPositionFromPointer(e);
      }
    });

    const stopCanvasPointer = (e) => {
      if (!isPointerDragging) return;
      isPointerDragging = false;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', stopCanvasPointer);
    canvas.addEventListener('pointercancel', stopCanvasPointer);

    // HUD update helper
    const updateHud = () => {
      const scoreEl = root.querySelector('#space-score-val');
      const timerEl = root.querySelector('#space-timer-val');
      const livesEl = root.querySelector('#space-lives-val');
      if (scoreEl) scoreEl.textContent = score.toLocaleString();
      if (timerEl) timerEl.textContent = `${timeLeft}s`;
      if (livesEl) livesEl.textContent = '❤️'.repeat(Math.max(0, lives));
    };

    // 60-second Blitz countdown (monotonic timestamp-based to prevent timer-throttling drift)
    const missionDurationMs = 60000;
    const missionStartTime = Date.now();
    const missionEndTime = missionStartTime + missionDurationMs;

    timerInterval = setInterval(() => {
      if (!isRunning) return;
      const remainingSec = Math.max(0, Math.ceil((missionEndTime - Date.now()) / 1000));
      timeLeft = remainingSec;
      updateHud();
      if (timeLeft <= 0) {
        endGame();
      }
    }, 250);

    function stopEngine() {
      isRunning = false;
      if (animId) cancelAnimationFrame(animId);
      if (timerInterval) clearInterval(timerInterval);
      if (fireInterval) clearInterval(fireInterval);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    }
    activeSpaceEngineCleanup = stopEngine;

    function endGame() {
      stopEngine();
      activeSpaceEngineCleanup = null;
      onGameOver({
        score,
        wave,
        aliensKilled
      });
    }

    // Hit feedback: the arcade frame shakes; phones that allow it (Android) also vibrate.
    // iPhone does not let web apps vibrate.
    const bezel = canvas.closest('.space-arcade-bezel');
    function vibrate(ms) {
      try { navigator.vibrate?.(ms); } catch (_) {}
    }
    function hitFeedback(ms) {
      vibrate(ms);
      if (!bezel) return;
      bezel.classList.remove('space-shake');
      void bezel.offsetWidth;
      bezel.classList.add('space-shake');
    }

    // Init game world
    spawnAliens();
    spawnShields();

    // Game loop. Movement is scaled by the real frame time, so a 120 Hz iPhone, a slow
    // phone and a laptop all play at the same speed (it matters when money is at stake)
    let lastFrameAt = null;
    function loop(ts) {
      if (!isRunning) return;
      const now = typeof ts === 'number' ? ts : performance.now();
      const dt = lastFrameAt === null ? 1 : Math.min(3, (now - lastFrameAt) / (1000 / 60));
      lastFrameAt = now;

      // 1. UPDATE PLAYER
      if (player.isMovingLeft) player.x -= player.speed * dt;
      if (player.isMovingRight) player.x += player.speed * dt;
      player.x = Math.max(6, Math.min(width - player.w - 6, player.x));

      // 2. UPDATE BULLETS
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.y -= b.speed * dt;
        if (b.y < -10) {
          bullets.splice(i, 1);
          continue;
        }

        // Check alien hits
        let hitAlien = false;
        for (let j = aliens.length - 1; j >= 0; j--) {
          const a = aliens[j];
          if (b.x + b.w >= a.x && b.x <= a.x + a.w && b.y <= a.y + a.h && b.y + b.h >= a.y) {
            score += a.points;
            aliensKilled++;
            vibrate(12);
            spawnExplosion(a.x + a.w / 2, a.y + a.h / 2, a.color);
            playExplosionSound();
            aliens.splice(j, 1);
            hitAlien = true;
            updateHud();
            break;
          }
        }
        if (hitAlien) {
          bullets.splice(i, 1);
          continue;
        }

        // Check UFO hit
        if (ufo && b.x + b.w >= ufo.x && b.x <= ufo.x + ufo.w && b.y <= ufo.y + ufo.h && b.y + b.h >= ufo.y) {
          score += 200;
          spawnExplosion(ufo.x + ufo.w / 2, ufo.y + ufo.h / 2, '#fbbf24', 24);
          playWinSound();
          showToast(t('arcade.spaceUfoBonus'), 'success');
          ufo = null;
          bullets.splice(i, 1);
          updateHud();
          continue;
        }

        // Check shield hits
        for (const s of shields) {
          if (s.hp > 0 && b.x + b.w >= s.x && b.x <= s.x + s.w && b.y <= s.y + s.h && b.y + b.h >= s.y) {
            s.hp--;
            bullets.splice(i, 1);
            break;
          }
        }
      }

      // 3. UPDATE ALIEN BULLETS
      for (let i = alienBullets.length - 1; i >= 0; i--) {
        const ab = alienBullets[i];
        ab.y += ab.speed * dt;
        if (ab.y > height + 10) {
          alienBullets.splice(i, 1);
          continue;
        }

        // Hit player
        if (ab.x + ab.w >= player.x && ab.x <= player.x + player.w && ab.y + ab.h >= player.y && ab.y <= player.y + player.h) {
          alienBullets.splice(i, 1);
          lives--;
          hitFeedback(140);
          spawnExplosion(player.x + player.w / 2, player.y + player.h / 2, '#ef4444', 20);
          playExplosionSound();
          updateHud();
          if (lives <= 0) {
            endGame();
            return;
          }
          continue;
        }

        // Hit shields
        for (const s of shields) {
          if (s.hp > 0 && ab.x + ab.w >= s.x && ab.x <= s.x + s.w && ab.y <= s.y + s.h && ab.y + ab.h >= s.y) {
            s.hp--;
            alienBullets.splice(i, 1);
            break;
          }
        }
      }

      // 4. UPDATE ALIENS GRID
      alienMoveTimer += dt;
      if (alienMoveTimer >= alienMoveInterval) {
        alienMoveTimer = 0;
        let edgeHit = false;

        for (const a of aliens) {
          if ((alienDirection > 0 && a.x + a.w >= width - 12) || (alienDirection < 0 && a.x <= 12)) {
            edgeHit = true;
            break;
          }
        }

        if (edgeHit) {
          alienDirection = -alienDirection;
          for (const a of aliens) {
            a.y += 12;
            if (a.y + a.h >= player.y) {
              lives = 0;
              endGame();
              return;
            }
          }
        } else {
          for (const a of aliens) {
            a.x += alienDirection * 10;
          }
        }

        // Alien vs Bunker / Shield collision (Classic arcade mechanic: aliens trample and destroy bunkers on contact)
        for (const a of aliens) {
          for (const s of shields) {
            if (s.hp > 0 && a.x + a.w >= s.x && a.x <= s.x + s.w && a.y + a.h >= s.y && a.y <= s.y + s.h) {
              s.hp = Math.max(0, s.hp - 3);
              spawnExplosion(a.x + a.w / 2, s.y + s.h / 2, '#10b981', 6);
              playExplosionSound();
              if (s.hp <= 0) {
                spawnExplosion(s.x + s.w / 2, s.y + s.h / 2, '#10b981', 14);
              }
            }
          }
        }

        // The pressure rises through the 60 seconds and with every wave
        const elapsedShare = Math.min(1, (Date.now() - missionStartTime) / missionDurationMs);
        const fireChance = Math.min(0.7, 0.3 + elapsedShare * 0.25 + (wave - 1) * 0.05);
        if (aliens.length > 0 && Math.random() < fireChance) {
          const shooter = aliens[Math.floor(Math.random() * aliens.length)];
          alienBullets.push({
            x: shooter.x + shooter.w / 2 - 1.5,
            y: shooter.y + shooter.h + 2,
            w: 3,
            h: 8,
            speed: 3.2 + elapsedShare * 1.6 + (wave - 1) * 0.3
          });
        }
      }

      if (aliens.length === 0) {
        wave++;
        score += 300;
        spawnAliens();
        playWinSound();
        showToast(isEn ? `🌊 Wave ${wave}! +300 bonus` : `🌊 Våg ${wave}! +300 i bonus`, 'success');
        updateHud();
      }

      // 5. MYSTERY UFO
      if (!ufo && Date.now() > nextUfoTime) {
        ufo = {
          x: -30,
          y: 18,
          w: 28,
          h: 12,
          speed: 2.2
        };
        playUfoSound();
        nextUfoTime = Date.now() + 18000 + Math.random() * 10000;
      }

      if (ufo) {
        ufo.x += ufo.speed * dt;
        if (ufo.x > width + 40) {
          ufo = null;
        }
      }

      // 6. UPDATE PARTICLES
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }

      // ── DRAWING ──────────────────────────────────────────
      ctx.fillStyle = '#060814';
      ctx.fillRect(0, 0, width, height);

      // Starfield
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      for (let s = 0; s < 25; s++) {
        const sx = (s * 37 + wave * 5) % width;
        const sy = (s * 43) % height;
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }

      // Draw Shields (Classic arcade bunkers with erosion)
      for (const s of shields) {
        if (s.hp > 0) {
          const alpha = Math.max(0.25, s.hp / 8);
          ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
          ctx.fillRect(s.x, s.y, s.w, s.h);

          // Classic arch cutout at bottom center
          ctx.fillStyle = '#060814';
          ctx.fillRect(s.x + s.w / 2 - 7, s.y + s.h - 8, 14, 8);

          // Damage erosion marks if damaged
          if (s.hp < 7) {
            ctx.fillRect(s.x + 4, s.y + 2, 6, 4);
          }
          if (s.hp < 5) {
            ctx.fillRect(s.x + s.w - 10, s.y + 4, 6, 5);
            ctx.fillRect(s.x + s.w / 2 - 3, s.y, 6, 5);
          }
          if (s.hp < 3) {
            ctx.fillRect(s.x + 8, s.y + 8, 8, 6);
            ctx.fillRect(s.x + s.w - 16, s.y + 6, 8, 6);
          }

          ctx.strokeStyle = `rgba(16, 185, 129, ${alpha + 0.2})`;
          ctx.strokeRect(s.x, s.y, s.w, s.h);
        }
      }

      // Draw Aliens
      for (const a of aliens) {
        ctx.fillStyle = a.color;
        ctx.fillRect(a.x + 3, a.y, a.w - 6, a.h);
        ctx.fillRect(a.x, a.y + 4, a.w, a.h - 6);
        ctx.fillStyle = '#000';
        ctx.fillRect(a.x + 5, a.y + 5, 3, 3);
        ctx.fillRect(a.x + a.w - 8, a.y + 5, 3, 3);
      }

      // Draw UFO
      if (ufo) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.ellipse(ufo.x + ufo.w / 2, ufo.y + ufo.h / 2, ufo.w / 2, ufo.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(ufo.x + ufo.w / 2 - 4, ufo.y - 2, 8, 4);
      }

      // Draw Player Ship
      ctx.fillStyle = '#10b981';
      ctx.fillRect(player.x + player.w / 2 - 3, player.y - 5, 6, 6);
      ctx.fillRect(player.x + 4, player.y, player.w - 8, player.h - 4);
      ctx.fillRect(player.x, player.y + player.h - 6, player.w, 6);

      // Draw Bullets
      ctx.fillStyle = '#38bdf8';
      for (const b of bullets) {
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }

      // Draw Alien Bullets
      ctx.fillStyle = '#ef4444';
      for (const ab of alienBullets) {
        ctx.fillRect(ab.x, ab.y, ab.w, ab.h);
      }

      // Draw Particles
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillRect(p.x, p.y, 2.5, 2.5);
        ctx.globalAlpha = 1.0;
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
  }
}

// ── 13. Is it a Gimme? ⛳️ (Live AR Golf Putt Checker) ─────────────
export async function openGimmeModal() {
  const isEn = getLang() === 'en';
  let videoStream = null;
  let animFrameId = null;
  let customGimmeCm = 60; // Standard gimme distance: 60 cm (approx putter grip)
  let isFrozen = false;
  let verdictState = null; // 'approved' | 'denied'
  let activeFallbackImg = null;

  // Betting state
  let activeBet = null; // { mode: 'free' | 'swish', stake: 20, p1: 'Kalle', p2: 'Johan', p1Phone: '', p2Phone: '' }
  let selectedBetMode = 'free';
  let selectedStake = 20;
  let userFriends = [];
  let selectedFriend = null;

  // Auto-Vision & Lock-on state
  let detectedHole = null; // { x, y, radiusPx, confidence }
  let detectedBall = null; // { x, y, confidence }
  let isHoleLocked = false;
  let lockSoundPlayed = false;
  let manualBallTarget = null; // { x, y } if user manually taps screen
  let lastVisionScanTime = 0;
  let measuredDistanceCm = null;
  let verdictMethod = 'auto'; // 'auto' | 'manual' – recorded in share text

  // Resource tracking
  let sessionToken = Symbol('gimme-session'); // Fix: async camera race guard
  let currentObjectUrl = null;               // Fix: object URL leak prevention
  let visionErrorCount = 0;                  // Fix: rate-limited vision error logging

  // Cleanup helper declared before modal creation
  const cleanup = () => {
    sessionToken = Symbol('disposed');        // invalidate any pending getUserMedia
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);  // free object URL memory
      currentObjectUrl = null;
    }
    isFrozen = true;
  };

  // Hidden vision processing canvas (low resolution for 60fps performance)
  const visionCanvas = document.createElement('canvas');
  visionCanvas.width = 160;
  visionCanvas.height = 120;
  const visionCtx = visionCanvas.getContext('2d', { willReadFrequently: true });

  // Funny roast quotes
  const approvedRoastsSv = [
    'Plocka upp bollen innan du skämmer ut dig! 🏆',
    'Gimme godkänd! Till och med farmor sätter den där med förbundna ögon. 👵',
    'Godkänd! Men bara för att vi ska hinna till 19:e hålet innan ölen blir ljummen. 🍻',
    'Gimme! Rädda ditt ego medan du fortfarande har chansen. 😉',
    'Den är så given att bollen praktiskt taget redan ligger i koppen! ⛳️',
    'Gimme! Men du är skyldig bollen en öl i klubbhuset. 🏌️'
  ];

  const approvedRoastsEn = [
    'Pick it up before you embarrass yourself! 🏆',
    'Gimme granted! Even grandma drains that blindfolded. 👵',
    'Approved! But only so we get to the 19th hole before the beers get warm. 🍻',
    'Gimme! Save your dignity while you still have some left. 😉',
    'That is so good the ball is practically already swimming in the cup! ⛳️'
  ];

  const deniedRoastsSv = [
    'PUTTA DIN FEGIS! Det där är ingen gimme på den här touren! 😈',
    'Glöm det! Ner med blicken, böj på knäna och gör jobbet! 🏌️‍♂️',
    'Kanske en gimme om du spelar på Gröna Lund. Putta nu! 🎡',
    'Försöker du fuska nu igen? Hela bollen skriker: PUTTA! 🚨',
    'Ingen gratis fika här inte! Lägg ner puttern och visa vad du går för! 🔥',
    'Hahaha nej! Den där putten vill hela bollen se dig darra på! 🥶'
  ];

  const deniedRoastsEn = [
    'PUTT IT, COWARD! That is not a gimme on this tour! 😈',
    'Nice try! Eyes down, knees bent, finish the job! 🏌️‍♂️',
    'Maybe a gimme at miniature golf. Putt it! 🎡',
    'Are you trying to cheat again? Everyone wants to see you shake! 🥶',
    'No free rides today! Show us what you got! 🔥'
  ];

  const modalTitle = `<img src="/golf-gimme.png" alt="Gimme" style="width: 28px; height: 24px; object-fit: contain; vertical-align: -4px; margin-right: 6px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));" />${t('arcade.gimmeTitle')}`;

  const contentHtml = `
    <div class="gimme-modal-container" style="max-width: 480px; margin: 0 auto; text-align: center; user-select: none;">
      <p class="game-modal-subheading">${t('arcade.gimmeDesc')}</p>
      
      <!-- Top instructions & quick settings -->
      <div class="flex justify-between items-center mb-sm" style="background: rgba(255,255,255,0.04); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 8px 12px; flex-wrap: wrap; gap: 8px;">
        <div style="text-align: left; flex: 1 1 140px; min-width: 0;">
          <div style="font-weight: 700; font-size: 0.85rem; color: var(--gold);">
            ⛳️ ${isEn ? 'AR Putt Referee' : 'Live AR-Domare'}
          </div>
          <div style="font-size: 0.72rem; color: rgba(255,255,255,0.6);">
            ${isEn ? 'Official cup diameter: 10.8 cm' : 'Hålets officiella mått: 10,8 cm'}
          </div>
        </div>

        <div class="flex gap-xs items-center" style="flex-wrap: wrap; flex-shrink: 0;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-gimme-bet" style="font-size: 0.75rem; padding: 4px 8px; border-color: #fbbf24; color: #fbbf24; font-weight: 700; white-space: nowrap;">
            💰 ${isEn ? 'Bet' : 'Betta'}
          </button>
          <span style="font-size: 0.75rem; color: rgba(255,255,255,0.7); white-space: nowrap;">${isEn ? 'Limit:' : 'Gräns:'}</span>
          <select id="gimme-dist-select" style="background: rgba(0,0,0,0.6); color: #10b981; border: 1px solid #10b981; border-radius: 6px; padding: 2px 6px; font-size: 0.8rem; font-weight: 700; cursor: pointer;">
            <option value="45">${isEn ? '45 cm (Strict)' : '45 cm (Strikt)'}</option>
            <option value="60" selected>${isEn ? '60 cm (Standard)' : '60 cm (Standard)'}</option>
            <option value="75">${isEn ? '75 cm (Generous)' : '75 cm (Snäll)'}</option>
            <option value="90">${isEn ? '90 cm (Putter)' : '90 cm (Putter)'}</option>
          </select>
        </div>
      </div>

      <!-- Active Bet Banner (if bet is ongoing) -->
      <div id="gimme-active-bet-banner" style="display: none; background: linear-gradient(135deg, rgba(251,191,36,0.15), rgba(16,185,129,0.15)); border: 1px solid #fbbf24; border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; font-size: 0.78rem; text-align: left;">
        <div class="flex justify-between items-center">
          <span style="font-weight: 700; color: #fbbf24;" id="gimme-bet-info-header">${isEn ? '🎯 ACTIVE BET: 50 kr' : '🎯 AKTIVT BET: 50 kr'}</span>
          <button type="button" id="btn-cancel-gimme-bet" style="background: none; border: none; color: rgba(255,255,255,0.5); font-size: 0.85rem; cursor: pointer;">✕</button>
        </div>
        <div style="font-size: 0.72rem; color: #fff; margin-top: 2px;" id="gimme-bet-info-players">
          ${isEn ? 'Player 1 (Gimme) vs Player 2 (Putt)' : 'Spelare 1 (Gimme) vs Spelare 2 (Putt)'}
        </div>
      </div>

      <!-- Gimme Bet Setup Drawer (Collapsible) -->
      <div id="gimme-bet-drawer" style="display: none; background: rgba(18,22,34,0.95); border: 1px solid #fbbf24; border-radius: 10px; padding: 12px; margin-bottom: 10px; text-align: left;">
        <div style="font-weight: 700; font-size: 0.88rem; color: #fbbf24; margin-bottom: 4px;">
          ⛳️ ${isEn ? 'Place a Gimme Bet on Tee!' : 'Lägg ett Gimme-Bet på Tee!'}
        </div>
        <p style="font-size: 0.75rem; color: rgba(255,255,255,0.7); margin-bottom: 10px; line-height: 1.3;">
          ${isEn ? 'Did someone hit it close? Bet before walking to the green!' : 'Slår polaren nära flaggan? Betta innan ni går fram till green!'}
        </p>

        <!-- Bet Mode: Gratis / Äran vs Swish -->
        <div class="flex gap-xs mb-sm">
          <button type="button" class="btn btn-sm active" id="btn-gimme-mode-free" style="flex: 1; font-size: 0.75rem; padding: 6px 4px; border: 1px solid #10b981; background: rgba(16,185,129,0.2); color: #10b981; font-weight: 700;">
            🪙 ${isEn ? 'Bragging Rights' : 'Äran (Gratis)'}
          </button>
          <button type="button" class="btn btn-sm" id="btn-gimme-mode-swish" style="flex: 1; font-size: 0.75rem; padding: 6px 4px; border: 1px solid var(--border-glass); background: rgba(255,255,255,0.05); color: #fff; font-weight: 700;">
            📱 ${isEn ? 'Swish Bet' : 'Swish (kr)'}
          </button>
        </div>

        <!-- Stake selector (only if Swish) -->
        <div id="gimme-stake-wrapper" style="display: none; margin-bottom: 10px;">
          <label style="font-size: 0.75rem; color: rgba(255,255,255,0.8); display: block; margin-bottom: 4px;">
            ${isEn ? 'Stake per player:' : 'Insats per spelare:'}
          </label>
          <div class="flex gap-xs">
            <button type="button" class="btn btn-secondary btn-sm gimme-stake-btn active" data-stake="20" style="flex: 1; font-size: 0.78rem; padding: 4px 0;">20 kr</button>
            <button type="button" class="btn btn-secondary btn-sm gimme-stake-btn" data-stake="50" style="flex: 1; font-size: 0.78rem; padding: 4px 0;">50 kr</button>
            <button type="button" class="btn btn-secondary btn-sm gimme-stake-btn" data-stake="100" style="flex: 1; font-size: 0.78rem; padding: 4px 0;">100 kr</button>
          </div>
        </div>

        <!-- Player Names -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 10px;">
          <div>
            <label style="font-size: 0.72rem; color: #10b981; font-weight: 700; display: block; margin-bottom: 2px;">
              🟢 ${isEn ? 'Claims Gimme:' : 'Tror på Gimme:'}
            </label>
            <input type="text" id="gimme-p1-name" placeholder="${isEn ? 'Name (e.g. Charlie)' : 'Namn (t.ex. Kalle)'}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.5); border: 1px solid #10b981; border-radius: 6px; padding: 6px 8px; font-size: 0.8rem; color: #fff;" />
          </div>
          <div>
            <label style="font-size: 0.72rem; color: #ef4444; font-weight: 700; display: block; margin-bottom: 2px;">
              🔴 ${isEn ? 'Demands Putt:' : 'Kräver Putt:'}
            </label>
            <input type="text" id="gimme-p2-name" placeholder="${isEn ? 'Name (e.g. Dave)' : 'Namn (t.ex. Johan)'}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.5); border: 1px solid #ef4444; border-radius: 6px; padding: 6px 8px; font-size: 0.8rem; color: #fff;" />
          </div>
        </div>

        <!-- Optional Swish Phone Number & Friends Quickselect -->
        <div id="gimme-swish-phone-wrapper" style="display: none; margin-bottom: 10px;">
          <label style="font-size: 0.75rem; color: rgba(255,255,255,0.8); display: block; margin-bottom: 4px;">
            ${isEn ? 'Opponent Swish number (optional):' : 'Motståndarens Swish-nummer (valfritt):'}
          </label>
          <input type="tel" id="gimme-swish-phone" placeholder="0701234567" style="width: 100%; background: rgba(0,0,0,0.5); border: 1px solid #fbbf24; border-radius: 6px; padding: 6px 8px; font-size: 0.8rem; color: #fff;" />
          <div id="gimme-friends-quickselect" style="margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap;"></div>
        </div>

        <button type="button" class="btn btn-primary btn-sm" id="btn-start-gimme-bet" style="width: 100%; padding: 8px; font-weight: 700; font-size: 0.85rem; background: linear-gradient(135deg, #fbbf24, #d97706); border: none; color: #000;">
          🎯 ${isEn ? 'LOCK IN BET 🔒' : 'LÅS BETTET 🔒'}
        </button>
      </div>

      <!-- AR Viewport Wrapper -->
      <div id="gimme-viewport-wrapper" style="position: relative; width: 100%; height: 380px; background: #000; border-radius: 14px; overflow: hidden; border: 2px solid var(--border-glass); box-shadow: 0 8px 24px rgba(0,0,0,0.6);">
        
        <!-- Live Video Element -->
        <video id="gimme-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform: scaleX(1);"></video>

        <!-- Canvas for Live AR Overlays (Crosshair, hole ring, laser gimme perimeter) -->
        <canvas id="gimme-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></canvas>

        <!-- Fallback camera banner if permission denied -->
        <div id="gimme-cam-fallback" style="display: none; position: absolute; inset: 0; background: rgba(10,12,18,0.92); flex-direction: column; align-items: center; justify-content: center; padding: 20px; z-index: 10;">
          <div style="font-size: 3rem; margin-bottom: 8px;">📷</div>
          <p style="font-size: 0.88rem; color: #f87171; font-weight: 700; margin-bottom: 6px;">
            ${isEn ? 'Camera access needed' : 'Kameratillstånd krävs'}
          </p>
          <p class="text-muted" style="font-size: 0.78rem; line-height: 1.4; margin-bottom: 12px;">
            ${isEn ? 'Allow camera access to aim at the hole, or take a quick photo:' : 'Tillåt kameran för att rikta mot hålet, eller knäpp ett snabbt foto:'}
          </p>
          <label class="btn btn-secondary btn-sm" style="cursor: pointer;">
            📁 ${isEn ? 'Take / Upload Photo' : 'Knäpp / Välj bild'}
            <input type="file" id="gimme-file-input" accept="image/jpeg,image/png,image/webp,image/gif,image/*" capture="environment" style="display: none;" />
          </label>
        </div>

        <!-- Realtime Guide Banner at bottom of AR View -->
        <div id="gimme-hud-guide" style="position: absolute; bottom: 8px; left: 10px; right: 10px; background: rgba(0,0,0,0.78); backdrop-filter: blur(8px); border-radius: 8px; padding: 6px 10px; font-size: 0.75rem; color: #fff; display: flex; align-items: center; justify-content: space-between; border: 1px solid rgba(255,255,255,0.15); pointer-events: none;">
          <div class="flex items-center gap-xs">
            <span id="gimme-hud-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 8px #fbbf24; animation: pulse 1.5s infinite;"></span>
            <span id="gimme-hud-text" style="font-weight: 600;">${isEn ? '🔍 Searching cup & ball...' : '🔍 Söker hål & boll...'}</span>
          </div>
          <span style="font-weight: 700; color: #10b981;" id="gimme-hud-radius">${customGimmeCm} cm</span>
        </div>

        <!-- Stamp Verdict Overlay (Shows when judged) -->
        <div id="gimme-verdict-overlay" style="display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); flex-direction: column; align-items: center; justify-content: center; padding: 16px; z-index: 20; animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
          <div id="gimme-verdict-stamp" style="border: 4px solid #10b981; border-radius: 12px; padding: 12px 20px; font-size: 1.6rem; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; transform: rotate(-6deg); box-shadow: 0 0 30px rgba(0,0,0,0.8); margin-bottom: 12px;">
            GIMME! 🏆
          </div>
          <div id="gimme-verdict-comment" style="font-size: 0.88rem; font-weight: 600; color: #fff; max-width: 280px; text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.8); margin-bottom: 16px;"></div>

          <!-- Bet Outcome Box (if bet was active) -->
          <div id="gimme-bet-payout-box" style="display: none; background: rgba(0,0,0,0.85); border: 2px solid #fbbf24; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; width: 100%; max-width: 320px; box-shadow: 0 4px 16px rgba(0,0,0,0.7);">
            <div style="font-weight: 800; font-size: 0.95rem; color: #fbbf24; margin-bottom: 4px;" id="gimme-bet-winner-text"></div>
            <div style="font-size: 0.78rem; color: rgba(255,255,255,0.85); margin-bottom: 8px;" id="gimme-bet-loser-text"></div>
            <a href="#" id="gimme-bet-swish-link" target="_blank" class="btn btn-success btn-sm" style="display: none; width: 100%; font-size: 0.85rem; font-weight: 700; text-decoration: none; padding: 6px 0; background: #00d26a; border: none; color: #fff;">
              📱 ${isEn ? 'Swish Winner Directly' : 'Swisha vinnaren direkt'}
            </a>
            <div id="gimme-bet-swish-fallback" style="display: none; font-size: 0.75rem; color: #fbbf24; background: rgba(251,191,36,0.1); border: 1px dashed #fbbf24; border-radius: 6px; padding: 6px; margin-top: 4px;"></div>
          </div>

          <div class="flex gap-xs">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-gimme-retake" style="font-size: 0.8rem;">
              🔄 ${isEn ? 'Measure Again' : 'Mät igen'}
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-gimme-share" style="font-size: 0.8rem;">
              📋 ${isEn ? 'Copy Verdict' : 'Kopiera dom'}
            </button>
          </div>
        </div>

      </div>

      <!-- Quick Action Bar -->
      <div class="mt-md flex flex-col gap-xs items-center">
        <button type="button" class="btn btn-primary" id="btn-gimme-judge-auto" style="width: 100%; padding: 14px 10px; font-size: 1.05rem; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
          ⚖️ ${isEn ? 'JUDGE WITH AR' : 'DÖM MED AR'}
        </button>

        <button type="button" id="btn-gimme-override-toggle" style="background: none; border: none; color: rgba(255,255,255,0.5); font-size: 0.72rem; cursor: pointer; text-decoration: underline; margin-top: 4px;">
          ⚙️ ${isEn ? 'Manual Override (if camera angle fails)' : 'Manuell överstyrning (om vinkeln trilskas)'}
        </button>

        <div id="gimme-manual-override-box" style="display: none; width: 100%; gap: 8px; margin-top: 6px;">
          <button type="button" class="btn btn-success btn-sm" id="btn-gimme-judge-yes" style="flex: 1; padding: 8px; font-size: 0.85rem; font-weight: 700; background: rgba(16,185,129,0.25); border: 1px solid #10b981; color: #10b981;">
            🟢 ${isEn ? 'Force YES (Gimme)' : 'Tvinga JA (Gimme)'}
          </button>
          <button type="button" class="btn btn-danger btn-sm" id="btn-gimme-judge-no" style="flex: 1; padding: 8px; font-size: 0.85rem; font-weight: 700; background: rgba(239,68,68,0.25); border: 1px solid #ef4444; color: #ef4444;">
            🔴 ${isEn ? 'Force NO (Putt)' : 'Tvinga NEJ (Putta)'}
          </button>
        </div>
      </div>

      <div style="font-size: 0.72rem; color: rgba(255,255,255,0.5); margin-top: 10px;">
        💡 ${isEn ? 'Official cup diameter is 10.8 cm. Hold phone 1–1.5m straight above cup for AR scale.' : 'Golfhålets officiella mått är 10,8 cm. Håll mobilen 1–1,5m rakt ovanför koppen för AR-skala.'}
      </div>

    </div>
  `;

  // Fix 2: Pass cleanup as 3rd parameter to showModal so every close route frees camera/animation
  const { close, root, setBusy } = showModal(modalTitle, contentHtml, cleanup, {
    isGame: true,
    preventBackdropClose: true,
    confirmClose: () => videoStream !== null || activeBet !== null,
    confirmTexts: {
      title: isEn ? 'Exit Gimme AR?' : 'Lämna Gimme AR?',
      message: isEn 
        ? 'Are you sure you want to exit? Active AR camera measuring and pending bet will be stopped.' 
        : 'Är du säker på att du vill avsluta? Pågående AR-kamera och vad avbryts.'
    }
  });
  setBusy(() => videoStream !== null || activeBet !== null);

  const videoEl = root.querySelector('#gimme-video');
  const canvasEl = root.querySelector('#gimme-canvas');
  const ctx = canvasEl?.getContext('2d');
  const distSelect = root.querySelector('#gimme-dist-select');
  const hudRadius = root.querySelector('#gimme-hud-radius');
  const verdictOverlay = root.querySelector('#gimme-verdict-overlay');
  const verdictStamp = root.querySelector('#gimme-verdict-stamp');
  const verdictComment = root.querySelector('#gimme-verdict-comment');
  const btnJudgeAuto = root.querySelector('#btn-gimme-judge-auto');
  const btnOverrideToggle = root.querySelector('#btn-gimme-override-toggle');
  const overrideBox = root.querySelector('#gimme-manual-override-box');
  const btnJudgeYes = root.querySelector('#btn-gimme-judge-yes');
  const btnJudgeNo = root.querySelector('#btn-gimme-judge-no');
  const btnRetake = root.querySelector('#btn-gimme-retake');
  const btnShare = root.querySelector('#btn-gimme-share');
  const camFallback = root.querySelector('#gimme-cam-fallback');
  const fileInput = root.querySelector('#gimme-file-input');

  const btnToggleBet = root.querySelector('#btn-toggle-gimme-bet');
  const betDrawer = root.querySelector('#gimme-bet-drawer');
  const activeBetBanner = root.querySelector('#gimme-active-bet-banner');
  const betInfoHeader = root.querySelector('#gimme-bet-info-header');
  const betInfoPlayers = root.querySelector('#gimme-bet-info-players');
  const btnCancelBet = root.querySelector('#btn-cancel-gimme-bet');
  const btnModeFree = root.querySelector('#btn-gimme-mode-free');
  const btnModeSwish = root.querySelector('#btn-gimme-mode-swish');
  const stakeWrapper = root.querySelector('#gimme-stake-wrapper');
  const swishPhoneWrapper = root.querySelector('#gimme-swish-phone-wrapper');
  const swishPhoneInput = root.querySelector('#gimme-swish-phone');
  const p1Input = root.querySelector('#gimme-p1-name');
  const p2Input = root.querySelector('#gimme-p2-name');
  const btnStartBet = root.querySelector('#btn-start-gimme-bet');
  const betPayoutBox = root.querySelector('#gimme-bet-payout-box');
  const betWinnerText = root.querySelector('#gimme-bet-winner-text');
  const betLoserText = root.querySelector('#gimme-bet-loser-text');
  const betSwishLink = root.querySelector('#gimme-bet-swish-link');
  const betSwishFallback = root.querySelector('#gimme-bet-swish-fallback');

  // Pre-fill user nickname if available
  const currentUser = getStoredUser();
  if (currentUser?.nickname && p1Input) {
    p1Input.value = currentUser.nickname;
  }

  // Load friends for Swish mode
  getFriends().then(friends => {
    userFriends = friends || [];
    renderFriendChips();
  }).catch(() => {
    userFriends = [];
  });

  function renderFriendChips() {
    const container = root.querySelector('#gimme-friends-quickselect');
    if (!container || userFriends.length === 0) return;
    container.innerHTML = `
      <div style="width: 100%; font-size: 0.7rem; color: rgba(255,255,255,0.6); margin-bottom: 2px;">
        ${isEn ? 'Quick-pick friend:' : 'Välj vän snabbt:'}
      </div>
      ${userFriends.slice(0, 6).map(f => `
        <button type="button" class="btn btn-secondary btn-sm gimme-friend-chip" data-id="${f.id}" style="font-size: 0.72rem; padding: 2px 6px; border-radius: 10px;">
          ${escapeHtml(f.nickname)}
        </button>
      `).join('')}
    `;
    container.querySelectorAll('.gimme-friend-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.id;
        selectedFriend = userFriends.find(f => String(f.id) === String(id));
        if (selectedFriend) {
          if (p2Input) p2Input.value = selectedFriend.nickname;
          if (swishPhoneInput && selectedFriend.swishNumber) {
            swishPhoneInput.value = selectedFriend.swishNumber;
          }
        }
      });
    });
  }

  // Toggle Betting Drawer
  btnToggleBet?.addEventListener('click', () => {
    if (betDrawer.style.display === 'none' || !betDrawer.style.display) {
      betDrawer.style.display = 'block';
    } else {
      betDrawer.style.display = 'none';
    }
  });

  // Mode Selection: Free (Äran) vs Swish
  btnModeFree?.addEventListener('click', () => {
    selectedBetMode = 'free';
    btnModeFree.style.background = 'rgba(16,185,129,0.2)';
    btnModeFree.style.borderColor = '#10b981';
    btnModeFree.style.color = '#10b981';
    btnModeSwish.style.background = 'rgba(255,255,255,0.05)';
    btnModeSwish.style.borderColor = 'var(--border-glass)';
    btnModeSwish.style.color = '#fff';
    if (stakeWrapper) stakeWrapper.style.display = 'none';
    if (swishPhoneWrapper) swishPhoneWrapper.style.display = 'none';
  });

  btnModeSwish?.addEventListener('click', () => {
    selectedBetMode = 'swish';
    btnModeSwish.style.background = 'rgba(251,191,36,0.2)';
    btnModeSwish.style.borderColor = '#fbbf24';
    btnModeSwish.style.color = '#fbbf24';
    btnModeFree.style.background = 'rgba(255,255,255,0.05)';
    btnModeFree.style.borderColor = 'var(--border-glass)';
    btnModeFree.style.color = '#fff';
    if (stakeWrapper) stakeWrapper.style.display = 'block';
    if (swishPhoneWrapper) swishPhoneWrapper.style.display = 'block';
  });

  // Stake Buttons
  root.querySelectorAll('.gimme-stake-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.gimme-stake-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--border-glass)';
        b.style.color = '#fff';
      });
      btn.classList.add('active');
      btn.style.borderColor = '#fbbf24';
      btn.style.color = '#fbbf24';
      selectedStake = parseInt(btn.dataset.stake, 10) || 20;
    });
  });

  // Start / Lock In Bet
  // Swish bet disclaimer (nivå 3) – shown before locking any Swish bet
  async function showGimmeSwishDisclaimer() {
    return new Promise((resolve) => {
      const dlg = document.createElement('div');
      dlg.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);padding:16px;';
      dlg.innerHTML = `
        <div style="background:var(--bg-secondary,#1a1f2e);border:2px solid #fbbf24;border-radius:14px;padding:20px 18px;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.8);text-align:center;">
          <div style="font-size:2rem;margin-bottom:8px;">🏌️</div>
          <div style="font-weight:800;font-size:1rem;color:#fbbf24;margin-bottom:10px;">
            ${isEn ? 'Fun Bet – Play Fair!' : 'Kompis-bet på skoj!'}
          </div>
          <p style="font-size:0.82rem;color:rgba(255,255,255,0.85);line-height:1.5;margin-bottom:14px;">
            ${isEn
              ? 'Whooply AR Referee uses camera analysis which may be inaccurate depending on lighting, angle and distance from the hole.<br><br>Swish payment is <strong>voluntary and at your own risk</strong>. This is a party game — not a certified measurement tool.'
              : 'Whooply AR-domare använder kameraanalys som kan vara unexakt beroende på ljus, vinkel och avstånd från hålet.<br><br>Swish-betalning sker <strong>frivilligt och på eget ansvar</strong>. Det här är ett sällskapsspel – inte en certifierad mätmetod.'}
          </p>
          <div style="display:flex;gap:10px;">
            <button id="gimme-disclaimer-cancel" class="btn btn-secondary btn-sm" style="flex:1;font-size:0.82rem;">
              ${isEn ? 'Cancel' : 'Avbryt'}
            </button>
            <button id="gimme-disclaimer-accept" class="btn btn-primary btn-sm" style="flex:1.4;font-size:0.82rem;font-weight:700;background:linear-gradient(135deg,#fbbf24,#d97706);border:none;color:#000;">
              ${isEn ? "Got it, let's go! 🏌️" : 'Jag fattar, kör igång! 🏌️'}
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(dlg);
      const cleanup = (result) => { document.body.removeChild(dlg); resolve(result); };
      dlg.querySelector('#gimme-disclaimer-accept').addEventListener('click', () => cleanup(true));
      dlg.querySelector('#gimme-disclaimer-cancel').addEventListener('click', () => cleanup(false));
      dlg.addEventListener('click', (e) => { if (e.target === dlg) cleanup(false); });
    });
  }

  btnStartBet?.addEventListener('click', async () => {
    const p1Raw = (p1Input?.value || '').trim();
    const p2Raw = (p2Input?.value || '').trim();

    // Fix 1.8: Require real names for Swish bets
    if (selectedBetMode === 'swish' && (!p1Raw || !p2Raw)) {
      showToast(
        isEn ? 'Enter both player names for a Swish bet.' : 'Ange båda spelarnas namn för Swish-bet.',
        'warning'
      );
      return;
    }

    // Fix 1.9: Validate and normalise Swish phone number
    const phoneRaw = (swishPhoneInput?.value || '').trim();
    const normalizedPhone = phoneRaw ? normalizeSwedishPhone(phoneRaw) : '';
    if (selectedBetMode === 'swish' && phoneRaw && !normalizedPhone) {
      showToast(
        isEn ? 'Invalid Swish number – use format 07XXXXXXXX.' : 'Ogiltigt Swish-nummer – använd formatet 07XXXXXXXX.',
        'warning'
      );
      return;
    }

    // Disclaimer (nivå 3) – must accept before locking a Swish bet
    if (selectedBetMode === 'swish') {
      const accepted = await showGimmeSwishDisclaimer();
      if (!accepted) return;
    }

    const p1 = p1Raw || (isEn ? 'Player 1' : 'Spelare 1');
    const p2 = p2Raw || (isEn ? 'Player 2' : 'Spelare 2');

    activeBet = {
      mode: selectedBetMode,
      stake: selectedBetMode === 'swish' ? selectedStake : 0,
      limitCm: customGimmeCm,  // Fix 1.1: freeze limit at lock time
      p1,   // believes GIMME
      p2,   // demands PUTT
      p1Phone: currentUser?.swishNumber || '',
      p2Phone: normalizedPhone || selectedFriend?.swishNumber || ''
    };

    if (betDrawer) betDrawer.style.display = 'none';
    if (activeBetBanner) {
      activeBetBanner.style.display = 'block';
      if (betInfoHeader) {
        betInfoHeader.textContent = activeBet.mode === 'swish'
          ? (isEn
              ? `🎯 ACTIVE BET: ${activeBet.stake} kr (Pot: ${activeBet.stake * 2} kr) · Limit: ${activeBet.limitCm} cm`
              : `🎯 AKTIVT BET: ${activeBet.stake} kr (Pott: ${activeBet.stake * 2} kr) · Gräns: ${activeBet.limitCm} cm`)
          : (isEn ? `🎯 ACTIVE BET: BRAGGING RIGHTS! 🪙` : `🎯 AKTIVT BET: ÄRAN & SKRYT! 🪙`);
      }
      if (betInfoPlayers) {
        betInfoPlayers.textContent = `🟢 ${p1} (Gimme) vs 🔴 ${p2} (Putt)`;
      }
    }
    showToast(isEn ? 'Bet locked in! Walk up and judge! 🏌️' : 'Bettet är låst! Gå fram till green och döm! 🏌️‍♂️⛳️', 'success');
  });

  // Cancel Bet
  btnCancelBet?.addEventListener('click', () => {
    activeBet = null;
    if (activeBetBanner) activeBetBanner.style.display = 'none';
    showToast(isEn ? 'Bet cancelled' : 'Bettet avbröts', 'info');
  });

  // Handle Gimme distance limit selector – locked when a bet is active
  distSelect?.addEventListener('change', () => {
    if (activeBet) {
      // Fix 1.1: Prevent changing limit after bet is locked
      showToast(
        isEn ? 'Limit locked – cancel the bet to change it.' : 'Gräns låst – avbryt bettet för att ändra.',
        'warning'
      );
      distSelect.value = String(activeBet.limitCm); // restore locked value
      return;
    }
    customGimmeCm = parseInt(distSelect.value, 10) || 60;
    if (hudRadius) hudRadius.textContent = `${customGimmeCm} cm`;
  });

  // Sound effects
  function playVerdictSound(isApproved) {
    try {
      const audio = getAudioContext();
      if (!audio) return;
      if (isApproved) {
        // Cheerful ascending chime
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          setTimeout(() => playTone(freq, 'triangle', 0.25, 0.15), idx * 80);
        });
      } else {
        // Dramatic low buzzer / buzzer-fail
        playTone(180, 'sawtooth', 0.2, 0.18);
        setTimeout(() => playTone(130, 'sawtooth', 0.35, 0.2), 180);
      }
    } catch (_) {}
  }

  // Fix 1.3: Cover-crop transform – matches CSS object-fit: cover so that vision
  // coordinates align with what the user actually sees in the viewport.
  function drawWithCoverCrop(sourceEl, canvas, ctx) {
    const srcW = sourceEl.videoWidth || sourceEl.naturalWidth || canvas.width;
    const srcH = sourceEl.videoHeight || sourceEl.naturalHeight || canvas.height;
    const dstW = canvas.width;
    const dstH = canvas.height;
    if (!srcW || !srcH) {
      ctx.drawImage(sourceEl, 0, 0, dstW, dstH); // fallback if dimensions unknown
      return;
    }
    const srcAspect = srcW / srcH;
    const dstAspect = dstW / dstH;
    let cropW, cropH, cropX, cropY;
    if (srcAspect > dstAspect) {
      // Source is wider than destination → crop sides
      cropH = srcH;
      cropW = srcH * dstAspect;
      cropX = (srcW - cropW) / 2;
      cropY = 0;
    } else {
      // Source is taller than destination → crop top/bottom
      cropW = srcW;
      cropH = srcW / dstAspect;
      cropX = 0;
      cropY = (srcH - cropH) / 2;
    }
    ctx.drawImage(sourceEl, cropX, cropY, cropW, cropH, 0, 0, dstW, dstH);
  }

  // Vision Scan Function (Runs every ~100ms to save battery and keep 60fps)
  // Supports both HTMLVideoElement and HTMLImageElement
  function processVisionFrame(sourceEl, width, height) {
    if (!sourceEl) return;
    if (sourceEl instanceof HTMLVideoElement && sourceEl.readyState < 2) return;
    const vW = visionCanvas.width;
    const vH = visionCanvas.height;

    try {
      drawWithCoverCrop(sourceEl, visionCanvas, visionCtx);
      const imgData = visionCtx.getImageData(0, 0, vW, vH);
      const data = imgData.data;

      // 1. Detect Hole (find darkest circular cluster with true perimeter contrast)
      let minBrightness = 255;
      let darkX = -1;
      let darkY = -1;

      // 2. Detect Ball (find brightest, high-contrast white sphere candidate)
      let maxBrightDiff = 0;
      let ballCandX = -1;
      let ballCandY = -1;

      // Scan interior grid (skip extreme edges)
      for (let y = 15; y < vH - 15; y += 3) {
        for (let x = 15; x < vW - 15; x += 3) {
          const idx = (y * vW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114);

          // Check for dark hole candidate
          // Hole is dark, non-green, with darker center than 8px perimeter
          if (brightness < minBrightness && brightness < 70) {
            let perimSum = 0;
            let sampleCount = 0;
            const offsets = [[-8, 0], [8, 0], [0, -8], [0, 8], [-6, -6], [6, 6], [-6, 6], [6, -6]];
            for (const [dx, dy] of offsets) {
              const px = x + dx;
              const py = y + dy;
              if (px >= 0 && px < vW && py >= 0 && py < vH) {
                const pIdx = (py * vW + px) * 4;
                perimSum += data[pIdx] * 0.299 + data[pIdx + 1] * 0.587 + data[pIdx + 2] * 0.114;
                sampleCount++;
              }
            }
            const avgPerim = sampleCount > 0 ? perimSum / sampleCount : 0;
            if (avgPerim - brightness > 25) {
              minBrightness = brightness;
              darkX = x;
              darkY = y;
            }
          }

          // Check for bright white golf ball candidate (high brightness, balanced RGB)
          const isWhiteish = Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && brightness > 180;
          if (isWhiteish) {
            // Check that background around candidate is darker (contrast)
            const pIdx = ((y - 5) * vW + x) * 4;
            const bgBright = data[pIdx] * 0.299 + data[pIdx + 1] * 0.587 + data[pIdx + 2] * 0.114;
            const diff = brightness - bgBright;
            if (diff > maxBrightDiff && diff > 40) {
              maxBrightDiff = diff;
              ballCandX = x;
              ballCandY = y;
            }
          }
        }
      }

      // Map back to screen coordinates
      const scaleX = width / vW;
      const scaleY = height / vH;

      if (darkX > 0 && darkY > 0) {
        const targetScreenX = darkX * scaleX;
        const targetScreenY = darkY * scaleY;

        // Measure actual cup radius in canvas coordinates
        let sumRadius = 0;
        let validAxes = 0;
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [stepX, stepY] of directions) {
          let step = 1;
          while (step < 35) {
            const sx = darkX + step * stepX;
            const sy = darkY + step * stepY;
            if (sx < 0 || sx >= vW || sy < 0 || sy >= vH) break;
            const sIdx = (sy * vW + sx) * 4;
            const sBright = data[sIdx] * 0.299 + data[sIdx + 1] * 0.587 + data[sIdx + 2] * 0.114;
            if (sBright > minBrightness + 25 || sBright > 85) {
              sumRadius += step;
              validAxes++;
              break;
            }
            step++;
          }
        }
        const detectedHoleRadiusCanvas = validAxes >= 2 ? (sumRadius / validAxes) : 10;
        const screenRadius = Math.max(12, detectedHoleRadiusCanvas * ((scaleX + scaleY) / 2));

        // Fix 1.6: Large position hop → treat as new object, reset confidence
        const MAX_HOP_PX = 40;
        if (!detectedHole) {
          detectedHole = { x: targetScreenX, y: targetScreenY, radiusPx: screenRadius, confidence: 1 };
        } else {
          const hop = Math.hypot(targetScreenX - detectedHole.x, targetScreenY - detectedHole.y);
          if (hop > MAX_HOP_PX) {
            // Different object – start fresh, unlock
            detectedHole = { x: targetScreenX, y: targetScreenY, radiusPx: screenRadius, confidence: 1 };
            isHoleLocked = false;
            lockSoundPlayed = false;
          } else {
            // Smooth lerp movement towards locked target
            detectedHole.x += (targetScreenX - detectedHole.x) * 0.25;
            detectedHole.y += (targetScreenY - detectedHole.y) * 0.25;
            detectedHole.radiusPx += (screenRadius - detectedHole.radiusPx) * 0.2;
            detectedHole.confidence = Math.min(10, (detectedHole.confidence || 0) + 1);
          }
        }
        isHoleLocked = detectedHole.confidence >= 3;
      } else {
        if (detectedHole) {
          detectedHole.confidence = Math.max(0, detectedHole.confidence - 0.5);
          if (detectedHole.confidence <= 0) {
            detectedHole = null;
            isHoleLocked = false;
            lockSoundPlayed = false;
          }
        }
      }

      // Ball candidate mapping (only if reasonably separated from hole)
      const holeCenterDistanceThreshold = detectedHole?.radiusPx ? (detectedHole.radiusPx + 10) : 35;
      if (ballCandX > 0 && ballCandY > 0) {
        const screenBallX = ballCandX * scaleX;
        const screenBallY = ballCandY * scaleY;
        const holeX = detectedHole ? detectedHole.x : width / 2;
        const holeY = detectedHole ? detectedHole.y : height / 2;
        const distFromHole = Math.hypot(screenBallX - holeX, screenBallY - holeY);

        if (distFromHole > holeCenterDistanceThreshold) { // Must not be inside hole itself
          if (!detectedBall) {
            detectedBall = { x: screenBallX, y: screenBallY, confidence: 1 };
          } else {
            detectedBall.x += (screenBallX - detectedBall.x) * 0.3;
            detectedBall.y += (screenBallY - detectedBall.y) * 0.3;
            detectedBall.confidence = Math.min(10, (detectedBall.confidence || 0) + 1);
          }
        } else {
          // Fix 1.7: Candidate found but rejected (too close to hole) → decay ball too
          if (detectedBall) {
            detectedBall.confidence = (detectedBall.confidence || 1) - 0.5;
            if (detectedBall.confidence <= 0) detectedBall = null;
          }
        }
      } else {
        // No candidate at all → decay
        if (detectedBall) {
          detectedBall.confidence = (detectedBall.confidence || 1) - 0.5;
          if (detectedBall.confidence <= 0) {
            detectedBall = null;
          }
        }
      }
    } catch (err) {
      // Fix 1.14: Log vision errors (rate-limited to avoid spam)
      visionErrorCount++;
      if (visionErrorCount <= 3) console.warn('[Gimme vision]', err?.message);
    }
  }

  // Draw AR Overlays in realtime loop
  let pulseAngle = 0;
  function renderARFrame() {
    if (isFrozen) return;

    if (canvasEl && ctx && canvasEl.clientWidth > 0) {
      const w = canvasEl.clientWidth;
      const h = canvasEl.clientHeight;
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w;
        canvasEl.height = h;
      }

      ctx.clearRect(0, 0, w, h);

      // Run computer vision scan every ~100ms
      const now = performance.now();
      if (now - lastVisionScanTime > 100) {
        lastVisionScanTime = now;
        if (videoEl && videoEl.videoWidth > 0 && videoEl.style.display !== 'none') {
          processVisionFrame(videoEl, w, h);
        } else if (activeFallbackImg) {
          processVisionFrame(activeFallbackImg, w, h);
        }
      }

      // Determine Hole Center: Either auto-locked hole position or screen center fallback
      const defaultCenterX = w / 2;
      const defaultCenterY = h / 2;
      const holeX = (detectedHole && isHoleLocked) ? detectedHole.x : defaultCenterX;
      const holeY = (detectedHole && isHoleLocked) ? detectedHole.y : defaultCenterY;

      // Fix 3: Physical scale calibration based on standard 10.8 cm hole (5.4 cm radius)
      // When locked, derive pxPerCm dynamically from the measured hole radius.
      const fallbackRadiusPx = Math.min(w, h) * 0.085;
      const holeRadiusPx = (detectedHole && isHoleLocked && detectedHole.radiusPx >= 12)
        ? detectedHole.radiusPx
        : fallbackRadiusPx;
      const pxPerCm = holeRadiusPx / 5.4;
      const gimmeRadiusPx = customGimmeCm * pxPerCm;

      pulseAngle += 0.05;
      const pulseEffect = Math.sin(pulseAngle) * 2;

      // Update HUD status banner
      const hudDot = root.querySelector('#gimme-hud-dot');
      const hudText = root.querySelector('#gimme-hud-text');
      if (hudDot && hudText) {
        if (isHoleLocked) {
          hudDot.style.background = '#10b981';
          hudDot.style.boxShadow = '0 0 10px #10b981';
          hudText.textContent = isEn ? '🔒 CUP CALIBRATED (10.8 cm)' : '🔒 HÅL KALIBRERAT (10,8 cm)';
          if (!lockSoundPlayed) {
            playTone(880, 'sine', 0.08, 0.08);
            lockSoundPlayed = true;
          }
        } else {
          hudDot.style.background = '#fbbf24';
          hudDot.style.boxShadow = '0 0 8px #fbbf24';
          hudText.textContent = isEn ? '🔍 Aim circle over cup (10.8 cm)...' : '🔍 Passa in hålet i siktet (10,8 cm)...';
        }
      }

      // 1. Draw outer Gimme Perimeter (Glowing Neon Green Laser Circle)
      ctx.save();
      ctx.beginPath();
      ctx.arc(holeX, holeY, Math.max(10, gimmeRadiusPx + pulseEffect), 0, Math.PI * 2);
      ctx.lineWidth = isHoleLocked ? 3.5 : 2.5;
      ctx.strokeStyle = '#10b981';
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = isHoleLocked ? 16 : 10;
      ctx.stroke();

      // Translucent Gimme zone fill
      ctx.fillStyle = isHoleLocked ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.06)';
      ctx.fill();
      ctx.restore();

      // Gimme radar dashed inner ring
      ctx.save();
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(holeX, holeY, Math.max(10, gimmeRadiusPx * 0.65), 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.stroke();
      ctx.restore();

      // 2. Draw Hole Alignment Ring (Gold Target with Sci-Fi Reticle)
      ctx.save();
      ctx.beginPath();
      ctx.arc(holeX, holeY, holeRadiusPx, 0, Math.PI * 2);
      ctx.lineWidth = isHoleLocked ? 3.5 : 2.5;
      ctx.strokeStyle = isHoleLocked ? '#10b981' : '#fbbf24';
      ctx.shadowColor = isHoleLocked ? '#10b981' : '#fbbf24';
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Crosshair tick marks
      ctx.strokeStyle = isHoleLocked ? '#10b981' : '#fbbf24';
      ctx.lineWidth = 2;
      const chLen = 8;
      // Top
      ctx.beginPath();
      ctx.moveTo(holeX, holeY - holeRadiusPx - chLen);
      ctx.lineTo(holeX, holeY - holeRadiusPx + chLen);
      ctx.stroke();
      // Bottom
      ctx.beginPath();
      ctx.moveTo(holeX, holeY + holeRadiusPx - chLen);
      ctx.lineTo(holeX, holeY + holeRadiusPx + chLen);
      ctx.stroke();
      // Left
      ctx.beginPath();
      ctx.moveTo(holeX - holeRadiusPx - chLen, holeY);
      ctx.lineTo(holeX - holeRadiusPx + chLen, holeY);
      ctx.stroke();
      // Right
      ctx.beginPath();
      ctx.moveTo(holeX + holeRadiusPx - chLen, holeY);
      ctx.lineTo(holeX + holeRadiusPx + chLen, holeY);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(holeX, holeY, 3, 0, Math.PI * 2);
      ctx.fillStyle = isHoleLocked ? '#10b981' : '#fbbf24';
      ctx.fill();

      // Label on hole
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillStyle = isHoleLocked ? '#10b981' : '#fbbf24';
      ctx.textAlign = 'center';
      ctx.fillText(isHoleLocked 
        ? (isEn ? '🔒 CUP (10.8 cm)' : '🔒 HÅL (10,8 cm)') 
        : (isEn ? 'CUP (10.8 cm)' : 'HÅL (10,8 cm)'), 
        holeX, holeY - holeRadiusPx - 10);

      // Label on gimme ring
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = '#10b981';
      ctx.fillText(isEn ? `🟢 GIMME ZONE (${customGimmeCm} cm)` : `🟢 GIMME ZON (${customGimmeCm} cm)`, holeX, holeY + gimmeRadiusPx + 15);
      ctx.restore();

      // 3. Draw Ball Target & Realtime Connecting Laser (Auto-detected or Manual Tap)
      const activeBall = manualBallTarget || detectedBall;
      if (activeBall) {
        const ballDistPx = Math.hypot(activeBall.x - holeX, activeBall.y - holeY);
        // Distance in cm (minus hole radius to measure from cup rim to ball center)
        const distCm = Math.max(0, Math.round((ballDistPx - holeRadiusPx) / pxPerCm));
        measuredDistanceCm = distCm;
        const isWithinGimme = distCm <= customGimmeCm;

        // Laser line connecting hole and ball
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(holeX, holeY);
        ctx.lineTo(activeBall.x, activeBall.y);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isWithinGimme ? '#10b981' : '#ef4444';
        ctx.shadowColor = isWithinGimme ? '#10b981' : '#ef4444';
        ctx.shadowBlur = 8;
        ctx.stroke();

        // Distance Tag in center of laser line
        const midX = (holeX + activeBall.x) / 2;
        const midY = (holeY + activeBall.y) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(midX - 34, midY - 12, 68, 24);
        ctx.strokeStyle = isWithinGimme ? '#10b981' : '#ef4444';
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - 34, midY - 12, 68, 24);

        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillStyle = isWithinGimme ? '#10b981' : '#ef4444';
        ctx.textAlign = 'center';
        ctx.fillText(`${distCm} cm ${isWithinGimme ? '✓' : '✗'}`, midX, midY + 4);

        // Ball target ring
        ctx.beginPath();
        ctx.arc(activeBall.x, activeBall.y, 14, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(activeBall.x, activeBall.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(isEn ? '⚪️ BALL' : '⚪️ BOLL', activeBall.x, activeBall.y - 18);
        ctx.restore();
      }
    }

    animFrameId = requestAnimationFrame(renderARFrame);
  }

  // Trigger Verdict
  function applyVerdict(approved, method = 'auto') {
    isFrozen = true;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    verdictState = approved ? 'approved' : 'denied';
    verdictMethod = method; // recorded for share text

    playVerdictSound(approved);

    const roasts = approved 
      ? (isEn ? approvedRoastsEn : approvedRoastsSv)
      : (isEn ? deniedRoastsEn : deniedRoastsSv);
    const randomRoast = roasts[Math.floor(Math.random() * roasts.length)];

    if (verdictOverlay && verdictStamp && verdictComment) {
      verdictOverlay.style.display = 'flex';
      if (approved) {
        verdictStamp.style.borderColor = '#10b981';
        verdictStamp.style.color = '#10b981';
        verdictStamp.style.textShadow = '0 0 15px rgba(16,185,129,0.8)';
        verdictStamp.textContent = isEn ? 'GIMME! 🏆' : 'GIMME GODKÄND! 🏆';
        launchConfetti();
      } else {
        verdictStamp.style.borderColor = '#ef4444';
        verdictStamp.style.color = '#ef4444';
        verdictStamp.style.textShadow = '0 0 15px rgba(239,68,68,0.8)';
        verdictStamp.textContent = isEn ? 'PUTT IT! 😈' : 'PUTTA DIN FEGIS! 😈';
      }
      verdictComment.textContent = randomRoast;

      // Settle active bet if one was placed
      if (activeBet && betPayoutBox && betWinnerText && betLoserText) {
        betPayoutBox.style.display = 'block';
        const winner = approved ? activeBet.p1 : activeBet.p2;
        const loser = approved ? activeBet.p2 : activeBet.p1;
        const winnerPhone = approved ? activeBet.p1Phone : activeBet.p2Phone;

        if (activeBet.mode === 'swish' && activeBet.stake > 0) {
          const totalPot = activeBet.stake * 2;
          betWinnerText.innerHTML = isEn 
            ? `👑 <strong>${escapeHtml(winner)}</strong> won ${totalPot} kr! 🎉` 
            : `👑 <strong>${escapeHtml(winner)}</strong> vann ${totalPot} kr! 🎉`;
          betLoserText.innerHTML = isEn
            ? `${escapeHtml(loser)} pays ${activeBet.stake} kr to ${escapeHtml(winner)}`
            : `${escapeHtml(loser)} swishar ${activeBet.stake} kr till ${escapeHtml(winner)}`;

          if (winnerPhone) {
            if (betSwishLink) {
              betSwishLink.style.display = 'block';
              betSwishLink.textContent = isEn 
                ? `📱 Swish ${escapeHtml(winner)} (${activeBet.stake} kr)` 
                : `📱 Swisha ${escapeHtml(winner)} (${activeBet.stake} kr)`;
              const swishUrl = createSwishUrl({
                phone: winnerPhone,
                amount: activeBet.stake,
                message: `Whooply Gimme (${winner} ${isEn ? 'won' : 'vann'})`
              });
              betSwishLink.href = swishUrl;
            }
            if (betSwishFallback) betSwishFallback.style.display = 'none';
          } else {
            // Fix 4: No dead '#' link!
            if (betSwishLink) betSwishLink.style.display = 'none';
            if (betSwishFallback) {
              betSwishFallback.style.display = 'block';
              betSwishFallback.innerHTML = isEn
                ? `📱 <strong>Swish winner manually:</strong> Send <strong>${activeBet.stake} kr</strong> to <strong>${escapeHtml(winner)}</strong> (no saved phone number).`
                : `📱 <strong>Swisha manuellt:</strong> Skicka <strong>${activeBet.stake} kr</strong> till <strong>${escapeHtml(winner)}</strong> (inget sparat telefonnummer).`;
            }
          }
        } else {
          betWinnerText.innerHTML = isEn
            ? `👑 <strong>${escapeHtml(winner)}</strong> won the bet! 🏆`
            : `👑 <strong>${escapeHtml(winner)}</strong> vann bettet! 🏆`;
          betLoserText.innerHTML = isEn
            ? `${escapeHtml(loser)} yields bragging rights! 😉`
            : `${escapeHtml(loser)} får bjuda på skryträtten! 😉`;
          if (betSwishLink) betSwishLink.style.display = 'none';
          if (betSwishFallback) betSwishFallback.style.display = 'none';
        }
      } else if (betPayoutBox) {
        betPayoutBox.style.display = 'none';
      }
    }
  }

  // Fix 5: Automatic AR Judge action
  // Fix 1.2: Require calibrated hole before AR judgment
  btnJudgeAuto?.addEventListener('click', () => {
    const activeBall = manualBallTarget || detectedBall;
    if (!activeBall) {
      showToast(isEn ? '⚪️ Tap screen to place the ball first!' : '⚪️ Tryck på skärmen för att markera bollen först!', 'warning');
      return;
    }
    if (!isHoleLocked) {
      showToast(isEn ? '⛳️ Wait for cup calibration (yellow → green lock).' : '⛳️ Vänta tills hålet är kalibrerat (gult → grönt lås).', 'warning');
      return;
    }
    if (measuredDistanceCm === null) {
      showToast(isEn ? 'Calculating distance...' : 'Beräknar avstånd...', 'info');
      return;
    }
    const limitCm = activeBet?.limitCm ?? customGimmeCm;
    const isApproved = measuredDistanceCm <= limitCm;
    applyVerdict(isApproved, 'auto');
  });

  // Manual override toggle & buttons
  btnOverrideToggle?.addEventListener('click', () => {
    if (overrideBox) {
      overrideBox.style.display = overrideBox.style.display === 'none' ? 'flex' : 'none';
    }
  });

  // Fix 1.5: Block one-sided manual verdict for Swish bets
  btnJudgeYes?.addEventListener('click', () => {
    if (activeBet?.mode === 'swish') {
      showToast(isEn ? 'Manual override not allowed for Swish bets – use AR judge.' : 'Manuell dom ej tillåten för Swish-bet – använd AR-domare.', 'error');
      return;
    }
    applyVerdict(true, 'manual');
  });
  btnJudgeNo?.addEventListener('click', () => {
    if (activeBet?.mode === 'swish') {
      showToast(isEn ? 'Manual override not allowed for Swish bets – use AR judge.' : 'Manuell dom ej tillåten för Swish-bet – använd AR-domare.', 'error');
      return;
    }
    applyVerdict(false, 'manual');
  });

  btnRetake?.addEventListener('click', () => {
    isFrozen = false;
    manualBallTarget = null;
    detectedBall = null;
    measuredDistanceCm = null;
    verdictMethod = 'auto';
    if (verdictOverlay) verdictOverlay.style.display = 'none';
    renderARFrame();
  });

  // Tap-to-set ball position – Fix 1.12: ignore clicks from controls (file picker etc.)
  const viewportWrapper = root.querySelector('#gimme-viewport-wrapper');
  viewportWrapper?.addEventListener('click', (e) => {
    if (isFrozen) return;
    if (e.target.closest('button, label, input, a, select')) return; // Fix 1.12
    const rect = viewportWrapper.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    const tapY = e.clientY - rect.top;

    manualBallTarget = { x: tapX, y: tapY };
    playTone(1200, 'sine', 0.05, 0.06);
    showToast(isEn ? '⚪️ Ball target placed!' : '⚪️ Bollpunkt markerad!', 'info');
  });

  // Clipboard share text – Fix 1.10: consistent ≤/>, add distance and method label
  btnShare?.addEventListener('click', () => {
    const isApproved = verdictState === 'approved';
    const limitUsed = activeBet?.limitCm ?? customGimmeCm;
    const distLabel = measuredDistanceCm !== null
      ? (isEn ? ` (~${measuredDistanceCm} cm, cup rim → ball centre)` : ` (~${measuredDistanceCm} cm, hålkant → bollcentrum)`)
      : '';
    const methodLabel = verdictMethod === 'manual'
      ? (isEn ? ' [manual override]' : ' [manuell dom]')
      : '';
    let text = isApproved
      ? (isEn
          ? `⛳️ Whooply Gimme Referee: Ball is APPROVED as Gimme (≤ ${limitUsed} cm)! 🏆${distLabel}${methodLabel}\nPick up the ball!`
          : `⛳️ Whooply Gimme Domare: Bollen är GODKÄND som Gimme (≤ ${limitUsed} cm)! 🏆${distLabel}${methodLabel}\nPlocka upp bollen!`)
      : (isEn
          ? `⛳️ Whooply Gimme Referee: NOT A GIMME (> ${limitUsed} cm)! 😈${distLabel}${methodLabel}\nPutt it, coward!`
          : `⛳️ Whooply Gimme Domare: ICKE GODKÄND Gimme (> ${limitUsed} cm)! 😈${distLabel}${methodLabel}\nPutta din fegis!`);

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

    navigator.clipboard?.writeText(text).then(() => {
      showToast(isEn ? 'Verdict & bet copied to clipboard! 📋' : 'Dom & bet-resultat kopierat till urklipp! 📋', 'success');
    }).catch(() => {
      showToast(text, 'info');
    });
  });

  // Start Camera
  // Fix 1.4: Disposed-token prevents camera staying active after modal close
  async function initCamera() {
    const myToken = sessionToken; // capture token before async gap
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      // If modal was closed while we were waiting, stop tracks immediately
      if (sessionToken !== myToken) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      videoStream = stream;
      if (videoEl) {
        videoEl.srcObject = videoStream;
        await videoEl.play().catch(() => {});
      }
      renderARFrame();
    } catch (err) {
      if (sessionToken !== myToken) return; // modal already closed, ignore
      console.warn('Camera failed or rejected, falling back to static overlay:', err);
      if (camFallback) camFallback.style.display = 'flex';
      renderARFrame();
    }
  }

  // Fallback image capture with actual vision processing – Fix 1.13: revoke old object URL
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl); // Fix 1.13
      const imgUrl = URL.createObjectURL(file);
      currentObjectUrl = imgUrl;
      const img = new Image();
      img.src = imgUrl;
      img.onload = () => {
        activeFallbackImg = img;
        if (videoEl) videoEl.style.display = 'none';
        const wrapper = root.querySelector('#gimme-viewport-wrapper');
        if (wrapper) {
          wrapper.style.backgroundImage = `url(${imgUrl})`;
          wrapper.style.backgroundSize = 'cover';
          wrapper.style.backgroundPosition = 'center';
        }
        if (camFallback) camFallback.style.display = 'none';
        const curW = canvasEl?.clientWidth || 360;
        const curH = canvasEl?.clientHeight || 380;
        processVisionFrame(img, curW, curH);
        renderARFrame();
      };
    }
  });

  // Initialize camera
  initCamera();

  // Root listeners as additional defense-in-depth
  root.querySelector('.modal-close')?.addEventListener('click', cleanup);
  root.querySelector('#modal-close-btn')?.addEventListener('click', cleanup);
  root.addEventListener('modal-closed', cleanup);
}

// ────────────────────────────────────────────────────────
// 🏒 GAME 11: LÖVEN GAME (Björklöven Matchtips 4-3-2p)
// ────────────────────────────────────────────────────────

export async function openLovenGameModal() {
  const isEn = getLang() === 'en';
  const user = getStoredUser();

  if (!user) {
    showToast(isEn ? 'Please log in to play Löven Game' : 'Logga in för att spela Löven Game', 'warning');
    return;
  }

  let activeTab = 'match'; // 'match' | 'create' | 'history'
  let games = [];
  let selectedGameId = null;
  let friends = [];
  let isSubmitting = false;

  const { close, root } = showModal(
    `<img src="/loven-game.png" alt="" style="width: 24px; height: 24px; object-fit: contain; vertical-align: -5px; margin-right: 6px; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6));" /> LÖVEN GAME`,
    `<div id="loven-modal-container" style="min-height: 280px; padding: 4px 0;">
      <div class="text-center text-muted" style="padding: 30px 0;">
        <span class="spinner" style="font-size: 1.8rem; margin-bottom: 8px;">⏳</span>
        <div>${isEn ? 'Loading Löven Game...' : 'Laddar Löven Game...'}</div>
      </div>
    </div>`,
    { isGame: true, preventBackdropClose: true, confirmClose: false }
  );

  async function loadData() {
    try {
      const [fetchedGames, fetchedFriends] = await Promise.all([
        getLovenGames().catch(() => []),
        getFriends().catch(() => [])
      ]);
      games = Array.isArray(fetchedGames) ? fetchedGames : [];
      friends = Array.isArray(fetchedFriends) ? fetchedFriends : [];

      // Pick selected game: first active open/locked match, else latest
      if (!selectedGameId && games.length > 0) {
        const activeMatch = games.find(g => g.status === 'open' || g.status === 'locked');
        selectedGameId = activeMatch ? activeMatch.id : games[0].id;
      }

      render();
    } catch (err) {
      console.error('Error loading Löven Game:', err);
      const container = root.querySelector('#loven-modal-container');
      if (container) {
        container.innerHTML = `
          <div class="text-center" style="padding: 20px;">
            <div style="color: #ef4444; font-weight: 700; margin-bottom: 8px;">Kunde inte ladda Löven Game</div>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-retry-loven">Försök igen</button>
          </div>
        `;
        container.querySelector('#btn-retry-loven')?.addEventListener('click', loadData);
      }
    }
  }

  function getRosterSelectOptions(selectedVal = '') {
    const normSelected = (selectedVal || '').trim().toLowerCase();
    let isCustomSelected = false;

    const goalies = BJORKLOVEN_ROSTER.filter(p => p.position === 'G');
    const defenders = BJORKLOVEN_ROSTER.filter(p => p.position === 'D');
    const forwards = BJORKLOVEN_ROSTER.filter(p => p.position === 'F');

    const renderGroup = (label, list) => `
      <optgroup label="${label}">
        ${list.map(p => {
          const val = `#${p.number} ${p.name}`;
          const isMatch = normSelected === val.toLowerCase() || normSelected === p.name.toLowerCase();
          return `<option value="${val}" ${isMatch ? 'selected' : ''}>#${p.number} ${p.name}</option>`;
        }).join('')}
      </optgroup>
    `;

    const noGoalsMatch = normSelected === NO_GOALS_OPTION.toLowerCase() || normSelected.includes('nollade');
    const knownValues = BJORKLOVEN_ROSTER.map(p => p.name.toLowerCase()).concat([NO_GOALS_OPTION.toLowerCase()]);
    if (selectedVal && !noGoalsMatch && !knownValues.some(k => normSelected.includes(k))) {
      isCustomSelected = true;
    }

    return {
      isCustomSelected,
      html: `
        <option value="">-- Välj målskytt --</option>
        ${renderGroup('Målvakter', goalies)}
        ${renderGroup('Backar', defenders)}
        ${renderGroup('Forwards', forwards)}
        <optgroup label="Special">
          <option value="${NO_GOALS_OPTION}" ${noGoalsMatch ? 'selected' : ''}>🚫 ${NO_GOALS_OPTION}</option>
          <option value="__custom__" ${isCustomSelected ? 'selected' : ''}>✏️ Egen spelare / Junior...</option>
        </optgroup>
      `
    };
  }

  async function render() {
    const container = root.querySelector('#loven-modal-container');
    if (!container) return;

    let currentGame = null;
    if (selectedGameId) {
      try {
        currentGame = await getLovenGame(selectedGameId);
      } catch (e) {
        console.warn('Could not fetch single game:', e);
      }
    }

    const openGames = games.filter(g => g.status === 'open' || g.status === 'locked');
    const settledGames = games.filter(g => g.status === 'settled');

    container.innerHTML = `
      <div class="loven-game-wrapper">
        <!-- Top Björklöven Banner -->
        <div class="loven-header-banner">
          <img src="/loven-game.png" alt="Björklöven" class="loven-emblem-img" />
          <div class="loven-title-group" style="flex: 1 1 auto; min-width: 0;">
            <h3>LÖVEN GAME <span>🏒</span></h3>
            <p>${t('arcade.lovenGameTag')}</p>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="loven-tab-nav">
          <button type="button" class="loven-tab-btn ${activeTab === 'match' ? 'active' : ''}" data-tab="match">
            🏒 Match & Tips ${openGames.length > 0 ? `(${openGames.length})` : ''}
          </button>
          <button type="button" class="loven-tab-btn ${activeTab === 'create' ? 'active' : ''}" data-tab="create">
            ➕ Skapa Match
          </button>
          <button type="button" class="loven-tab-btn ${activeTab === 'history' ? 'active' : ''}" data-tab="history">
            📋 Historik (${settledGames.length})
          </button>
        </div>

        <!-- Content Area -->
        <div id="loven-tab-content">
          ${activeTab === 'match' ? renderMatchTab(currentGame, openGames) : ''}
          ${activeTab === 'create' ? renderCreateTab() : ''}
          ${activeTab === 'history' ? renderHistoryTab(settledGames) : ''}
        </div>
      </div>
    `;

    attachEventHandlers(currentGame);
  }

  function renderMatchTab(game, openGames) {
    if (!game) {
      return `
        <div class="text-center" style="padding: 30px 10px;">
          <div style="font-size: 2.4rem; margin-bottom: 8px;">🏒</div>
          <div style="font-weight: 800; font-size: 1.05rem; color: #fff; margin-bottom: 6px;">
            Ingen aktiv Löven-match just nu
          </div>
          <p class="text-muted" style="font-size: 0.82rem; max-width: 320px; margin: 0 auto 16px auto;">
            Skapa nästa match mot MoDo, Djurgården, AIK eller valfritt lag och bjud in polarna till gängpotten!
          </p>
          <button type="button" class="btn btn-primary" id="btn-goto-create-match" style="background: linear-gradient(135deg, #2d7a46 0%, #155724 100%); border-color: #d4af37; font-weight: 800;">
            ➕ Skapa nästa Löven-match
          </button>
        </div>
      `;
    }

    const isCreator = user && (game.creator_id === user.id || !!user.is_admin);
    const matchDateObj = new Date(game.match_date);
    const dateFormatted = matchDateObj.toLocaleDateString('sv-SE', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const isLocked = game.status === 'locked' || game.status === 'settled' || Date.now() >= matchDateObj.getTime();
    const isSettled = game.status === 'settled';

    const entries = game.entries || [];
    const myEntry = entries.find(e => e.user_id === user.id);
    const totalPot = entries.length * (Number(game.stake_amount) || 0);

    const rosterSelect = getRosterSelectOptions(myEntry?.pred_last_scorer || '');

    return `
      <!-- Multiple Matches Switcher if more than 1 -->
      ${openGames.length > 1 ? `
        <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 10px;">
          ${openGames.map(g => `
            <button type="button" class="btn btn-xs ${g.id === game.id ? 'btn-primary' : 'btn-secondary'} match-picker-btn" data-game-id="${g.id}" style="white-space: nowrap; font-size: 0.72rem;">
              vs ${escapeHtml(g.opponent_team)} (${g.is_home ? 'H' : 'B'})
            </button>
          `).join('')}
        </div>
      ` : ''}

      <!-- Match Headline & Status -->
      <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(212,175,55,0.25); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
        <div class="flex-between align-center mb-xs">
          <span style="font-size: 0.75rem; color: #d4af37; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
            ${game.is_home ? '🟢 Visionite Arena (Hemma)' : '⚪ Borta'} · ${dateFormatted}
          </span>
          <span class="badge" style="background: ${isSettled ? 'rgba(74, 222, 128, 0.2)' : (isLocked ? 'rgba(239, 68, 68, 0.2)' : 'rgba(45, 122, 70, 0.35)')}; color: ${isSettled ? '#4ade80' : (isLocked ? '#ff6b6b' : '#ffd700')}; font-weight: 700; font-size: 0.72rem; border: 1px solid currentColor;">
            ${isSettled ? '🏁 Rättad' : (isLocked ? '🔒 Spelstopp' : '🟢 Öppen')}
          </span>
        </div>

        <div style="font-family: var(--font-heading); font-size: 1.15rem; font-weight: 900; color: #fff; text-align: center; margin: 6px 0;">
          IF Björklöven <span style="color: #d4af37;">vs</span> ${escapeHtml(game.opponent_team)}
        </div>

        <!-- Pot Banner -->
        <div class="loven-pot-banner" style="margin-top: 10px; margin-bottom: 0;">
          <div>
            <div style="font-size: 0.7rem; color: #d4af37; text-transform: uppercase; font-weight: 700;">Gängpott</div>
            <div style="font-size: 1.15rem; font-weight: 900; color: #fff;">
              ${totalPot} kr <span style="font-size: 0.75rem; font-weight: 500; color: var(--text-secondary);">(${entries.length} st à ${game.stake_amount} kr)</span>
            </div>
          </div>
          <div style="text-align: right; font-size: 0.72rem; color: var(--text-muted); max-width: 140px;">
            Dras i THE TAB & Swish vid rättning
          </div>
        </div>
      </div>

      <!-- Result Banner if Settled -->
      ${isSettled ? `
        <div style="background: linear-gradient(135deg, rgba(212,175,55,0.2) 0%, rgba(45,122,70,0.3) 100%); border: 1.5px solid #d4af37; border-radius: 12px; padding: 12px; margin-bottom: 14px; text-align: center;">
          <div style="font-size: 0.75rem; font-weight: 800; color: #ffd700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
            🏆 Officiellt Matchresultat
          </div>
          <div style="font-size: 1.4rem; font-weight: 900; color: #fff; margin-bottom: 4px;">
            Löven ${game.result_loven_goals} - ${game.result_opponent_goals} ${escapeHtml(game.opponent_team)}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">
            Sista målskytt: <strong style="color: #ffd700;">${escapeHtml(game.result_last_scorer || '-')}</strong> · Skott på mål: <strong style="color: #ffd700;">${game.result_shots_on_goal}</strong>
          </div>
          <div style="font-size: 0.85rem; font-weight: 800; color: #4ade80; padding-top: 4px; border-top: 1px dashed rgba(212,175,55,0.3);">
            ${renderWinnerAnnouncement(game)}
          </div>
        </div>
      ` : ''}

      <!-- Tips Form (If game is open and user can submit/edit) -->
      ${!isLocked ? `
        <form id="form-loven-submit-tip" style="margin-bottom: 16px;">
          <div style="font-size: 0.82rem; font-weight: 800; color: #d4af37; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em;">
            ${myEntry ? '✏️ Ändra ditt tips' : '🏒 Lämna ditt matchtips'}
          </div>

          <!-- Fråga 1: Slutresultat (4p) -->
          <div class="loven-q-box">
            <div class="loven-q-header">
              <span class="loven-q-title">1. Slutresultat (Fulltid)</span>
              <span class="loven-pts-badge">4 POÄNG</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">
              Gissa matchens slutresultat (4p för exakt match).
            </div>
            <div class="flex align-center" style="justify-content: center; gap: 12px;">
              <div style="text-align: center;">
                <div style="font-size: 0.75rem; color: #4ade80; font-weight: 700; margin-bottom: 4px;">LÖVEN</div>
                <div class="flex align-center" style="gap: 4px;">
                  <button type="button" class="btn btn-secondary btn-xs btn-step" data-target="loven-goals" data-dir="-1" style="width: 28px; height: 28px; padding: 0;">-</button>
                  <input type="number" id="input-loven-goals" class="form-input text-center" min="0" max="25" value="${myEntry ? myEntry.pred_loven_goals : 4}" style="width: 44px; font-size: 1.1rem; font-weight: 800; padding: 4px;" />
                  <button type="button" class="btn btn-secondary btn-xs btn-step" data-target="loven-goals" data-dir="1" style="width: 28px; height: 28px; padding: 0;">+</button>
                </div>
              </div>

              <div style="font-size: 1.3rem; font-weight: 900; color: #d4af37; padding-top: 16px;">-</div>

              <div style="text-align: center;">
                <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 700; margin-bottom: 4px;">${escapeHtml(game.opponent_team).slice(0, 12)}</div>
                <div class="flex align-center" style="gap: 4px;">
                  <button type="button" class="btn btn-secondary btn-xs btn-step" data-target="opp-goals" data-dir="-1" style="width: 28px; height: 28px; padding: 0;">-</button>
                  <input type="number" id="input-opp-goals" class="form-input text-center" min="0" max="25" value="${myEntry ? myEntry.pred_opponent_goals : 2}" style="width: 44px; font-size: 1.1rem; font-weight: 800; padding: 4px;" />
                  <button type="button" class="btn btn-secondary btn-xs btn-step" data-target="opp-goals" data-dir="1" style="width: 28px; height: 28px; padding: 0;">+</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Fråga 2: Lövens sista målskytt (3p) -->
          <div class="loven-q-box">
            <div class="loven-q-header">
              <span class="loven-q-title">2. Lövens sista målskytt</span>
              <span class="loven-pts-badge">3 POÄNG</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">
              Vem gör Björklövens sista mål i matchen? (3p).
            </div>
            <select id="select-loven-scorer" class="form-input" style="font-size: 0.85rem; font-weight: 600; margin-bottom: 6px;">
              ${rosterSelect.html}
            </select>
            <div id="custom-scorer-box" style="${rosterSelect.isCustomSelected ? 'display: block;' : 'display: none;'} margin-top: 6px;">
              <input type="text" id="input-custom-scorer" class="form-input" placeholder="Skriv in spelarens namn (t.ex. junior)..." value="${rosterSelect.isCustomSelected ? escapeHtml(myEntry.pred_last_scorer) : ''}" style="font-size: 0.85rem;" />
            </div>
          </div>

          <!-- Fråga 3: Lövens skott på mål (2p - närmast) -->
          <div class="loven-q-box">
            <div class="loven-q-header">
              <span class="loven-q-title">3. Lövens skott på mål</span>
              <span class="loven-pts-badge">2 POÄNG</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">
              Totalt antal skott på mål av Löven. <strong>2 poäng till den eller de som är närmast!</strong>
            </div>
            <div class="flex align-center gap-xs mb-xs" style="justify-content: center;">
              <input type="number" id="input-loven-shots" class="form-input text-center" min="5" max="100" value="${myEntry ? myEntry.pred_shots_on_goal : 31}" style="width: 80px; font-size: 1.15rem; font-weight: 800; padding: 6px;" />
              <span style="font-weight: 700; color: var(--text-secondary); font-size: 0.85rem;">skott</span>
            </div>
            <!-- Quick Chips -->
            <div class="flex gap-xs" style="justify-content: center; flex-wrap: wrap;">
              ${[26, 29, 31, 33, 36, 40].map(s => `
                <button type="button" class="btn btn-xs btn-secondary shot-chip-btn" data-shot="${s}" style="font-size: 0.72rem; padding: 2px 7px;">
                  ${s}
                </button>
              `).join('')}
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block" id="btn-save-tip" style="background: linear-gradient(135deg, #2d7a46 0%, #155724 100%); border-color: #d4af37; font-weight: 800; font-size: 0.95rem; padding: 10px;">
            🏒 ${myEntry ? 'Uppdatera mitt tips' : 'Lämna in matchtips'}
          </button>
        </form>
      ` : ''}

      <!-- Deltagare och Tips Leaderboard -->
      <div style="margin-top: 14px;">
        <div class="flex-between align-center mb-xs">
          <span style="font-size: 0.78rem; font-weight: 800; color: #d4af37; text-transform: uppercase;">
            👥 Deltagarnas Tips (${entries.length})
          </span>
          ${!isLocked ? `
            <span style="font-size: 0.7rem; color: var(--text-muted);">
              🔒 Dolda fram till matchstart
            </span>
          ` : ''}
        </div>

        ${entries.length === 0 ? `
          <div class="text-center text-muted" style="padding: 16px; background: rgba(0,0,0,0.2); border-radius: 8px; font-size: 0.78rem;">
            Inga tips inlämnade än. Bli den första!
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${entries.map((e, idx) => {
              const isWinner = isSettled && Boolean(e.is_winner);
              const isMe = e.user_id === user.id;

              return `
                <div class="loven-entry-card ${isWinner ? 'is-winner' : ''}">
                  <div class="flex-between align-center mb-xs">
                    <div class="flex align-center gap-xs">
                      <div style="width: 24px; height: 24px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; border: 1px solid var(--border-glass);">
                        ${e.avatar_url ? `<img src="${e.avatar_url}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />` : (e.avatar_emoji || '👤')}
                      </div>
                      <span style="font-weight: 700; font-size: 0.82rem; color: ${isMe ? '#ffd700' : '#fff'};">
                        ${escapeHtml(e.real_name || e.nickname)} ${isMe ? '(Du)' : ''}
                      </span>
                    </div>

                    ${isSettled ? `
                      <div class="flex align-center gap-xs">
                        <span style="font-weight: 900; font-size: 0.95rem; color: ${isWinner ? '#ffd700' : '#fff'};">
                          ${e.points} p
                        </span>
                        ${isWinner ? '🏆' : ''}
                      </div>
                    ` : `
                      <span style="font-size: 0.7rem; color: #4ade80; font-weight: 600;">Tips inlämnat ✓</span>
                    `}
                  </div>

                  <!-- Tips details -->
                  <div style="font-size: 0.74rem; color: var(--text-secondary); background: rgba(0,0,0,0.25); border-radius: 6px; padding: 6px 8px; display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 4px; text-align: center;">
                    <div>
                      <span style="color: var(--text-muted); display: block; font-size: 0.65rem;">1. Resultat</span>
                      <strong style="color: ${isSettled && e.pts_result === 4 ? '#4ade80' : 'inherit'};">
                        ${e.pred_loven_goals === '🔒' ? '🔒' : `${e.pred_loven_goals} - ${e.pred_opponent_goals}`}
                        ${isSettled ? `(${e.pts_result}p)` : ''}
                      </strong>
                    </div>
                    <div>
                      <span style="color: var(--text-muted); display: block; font-size: 0.65rem;">2. Sista mål</span>
                      <strong style="color: ${isSettled && e.pts_scorer === 3 ? '#4ade80' : 'inherit'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">
                        ${escapeHtml(e.pred_last_scorer || '')}
                        ${isSettled ? `(${e.pts_scorer}p)` : ''}
                      </strong>
                    </div>
                    <div>
                      <span style="color: var(--text-muted); display: block; font-size: 0.65rem;">3. Skott</span>
                      <strong style="color: ${isSettled && e.pts_shots === 2 ? '#4ade80' : 'inherit'};">
                        ${e.pred_shots_on_goal === '🔒' ? '🔒' : `${e.pred_shots_on_goal} st`}
                        ${isSettled ? `(${e.pts_shots}p)` : ''}
                      </strong>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <!-- Creator Adjudication & Administration Controls -->
      ${isCreator ? `
        <div style="margin-top: 20px; padding-top: 14px; border-top: 1px dashed rgba(212,175,55,0.3);">
          <div style="font-size: 0.78rem; font-weight: 800; color: #d4af37; margin-bottom: 8px; text-transform: uppercase;">
            👑 Skaparens Kontroller
          </div>

          ${!isSettled ? `
            <div id="settle-controls-box">
              <button type="button" class="btn btn-block btn-secondary mb-xs" id="btn-toggle-settle-form" style="background: rgba(45,122,70,0.3); border-color: #d4af37; color: #ffd700; font-weight: 800; font-size: 0.88rem; padding: 10px;">
                🏁 Rätta matchen & Fördela potten
              </button>

              <div id="loven-settle-form-wrapper" style="display: none; background: rgba(0,0,0,0.4); border: 1px solid #d4af37; border-radius: 10px; padding: 12px; margin-top: 8px;">
                <div style="font-weight: 800; font-size: 0.85rem; color: #fff; margin-bottom: 10px; text-align: center;">
                  Mata in officiellt matchresultat:
                </div>

                <div class="mb-sm">
                  <label class="form-label" style="font-size: 0.75rem;">1. Slutresultat:</label>
                  <div class="flex align-center gap-xs" style="justify-content: center;">
                    <div style="text-align: center;">
                      <span style="font-size: 0.7rem; color: #4ade80;">Löven mål</span>
                      <input type="number" id="input-result-loven" class="form-input text-center" min="0" max="30" value="4" style="width: 50px; font-weight: 800;" />
                    </div>
                    <span style="font-weight: 800; color: #d4af37; padding-top: 14px;">-</span>
                    <div style="text-align: center;">
                      <span style="font-size: 0.7rem; color: var(--text-secondary);">${escapeHtml(game.opponent_team).slice(0, 10)}</span>
                      <input type="number" id="input-result-opp" class="form-input text-center" min="0" max="30" value="2" style="width: 50px; font-weight: 800;" />
                    </div>
                  </div>
                </div>

                <div class="mb-sm">
                  <label class="form-label" style="font-size: 0.75rem;">2. Lövens sista målskytt:</label>
                  <select id="select-result-scorer" class="form-input" style="font-size: 0.82rem;">
                    ${getRosterSelectOptions('').html}
                  </select>
                  <div id="settle-custom-scorer-box" style="display: none; margin-top: 4px;">
                    <input type="text" id="input-settle-custom-scorer" class="form-input" placeholder="Spelarens namn..." style="font-size: 0.82rem;" />
                  </div>
                </div>

                <div class="mb-md">
                  <label class="form-label" style="font-size: 0.75rem;">3. Lövens totala skott på mål:</label>
                  <input type="number" id="input-result-shots" class="form-input text-center" min="0" max="120" value="32" style="width: 100px; margin: 0 auto; font-weight: 800;" />
                </div>

                <button type="button" class="btn btn-primary btn-block mb-xs" id="btn-confirm-settle-loven" style="background: linear-gradient(135deg, #2d7a46 0%, #155724 100%); border-color: #ffd700; font-weight: 800;">
                  🏆 Rätta & Tilldela Potten (Even Steven)
                </button>
              </div>

              <div class="flex gap-xs mt-xs">
                ${!isLocked ? `
                  <button type="button" class="btn btn-secondary btn-xs btn-block" id="btn-manual-lock-loven" style="font-size: 0.72rem;">
                    🔒 Lås tips nu
                  </button>
                ` : ''}
                <button type="button" class="btn btn-secondary btn-xs btn-block" id="btn-cancel-loven" style="color: #ff6b6b; font-size: 0.72rem;">
                  ❌ Avbryt match
                </button>
              </div>
            </div>
          ` : `
            <div style="font-size: 0.75rem; color: #4ade80; text-align: center; font-weight: 600;">
              ✓ Matchen är rättad och avräknad i The Tab.
            </div>
          `}
        </div>
      ` : ''}
    `;
  }

  function renderWinnerAnnouncement(game) {
    let winnerIds = game.winner_user_ids || [];
    if (typeof winnerIds === 'string') {
      try { winnerIds = JSON.parse(winnerIds); } catch { winnerIds = []; }
    }
    const entries = game.entries || [];
    const totalPot = entries.length * (Number(game.stake_amount) || 0);

    // Detailed view: entries are available, look up winners by user_id
    if (entries.length > 0) {
      const winners = entries.filter(e => winnerIds.includes(e.user_id));
      if (winners.length === 0) return 'Inga vinnare korade.';
      if (winners.length === 1) {
        const w = winners[0];
        return `🎉 ${escapeHtml(w.real_name || w.nickname)} vann hela potten på ${totalPot} kr! (${w.points} poäng)`;
      }
      const winnerNames = winners.map(w => escapeHtml(w.real_name || w.nickname)).join(' & ');
      const share = Math.floor(totalPot / winners.length);
      return `🤝 Delad vinst! ${winnerNames} delar potten lika: ca ${share} kr var! (${winners[0].points} poäng)`;
    }

    // History / list view: no entries loaded — use server-produced summary
    if (game.winner_summary) {
      return `🎉 ${escapeHtml(game.winner_summary)}`;
    }

    // No winners (e.g. no participants, or zero-stake cancelled game)
    if (winnerIds.length === 0) return 'Inga vinnare korade.';

    // Fallback: winner IDs exist but no summary yet (shouldn't happen in practice)
    return `🎉 ${winnerIds.length} vinnare`;
  }

  function renderCreateTab() {
    // Default match time: upcoming Saturday 18:00 or tomorrow 19:00
    const now = new Date();
    const defaultDate = new Date(now.getTime() + 24 * 3600 * 1000);
    defaultDate.setHours(19, 0, 0, 0);
    const dateStr = defaultDate.toISOString().slice(0, 16);

    return `
      <form id="form-create-loven-match" style="padding: 4px 0;">
        <!-- Opponent -->
        <div class="mb-sm">
          <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: #d4af37;">
            Motståndarlag:
          </label>
          <input type="text" id="input-opponent-team" class="form-input" placeholder="T.ex. MoDo Hockey, Djurgårdens IF..." required style="font-weight: 700;" />

          <!-- Quick Rival Chips -->
          <div class="flex gap-xs mt-xs" style="flex-wrap: wrap;">
            ${COMMON_OPPONENTS.slice(0, 8).map(opp => `
              <button type="button" class="loven-rival-chip opponent-chip-btn" data-team="${escapeHtml(opp)}">
                ${escapeHtml(opp.replace(' IF', '').replace(' Hockey', '').replace(' SK', '').replace(' IK', ''))}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Home / Away -->
        <div class="mb-sm">
          <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: #d4af37;">
            Spelplats:
          </label>
          <div class="flex gap-xs">
            <button type="button" class="btn btn-secondary venue-pick-btn active" data-home="1" style="flex: 1; font-weight: 700; border-color: #d4af37; background: rgba(45, 122, 70, 0.35); color: #ffd700;">
              🟢 Hemma (Visionite Arena)
            </button>
            <button type="button" class="btn btn-secondary venue-pick-btn" data-home="0" style="flex: 1; font-weight: 700;">
              ⚪ Borta
            </button>
          </div>
        </div>

        <!-- Date & Time -->
        <div class="mb-sm">
          <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: #d4af37;">
            Matchstart & Spelstopp:
          </label>
          <input type="datetime-local" id="input-match-date" class="form-input" value="${dateStr}" required style="font-weight: 600;" />
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
            Bettningen stängs automatiskt när matchen startar.
          </div>
        </div>

        <!-- Stake -->
        <div class="mb-sm">
          <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: #d4af37;">
            Insats per person:
          </label>
          <div class="flex align-center gap-xs mb-xs">
            <input type="number" id="input-stake-amount" class="form-input text-center" min="0" max="10000" step="5" value="50" style="width: 90px; font-size: 1.1rem; font-weight: 800;" />
            <span style="font-weight: 700; color: var(--text-secondary);">kr</span>
          </div>
          <div class="flex gap-xs" style="flex-wrap: wrap;">
            ${[0, 20, 50, 100, 200].map(s => `
              <button type="button" class="btn btn-xs btn-secondary stake-chip-btn ${s === 50 ? 'active' : ''}" data-stake="${s}" style="font-size: 0.72rem;">
                ${s === 0 ? 'Gratis (Äran)' : `${s} kr`}
              </button>
            `).join('')}
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
            Alla betalar samma insats. Vid delad förstaplats delas potten lika (Even Steven).
          </div>
        </div>

        <!-- Invite Friends -->
        ${friends.length > 0 ? `
          <div class="mb-md">
            <label class="form-label flex-between align-center" style="font-size: 0.8rem; font-weight: 700; color: #d4af37;">
              <span>Bjud in vänner:</span>
              <button type="button" class="btn btn-xs btn-secondary" id="btn-select-all-friends" style="font-size: 0.68rem; padding: 2px 6px;">
                Välj alla
              </button>
            </label>
            <div style="max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.25); border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 4px;">
              ${friends.map(f => `
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.78rem; cursor: pointer; padding: 2px 4px;">
                  <input type="checkbox" class="friend-invite-cb" value="${f.id}" checked />
                  <span>${escapeHtml(f.real_name || f.nickname)}</span>
                </label>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <button type="submit" class="btn btn-primary btn-block" id="btn-create-match-submit" style="background: linear-gradient(135deg, #2d7a46 0%, #155724 100%); border-color: #d4af37; font-weight: 800; font-size: 1rem; padding: 12px;">
          🏒 Skapa Löven Game & Bjud in
        </button>
      </form>
    `;
  }

  function renderHistoryTab(settledGames) {
    if (settledGames.length === 0) {
      return `
        <div class="text-center text-muted" style="padding: 30px 10px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">📋</div>
          <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 4px;">Inga avslutade matcher än</div>
          <p style="font-size: 0.78rem; max-width: 280px; margin: 0 auto;">
            När en match är spelad och rättad ser du vinnartavlan, alla deltagares poäng och Swish-uppgörelsen här.
          </p>
        </div>
      `;
    }

    return `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${settledGames.map(g => {
          const matchDateObj = new Date(g.match_date);
          const dateStr = matchDateObj.toLocaleDateString('sv-SE', {
            month: 'short',
            day: 'numeric'
          });

          return `
            <div class="loven-entry-card" style="border-color: rgba(212,175,55,0.3);">
              <div class="flex-between align-center mb-xs">
                <span style="font-size: 0.72rem; color: #d4af37; font-weight: 700;">
                  ${dateStr} · ${g.is_home ? 'Hemma' : 'Borta'}
                </span>
                <span class="badge" style="background: rgba(74,222,128,0.15); color: #4ade80; font-size: 0.7rem; font-weight: 700;">
                  Slutresultat
                </span>
              </div>

              <div style="font-size: 1.1rem; font-weight: 900; color: #fff; text-align: center; margin: 4px 0;">
                Björklöven ${g.result_loven_goals} - ${g.result_opponent_goals} ${escapeHtml(g.opponent_team)}
              </div>

              <div style="font-size: 0.75rem; text-align: center; color: var(--text-secondary); margin-bottom: 8px;">
                Sista mål: <strong style="color: #ffd700;">${escapeHtml(g.result_last_scorer || '-')}</strong> · Skott: <strong style="color: #ffd700;">${g.result_shots_on_goal}</strong>
              </div>

              <div class="flex-between align-center" style="background: rgba(0,0,0,0.3); border-radius: 6px; padding: 6px 10px; font-size: 0.75rem;">
                <span>${renderWinnerAnnouncement(g)}</span>
                <button type="button" class="btn btn-xs btn-secondary view-past-match-btn" data-game-id="${g.id}">
                  Visa tabell
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function attachEventHandlers(currentGame) {
    // Tab switching
    root.querySelectorAll('.loven-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        render();
      });
    });

    // Match switcher button
    root.querySelectorAll('.match-picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedGameId = btn.getAttribute('data-game-id');
        render();
      });
    });

    // View past match from history
    root.querySelectorAll('.view-past-match-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedGameId = btn.getAttribute('data-game-id');
        activeTab = 'match';
        render();
      });
    });

    // Go to create match from empty state
    root.querySelector('#btn-goto-create-match')?.addEventListener('click', () => {
      activeTab = 'create';
      render();
    });

    // ── Tab 1 Handlers: Tips Submission ──
    const formSubmitTip = root.querySelector('#form-loven-submit-tip');
    if (formSubmitTip && currentGame) {
      // Stepper buttons for goals
      formSubmitTip.querySelectorAll('.btn-step').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-target');
          const dir = parseInt(btn.getAttribute('data-dir'), 10) || 0;
          const input = target === 'loven-goals'
            ? formSubmitTip.querySelector('#input-loven-goals')
            : formSubmitTip.querySelector('#input-opp-goals');
          if (input) {
            const current = parseInt(input.value, 10) || 0;
            input.value = Math.max(0, Math.min(25, current + dir));
          }
        });
      });

      // Scorer dropdown custom trigger
      const selectScorer = formSubmitTip.querySelector('#select-loven-scorer');
      const customScorerBox = formSubmitTip.querySelector('#custom-scorer-box');
      selectScorer?.addEventListener('change', () => {
        if (selectScorer.value === '__custom__') {
          customScorerBox.style.display = 'block';
          customScorerBox.querySelector('#input-custom-scorer')?.focus();
        } else {
          customScorerBox.style.display = 'none';
        }
      });

      // Quick shot chips
      formSubmitTip.querySelectorAll('.shot-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const shotVal = btn.getAttribute('data-shot');
          const shotsInput = formSubmitTip.querySelector('#input-loven-shots');
          if (shotsInput) shotsInput.value = shotVal;
        });
      });

      // Submit Tips
      formSubmitTip.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        const pLoven = parseInt(formSubmitTip.querySelector('#input-loven-goals')?.value, 10);
        const pOpp = parseInt(formSubmitTip.querySelector('#input-opp-goals')?.value, 10);
        const pShots = parseInt(formSubmitTip.querySelector('#input-loven-shots')?.value, 10);

        let scorer = selectScorer ? selectScorer.value : '';
        if (scorer === '__custom__') {
          scorer = formSubmitTip.querySelector('#input-custom-scorer')?.value.trim();
        }

        if (isNaN(pLoven) || isNaN(pOpp) || isNaN(pShots)) {
          showToast('Fyll i alla fält (mål och skott)', 'warning');
          return;
        }

        if (!scorer) {
          showToast('Välj eller ange Lövens sista målskytt', 'warning');
          return;
        }

        if (Number(currentGame.stake_amount) > 0 && !user.swish_number) {
          showToast('Du måste ange ditt Swish-nummer i profilen innan du deltar i spel med insats', 'warning');
          return;
        }

        isSubmitting = true;
        const btnSave = formSubmitTip.querySelector('#btn-save-tip');
        if (btnSave) btnSave.disabled = true;

        try {
          await joinLovenGame(currentGame.id, {
            predLovenGoals: pLoven,
            predOpponentGoals: pOpp,
            predLastScorer: scorer,
            predShotsOnGoal: pShots
          });
          playCoinSound();
          showToast('Ditt matchtips är sparat! 🏒 ⭐', 'success');
          await loadData();
        } catch (err) {
          showToast(err.message || 'Kunde inte spara tipset', 'error');
        } finally {
          isSubmitting = false;
          if (btnSave) btnSave.disabled = false;
        }
      });
    }

    // ── Tab 1 Creator Controls ──
    const btnToggleSettle = root.querySelector('#btn-toggle-settle-form');
    const settleFormWrapper = root.querySelector('#loven-settle-form-wrapper');
    btnToggleSettle?.addEventListener('click', () => {
      const isHidden = settleFormWrapper.style.display === 'none';
      settleFormWrapper.style.display = isHidden ? 'block' : 'none';
    });

    const selectResultScorer = root.querySelector('#select-result-scorer');
    const settleCustomScorerBox = root.querySelector('#settle-custom-scorer-box');
    selectResultScorer?.addEventListener('change', () => {
      if (selectResultScorer.value === '__custom__') {
        settleCustomScorerBox.style.display = 'block';
        settleCustomScorerBox.querySelector('#input-settle-custom-scorer')?.focus();
      } else {
        settleCustomScorerBox.style.display = 'none';
      }
    });

    // Confirm Settle
    const btnConfirmSettle = root.querySelector('#btn-confirm-settle-loven');
    btnConfirmSettle?.addEventListener('click', async () => {
      if (!currentGame || isSubmitting) return;

      const resLoven = parseInt(root.querySelector('#input-result-loven')?.value, 10);
      const resOpp = parseInt(root.querySelector('#input-result-opp')?.value, 10);
      const resShots = parseInt(root.querySelector('#input-result-shots')?.value, 10);

      let scorer = selectResultScorer ? selectResultScorer.value : '';
      if (scorer === '__custom__') {
        scorer = root.querySelector('#input-settle-custom-scorer')?.value.trim();
      }

      if (isNaN(resLoven) || isNaN(resOpp) || !scorer || isNaN(resShots)) {
        showToast('Fyll i alla resultatfält för att rätta matchen', 'warning');
        return;
      }

      if (!confirm('Är du säker på att du vill rätta matchen och fördela potten?')) {
        return;
      }

      isSubmitting = true;
      btnConfirmSettle.disabled = true;

      try {
        await settleLovenGame(currentGame.id, {
          resultLovenGoals: resLoven,
          resultOpponentGoals: resOpp,
          resultLastScorer: scorer,
          resultShotsOnGoal: resShots
        });
        playWinSound();
        launchConfetti();
        showToast('Matchen är rättad och potten fördelad i THE TAB! 🏆', 'success');
        await loadData();
      } catch (err) {
        showToast(err.message || 'Kunde inte rätta matchen', 'error');
      } finally {
        isSubmitting = false;
        btnConfirmSettle.disabled = false;
      }
    });

    // Manual lock
    root.querySelector('#btn-manual-lock-loven')?.addEventListener('click', async () => {
      if (!currentGame) return;
      try {
        await lockLovenGame(currentGame.id);
        showToast('Tipsen är nu låsta! 🔒', 'info');
        await loadData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Cancel match
    root.querySelector('#btn-cancel-loven')?.addEventListener('click', async () => {
      if (!currentGame) return;
      if (!confirm('Vill du verkligen avbryta denna match?')) return;
      try {
        await cancelLovenGame(currentGame.id);
        showToast('Matchen har avbrutits', 'info');
        await loadData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // ── Tab 2 Handlers: Create Match ──
    const formCreate = root.querySelector('#form-create-loven-match');
    if (formCreate) {
      // Opponent quick chips
      formCreate.querySelectorAll('.opponent-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const team = btn.getAttribute('data-team');
          const oppInput = formCreate.querySelector('#input-opponent-team');
          if (oppInput) oppInput.value = team;
        });
      });

      // Venue buttons
      let isHomeSelected = 1;
      formCreate.querySelectorAll('.venue-pick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formCreate.querySelectorAll('.venue-pick-btn').forEach(b => {
            b.classList.remove('active');
            b.style.borderColor = 'rgba(255,255,255,0.12)';
            b.style.background = 'rgba(0,0,0,0.2)';
            b.style.color = 'var(--text-secondary)';
          });
          btn.classList.add('active');
          btn.style.borderColor = '#d4af37';
          btn.style.background = 'rgba(45, 122, 70, 0.35)';
          btn.style.color = '#ffd700';
          isHomeSelected = parseInt(btn.getAttribute('data-home'), 10);
        });
      });

      // Stake chips
      formCreate.querySelectorAll('.stake-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formCreate.querySelectorAll('.stake-chip-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const stake = btn.getAttribute('data-stake');
          const stakeInput = formCreate.querySelector('#input-stake-amount');
          if (stakeInput) stakeInput.value = stake;
        });
      });

      // Select all friends
      formCreate.querySelector('#btn-select-all-friends')?.addEventListener('click', () => {
        const cbs = formCreate.querySelectorAll('.friend-invite-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => { cb.checked = !allChecked; });
      });

      // Create match submit
      formCreate.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        const opponent = formCreate.querySelector('#input-opponent-team')?.value.trim();
        const matchDate = formCreate.querySelector('#input-match-date')?.value;
        const stake = parseInt(formCreate.querySelector('#input-stake-amount')?.value, 10) || 0;

        if (!opponent) {
          showToast('Ange motståndarlag', 'warning');
          return;
        }
        if (!matchDate) {
          showToast('Ange matchdatum och tid', 'warning');
          return;
        }
        if (stake > 0 && !user.swish_number) {
          showToast('Du måste ange ditt Swish-nummer i profilen innan du skapar spel med insats', 'warning');
          return;
        }

        const friendIds = Array.from(formCreate.querySelectorAll('.friend-invite-cb:checked')).map(cb => cb.value);

        isSubmitting = true;
        const submitBtn = formCreate.querySelector('#btn-create-match-submit');
        if (submitBtn) submitBtn.disabled = true;

        try {
          const res = await createLovenGame({
            opponentTeam: opponent,
            isHome: Boolean(isHomeSelected),
            matchDate: new Date(matchDate).toISOString(),
            stakeAmount: stake,
            targetFriendIds: friendIds
          });

          playWinSound();
          showToast(`Löven Game skapat mot ${opponent}! 🏒`, 'success');
          selectedGameId = res?.game?.id || null;
          activeTab = 'match';
          await loadData();
        } catch (err) {
          showToast(err.message || 'Kunde inte skapa matchen', 'error');
        } finally {
          isSubmitting = false;
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  // Initial load
  loadData();
}

