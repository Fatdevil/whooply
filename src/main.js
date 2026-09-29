import { renderNavbar } from './components/navbar.js';
import { renderHome } from './pages/home.js';
import { initAds } from './components/ads.js';
import { addFriend, getPartyRoom, joinPartyRoom, connectWebSocket } from './api.js';
import { isLoggedIn, getStoredUser } from './auth.js';
import { showToast } from './utils.js';
import { closeModal, isGameInProgress } from './components/modal.js';
import { openBlind10Modal, openMafiaModal, openSpaceInvadersModal, openAllArcadeGamesModal, openFlashBetModal, openAnyBetModal, openLovenGameModal } from './components/minigames.js';
import { initMaltaSupportWidget } from './components/maltaSupport.js';
import { setDeferredPrompt, isAppStandalone, shouldShowAutoPrompt, showPwaInstallModal } from './components/pwaInstallModal.js';
import { isPushSupported, subscribeToPush, syncPushSubscription } from './push.js';
import { resetBack, interceptBack, getBackParent } from './backNav.js';
import { initTheme } from './theme.js';

// ── Apply saved theme immediately (before first render) ──
initTheme();

// ── Global Client Error Reporting ─────────────────────
let reportedErrorsCount = 0;
function reportClientError(errData) {
  if (reportedErrorsCount > 10) return;
  reportedErrorsCount++;
  try {
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...errData,
        url: window.location.href,
        userAgent: navigator.userAgent
      })
    }).catch(() => {});
  } catch (e) {}
}

window.addEventListener('error', (event) => {
  reportClientError({
    message: event.message,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  reportClientError({
    message: event.reason?.message || String(event.reason),
    source: 'unhandledrejection',
    lineno: 0,
    colno: 0
  });
});

let currentPage = 'home';
let currentParams = {};
let activeCleanup = null;

// How many in-app steps can be undone with history.back()
const historyDepth = () => Number(window.history.state?.depth) || 0;

function cleanupActivePage() {
  resetBack();
  if (activeCleanup) {
    try { activeCleanup(); } catch {}
    activeCleanup = null;
  }
}

export function navigate(page, params = {}, { replace = false } = {}) {
  // Cleanup previous page
  cleanupActivePage();

  currentPage = page;
  currentParams = params;

  // Update URL
  const url = pageUrl(page, params);
  if (replace) {
    window.history.replaceState({ depth: historyDepth() }, '', url);
    guardSubPage();
  } else {
    window.history.pushState({ depth: historyDepth() + 1 }, '', url);
  }
  shownDepth = historyDepth();

  renderApp();
}

const SUB_PAGES = new Set(['event', 'tournament']);

// Depth of the entry on screen: popstate says neither back nor forward, this does
let shownDepth = 0;

// A sub page opened with nothing of the app underneath (a shared link, a notification):
// the phone's back would leave the app before any code runs. Put a guard entry below it,
// so back lands here and shows the parent instead (or first closes an open bet slip)
function guardSubPage() {
  if (!SUB_PAGES.has(currentPage) || historyDepth() > 0) return;
  const url = pageUrl(currentPage, currentParams);
  window.history.replaceState({ depth: 0, guard: true }, '', url);
  window.history.pushState({ depth: 1 }, '', url);
}

function pageUrl(page, params = {}) {
  const url = new URL(window.location);
  url.searchParams.delete('code');
  url.searchParams.delete('tab');
  url.searchParams.set('page', page);
  if (params.code) url.searchParams.set('code', params.code);
  if (params.tab) url.searchParams.set('tab', params.tab);
  return url;
}

// "‹" in the header: close what the page has open, else step back inside the app,
// else go to the page's parent (the event for a game, Betting for the rest)
function goBack() {
  if (interceptBack()) return;
  if (historyDepth() > 0) {
    window.history.back();
    return;
  }
  const parent = getBackParent() || { page: 'home', params: {} };
  navigate(parent.page, parent.params, { replace: true });
}

// After a new deploy, a phone that kept the old app open in the background asks for page
// files that no longer exist. Reload once to get the new version instead of silently
// staying on the previous page.
const PAGE_RELOAD_KEY = 'whooply_page_reload_at';

function reloadForNewVersion() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(PAGE_RELOAD_KEY)) || 0; } catch {}
  if (Date.now() - last < 30000) return false;
  try { sessionStorage.setItem(PAGE_RELOAD_KEY, String(Date.now())); } catch {}
  window.location.reload();
  return true;
}

function renderPageLoadError() {
  const content = document.getElementById('page-content');
  if (!content) return;
  content.innerHTML = `
    <div class="card text-center animate-in" style="padding: var(--space-lg); margin-top: var(--space-md);">
      <div style="font-size: 2.2rem; margin-bottom: 6px;">📶</div>
      <h3 style="font-size: 1.05rem; margin-bottom: 6px;">Sidan kunde inte laddas</h3>
      <p class="text-muted" style="font-size: 0.85rem; margin-bottom: var(--space-md);">Kontrollera uppkopplingen och försök igen.</p>
      <button type="button" class="btn btn-primary btn-block" id="btn-page-reload">Ladda om</button>
    </div>
  `;
  document.getElementById('btn-page-reload')?.addEventListener('click', () => window.location.reload());
}

let renderSeq = 0;

async function renderApp() {
  const seq = ++renderSeq;

  // Render navbar
  document.getElementById('navbar').innerHTML = renderNavbar(currentPage);

  // Attach nav listeners
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.nav);
    });
  });

  // Render current page (Home is instant, other pages lazy loaded on demand)
  const loaders = {
    event: () => import('./pages/event.js'),
    join: () => import('./pages/join.js'),
    admin: () => import('./pages/admin.js'),
    profile: () => import('./pages/profile.js'),
    leaderboard: () => import('./pages/leaderboard.js'),
    tournament: () => import('./pages/tournament.js')
  };
  const loader = loaders[currentPage];
  if (!loader) {
    renderHome();
    return;
  }

  let mod;
  try {
    mod = await loader();
  } catch (err) {
    console.warn('[nav] Could not load page', currentPage, err);
    if (seq !== renderSeq) return;
    if (!reloadForNewVersion()) renderPageLoadError();
    return;
  }
  // A newer navigation happened while this page was loading
  if (seq !== renderSeq) return;

  switch (currentPage) {
    case 'event':
      activeCleanup = mod.cleanupEvent;
      mod.renderEvent(currentParams);
      break;
    case 'join':
      mod.renderJoin();
      break;
    case 'admin':
      mod.renderAdmin();
      break;
    case 'profile':
      mod.renderProfile();
      break;
    case 'leaderboard':
      mod.renderLeaderboard(currentParams);
      break;
    case 'tournament':
      activeCleanup = mod.cleanupTournament;
      mod.renderTournament(currentParams);
      break;
  }
}

// ── PWA & Service Worker Initialization ──────────────────
function initPwa() {
  if ('serviceWorker' in navigator) {
    const registerSw = () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('[SW] Registration failed:', err);
      });
    };
    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw);
    }
  }

  // Devices that already allowed notifications (browser or installed app): make sure the
  // server still has a valid subscription for them. It can go stale silently, and then no
  // "pling" ever arrives although the phone says notifications are allowed.
  if (isLoggedIn()) syncPushSubscription();

  // Catch native Android/Chrome prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setDeferredPrompt(e);
  });

  // If already installed as standalone app on home screen
  if (isAppStandalone()) {
    checkFirstRunPushPrompt();
    return;
  }

  // If running in normal browser, gently offer installation guide after 12s of engagement
  if (shouldShowAutoPrompt()) {
    const offerInstall = () => {
      if (isAppStandalone() || !shouldShowAutoPrompt()) return;
      // Never replace a dialog that is open (a game, its result, a form...)
      if (isGameInProgress() || document.getElementById('modal-root')?.childElementCount) {
        setTimeout(offerInstall, 30000);
        return;
      }
      const isMobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
      if (isMobile) {
        showPwaInstallModal({ forced: false });
      }
    };
    setTimeout(offerInstall, 12000);
  }
}

// ── Standalone First-Run Push Notification Invitation ────
function checkFirstRunPushPrompt() {
  if (!isPushSupported() || !isLoggedIn()) return;
  if (Notification.permission !== 'default') return;

  const PUSH_PROMPT_KEY = 'whooply_first_run_push_asked';
  if (localStorage.getItem(PUSH_PROMPT_KEY)) return;

  setTimeout(async () => {
    if (Notification.permission !== 'default') return;
    // Ask later instead of interrupting a game in progress
    if (isGameInProgress()) return;
    localStorage.setItem(PUSH_PROMPT_KEY, '1');

    const { showModal, closeModal } = await import('./components/modal.js');
    showModal(
      '🔔 Blixtsnabba notiser',
      `
        <div class="text-center animate-in" style="padding: 4px;">
          <div style="font-size: 2.8rem; margin-bottom: 8px;">⚡</div>
          <h4 style="margin-bottom: 8px; color: var(--gold); font-weight: 800;">Missa inga BlixtBets!</h4>
          <p class="text-muted" style="font-size: 0.85rem; line-height: 1.45; margin-bottom: var(--space-md);">
            Nu när du har sparat appen kan du få notiser direkt i mobilen när vänner startar ett <strong>BlixtBet</strong> eller utmanar dig på en duell.
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button class="btn btn-primary btn-block" id="btn-first-run-enable-push" style="font-weight: 700; background: linear-gradient(135deg, var(--gold), #f59e0b); border: none;">
              🔔 Slå på notiser nu
            </button>
            <button class="btn btn-secondary btn-block btn-sm" id="btn-first-run-skip-push">
              Kanske senare
            </button>
          </div>
        </div>
      `,
      null
    );

    document.getElementById('btn-first-run-skip-push')?.addEventListener('click', () => {
      closeModal();
    });

    document.getElementById('btn-first-run-enable-push')?.addEventListener('click', async () => {
      closeModal();
      try {
        await subscribeToPush();
        showToast('🔔 Notiser aktiverade! Du får nu blixtsnabb info i mobilen.', 'success');
      } catch (err) {
        showToast(err.message || 'Kunde inte aktivera notiser', 'error');
      }
    });
  }, 2500);
}

// ── Init ──────────────────────────────────────────────
function init() {
  initPwa();
  const url = new URL(window.location);
  const page = url.searchParams.get('page') || 'home';
  const code = url.searchParams.get('code');
  const tab = url.searchParams.get('tab');

  currentPage = page;
  currentParams = { ...(code ? { code } : {}), ...(tab ? { tab } : {}) };

  // Every entry carries its depth, so "‹" knows whether history.back() stays in the app
  if (!('depth' in (window.history.state || {}))) window.history.replaceState({ ...(window.history.state || {}), depth: 0 }, '');
  window.addEventListener('app-back', goBack);

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    // The phone's back closes an open bet slip first and stays on the page.
    // Only going back: forward must still go forward
    const goingBack = historyDepth() < shownDepth;
    if (goingBack && interceptBack()) {
      window.history.pushState({ depth: historyDepth() + 1 }, '', pageUrl(currentPage, currentParams));
      shownDepth = historyDepth();
      return;
    }
    shownDepth = historyDepth();
    // Back onto the guard below a directly opened page: go to its parent, stay in the app
    if (window.history.state?.guard) {
      const parent = getBackParent() || { page: 'home', params: {} };
      navigate(parent.page, parent.params, { replace: true });
      return;
    }
    cleanupActivePage();
    const url = new URL(window.location);
    currentPage = url.searchParams.get('page') || 'home';
    const code = url.searchParams.get('code');
    const tab = url.searchParams.get('tab');
    currentParams = { ...(code ? { code } : {}), ...(tab ? { tab } : {}) };
    renderApp();
  });

  // Handle legacy hash navigation fallback (e.g. #admin, #home, #profile, #tournament/CODE, #leaderboard)
  function handleHashRoute(initial = false) {
    const opts = { replace: initial === true };
    const hash = (window.location.hash || '').replace(/^#\/?/, '');
    if (!hash) return;
    // A notification link replaces whatever dialog was open (e.g. the games list),
    // but never a game in progress: that would throw both players out of the round
    const gameRunning = isGameInProgress();
    if (!gameRunning) closeModal();
    const clearHash = () => window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    // Game notifications open the right game on top of the betting page
    const openOnHome = (open) => {
      clearHash();
      if (gameRunning) {
        showToast('Avsluta spelet du är i först, öppna sedan notisen igen.', 'info');
        return;
      }
      if (currentPage !== 'home') navigate('home');
      open();
    };
    if (hash === 'admin' || hash === 'home' || hash === 'profile' || hash === 'join') {
      clearHash();
      navigate(hash);
    } else if (hash === 'leaderboard' || hash === 'swishlist' || hash === 'the-tab') {
      clearHash();
      navigate('leaderboard', { tab: hash === 'swishlist' ? 'swishlist' : 'tournaments' });
    } else if (hash.startsWith('tournament?code=')) {
      // Older notification links
      const tCode = decodeURIComponent(hash.split('code=')[1] || '');
      clearHash();
      if (tCode) navigate('tournament', { code: tCode });
    } else if (hash.startsWith('flashbet/')) {
      const id = decodeURIComponent(hash.split('/')[1] || '');
      openOnHome(() => openFlashBetModal(id || null));
    } else if (hash.startsWith('anybet/')) {
      const id = decodeURIComponent(hash.split('/')[1] || '');
      openOnHome(() => openAnyBetModal(id || null));
    } else if (hash === 'loven' || hash.startsWith('loven/')) {
      openOnHome(() => openLovenGameModal());
    } else if (hash.startsWith('tournament/')) {
      const tCode = hash.split('/')[1];
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      navigate('tournament', { code: tCode }, opts);
    } else if (hash.startsWith('event/')) {
      const eCode = hash.split('/')[1];
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      navigate('event', { code: eCode }, opts);
    } else if (hash === 'arcade' || hash === 'duels') {
      // Used by duel and game notifications: open the games from the betting page
      openOnHome(() => openAllArcadeGamesModal());
    }
  }

  window.addEventListener('hashchange', () => handleHashRoute());

  // A tapped notification while the app is already open: the service worker asks the
  // page to go to the notification's link (party rooms, hash routes, other pages)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type !== 'open-url' || !e.data.url) return;
      let target;
      try {
        target = new URL(e.data.url, window.location.origin);
      } catch {
        return;
      }
      if (target.origin !== window.location.origin) return;
      const partyCode = (target.searchParams.get('party') || target.searchParams.get('room') || '').trim().toUpperCase();
      if (partyCode) {
        handlePartyRoomDeepLink(partyCode);
      } else if (target.hash && target.hash !== '#') {
        window.location.hash = target.hash;
        handleHashRoute();
      } else {
        window.location.assign(target.href);
      }
    });
    navigator.serviceWorker.startMessages?.();
  }

  // Older notifications linked to paths such as /duels or /leaderboard that do not exist
  const legacyPaths = { '/duels': '#arcade', '/leaderboard': '#swishlist', '/the-tab': '#swishlist' };
  if (legacyPaths[window.location.pathname]) {
    window.history.replaceState(window.history.state, '', `/${window.location.search}${legacyPaths[window.location.pathname]}`);
  }
  if (window.location.hash) handleHashRoute(true);

  // Intercept clicks on hash links in SPA
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href === '#' || href.startsWith('#!')) return;
    const route = href.replace(/^#\/?/, '');
    if (route === 'admin' || route === 'home' || route === 'profile' || route === 'join') {
      e.preventDefault();
      navigate(route);
    } else if (route === 'leaderboard' || route === 'swishlist') {
      e.preventDefault();
      navigate('leaderboard', { tab: route === 'swishlist' ? 'swishlist' : 'tournaments' });
    } else if (route.startsWith('tournament/')) {
      e.preventDefault();
      const tCode = route.split('/')[1];
      navigate('tournament', { code: tCode });
    } else if (route.startsWith('event/')) {
      e.preventDefault();
      const eCode = route.split('/')[1];
      navigate('event', { code: eCode });
    }
  });

  // Handle custom navigation events (from profile page etc.)
  window.addEventListener('navigate', (e) => {
    navigate(e.detail.page, e.detail);
  });

  // Stored session is no longer valid (expired token, or Safari cleared the login)
  window.addEventListener('auth-expired', () => {
    showToast('Din inloggning har gått ut. Logga in igen för att se och betta på matcher. 🔑', 'info');
    renderApp();
  });

  // Handle language switch
  window.addEventListener('lang-changed', () => {
    renderApp();
  });

  initAds();
  initMaltaSupportWidget();
  guardSubPage();
  shownDepth = historyDepth();
  renderApp();

  // Handle friend invite link ?addFriend=nickname&ft=token
  const addFriendParam = url.searchParams.get('addFriend');
  if (addFriendParam) {
    const invite = { nickname: addFriendParam, inviteToken: url.searchParams.get('ft') || undefined };
    if (isLoggedIn()) {
      addFriend(invite)
        .then((res) => {
          showToast(res.message || `Du och @${res.friend?.nickname || addFriendParam} är nu vänner! 👥🎉`, res.status === 'pending' ? 'info' : 'success');
        })
        .catch((err) => showToast(err.message, 'error'));
    } else {
      sessionStorage.setItem('pending_friend_invite', JSON.stringify(invite));
      showToast(`Logga in eller skapa profil för att bli vän med @${addFriendParam}! 👋`, 'info');
    }
    url.searchParams.delete('addFriend');
    url.searchParams.delete('ft');
    window.history.replaceState(window.history.state, '', url);
  }

  // Handle party/room QR link ?party=CODE or ?room=CODE
  const partyParam = (url.searchParams.get('party') || url.searchParams.get('room') || '').trim().toUpperCase();
  if (partyParam) {
    url.searchParams.delete('party');
    url.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', url);

    handlePartyRoomDeepLink(partyParam);
  }


  // Connect central WebSocket if logged in
  if (isLoggedIn()) {
    connectWebSocket();
  }

  // Handle live stream deep link ?live=ID or ?liveId=ID
  const liveParam = url.searchParams.get('live') || url.searchParams.get('liveId');
  if (liveParam) {
    url.searchParams.delete('live');
    url.searchParams.delete('liveId');
    window.history.replaceState(window.history.state, '', url);

    import('./components/livestream.js').then(({ openLiveStreamModal }) => {
      import('./api.js').then(({ getFlashLive }) => {
        getFlashLive(liveParam).then(({ live, flashBet, livekitToken, livekitUrl }) => {
          const currentUser = getStoredUser();
          const isHost = currentUser && live.hostId === currentUser.id;
          openLiveStreamModal({
            isBroadcaster: isHost,
            isStandalone: true,
            liveId: live.id,
            flashBetId: live.flashBetId,
            hasBet: live.hasBet,
            tournamentName: `${live.hostName} sänder live ⚡`,
            initialQuestion: live.question,
            initialFlashBet: flashBet,
            livekitToken,
            livekitUrl,
            endsAt: live.endsAt
          });
        }).catch(err => {
          showToast(err.message || 'Kunde inte ansluta till livesändningen', 'error');
        });
      });
    });
  }
}

async function handlePartyRoomDeepLink(code) {
  if (isGameInProgress()) {
    showToast('Avsluta spelet du är i först, öppna sedan inbjudan igen.', 'info');
    return;
  }
  try {
    const res = await getPartyRoom(code);
    const room = res?.room;
    if (!room) {
      showToast('Rummet hittades inte eller har löpt ut', 'error');
      return;
    }

    if (isLoggedIn()) {
      const joinRes = await joinPartyRoom({ code });
      const joinedRoom = joinRes?.room || room;
      const gameLabel = joinedRoom.gameType === 'mafia' ? 'Maffia' : (joinedRoom.gameType === 'space_invaders' ? 'Space Blitz' : 'The Blind 10.00');
      showToast(`Ansluten till ${gameLabel}! 🎉`, 'success');
      if (joinedRoom.gameType === 'mafia') {
        openMafiaModal(joinedRoom);
      } else if (joinedRoom.gameType === 'space_invaders') {
        openSpaceInvadersModal({ mode: 'party', room: joinedRoom });
      } else {
        openBlind10Modal(joinedRoom);
      }
    } else {
      sessionStorage.setItem('pending_party_join', code);
      const gameLabel = room.gameType === 'mafia' ? 'Maffia' : (room.gameType === 'space_invaders' ? 'Space Blitz' : 'The Blind 10.00');
      showToast(`Skapa profil eller logga in för att gå med i ${gameLabel}! 🎮`, 'info');
      navigate('profile');
    }
  } catch (err) {
    showToast(err.message || 'Kunde inte ansluta till rummet', 'error');
  }
}

init();
