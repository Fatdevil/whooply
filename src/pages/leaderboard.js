// ── Page: The Tab (Vem ska swisha vem) ───────────────────
// One place that answers "what do I owe, who owes me, and why". Every source
// (events, BlixtBets, AnyBets, duels, split bills) is netted per person on the
// server, so you swish each friend once.
import { 
  getTournaments, 
  getTournament, 
  toggleSettlementReceipt, 
  getSettlementsOverview,
  clearSettlementWithFriend
} from '../api.js';
import { formatCurrency, showToast, escapeHtml, createSwishUrl, parseServerDate, safeImageSrc } from '../utils.js';
import { t, getLang } from '../i18n.js';
import { getStoredUser, isLoggedIn } from '../auth.js';
import { openReceiptModal } from '../components/minigames.js';
import { openDelaUtlaggModal } from '../components/delaUtlagg.js';
import { showModal, closeModal } from '../components/modal.js';

let activeTab = 'overview'; // 'overview' | 'tournaments' | 'history'
let currentTournamentCode = null;

// A person with an account is identified by userId only; names only identify guests.
// Otherwise a guest who shares your name could show up as "Du" or get your debts.
function isSameUser(user, userId, name) {
  if (!user) return false;
  if (userId) return userId === user.id;
  return Boolean(name) && (name === user.nickname || name === user.realName);
}

const SOURCE_LABELS = {
  flashbet: ['⚡', 'BlixtBet'],
  flashlive: ['🔴', 'Livebet'],
  anybet: ['🤝', 'AnyBet'],
  even_steven: ['🧾', 'Nota'],
  gimme: ['⛳', 'Gimme?'],
  'coin-flip': ['🪙', 'Krona/klave'],
  coin: ['🪙', 'Krona/klave'],
  mafia: ['🕵️', 'Maffia'],
  blind10: ['⏱️', 'The Blind 10.00'],
  wheel: ['💳', 'Not-Roulette'],
  space_invaders: ['👾', 'Space Invaders'],
  'space-invaders': ['👾', 'Space Invaders'],
  slots: ['🎰', 'Enarmad bandit'],
  loven_game: ['🟢', 'Lövenspelet']
};

// Turns one server detail row into an icon + a title a friend understands
function describeSource(d) {
  if (d.type === 'tournament') return { icon: '🏆', title: String(d.title || '').replace(/^🏆\s*/, '') };
  if (d.type === 'expense') return { icon: '🧾', title: d.title || 'Nota' };
  const [icon, label] = SOURCE_LABELS[d.gameType] || ['🎲', 'Duell'];
  const generic = !d.title || /^Duell \(/.test(d.title);
  return { icon, title: generic ? label : d.title };
}

function shareText(text, title) {
  const isEn = getLang() === 'en';
  if (navigator.share) {
    navigator.share({ title, text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => showToast(isEn ? 'Reminder copied! 📋' : 'Påminnelsen är kopierad 📋', 'success'))
      .catch(() => showToast(text, 'info'));
  }
}

function avatarHtml(f) {
  const src = safeImageSrc(f.friendAvatarUrl);
  return `<div class="tabx-avatar">${src ? `<img src="${escapeHtml(src)}" alt="" />` : escapeHtml(f.friendAvatarEmoji || '👤')}</div>`;
}

export async function renderLeaderboard(params = {}) {
  const content = document.getElementById('page-content');
  if (!content) return;

  const url = new URL(window.location);
  let tabParam = params.tab || url.searchParams.get('tab');
  if (tabParam === 'swishlist') tabParam = 'overview'; // old links and pushes
  if (tabParam && ['overview', 'tournaments', 'history'].includes(tabParam)) {
    activeTab = tabParam;
  }
  const isEn = getLang() === 'en';

  content.innerHTML = `
    <div class="animate-in the-tab-container">
      <div class="tabx-top">
        <h1 class="tabx-title">THE TAB</h1>
        <span class="tabx-sub">${isEn ? 'Who swishes whom' : 'Vem ska swisha vem'}</span>
      </div>

      <div class="tabx-seg" role="tablist">
        <button type="button" class="tab-nav-btn ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">${isEn ? 'To do' : 'Att göra'}</button>
        <button type="button" class="tab-nav-btn ${activeTab === 'tournaments' ? 'active' : ''}" data-tab="tournaments">${isEn ? 'Events' : 'Event'}</button>
        <button type="button" class="tab-nav-btn ${activeTab === 'history' ? 'active' : ''}" data-tab="history">${isEn ? 'Archive' : 'Arkiv'}</button>
      </div>

      <div id="tab-body">
        <div class="skeleton skeleton-card" style="height: 150px; margin-bottom: 12px;"></div>
        <div class="skeleton skeleton-card" style="height: 110px;"></div>
      </div>
    </div>`;

  content.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (targetTab === activeTab) return;
      activeTab = targetTab;
      renderLeaderboard();
    });
  });

  try {
    const user = getStoredUser();
    const loggedIn = isLoggedIn();

    const allTournaments = await getTournaments();
    const activeTournaments = allTournaments.filter(t => t.status === 'active');
    const pastTournaments = allTournaments.filter(t => t.status === 'settled');

    let overviewData = { friends: [], totalNet: 0, totalOwed: 0, totalDue: 0 };
    let overviewError = false;
    if (loggedIn) {
      const raw = await getSettlementsOverview().catch(() => null);
      if (raw) overviewData = raw;
      else overviewError = true;
    }

    const tabBody = document.getElementById('tab-body');
    if (!tabBody) return;

    if (activeTab === 'overview') {
      renderOverviewTab(tabBody, overviewData, user, overviewError, activeTournaments);
    } else if (activeTab === 'tournaments') {
      await renderTournamentTab(tabBody, activeTournaments, user);
    } else {
      // An archived event is only "settled" for you once none of your payments are open
      const openTournamentIds = new Set((overviewData.friends || [])
        .flatMap(f => f.details || [])
        .filter(d => d.type === 'tournament' && d.tournamentId)
        .map(d => d.tournamentId));
      renderHistoryTab(tabBody, pastTournaments, user, openTournamentIds);
    }
  } catch (err) {
    const tabBody = document.getElementById('tab-body');
    if (tabBody) {
      tabBody.innerHTML = `
        <div class="empty-state animate-in">
          <div class="empty-state-icon">❌</div>
          <p class="empty-state-text">${escapeHtml(err.message)}</p>
        </div>`;
    }
  }
}

// Split a bill: pick a standalone bill or one of your running events
function openSplitPicker(activeTournaments) {
  const isEn = getLang() === 'en';
  const openForTournament = async (code) => {
    const tour = await getTournament(code).catch(() => null);
    if (!tour) {
      openDelaUtlaggModal({ onSaved: () => renderLeaderboard() });
      return;
    }
    const participants = ((tour.settlement && tour.settlement.balances) || []).map(b => ({
      id: b.userId || b.name,
      name: b.name,
      nickname: b.name
    }));
    openDelaUtlaggModal({
      tournamentId: tour.id,
      tournamentName: tour.name,
      participants: participants.length > 0 ? participants : undefined,
      onSaved: () => renderLeaderboard()
    });
  };

  if (!activeTournaments || activeTournaments.length === 0) {
    openDelaUtlaggModal({ onSaved: () => renderLeaderboard() });
    return;
  }

  showModal(isEn ? 'Split a bill' : 'Dela på en nota', `
    <p class="text-muted" style="font-size: 0.85rem; margin: 0 0 12px;">
      ${isEn ? 'Is the bill part of an event?' : 'Hör notan till ett event? Då hamnar den i eventets avräkning.'}
    </p>
    <div class="tabx-pick-list">
      ${activeTournaments.map(tr => `
        <button type="button" class="tabx-pick" data-code="${escapeHtml(tr.shareCode)}">
          <span>🏆 ${escapeHtml(tr.name)}</span><span class="tabx-pick-arrow">›</span>
        </button>`).join('')}
      <button type="button" class="tabx-pick" data-code="">
        <span>🧾 ${isEn ? 'Standalone bill (no event)' : 'Fristående nota (inget event)'}</span><span class="tabx-pick-arrow">›</span>
      </button>
    </div>
  `);

  document.querySelectorAll('.tabx-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-code');
      closeModal();
      if (code) openForTournament(code);
      else openDelaUtlaggModal({ onSaved: () => renderLeaderboard() });
    });
  });
}

// ── 0. "Att göra": everything netted per person ─────
function renderOverviewTab(container, overview, user, overviewError = false, activeTournaments = []) {
  const isEn = getLang() === 'en';
  if (!user) {
    container.innerHTML = `
      <div class="card text-center p-lg">
        <p class="text-secondary">${isEn ? 'Log in to see who you owe and who owes you.' : 'Logga in för att se vem du ska swisha och vem som ska swisha dig.'}</p>
        <button type="button" class="btn btn-primary btn-sm mt-sm btn-tab-goto-profile">${t('nav.account')}</button>
      </div>`;
    container.querySelector('.btn-tab-goto-profile')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'profile' } }));
    });
    return;
  }

  if (overviewError) {
    container.innerHTML = `
      <div class="empty-state card text-center" style="padding: 32px 16px;">
        <div style="font-size: 2.6rem; margin-bottom: 8px;">⚠️</div>
        <h3 class="font-heading" style="color: #f59e0b; margin-bottom: 6px;">${isEn ? 'Could not load your balance' : 'Kunde inte hämta ditt saldo'}</h3>
        <p class="text-muted" style="font-size: 0.85rem; margin: 0 auto 16px;">${isEn ? 'Please try again.' : 'Försök igen om en liten stund.'}</p>
        <button type="button" class="btn btn-primary btn-sm btn-overview-retry">🔄 ${isEn ? 'Try again' : 'Försök igen'}</button>
      </div>`;
    container.querySelector('.btn-overview-retry')?.addEventListener('click', () => renderLeaderboard());
    return;
  }

  const friends = (overview.friends || []).filter(f => f.totalNet !== 0);
  // With people you share a running event with, everything is added up when it ends:
  // those balances are "live" and wait, so you swish once instead of several times
  const live = friends.filter(f => f.isLive);
  const iOwe = friends.filter(f => !f.isLive && f.totalNet < 0);
  const owesMe = friends.filter(f => !f.isLive && f.totalNet > 0).sort((a, b) => b.totalNet - a.totalNet);
  const liveNet = live.reduce((s, f) => s + f.totalNet, 0);
  const liveEventNames = [...new Set(live.flatMap(f => (f.liveEvents || []).map(e => e.name)))];
  const liveHtml = live.length > 0 ? `
    <div class="tabx-live-line">⏳ ${isEn ? 'Running events' : 'Pågående event'}: <b class="${liveNet < 0 ? 'neg' : 'pos'}">${liveNet > 0 ? '+' : liveNet < 0 ? '−' : ''}${formatCurrency(Math.abs(liveNet))}</b> · ${isEn ? 'settled when they end' : 'görs upp när de är slut'}</div>` : '';
  const totalOwed = iOwe.reduce((s, f) => s - f.totalNet, 0);
  const totalDue = owesMe.reduce((s, f) => s + f.totalNet, 0);
  const people = (n) => isEn ? `${n} ${n === 1 ? 'person' : 'people'}` : `${n} ${n === 1 ? 'person' : 'personer'}`;

  const undecided = activeTournaments.reduce((s, tr) => s + (tr.undecidedCount || 0), 0);
  const undecidedHtml = undecided > 0 ? `
    <div class="tabx-warn">⏳ ${isEn
      ? `${undecided} ${undecided === 1 ? 'game is' : 'games are'} not decided yet – amounts can still change.`
      : `${undecided} spel är inte ${undecided === 1 ? 'avgjort' : 'avgjorda'} än – beloppen kan ändras.`}</div>` : '';

  let heroHtml;
  if (totalOwed > 0) {
    heroHtml = `
      <div class="tabx-hero is-owe">
        <div class="tabx-hero-label">${isEn ? 'YOU SWISH' : 'DU SKA SWISHA'}</div>
        <div class="tabx-hero-amount">${formatCurrency(totalOwed)} <small>${isEn ? 'to' : 'till'} ${people(iOwe.length)}</small></div>
        ${totalDue > 0 ? `<div class="tabx-hero-second">+ ${isEn ? 'You get' : 'Du får'} <b>${formatCurrency(totalDue)}</b> ${isEn ? 'from' : 'från'} ${people(owesMe.length)}</div>` : ''}
        <p class="tabx-hero-text">${isEn
          ? 'Everything is added up – events, BlixtBets, duels and bills. You swish <b>once per person</b>, then you are even.'
          : 'Allt är ihopräknat – event, BlixtBets, dueller och notor. Du swishar <b>en gång per person</b>, sen är ni kvitt.'}</p>
        ${liveHtml}
        ${undecidedHtml}
      </div>`;
  } else if (totalDue > 0) {
    heroHtml = `
      <div class="tabx-hero is-due">
        <div class="tabx-hero-label">${isEn ? 'YOU GET' : 'DU FÅR'}</div>
        <div class="tabx-hero-amount">${formatCurrency(totalDue)} <small>${isEn ? 'from' : 'från'} ${people(owesMe.length)}</small></div>
        <p class="tabx-hero-text">${isEn
          ? 'Everything is added up per person. When the money arrives, mark it as paid.'
          : 'Allt är ihopräknat per person. När pengarna kommit markerar du det som betalt.'}</p>
        ${liveHtml}
        ${undecidedHtml}
      </div>`;
  } else if (live.length > 0) {
    heroHtml = `
      <div class="tabx-hero is-even">
        <div class="tabx-hero-label">${isEn ? 'NOTHING TO SWISH YET' : 'INGET ATT SWISHA ÄN'}</div>
        <div class="tabx-hero-amount ${liveNet < 0 ? 'neg' : 'pos'}">${liveNet > 0 ? '+' : liveNet < 0 ? '−' : ''}${formatCurrency(Math.abs(liveNet))} <small>${isEn ? 'right now' : 'just nu'}</small></div>
        <p class="tabx-hero-text">${isEn
          ? `You are in a running event (${escapeHtml(liveEventNames.join(', '))}). Everything is added up when it ends – then you swish <b>once per person</b>.`
          : `Du är med i ett pågående event (${escapeHtml(liveEventNames.join(', '))}). Allt räknas ihop när det är slut – då swishar du <b>en gång per person</b>.`}</p>
        ${undecidedHtml}
      </div>`;
  } else {
    heroHtml = `
      <div class="tabx-hero is-even">
        <div class="tabx-hero-label">${isEn ? 'ALL SETTLED' : 'HELT KVITT'}</div>
        <div class="tabx-hero-amount">0 kr <small>✅</small></div>
        <p class="tabx-hero-text">${isEn
          ? 'You owe nobody and nobody owes you.'
          : 'Du är skyldig ingen och ingen är skyldig dig.'}</p>
        ${undecidedHtml}
      </div>`;
  }

  const MAX_LINES = 4;
  const breakdown = (f) => {
    const lines = (f.details || []).filter(d => d.amount !== 0);
    if (lines.length === 0) return '';
    const shown = lines.slice(0, MAX_LINES);
    const rest = lines.length - shown.length;
    return `
      <div class="tabx-why">
        ${shown.map(d => {
          const { icon, title } = describeSource(d);
          return `<div class="tabx-why-row"><span>${icon} ${escapeHtml(title)}</span><span class="${d.amount < 0 ? 'neg' : 'pos'}">${d.amount > 0 ? '+' : '−'}${formatCurrency(Math.abs(d.amount))}</span></div>`;
        }).join('')}
        ${rest > 0 ? `<div class="tabx-why-more">${isEn ? `+ ${rest} more` : `+ ${rest} till`}</div>` : ''}
        ${lines.length > 1 ? `<div class="tabx-why-row tabx-why-sum"><span>${isEn ? 'Total' : 'Totalt'}</span><span>${formatCurrency(Math.abs(f.totalNet))}</span></div>` : ''}
      </div>`;
  };

  // The only place that builds Swish links
  const swishUrlFor = (f, amount) => f.friendSwish ? createSwishUrl({ phone: f.friendSwish, amount, message: 'Whooply' }) : '#';

  const oweCard = (f) => {
    const name = f.friendName || f.friendNickname || '';
    const amount = Math.abs(f.totalNet);
    const swishUrl = swishUrlFor(f, amount);
    return `
      <div class="tabx-person">
        <div class="tabx-person-row">
          ${avatarHtml(f)}
          <div class="tabx-person-info">
            <b>${escapeHtml(name)}</b>
            <span class="neg">${isEn ? `You swish ${formatCurrency(amount)}` : `Du ska swisha ${formatCurrency(amount)}`}</span>
          </div>
          ${swishUrl !== '#'
            ? `<a href="${swishUrl}" class="tabx-btn tabx-btn-swish" rel="noopener">${isEn ? 'Swish' : 'Swisha'} ${formatCurrency(amount)}</a>`
            : `<span class="tabx-no-swish">${isEn ? 'No Swish no.' : 'Saknar Swish-nr'}</span>`}
        </div>
        ${breakdown(f)}
        <div class="tabx-note">${isEn
          ? `${escapeHtml(name)} confirms when the money has arrived – then the row disappears.`
          : `${escapeHtml(name)} bekräftar när pengarna kommit – då försvinner raden.`}</div>
      </div>`;
  };

  const dueCard = (f) => {
    const name = f.friendName || f.friendNickname || '';
    const amount = Math.abs(f.totalNet);
    const tournamentCount = (f.details || []).filter(d => d.type === 'tournament').length;
    return `
      <div class="tabx-person">
        <div class="tabx-person-row">
          ${avatarHtml(f)}
          <div class="tabx-person-info">
            <b>${escapeHtml(name)}</b>
            <span class="pos">${isEn ? `Swishes you ${formatCurrency(amount)}` : `Ska swisha dig ${formatCurrency(amount)}`}</span>
          </div>
          <button type="button" class="tabx-btn tabx-btn-ghost btn-remind-unified" data-name="${escapeHtml(name)}" data-amount="${amount}">${isEn ? 'Remind' : 'Påminn'}</button>
        </div>
        ${breakdown(f)}
        ${f.isRegistered !== false ? `
          <button type="button" class="tabx-paid btn-clear-all" data-friend-id="${escapeHtml(f.friendId)}" data-friend-name="${escapeHtml(name)}" data-amount="${amount}" data-duels="${f.duelsCount || 0}" data-tournaments="${tournamentCount}">
            ${isEn ? 'Got the money? <b>Mark as paid ✓</b>' : 'Fått pengarna? <b>Markera som betalt ✓</b>'}
          </button>` : ''}
      </div>`;
  };

  const liveCard = (f) => {
    const name = f.friendName || f.friendNickname || '';
    const amount = Math.abs(f.totalNet);
    const events = (f.liveEvents || []).map(e => e.name).join(', ');
    const swishUrl = f.totalNet < 0 && f.friendSwish ? swishUrlFor(f, amount) : null;
    return `
      <div class="tabx-person is-live">
        <div class="tabx-person-row">
          ${avatarHtml(f)}
          <div class="tabx-person-info">
            <b>${escapeHtml(name)}</b>
            <span class="${f.totalNet < 0 ? 'neg' : 'pos'}">${f.totalNet === 0
              ? (isEn ? 'Even right now' : 'Jämnt just nu')
              : f.totalNet < 0
                ? (isEn ? `You are down ${formatCurrency(amount)} right now` : `Du ligger back ${formatCurrency(amount)} just nu`)
                : (isEn ? `You are up ${formatCurrency(amount)} right now` : `Du ligger plus ${formatCurrency(amount)} just nu`)}</span>
          </div>
        </div>
        ${breakdown(f)}
        <div class="tabx-note">⏳ ${isEn
          ? `Waiting for ${escapeHtml(events)} to end – then it is added up and you swish once.`
          : `Väntar på att ${escapeHtml(events)} tar slut – då räknas allt ihop och ni swishar en gång.`}
          ${swishUrl ? ` <a href="${swishUrl}" class="tabx-swish-anyway" rel="noopener">${isEn ? 'Swish anyway' : 'Swisha ändå'} ${formatCurrency(amount)}</a>` : ''}</div>
        ${f.totalNet > 0 && f.isRegistered !== false ? `
          <button type="button" class="tabx-paid btn-clear-all" data-friend-id="${escapeHtml(f.friendId)}" data-friend-name="${escapeHtml(name)}" data-amount="${amount}" data-duels="${f.duelsCount || 0}" data-tournaments="${(f.details || []).filter(d => d.type === 'tournament').length}">
            ${isEn ? 'Paid you already? <b>Mark as paid ✓</b>' : 'Har hen redan swishat? <b>Markera som betalt ✓</b>'}
          </button>` : ''}
      </div>`;
  };

  container.innerHTML = `
    <div class="animate-in">
      ${heroHtml}

      ${iOwe.length > 0 ? `
        <div class="tabx-section">${isEn ? 'TO SWISH' : 'ATT SWISHA'}</div>
        ${iOwe.map(oweCard).join('')}` : ''}

      ${owesMe.length > 0 ? `
        <div class="tabx-section">${isEn ? 'SWISHES YOU' : 'SKA SWISHA DIG'}</div>
        ${owesMe.map(dueCard).join('')}` : ''}

      ${live.length > 0 ? `
        <div class="tabx-section">${isEn ? 'RUNNING – SETTLED WHEN THE EVENT ENDS' : 'LÖPANDE – GÖRS UPP NÄR EVENTET ÄR SLUT'}</div>
        ${live.map(liveCard).join('')}` : ''}

      <div class="tabx-how">
        <b>${isEn ? 'How it adds up:' : 'Så räknas det:'}</b>
        ${isEn
          ? 'wins and losses from every game are added up per person. If you owe a friend 130 kr and they owe you 30 kr, you only swish 100 kr.'
          : 'vinster och förluster från alla spel läggs ihop per person. Är du skyldig en kompis 130 kr och hen dig 30 kr swishar du bara 100 kr.'}
      </div>

      <button type="button" class="tabx-split" id="btn-hero-dela-notan">
        <span>🧾 ${isEn ? 'Split a bill' : 'Dela på en nota'}</span>
        <i>${isEn ? 'Lunch, taxi, bar →' : 'Lunch, taxi, bar →'}</i>
      </button>
    </div>`;

  container.querySelector('#btn-hero-dela-notan')?.addEventListener('click', () => openSplitPicker(activeTournaments));

  container.querySelectorAll('.btn-remind-unified').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-name');
      const amount = btn.getAttribute('data-amount');
      const myPhone = user.swishNumber || user.phone || '';
      const phoneNote = myPhone ? (isEn ? ` to ${myPhone}` : ` till ${myPhone}`) : '';
      const text = isEn
        ? `Hey ${name}! Friendly reminder to Swish ${amount} kr${phoneNote} for our Whooply games 📱🤝`
        : `Tjena ${name}! Vänlig påminnelse att swisha ${amount} kr${phoneNote} för våra spel i Whooply 📱🤝`;
      shareText(text, 'Whooply');
    });
  });

  container.querySelectorAll('.btn-clear-all').forEach(btn => {
    btn.addEventListener('click', async () => {
      const friendId = btn.getAttribute('data-friend-id');
      const friendName = btn.getAttribute('data-friend-name');
      const amount = Number(btn.getAttribute('data-amount')) || 0;

      const confirmMsg = isEn
        ? `Has ${friendName} swished you ${amount} kr?\n\nEverything between you will be marked as paid.`
        : `Har ${friendName} swishat dig ${amount} kr?\n\nAllt mellan er markeras då som betalt.`;
      if (!confirm(confirmMsg)) return;

      btn.disabled = true;
      try {
        await clearSettlementWithFriend(friendId, amount);
        showToast(isEn ? `Paid ✅ You and ${friendName} are even.` : `Betalt ✅ Du och ${friendName} är kvitt.`, 'success');
        renderLeaderboard();
      } catch (err) {
        btn.disabled = false;
        if (err.message && err.message.includes('ändrats')) {
          showToast(isEn ? 'The balance changed – reloading…' : 'Saldot har ändrats – laddar om…', 'warning');
          renderLeaderboard();
        } else {
          showToast(err.message || 'Något gick fel', 'error');
        }
      }
    });
  });
}

// ── 1. Tournament Settlement Tab ──────────────────────
async function renderTournamentTab(container, activeTournaments, user) {
  if (!activeTournaments || activeTournaments.length === 0) {
    container.innerHTML = `
      <div class="empty-state card text-center" style="padding: var(--space-xl) var(--space-md);">
        <div style="display: flex; justify-content: center; margin-bottom: var(--space-md);">
          <img src="/malta-chips-gold.png" alt="Whooply" class="animate-in" style="width: 140px; max-width: 60vw; height: auto; object-fit: contain; filter: drop-shadow(0 8px 24px rgba(0,0,0,0.7)) drop-shadow(0 0 16px rgba(255, 215, 0, 0.25));" />
        </div>
        <h3 class="font-heading" style="color: var(--gold); margin-bottom: 6px;">${t('tab.noActiveTournaments')}</h3>
        <p class="text-muted" style="font-size: 0.85rem; max-width: 360px; margin: 0 auto var(--space-md);">
          ${t('tab.createOrJoin')}
        </p>
        <div class="flex gap-sm justify-center">
          <button type="button" class="btn btn-primary btn-sm btn-tab-goto-admin">${t('tab.goToCreate')}</button>
          <button type="button" class="btn btn-secondary btn-sm btn-tab-goto-home">${t('nav.home')}</button>
        </div>
      </div>`;

    container.querySelector('.btn-tab-goto-admin')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'admin' } }));
    });
    container.querySelector('.btn-tab-goto-home')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'home' } }));
    });
    return;
  }

  // Determine current active tournament
  if (!currentTournamentCode || !activeTournaments.some(t => t.shareCode === currentTournamentCode)) {
    currentTournamentCode = activeTournaments[0].shareCode;
  }

  // Load full details for selected tournament
  const tour = await getTournament(currentTournamentCode);
  const settlement = tour.settlement || { balances: [], transfers: [], auditTrail: {}, receipts: [], finishedRounds: 0, totalRounds: 0 };
  const balances = settlement.balances || [];
  const transfers = settlement.transfers || [];
  const auditTrail = settlement.auditTrail || {};
  const isEn = getLang() === 'en';

  // Find user's balance
  let myBalance = null;
  if (user) {
    myBalance = balances.find(b => isSameUser(user, b.userId, b.name));
  }

  // Build Hero Status Card
  let heroCardHtml = '';
  if (myBalance) {
    if (myBalance.net < 0) {
      const debtAmount = -myBalance.net;
      // Find all transfers where user is the debtor

      // Paying happens in one place (Att göra), netted across every event and game,
      // so nobody swishes the same debt twice
      const transfersListHtml = `
        <button type="button" class="btn btn-danger btn-block btn-goto-todo" style="background: #ef4444; border: none; font-weight: 800;">
          ${isEn ? 'Pay under To do →' : 'Betala under Att göra →'}
        </button>`;

      heroCardHtml = `
        <div class="tab-hero-card hero-debt animate-in">
          <div class="flex-between align-center" style="margin-bottom: 8px;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #f87171;">
              ⚠️ ${t('tab.clearDebtHeroTitle')}
            </div>
            <div style="font-size: 1.4rem; font-weight: 900; color: #ef4444;">
              -${formatCurrency(debtAmount)}
            </div>
          </div>
          <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 12px;">
            ${t('tab.clearDebtHeroDesc')}
          </p>
          ${transfersListHtml}
        </div>`;
    } else if (myBalance.isDebtFree || myBalance.net === 0) {
      heroCardHtml = `
        <div class="tab-hero-card hero-debtfree animate-in">
          <div class="flex-between align-center" style="margin-bottom: 4px;">
            <div style="font-size: 0.9rem; font-weight: 800; color: #4ade80;">
              ${t('tab.debtFreeTitle')}
            </div>
            <div style="font-size: 1.3rem; font-weight: 900; color: #4ade80;">
              0 kr
            </div>
          </div>
          <p class="text-muted" style="font-size: 0.8rem; margin: 0;">
            ${t('tab.debtFreeDesc')}
          </p>
        </div>`;
    } else {
      heroCardHtml = `
        <div class="tab-hero-card hero-credit animate-in">
          <div class="flex-between align-center" style="margin-bottom: 4px;">
            <div style="font-size: 0.9rem; font-weight: 800; color: var(--gold);">
              💰 ${t('tab.creditTitle')}
            </div>
            <div style="font-size: 1.4rem; font-weight: 900; color: #4ade80;">
              +${formatCurrency(myBalance.net)}
            </div>
          </div>
          <p class="text-muted" style="font-size: 0.8rem; margin: 0;">
            ${t('tab.creditDesc')}
          </p>
        </div>`;
    }
  }

  // Tournament selector if multiple active
  let selectorHtml = '';
  if (activeTournaments.length > 1) {
    selectorHtml = `
      <div class="tab-tournament-selector">
        <span class="text-muted" style="font-size: 0.8rem; font-weight: 700;">Event:</span>
        <select class="form-input" id="tab-tour-select" style="max-width: 200px; padding: 4px 8px; font-size: 0.8rem;">
          ${activeTournaments.map(t => `
            <option value="${escapeHtml(t.shareCode)}" ${t.shareCode === currentTournamentCode ? 'selected' : ''}>
              ${escapeHtml(t.name)}
            </option>
          `).join('')}
        </select>
      </div>`;
  }

  // Render Standings & Audit rows
  const sortedBalances = [...balances].sort((a, b) => b.net - a.net);
  const standingsRowsHtml = sortedBalances.map((b, i) => {
    const isMe = isSameUser(user, b.userId, b.name);
    const medal = i === 0 ? '👑 🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    const netClass = b.isDebtFree || b.net === 0 ? 'badge badge-success' : b.net > 0 ? 'text-green' : 'text-red';
    const netDisplay = b.isDebtFree || b.net === 0 ? t('tab.debtFreeBadge') : (b.net > 0 ? `+${formatCurrency(b.net)}` : formatCurrency(b.net));
    const userAudit = (b.key && auditTrail[b.key]) || auditTrail[b.name] || [];
    const drawerId = 'audit-' + (b.key ? b.key.replace(/[^a-zA-Z0-9_-]/g, '_') : escapeHtml(b.name));

    return `
      <div class="tab-player-group" style="margin-bottom: 6px;">
        <div class="tab-audit-row" data-drawer-id="${drawerId}" data-name="${escapeHtml(b.name)}" style="${isMe ? 'border-color: var(--gold); background: rgba(255,215,0,0.06);' : ''}">
          <div class="flex align-center gap-sm">
            <span style="font-size: 0.9rem; min-width: 24px;">${medal}</span>
            <div>
              <div style="font-weight: 700; font-size: 0.9rem;">
                ${escapeHtml(b.name)} ${isMe ? '<span class="badge badge-accent" style="font-size: 0.6rem; margin-left: 4px;">Du</span>' : ''}
              </div>
              <div class="text-muted" style="font-size: 0.75rem;">
                ${isEn ? 'Games' : 'Spel'}: ${b.rawTotal >= 0 ? '+' : ''}${formatCurrency(b.rawTotal)}${b.totalPaid ? ` · ${isEn ? 'Paid' : 'Betalt'} ${formatCurrency(b.totalPaid)}` : ''}${b.totalReceived ? ` · ${isEn ? 'Received' : 'Fått'} ${formatCurrency(b.totalReceived)}` : ''}
              </div>
            </div>
          </div>
          <div class="flex align-center gap-sm">
            <span class="${netClass}" style="font-weight: 800; font-size: 0.95rem;">${netDisplay}</span>
            <span class="text-muted audit-chevron" style="font-size: 0.75rem; transition: transform 0.2s;">▾</span>
          </div>
        </div>

        <!-- Audit Drawer -->
        <div class="tab-audit-drawer" id="${drawerId}" style="display: none;">
          <div class="text-secondary" style="font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; text-transform: uppercase;">
            📋 ${t('tab.auditHistory')} (${b.name})
          </div>
          ${userAudit.length === 0 ? `
            <div class="text-muted" style="font-size: 0.75rem; font-style: italic;">
              ${t('tab.noHistoryYet')}
            </div>
          ` : userAudit.map(item => {
            const isPayment = item.type.startsWith('payment');
            const isExpense = item.type === 'expense';
            const itemSign = item.amount >= 0 ? '+' : '';
            const itemClass = item.amount >= 0 ? 'text-green' : 'text-red';
            const icon = isPayment ? '📱' : isExpense ? '🛒' : item.won ? '✅' : '🔴';
            const dateStr = item.timestamp ? parseServerDate(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            return `
              <div class="audit-item">
                <div class="flex align-center gap-xs" style="flex: 1; min-width: 0;">
                  <span>${icon}</span>
                  <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(item.title)}</span>
                  ${dateStr ? `<span class="text-muted" style="font-size: 0.65rem;">(${dateStr})</span>` : ''}
                </div>
                <div class="flex align-center gap-xs">
                  ${(item.expenseId || item.hasReceipt) ? `
                    <button type="button" class="btn btn-ghost btn-xs btn-view-tab-receipt" data-expense-id="${escapeHtml(item.expenseId || '')}" style="padding: 1px 6px; font-size: 0.68rem; color: var(--gold); border: 1px solid rgba(245,166,35,0.3); border-radius: 4px;" title="${isEn ? 'View receipt' : 'Visa kvitto'}">
                      🧾 ${isEn ? 'Receipt' : 'Kvitto'}
                    </button>
                  ` : ''}
                  <div class="${itemClass}" style="font-weight: 700;">
                    ${itemSign}${formatCurrency(item.amount)}
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  // Render Transfers section ("📱 Att Swisha för helgen")
  let transfersHtml = '';
  if (transfers.length === 0) {
    transfersHtml = `
      <div class="card text-center" style="padding: 16px; background: rgba(74, 222, 128, 0.05); border: 1px solid rgba(74, 222, 128, 0.2);">
        <span style="font-size: 1.4rem;">🎉</span>
        <p style="margin: 4px 0 0; color: #4ade80; font-size: 0.85rem; font-weight: 700;">
          ${t('tab.noTransfersNeeded')}
        </p>
      </div>`;
  } else {
    transfersHtml = transfers.map(tr => {
      const isMeFrom = isSameUser(user, tr.fromUserId, tr.from);
      const isMeTo = isSameUser(user, tr.toUserId, tr.to);
      const isHost = user && tour.creatorId === user.id;


      return `
        <div class="tab-transfer-card ${isMeFrom ? 'animate-pulse' : ''}" style="border-left-color: ${isMeFrom ? '#ef4444' : isMeTo ? '#4ade80' : 'var(--gold)'};">
          <div>
            <div style="font-weight: 700; font-size: 0.9rem;">
              <span class="${isMeFrom ? 'text-red' : ''}">${escapeHtml(tr.from)}</span>
              <span class="text-muted" style="margin: 0 4px;">➜</span>
              <span class="${isMeTo ? 'text-green' : ''}">${escapeHtml(tr.to)}</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem;">
              ${tr.toSwish ? `Swish: ${escapeHtml(tr.toSwish)}` : 'Inget Swish-nr registrerat'}
            </div>
          </div>
          <div class="flex align-center gap-xs">
            <div style="font-size: 1.1rem; font-weight: 900; margin-right: 6px; color: ${isMeFrom ? '#ef4444' : '#4ade80'};">
              ${formatCurrency(tr.amount)}
            </div>

            ${isMeTo ? `
              <button type="button" class="btn btn-secondary btn-xs btn-remind-transfer" data-from="${escapeHtml(tr.from)}" data-amount="${tr.amount}" style="padding: 6px 8px;">
                ${t('tab.remindBtn')}
              </button>
            ` : ''}
            ${(isMeTo || isHost) ? `
              <button type="button" class="btn btn-secondary btn-xs btn-settle-transfer" 
                data-from="${escapeHtml(tr.from)}" 
                data-to="${escapeHtml(tr.to)}" 
                data-from-user-id="${escapeHtml(tr.fromUserId || '')}"
                data-to-user-id="${escapeHtml(tr.toUserId || '')}"
                data-amount="${tr.amount}" 
                title="${t('tab.settleBtn')}" 
                style="padding: 6px 8px; font-weight: 700;">
                ${t('tab.settleBtn')}
              </button>
            ` : ''}
          </div>
        </div>`;
    }).join('');
  }

  container.innerHTML = `
    <div class="animate-in">
      <!-- Tournament Header Card -->
      <div class="card flex-between align-center" style="margin-bottom: var(--space-md); padding: 12px 16px;">
        <div>
          <h2 class="font-heading" style="font-size: 1.1rem; margin: 0; color: var(--gold);">
            🏆 ${escapeHtml(tour.name)}
          </h2>
          <div class="text-muted" style="font-size: 0.75rem;">
            ${settlement.finishedRounds ?? 0} av ${settlement.totalRounds ?? 0} ${t('tab.roundsPlayed')}
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm btn-tab-open-tour" data-code="${escapeHtml(tour.shareCode)}" style="font-size: 0.75rem; padding: 6px 12px;">
          Öppna ➜
        </button>
      </div>

      ${selectorHtml}
      ${heroCardHtml}

      <!-- Standings & Audit Section -->
      <div class="section-header mt-md mb-xs">
        <h3 class="section-title" style="font-size: 0.95rem;">${t('tab.standingsTitle')}</h3>
      </div>
      <p class="text-muted" style="font-size: 0.75rem; margin-bottom: var(--space-sm);">
        ${t('tab.standingsDesc')}
      </p>
      <div class="tab-standings-list mb-lg">
        ${standingsRowsHtml}
      </div>

      <!-- Transfers Section -->
      <div class="section-header mt-lg mb-xs">
        <h3 class="section-title" style="font-size: 0.95rem;">${t('tab.toSwishTitle')}</h3>
      </div>
      <div class="tab-transfers-list mb-lg">
        ${transfersHtml}
      </div>

      <!-- Footer Quick Link -->
      <div class="text-center mt-lg">
        <button type="button" class="btn btn-secondary btn-block btn-tab-open-tour" data-code="${escapeHtml(tour.shareCode)}" style="padding: 12px; font-weight: 700;">
          ${t('tab.goToTournamentRounds')}
        </button>
      </div>
    </div>`;

  // Attach receipt modal viewer listener in audit drawer
  container.querySelectorAll('.btn-view-tab-receipt').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expenseId = btn.getAttribute('data-expense-id');
      if (expenseId) {
        openReceiptModal(expenseId);
      }
    });
  });

  container.querySelector('.btn-goto-todo')?.addEventListener('click', () => {
    activeTab = 'overview';
    renderLeaderboard();
  });

  // Attach tournament selector listener
  document.getElementById('tab-tour-select')?.addEventListener('change', (e) => {
    currentTournamentCode = e.target.value;
    renderLeaderboard();
  });

  // Attach open tournament listeners
  container.querySelectorAll('.btn-tab-open-tour').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-code');
      if (code) {
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'tournament', code } }));
      }
    });
  });

  // Attach accordion drawer click listeners
  container.querySelectorAll('.tab-audit-row').forEach(row => {
    row.addEventListener('click', () => {
      const drawerId = row.getAttribute('data-drawer-id') || `audit-${row.getAttribute('data-name')}`;
      const drawer = document.getElementById(drawerId);
      const chevron = row.querySelector('.audit-chevron');
      if (drawer) {
        const isClosed = drawer.style.display === 'none';
        drawer.style.display = isClosed ? 'block' : 'none';
        if (chevron) chevron.style.transform = isClosed ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
  });

  // Attach Settle Transfer listeners
  container.querySelectorAll('.btn-settle-transfer').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fromName = btn.getAttribute('data-from');
      const toName = btn.getAttribute('data-to');
      const fromUserId = btn.getAttribute('data-from-user-id') || undefined;
      const toUserId = btn.getAttribute('data-to-user-id') || undefined;
      const amount = Number(btn.getAttribute('data-amount')) || 0;

      const confirmMsg = isEn
        ? `Mark transfer of ${amount} kr from ${fromName} to ${toName} as settled?`
        : `Kvittera att ${fromName} har swishat ${amount} kr till ${toName}?`;

      if (confirm(confirmMsg)) {
        try {
          await toggleSettlementReceipt(tour.id, { fromName, toName, fromUserId, toUserId, amount });
          showToast(isEn ? 'Transfer settled! ✅' : 'Överföring kvitterad! ✅', 'success');
          renderLeaderboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  });

  // Attach Remind Transfer listener
  container.querySelectorAll('.btn-remind-transfer').forEach(btn => {
    btn.addEventListener('click', () => {
      const fromName = btn.getAttribute('data-from');
      const amount = btn.getAttribute('data-amount');
      const text = isEn 
        ? `Hey ${fromName}! Friendly reminder to settle ${amount} kr for ${tour.name} on Whooply 📱🤝`
        : `Tjena ${fromName}! Vänlig påminnelse att swisha ${amount} kr för ${tour.name} på Whooply 📱🤝`;

      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(isEn ? 'Reminder copied to clipboard! 📋' : 'Påminnelsetext kopierad till urklipp! 📋', 'success');
        });
      }
    });
  });
}

// ── 3. History & Archive Tab ───────────────────────────
function renderHistoryTab(container, pastTournaments, user = null, openTournamentIds = new Set()) {
  const isEn = getLang() === 'en';

  if (!pastTournaments || pastTournaments.length === 0) {
    container.innerHTML = `
      <div class="card text-center text-muted" style="padding: 30px;">
        <div style="font-size: 2rem; margin-bottom: 6px;">📁</div>
        <p style="margin: 0; font-size: 0.85rem;">
          ${t('tab.noPastTournaments')}
        </p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="animate-in">
      <div class="section-header mb-sm">
        <h3 class="section-title" style="font-size: 0.95rem;">
          ${t('tab.pastTournaments')}
        </h3>
      </div>
      <div class="past-tournaments-list">
        ${pastTournaments.map(tItem => `
          <div class="card mb-sm" style="padding: 12px 14px;">
            <div class="flex-between align-center">
              <div>
                <div style="font-weight: 700; font-size: 0.9rem;">
                  🏆 ${escapeHtml(tItem.name)}
                </div>
                <div class="text-muted" style="font-size: 0.75rem;">
                  ${tItem.roundCount} ${isEn ? 'games' : 'spel'} · ${tItem.createdAt ? parseServerDate(tItem.createdAt).toLocaleDateString() : ''}
                </div>
              </div>
              <div class="flex align-center gap-xs">
                ${openTournamentIds.has(tItem.id)
                  ? `<span class="badge badge-warning" style="font-size: 0.7rem;">${isEn ? '⏳ Payments open' : '⏳ Betalningar kvar'}</span>`
                  : `<span class="badge badge-success" style="font-size: 0.7rem;">${isEn ? 'Settled ✅' : 'Avräknad ✅'}</span>`}
              </div>
            </div>
            <div class="flex gap-xs mt-xs" style="margin-top: 8px;">
              <button type="button" class="btn btn-secondary btn-xs btn-toggle-history-settlement" data-code="${escapeHtml(tItem.shareCode)}" data-tour-id="${escapeHtml(tItem.id)}" data-creator-id="${escapeHtml(tItem.creatorId || '')}" style="font-size: 0.75rem; padding: 4px 10px;">
                📊 ${isEn ? 'View Settlement' : 'Visa slutavräkning'}
              </button>
              <button type="button" class="btn btn-ghost btn-xs btn-tab-open-tour" data-code="${escapeHtml(tItem.shareCode)}" style="font-size: 0.75rem; padding: 4px 10px;">
                ➜ ${isEn ? 'Open Event' : 'Öppna event'}
              </button>
            </div>
            <div class="history-settlement-drawer" id="history-settle-${escapeHtml(tItem.shareCode)}" style="display: none; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;"></div>
          </div>
        `).join('')}
      </div>
    </div>`;

  container.querySelectorAll('.btn-tab-open-tour').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.getAttribute('data-code');
      if (code) {
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'tournament', code } }));
      }
    });
  });

  container.querySelectorAll('.btn-toggle-history-settlement').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.getAttribute('data-code');
      const tourId = btn.getAttribute('data-tour-id');
      const creatorId = btn.getAttribute('data-creator-id');
      if (!code) return;
      const drawer = container.querySelector(`#history-settle-${code}`);
      if (!drawer) return;

      if (drawer.style.display !== 'none') {
        drawer.style.display = 'none';
        btn.innerHTML = `📊 ${isEn ? 'View Settlement' : 'Visa slutavräkning'}`;
        return;
      }

      drawer.style.display = 'block';
      btn.innerHTML = `▲ ${isEn ? 'Hide Settlement' : 'Dölj avräkning'}`;
      drawer.innerHTML = `<div class="text-center text-muted" style="padding: 12px 0;"><span class="spinner" style="font-size: 1.1rem; margin-right: 6px;">⏳</span> ${isEn ? 'Loading...' : 'Hämtar avräkning...'}</div>`;

      try {
        const fullTour = await getTournament(code);
        const settlement = fullTour.settlement || {};
        const balances = settlement.balances || [];
        const transfers = settlement.transfers || [];
        const isHost = user && fullTour.creatorId === user.id;

        let html = '';
        if (balances.length === 0) {
          html = `<p class="text-muted text-center" style="font-size: 0.8rem; margin: 4px 0;">${isEn ? 'No settlement data recorded.' : 'Ingen avräkningsdata registrerad.'}</p>`;
        } else {
          html += `
            <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 6px; color: var(--gold);">
              📈 ${isEn ? 'Final Standings' : 'Slutställning'}:
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
              ${balances.map(b => {
                const isWinner = b.net > 0;
                const isEven = b.net === 0;
                const badgeClass = isWinner ? 'badge-success' : (isEven ? 'badge-neutral' : 'badge-danger');
                const netFormatted = isWinner ? `+${b.net} kr` : `${b.net} kr`;
                return `
                  <div class="flex-between align-center" style="font-size: 0.8rem; padding: 4px 8px; background: rgba(255,255,255,0.03); border-radius: 4px;">
                    <span>${escapeHtml(b.name)}</span>
                    <span class="badge ${badgeClass}" style="font-size: 0.7rem; font-weight: 700;">${netFormatted}</span>
                  </div>`;
              }).join('')}
            </div>`;

          if (transfers.length > 0) {
            html += `
              <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 6px; color: var(--text-muted);">
                📱 ${isEn ? 'Swish Transfers' : 'Swish-överföringar'}:
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${transfers.map(tr => {
                  const isMeFrom = isSameUser(user, tr.fromUserId, tr.from);
                  const isMeTo = isSameUser(user, tr.toUserId, tr.to);


                  return `
                  <div class="flex-between align-center" style="font-size: 0.75rem; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 3px solid ${isMeFrom ? '#ef4444' : isMeTo ? '#4ade80' : 'var(--gold)'};">
                    <div>
                      <span class="${isMeFrom ? 'text-red' : ''}"><strong>${escapeHtml(tr.from)}</strong></span>
                      <span class="text-muted" style="margin: 0 4px;">➜</span>
                      <span class="${isMeTo ? 'text-green' : ''}"><strong>${escapeHtml(tr.to)}</strong></span>
                    </div>
                    <div class="flex align-center gap-xs">
                      <span style="font-weight: 700; color: ${isMeFrom ? '#ef4444' : '#4ade80'};">${tr.amount} kr</span>

                      ${isMeTo ? `
                        <button type="button" class="btn btn-secondary btn-xs btn-history-remind" data-from="${escapeHtml(tr.from)}" data-amount="${tr.amount}" data-tour-name="${escapeHtml(fullTour.name)}" style="padding: 4px 8px; font-size: 0.7rem;">
                          ${t('tab.remindBtn')}
                        </button>
                      ` : ''}
                      ${(isMeTo || isHost) ? `
                        <button type="button" class="btn btn-secondary btn-xs btn-history-settle" 
                          data-tour-id="${escapeHtml(fullTour.id)}"
                          data-from="${escapeHtml(tr.from)}" 
                          data-to="${escapeHtml(tr.to)}" 
                          data-from-user-id="${escapeHtml(tr.fromUserId || '')}"
                          data-to-user-id="${escapeHtml(tr.toUserId || '')}"
                          data-amount="${tr.amount}" 
                          style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700;">
                          ${t('tab.settleBtn')}
                        </button>
                      ` : ''}
                    </div>
                  </div>`;
                }).join('')}
              </div>`;
          } else {
            html += `<p class="text-muted" style="font-size: 0.75rem; margin: 4px 0;">${isEn ? 'All debts settled! 🟢' : 'Alla skulder kvittade! 🟢'}</p>`;
          }
        }
        drawer.innerHTML = html;

        // Attach settle listeners for archived tournament transfers
        drawer.querySelectorAll('.btn-history-settle').forEach(settleBtn => {
          settleBtn.addEventListener('click', async () => {
            const tId = settleBtn.getAttribute('data-tour-id');
            const fromName = settleBtn.getAttribute('data-from');
            const toName = settleBtn.getAttribute('data-to');
            const fromUserId = settleBtn.getAttribute('data-from-user-id') || undefined;
            const toUserId = settleBtn.getAttribute('data-to-user-id') || undefined;
            const amount = Number(settleBtn.getAttribute('data-amount')) || 0;

            const confirmMsg = isEn
              ? `Mark transfer of ${amount} kr from ${fromName} to ${toName} as settled?`
              : `Kvittera att ${fromName} har swishat ${amount} kr till ${toName}?`;

            if (confirm(confirmMsg)) {
              try {
                await toggleSettlementReceipt(tId, { fromName, toName, fromUserId, toUserId, amount });
                showToast(isEn ? 'Transfer settled! ✅' : 'Överföring kvitterad! ✅', 'success');
                // Re-render the drawer to show updated state
                btn.click(); // close
                btn.click(); // re-open with fresh data
              } catch (err) {
                showToast(err.message, 'error');
              }
            }
          });
        });

        // Attach remind listeners for archived tournament transfers
        drawer.querySelectorAll('.btn-history-remind').forEach(remindBtn => {
          remindBtn.addEventListener('click', () => {
            const fromName = remindBtn.getAttribute('data-from');
            const amount = remindBtn.getAttribute('data-amount');
            const tourName = remindBtn.getAttribute('data-tour-name');
            const text = isEn
              ? `Hey ${fromName}! Friendly reminder to settle ${amount} kr for ${tourName} on Whooply 📱🤝`
              : `Tjena ${fromName}! Vänlig påminnelse att swisha ${amount} kr för ${tourName} på Whooply 📱🤝`;

            if (navigator.clipboard) {
              navigator.clipboard.writeText(text).then(() => {
                showToast(isEn ? 'Reminder copied to clipboard! 📋' : 'Påminnelsetext kopierad till urklipp! 📋', 'success');
              });
            }
          });
        });

      } catch (err) {
        drawer.innerHTML = `<p class="text-danger text-center" style="font-size: 0.75rem;">${escapeHtml(err.message)}</p>`;
      }
    });
  });
}

// Re-render Swishlistan automatically if an expense is converted in real time
window.addEventListener('tab-expenses-updated', () => {
  const content = document.getElementById('page-content');
  if (content && content.querySelector('.the-tab-container') && activeTab === 'overview') {
    renderLeaderboard();
  }
});
