// ── Page: Home / Dashboard ────────────────────────────
import { getEvents, getTournaments, getActiveFlashLives, getInbox, getSettlementsOverview } from '../api.js';
import { formatCurrency, formatDate, formatDeadline, parseDateSafe, statusLabel, statusBadgeClass, escapeHtml, showToast, renderLoginPrompt, attachLoginPrompt } from '../utils.js';
import { navigate } from '../main.js';
import { t, getLang } from '../i18n.js';
import { renderMinigamesRoller, attachMinigamesListeners } from '../components/minigames.js';
import { openLiveStreamModal } from '../components/livestream.js';
import { getStoredUser, isLoggedIn } from '../auth.js';
import { openAppQrModal } from '../components/appQrModal.js';
import { renderSponsorCarousel, initSponsorCarousel } from '../components/sponsor-carousel.js';
import { isPushSupported, getPushPermissionState, subscribeToPush } from '../push.js';

export async function renderHome() {
  const isEn = getLang() === 'en';
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div id="home-live-banner-container"></div>
    <div class="page-header animate-in" style="padding-top: 0; margin-top: -4px; margin-bottom: 4px;">
      <div class="home-logo-wrap" id="home-logo-btn" role="button" tabindex="0" style="max-width: 150px; margin: 0 auto; cursor: pointer;" title="Whooply">
        <img src="/logo-banner.png" alt="Whooply" class="home-logo-banner" />
      </div>
    </div>
    <div id="home-action-feed-container"></div>
    <div id="tournaments-list"></div>
    <div id="events-list">
      <div class="text-center text-muted mt-lg">${t('common.loading')}</div>
    </div>
    ${renderMinigamesRoller()}
    <div id="home-push-banner-container"></div>
  `;

  document.getElementById('home-logo-btn')?.addEventListener('click', () => {
    openAppQrModal();
  });
  document.getElementById('home-logo-btn')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAppQrModal();
    }
  });

  attachMinigamesListeners();
  initHomeLiveBanners();
  initHomePushBanner(isEn);

  try {
    // Keep the two feeds independent. Previously one failed request (most often an
    // expired login token on iOS/PWA) hid both Events and tournaments because the
    // shared Promise.all rejected before either list was rendered.
    const [eventsResult, tournamentsResult] = await Promise.allSettled([getEvents(), getTournaments()]);
    if (!document.getElementById('events-list') || !document.getElementById('tournaments-list')) return;

    const events = eventsResult.status === 'fulfilled' && Array.isArray(eventsResult.value)
      ? eventsResult.value
      : [];
    const tournaments = tournamentsResult.status === 'fulfilled' && Array.isArray(tournamentsResult.value)
      ? tournamentsResult.value
      : [];
    const eventsError = eventsResult.status === 'rejected' ? eventsResult.reason : null;
    initHomeActionFeed(isEn, events);

    // Tournaments ("Events") are only listed for logged-in users. Without a login (common on
    // iPhone: Safari clears storage after 7 days and the home-screen app has its own login)
    // they would silently be missing, so explain why and offer a login.
    const tList = document.getElementById('tournaments-list');
    if (!isLoggedIn()) {
      tList.innerHTML = renderLoginPrompt(isEn
        ? 'Log in to see your events and bet with your friends.'
        : 'Logga in för att se dina event och betta med kompisarna.');
      attachLoginPrompt(tList);
    } else if (tournaments.length > 0) {
      const activeCount = tournaments.filter(t => t.status === 'active').length;
      const headerBadge = activeCount > 0
        ? `${activeCount} ${isEn ? 'LIVE' : 'PÅGÅR'}`
        : (isEn ? 'SEASON 2026' : 'SÄSONG 2026');
      // One clearly tappable card per event: chevron, status, one info line and an action
      // row that says what to do next. Sponsors sit below the action, never in the way.
      const renderEventCard = (tr, i) => {
        const isActive = tr.status === 'active';
        const games = tr.roundCount || 0;
        // Who is in (and, added below, your result so far). No total of all pots: each game
        // row shows its own pot, and a total next to your result read as "your share of it"
        const info = [
          games === 0 ? (isEn ? 'No games yet' : 'Inga spel än') : isActive ? '' : `<b>${games} ${isEn ? (games === 1 ? 'game' : 'games') : 'spel'}</b>`,
          tr.participantCount ? `👥 ${tr.participantCount} ${isEn ? 'in' : 'med'}` : ''
        ].filter(Boolean).join(' · ');
        // Up to three open games (the ones you have not bet on first, then closing soonest),
        // then up to two closed games you are in that wait for a result
        const upNext = isActive ? (tr.upNext || []) : [];
        const waiting = isActive ? (tr.waiting || []) : [];
        const seeAll = `<span class="home-see-all">${isEn ? 'See all' : 'Visa alla'} ›</span>`;
        const sectionHead = (label, count, withLink) =>
          `<div class="home-games-head"><span class="home-games-label">${label} · ${count}</span>${withLink ? seeAll : ''}</div>`;
        const openHtml = upNext.length ? `
          ${sectionHead(isEn ? 'Open games' : 'Öppna spel', tr.openGameCount, true)}
          <div class="home-event-games">
            ${upNext.map(g => {
              const dl = g.closesAt ? formatDeadline(g.closesAt) : null;
              const left = dl && !dl.isExpired ? dl.shortText.replace(/\s*kvar.*$/, '') : '';
              const soon = Boolean(left && dl.remainingMs < 3600000);
              const pot = g.pool > 0 ? `${isEn ? 'pot' : 'pott'} ${formatCurrency(g.pool)}` : (isEn ? 'no bets yet' : 'inga bets än');
              return `
                <button type="button" class="home-game-row" data-game-code="${escapeHtml(g.shareCode)}">
                  <span class="home-game-main">
                    <span class="home-game-name">${escapeHtml(g.name)}</span>
                    <span class="home-game-meta">${left ? `<span class="home-game-time${soon ? ' is-soon' : ''}">⏱ ${escapeHtml(left)}</span> · ` : ''}${pot}</span>
                  </span>
                  ${g.hasBet
                    ? `<span class="home-game-done">✓ ${isEn ? 'In' : 'Med'}</span>`
                    : `<span class="home-game-go">${g.isPick ? (isEn ? 'Tip' : 'Tippa') : (isEn ? 'Bet' : 'Betta')} →</span>`}
                </button>`;
            }).join('')}
          </div>` : '';
        // What you bet, so a glance answers "what did I play?" without opening the game
        const yourBet = (g) => {
          if (g.kind === 'coupon') {
            const p = g.progress || {};
            return [
              `${isEn ? 'Your row' : 'Din rad'}: ${escapeHtml(g.label)}`,
              p.decided ? `✏️ ${p.decided}/${p.matchCount} ${isEn ? 'corrected' : 'rättade'}` : '',
              p.decided && p.correct !== null ? `${p.correct} ${isEn ? 'right' : 'rätt'}` : ''
            ].filter(Boolean).join(' · ');
          }
          if (g.kind === 'picks') return `${isEn ? 'Your tip' : 'Ditt tips'}: ${escapeHtml(g.label)}`;
          if (g.kind === 'self') return `${isEn ? "You're in" : 'Du är med'} · ${formatCurrency(g.stake)}`;
          return `${isEn ? 'Your bet' : 'Ditt bet'}: ${escapeHtml(g.label)} · ${formatCurrency(g.stake)}`;
        };
        const waitingHtml = waiting.length ? `
          ${sectionHead(isEn ? 'Waiting for result' : 'Väntar på resultat', tr.waitingCount, !upNext.length)}
          <div class="home-event-games">
            ${waiting.map(g => `
              <button type="button" class="home-game-row is-waiting" data-game-code="${escapeHtml(g.shareCode)}">
                <span class="home-game-main">
                  <span class="home-game-name">🔒 ${escapeHtml(g.name)}</span>
                  <span class="home-game-meta">${yourBet(g)}${g.kind !== 'coupon' && g.pool > 0 ? ` · ${isEn ? 'pot' : 'pott'} ${formatCurrency(g.pool)}` : ''}</span>
                </span>
                <span class="home-game-chev" aria-hidden="true">›</span>
              </button>`).join('')}
          </div>` : '';
        const gamesHtml = openHtml + waitingHtml;
        // A note row only when there are no game rows; "Visa alla ›" in a section heading and
        // the card itself (with its ›) open the event
        let action = '';
        if (!isActive) {
          action = `<span class="home-event-note">🏁 ${isEn ? 'Settled – see the results' : 'Avgjort – se resultatet'}</span><span class="home-event-link">${isEn ? 'Open' : 'Öppna'} →</span>`;
        } else if (gamesHtml) {
          action = '';
        } else if (games === 0) {
          action = `<span class="home-event-note">${isEn ? 'Waiting for the first game' : 'Väntar på första spelet'}</span><span class="home-event-link">${isEn ? 'Open' : 'Öppna'} →</span>`;
        } else {
          action = `<span class="home-event-note">${isEn ? 'No open games right now' : 'Inga öppna spel just nu'}</span><span class="home-event-link">${isEn ? 'All games' : 'Alla spel'} →</span>`;
        }
        return `
          <div class="home-event-card card-clickable animate-in" data-tournament-code="${escapeHtml(tr.shareCode)}"
               role="link" tabindex="0" style="animation-delay: ${i * 0.08}s">
            <div class="home-event-top">
              <h3 class="home-event-title">${escapeHtml(tr.name)}</h3>
              <span class="home-event-chevron" aria-hidden="true">›</span>
            </div>
            <span class="game-pill ${isActive ? 'game-pill-open' : 'game-pill-done'}">${isActive ? `<i></i>${isEn ? 'Live' : 'Pågår'}` : `🏁 ${isEn ? 'Settled' : 'Avgjort'}`}</span>
            ${info ? `<div class="home-event-info">${info}</div>` : ''}
            ${gamesHtml}
            ${action ? `<div class="home-event-action">${action}</div>` : ''}
            ${tr.banners && tr.banners.length > 0 ? `
              <div class="home-event-sponsors">
                <div class="home-event-sponsors-label">${isEn ? 'Sponsored by' : 'Sponsrat av'}</div>
                ${renderSponsorCarousel(tr.banners, { carouselId: `home-sponsor-carousel-${i}`, showSectionHeader: false })}
              </div>
            ` : ''}
          </div>
        `;
      };
      tList.innerHTML = `
        <div class="section-header-bar">
          <div class="section-header-title">
            <span>${isEn ? 'YOUR EVENTS' : 'DINA EVENT'}</span>
          </div>
          <div class="flex gap-xs" style="align-items: center;">
            <span class="section-header-status ${activeCount > 0 ? 'is-live' : ''}">${headerBadge}</span>
          </div>
        </div>
        ${tournaments.map(renderEventCard).join('')}
      `;

      // Tapping an ad opens the sponsor, not the event
      tList.querySelectorAll('.home-event-sponsors').forEach(el => {
        el.addEventListener('click', e => e.stopPropagation());
      });
      tList.querySelectorAll('.home-event-card').forEach(card => {
        card.addEventListener('keydown', e => {
          // Enter on a button inside (a game row, a sponsor) is that button's, not the card's
          if (e.key === 'Enter' && e.target === card) navigate('tournament', { code: card.dataset.tournamentCode });
        });
      });

      // A game row goes straight to that game
      tList.querySelectorAll('.home-game-row').forEach(row => {
        row.addEventListener('click', e => {
          e.stopPropagation();
          navigate('event', { code: row.dataset.gameCode });
        });
      });

      tList.querySelectorAll('[data-tournament-code]').forEach(card => {
        card.addEventListener('click', () => {
          navigate('tournament', { code: card.dataset.tournamentCode });
        });
      });

      // Initialize sponsor carousel auto-roll for each tournament
      requestAnimationFrame(() => {
        tournaments.forEach((tr, i) => {
          if (tr.banners && tr.banners.length > 1) {
            const carouselEl = document.getElementById(`home-sponsor-carousel-${i}`);
            if (carouselEl) {
              initSponsorCarousel(carouselEl, tr.banners);
            }
          }
        });
      });
    }

    // Events
    if (events.length === 0 && tournaments.length === 0 && !eventsError) {
      document.getElementById('events-list').innerHTML = `
        <div class="empty-state">
          <div style="display: flex; justify-content: center; margin-bottom: var(--space-md);">
            <img src="/malta-betting-chips.png" alt="Whooply" class="animate-in" style="width: 140px; max-width: 60vw; height: auto; object-fit: contain; filter: drop-shadow(0 8px 24px rgba(0,0,0,0.7)) drop-shadow(0 0 16px rgba(255, 215, 0, 0.25));" />
          </div>
          <p class="empty-state-text">${t('home.noEvents')}</p>
          <div class="flex gap-md" style="justify-content: center;">
            <button class="btn btn-primary" id="go-admin-btn">${t('admin.createEvent')}</button>
            <button class="btn btn-secondary" id="go-join-btn">${t('nav.join')}</button>
          </div>
        </div>
      `;
      document.getElementById('go-admin-btn')?.addEventListener('click', () => navigate('admin'));
      document.getElementById('go-join-btn')?.addEventListener('click', () => navigate('join'));
      return;
    }

    const order = { open: 0, locked: 1, finished: 2 };
    events.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    if (events.length > 0) {
      // Always render a heading. The old condition removed the EVENTS heading for
      // users without a visible tournament, which made the feed look like unrelated
      // cards on the small iPhone viewport.
      const evHeader = `
        <div class="section-header-bar ${tournaments.length > 0 ? 'mt-lg' : ''}">
          <div class="section-header-title">
            <span>${t('home.events')}</span>
          </div>
          <span class="section-header-status">${events.length} ${isEn ? (events.length === 1 ? 'MATCH' : 'MATCHES') : 'SPEL'}</span>
        </div>
      `;
      document.getElementById('events-list').innerHTML = evHeader + events.map((ev, i) => `
        <div class="card card-clickable animate-in" data-event-id="${escapeHtml(ev.shareCode)}"
             style="animation-delay: ${(tournaments.length + i) * 0.08}s">
          <div class="flex-between">
            <div>
              <h3 style="font-family: var(--font-heading); font-weight: 700; font-size: 1.1rem;">
                ${escapeHtml(ev.name)}
              </h3>
              <p class="text-secondary" style="font-size: 0.8rem; margin-top: 2px;">
                ${formatDate(ev.date)} · ${ev.playerCount} ${t('home.players')} · ${ev.betCount} ${t('home.predictions')}
              </p>
            </div>
            <span class="badge ${statusBadgeClass(ev.status)}">${statusLabel(ev.status)}</span>
          </div>
          <div class="home-event-action">
            <span class="home-event-note">${isEn ? 'Pot' : 'Pott'} ${formatCurrency(ev.totalPool)}</span>
            ${ev.status === 'open'
              ? `<span class="home-event-cta">${isEn ? 'Bet' : 'Betta'} →</span>`
              : `<span class="home-event-link">${isEn ? 'Open' : 'Öppna'} →</span>`}
          </div>
        </div>
      `).join('');
    } else if (eventsError) {
      const needsLogin = eventsError.status === 401;
      document.getElementById('events-list').innerHTML = `
        <div class="card home-events-error" role="status">
          <div class="section-header-title mb-md">⚠️ ${t('home.events')}</div>
          <p class="text-secondary" style="font-size: 0.85rem;">
            ${needsLogin
              ? (isEn ? 'Sign in again to load your events.' : 'Logga in igen för att visa dina events.')
              : (isEn ? 'Events could not be loaded. Try again.' : 'Events kunde inte laddas. Försök igen.')}
          </p>
          <button type="button" class="btn btn-primary btn-sm mt-md" id="home-events-retry">
            ${needsLogin ? (isEn ? 'Sign in' : 'Logga in') : (isEn ? 'Try again' : 'Försök igen')}
          </button>
        </div>
      `;
      document.getElementById('home-events-retry')?.addEventListener('click', () => {
        if (needsLogin) navigate('profile');
        else renderHome();
      });
    } else {
      document.getElementById('events-list').innerHTML = '';
    }

    content.querySelectorAll('[data-event-id]').forEach(card => {
      card.addEventListener('click', () => {
        navigate('event', { code: card.dataset.eventId });
      });
    });

  } catch (err) {
    document.getElementById('events-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p class="empty-state-text">${escapeHtml(err?.message || t('common.error'))}</p>
        <button type="button" class="btn btn-secondary btn-sm" id="home-retry-btn">${isEn ? 'Try again' : 'Försök igen'}</button>
      </div>
    `;
    document.getElementById('home-retry-btn')?.addEventListener('click', () => renderHome());
  }
}

async function initHomeLiveBanners() {
  const container = document.getElementById('home-live-banner-container');
  if (!container) return;

  const renderActiveStreams = (streams) => {
    if (!streams || streams.length === 0) {
      container.innerHTML = '';
      return;
    }

    const s = streams[0];
    container.innerHTML = `
      <div class="animate-in" style="
        background: linear-gradient(135deg, rgba(255, 51, 75, 0.95), rgba(180, 20, 40, 0.95));
        color: #fff;
        border-radius: 12px;
        padding: 10px 14px;
        margin-bottom: 12px;
        box-shadow: 0 4px 20px rgba(255, 51, 75, 0.4);
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.2);
        animation: pulse 2s infinite;
      " id="home-live-stream-banner">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">🔴</span>
          <div>
            <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #ffeb3b;">
              SÄNDER LIVE JUST NU
            </div>
            <div style="font-weight: 800; font-size: 0.95rem; line-height: 1.2;">
              ${escapeHtml(s.hostName)}: "${escapeHtml(s.question)}"
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-sm" style="background: #fff; color: #ff334b; font-weight: 800; font-size: 0.8rem; border-radius: 20px; padding: 5px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
          ${s.hasBet ? 'Titta & Betta 👁️' : 'Titta Live 👁️'}
        </button>
      </div>
    `;

    document.getElementById('home-live-stream-banner')?.addEventListener('click', () => {
      const currentUser = getStoredUser();
      const isHost = currentUser && s.hostId && s.hostId === currentUser.id;
      openLiveStreamModal({
        isBroadcaster: isHost,
        isStandalone: true,
        hasBet: s.hasBet !== false,
        liveId: s.id,
        flashBetId: s.flashBetId,
        tournamentName: `${s.hostName} sänder live ⚡`,
        initialQuestion: s.question,
        endsAt: s.endsAt
      });
    });
  };

  try {
    const active = await getActiveFlashLives();
    renderActiveStreams(active);
  } catch {}

  // Listen to real-time broadcast events
  window.addEventListener('flashlive-stream-updated', async (e) => {
    try {
      const active = await getActiveFlashLives();
      renderActiveStreams(active);
    } catch {}
  });
}

// ── Push Notification Reminder Banner ────────────────────
function initHomePushBanner(isEn) {
  const container = document.getElementById('home-push-banner-container');
  if (!container) return;

  // Don't show if push is unsupported, already granted, or dismissed this session
  if (!isPushSupported() || getPushPermissionState() === 'granted') return;
  if (sessionStorage.getItem('whooply_push_dismissed')) return;

  container.innerHTML = `
    <div id="home-push-banner" class="animate-in" style="
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 10px 14px; margin-bottom: 12px;
      background: rgba(245, 166, 35, 0.12);
      border: 1px solid rgba(245, 166, 35, 0.35);
      border-radius: 12px;
    ">
      <div style="font-size: 0.8rem; line-height: 1.35; flex: 1;">
        🔔 <strong>${isEn ? 'Enable push notifications' : 'Slå på pushnotiser'}</strong>
        <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">
          ${isEn ? 'Get notified when friends challenge you or start a FlashBet!' : 'Få notis när polarna utmanar dig eller startar ett BlixtBet!'}
        </div>
      </div>
      <div style="display: flex; gap: 6px; flex-shrink: 0;">
        <button type="button" id="btn-home-enable-push" class="btn btn-sm btn-primary" style="
          padding: 5px 12px; font-size: 0.75rem; font-weight: 700;
          background: linear-gradient(135deg, var(--gold), #e67e22); border: none;
        ">${isEn ? 'Enable' : 'Aktivera'}</button>
        <button type="button" id="btn-home-dismiss-push" class="btn btn-sm" style="
          padding: 5px 8px; font-size: 0.75rem; background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);
        ">✕</button>
      </div>
    </div>
  `;

  document.getElementById('btn-home-enable-push')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-home-enable-push');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      await subscribeToPush();
      showToast('🔔 Pushnotiser aktiverade! Du får nu notiser från polarna.', 'success');
      container.innerHTML = '';
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = isEn ? 'Enable' : 'Aktivera';
    }
  });

  document.getElementById('btn-home-dismiss-push')?.addEventListener('click', () => {
    sessionStorage.setItem('whooply_push_dismissed', '1');
    container.innerHTML = '';
  });
}

// A running event shows where you stand right now, as part of the card's info line
function showLiveStandings(settlements, isEn) {
  for (const ev of settlements?.liveEvents || []) {
    const net = Math.round(ev.myResult || 0);
    if (!net) continue;
    const card = [...document.querySelectorAll('.home-event-card')].find(c => c.dataset.tournamentCode === ev.shareCode);
    if (!card || card.querySelector('.home-event-me')) continue;
    const me = `<span class="home-event-me ${net < 0 ? 'is-neg' : 'is-pos'}" title="${isEn ? 'From the games decided so far; settled when the event ends' : 'Från de spel som är avgjorda; görs upp när eventet är slut'}">${isEn ? 'Your result so far' : 'Ditt resultat hittills'}: <b>${net > 0 ? '+' : '−'}${formatCurrency(Math.abs(net))}</b></span>`;
    const info = card.querySelector('.home-event-info');
    if (info) {
      info.insertAdjacentHTML('beforeend', `${info.textContent.trim() ? ' · ' : ''}${me}`);
    } else {
      const pill = card.querySelector('.game-pill');
      pill?.insertAdjacentHTML('afterend', `<div class="home-event-info">${me}</div>`);
    }
  }
}

async function initHomeActionFeed(isEn, events = []) {
  const container = document.getElementById('home-action-feed-container');
  if (!container || !isLoggedIn()) return;

  const user = getStoredUser();
  try {
    // Same list as the bell's "Väntar på dig", so the two always agree
    const [inbox, settlements] = await Promise.all([
      getInbox(isEn ? 'en' : 'sv').catch(() => null),
      getSettlementsOverview().catch(() => null)
    ]);

    const items = [];
    const requests = inbox?.friendRequests || [];
    if (requests.length > 0) {
      items.push({
        icon: '👥',
        title: requests.length === 1
          ? `${requests[0].realName || requests[0].nickname} ${isEn ? 'wants to be friends' : 'vill bli din vän'}`
          : `${requests.length} ${isEn ? 'friend requests' : 'vänförfrågningar'}`,
        subtitle: isEn ? 'Tap to accept or decline' : 'Tryck för att godkänna eller neka',
        badge: isEn ? 'Answer' : 'Svara',
        badgeClass: 'badge-accent',
        link: '#profile'
      });
    }
    for (const t of inbox?.todos || []) {
      items.push({
        icon: t.icon || '🔔',
        title: t.title,
        subtitle: t.subtitle || '',
        badge: t.action || (isEn ? 'Open' : 'Öppna'),
        badgeClass: t.key === 'swish' ? 'badge-danger' : 'badge-accent',
        link: t.url || '#'
      });
    }

    showLiveStandings(settlements, isEn);

    if (items.length === 0) return;

    container.innerHTML = `
      <div class="card p-sm mb-sm animate-in" style="background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(20,20,35,0.85)); border: 1.5px solid rgba(245,158,11,0.35); box-shadow: 0 4px 20px rgba(0,0,0,0.4);">
        <div class="flex-between align-center mb-xs" style="padding: 2px 4px;">
          <span style="font-size: 0.75rem; font-weight: 800; color: var(--gold); text-transform: uppercase; letter-spacing: 0.08em;">
            🔔 ${isEn ? 'REQUIRES YOUR ACTION' : 'KRÄVER DITT DRAG'} (${items.length})
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${items.map(item => `
            <a href="${escapeHtml(item.link)}" class="card-clickable flex-between align-center p-xs" style="background: rgba(255,255,255,0.04); border-radius: var(--radius-sm); text-decoration: none; color: inherit;">
              <div class="flex gap-xs align-center" style="min-width: 0; flex: 1;">
                <span style="font-size: 1.15rem; min-width: 24px; text-align: center;">${escapeHtml(item.icon)}</span>
                <div style="min-width: 0;">
                  <div style="font-weight: 700; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(item.title)}
                  </div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(item.subtitle)}
                  </div>
                </div>
              </div>
              <span class="badge ${item.badgeClass}" style="font-size: 0.72rem; font-weight: 700; padding: 4px 8px; flex-shrink: 0; margin-left: 8px;">
                ${escapeHtml(item.badge)} ➜
              </span>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    console.warn('Could not load home action items:', e);
  }
}
