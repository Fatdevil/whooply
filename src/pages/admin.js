// ── Page: Admin Panel ─────────────────────────────────
import * as api from '../api.js';
import { formatCurrency, formatDate, formatTime, statusLabel, statusBadgeClass, showToast, launchConfetti, escapeHtml, formatDeadline, safeImageSrc } from '../utils.js';
import { showModal, closeModal } from '../components/modal.js';
import { navigate } from '../main.js';
import { isLoggedIn, getStoredUser } from '../auth.js';
import { t, getLang } from '../i18n.js';
import { compressImage } from '../imageUtils.js';
import { openFinishEventModal } from '../components/finish-event-modal.js';

let adminPin = null;

function getPin() {
  return adminPin || sessionStorage.getItem('whooply_pin');
}

function savePin(pin) {
  adminPin = pin;
  sessionStorage.setItem('whooply_pin', pin);
}

function isSuperAdmin() {
  return !!getPin();
}

export async function renderAdmin() {
  const content = document.getElementById('page-content');
  const loggedIn = isLoggedIn();
  const hasPinSession = isSuperAdmin();

  // If logged in, show admin dashboard (can manage own events)
  // If has PIN, show all events (superadmin)
  // If neither, show options
  if (loggedIn || hasPinSession) {
    renderAdminDashboard(content, loggedIn, hasPinSession);
    return;
  }

  // Show choice: login as user OR enter superadmin PIN
  renderAdminChoice(content);
}

function renderAdminChoice(content) {
  content.innerHTML = `
    <div class="animate-in">
      <div class="page-header text-center" style="margin-bottom: var(--space-md); padding-top: 4px;">
        <h1 class="tabx-title" style="text-align: left;">ADMIN</h1>
        <p class="page-subtitle" style="margin-top: 2px; text-align: left;">${t('admin.subtitleUser')}</p>
      </div>

      <div class="card text-center" style="padding: var(--space-xl);">
        <div style="font-size: 2.5rem; margin-bottom: var(--space-md);">👤</div>
        <h3 style="margin-bottom: var(--space-sm);">${t('admin.loginPromptTitle')}</h3>
        <p class="text-muted mb-md" style="font-size: 0.85rem;">
          ${t('admin.loginPromptDesc')}
        </p>
        <button class="btn btn-primary btn-block" id="go-profile-btn">${t('admin.goToAccount')}</button>
      </div>

      <div class="text-center mt-md text-muted" style="font-size: 0.8rem;">${t('admin.orDivider')}</div>

      <div class="card mt-md">
        <h3 class="text-center mb-md" style="font-size: 0.9rem;">${t('admin.superadminPin')}</h3>
        <form id="enter-pin-form">
          <div class="pin-input-group">
            <input type="password" class="form-input admin-secret-input" autocomplete="current-password" placeholder="Admin-lösenord (minst 8 tecken)" />
          </div>
          <button type="submit" class="btn btn-secondary btn-block btn-sm">${t('admin.loginSuperadmin')}</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('go-profile-btn').addEventListener('click', () => {
    navigate('profile');
  });

  setupPinInputs();
  document.getElementById('enter-pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = collectPin();
    if (pin.length < 8) { showToast(t('admin.toastEnterDigits'), 'error'); return; }
    try {
      const status = await api.adminStatus();
      if (!status.hasPin) {
        // First time — set up PIN
        await api.adminSetup(pin);
        savePin(pin);
        showToast(t('admin.toastPinCreated'), 'success');
        renderAdmin();
      } else {
        const result = await api.adminVerify(pin);
        if (result.verified) {
          savePin(pin);
          renderAdmin();
        } else {
          showToast(t('admin.toastWrongPin'), 'error');
        }
      }
    } catch (err) { showToast(err.message, 'error'); }
  });
}

async function renderAdminDashboard(content, loggedIn, hasPinSession) {
  const user = getStoredUser();
  const isEn = getLang() === 'en';

  content.innerHTML = `
    <div class="animate-in adm">
      <div class="tabx-top">
        <h1 class="tabx-title">ADMIN</h1>
        ${hasPinSession
          ? `<button class="adm-chip is-super" id="admin-logout-btn" title="${t('admin.logoutPin')}">🔐 Superadmin · ${isEn ? 'Lock' : 'Lås'}</button>`
          : `<button class="adm-chip" id="admin-unlock-super-btn">🔐 Superadmin</button>`}
      </div>
      <p class="adm-sub">${loggedIn
        ? (isEn ? 'Create events and manage your games.' : 'Skapa event och hantera dina spel. Spelen sköter du inne i varje event.')
        : (isEn ? 'Log in to create your own events.' : 'Logga in för att skapa egna event.')}</p>

      ${loggedIn
        ? `<button class="btn btn-primary btn-block" id="create-tournament-btn" style="padding: 13px; font-size: 1.05rem; font-weight: 700;">🏆 ${t('admin.createNewEvent') || 'Skapa nytt event'}</button>`
        : `<button class="btn btn-secondary btn-block" id="go-login-btn">${t('admin.goToAccount')}</button>`}

      <div id="admin-tournaments-list"></div>
      <div id="admin-events-list"></div>

      ${hasPinSession ? `
        <div class="adm-super-head">🔐 SUPERADMIN</div>
        <details class="adm-panel" id="adm-all-events"><summary>🏆 ${isEn ? 'All events' : 'Alla event'} <span class="adm-count" id="adm-all-events-count"></span></summary><div id="admin-all-tournaments"></div></details>
        <details class="adm-panel"><summary>👥 ${isEn ? 'Users' : 'Användare'} <span class="adm-count" id="adm-users-count"></span></summary><div id="admin-users-list"></div></details>
        <details class="adm-panel"><summary>⚖️ ${isEn ? 'Debts & disputes' : 'Skulder & tvister'} <span class="adm-count" id="adm-debts-count"></span></summary><div id="admin-debts-list"></div></details>
        <details class="adm-panel"><summary>📢 ${isEn ? 'Push to everyone' : 'Pushnotis till alla'}</summary><div id="admin-broadcast-push-container"></div></details>
      ` : ''}
    </div>
  `;

  if (hasPinSession) {
    document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
      sessionStorage.removeItem('whooply_pin');
      adminPin = null;
      showToast(t('admin.toastSuperLoggedOut'), 'info');
      renderAdmin();
    });
  } else {
    document.getElementById('admin-unlock-super-btn')?.addEventListener('click', () => {
      showUnlockSuperAdminModal();
    });
  }

  document.getElementById('go-login-btn')?.addEventListener('click', () => navigate('profile'));
  document.getElementById('create-tournament-btn')?.addEventListener('click', () => showCreateTournamentModal());

  await loadAdminTournaments(loggedIn, hasPinSession, user);
  await loadAdminEvents(loggedIn, hasPinSession, user);
  if (hasPinSession) {
    await loadAllTournamentsForSuperadmin(getPin());
    await loadAdminUsers(getPin());
    await loadAdminDebts(getPin());
    await loadAdminBroadcastPushSection();
  }
}

// One card per event: what it is, how it is going, and a tap into the event where
// its games are managed
function renderTournamentCard(tr, { showCreator = false } = {}) {
  const isEn = getLang() === 'en';
  const active = tr.status === 'active';
  const bits = [
    `${tr.roundCount || 0} ${isEn ? 'games' : 'spel'}`,
    tr.undecidedCount > 0 ? `${tr.undecidedCount} ${isEn ? 'undecided' : 'ej avgjorda'}` : null,
    `👥 ${tr.participantCount || 0}`,
    tr.totalPool > 0 ? formatCurrency(tr.totalPool) : null
  ].filter(Boolean).join(' · ');
  return `
    <button type="button" class="adm-event tournament-link" data-code="${escapeHtml(tr.shareCode)}">
      <div class="adm-event-main">
        <b>${escapeHtml(tr.name)}</b>
        <small>${bits}${showCreator && tr.creatorName ? ` · ${isEn ? 'by' : 'av'} @${escapeHtml(tr.creatorName)}` : ''}</small>
      </div>
      <span class="prof-pill ${active ? 'on' : ''}">${active ? (isEn ? 'Live' : 'Pågår') : (isEn ? 'Settled' : 'Avslutat')}</span>
      <span class="prof-chev">›</span>
    </button>`;
}

function bindTournamentLinks(root) {
  root.querySelectorAll('.tournament-link').forEach(el => {
    el.addEventListener('click', () => navigate('tournament', { code: el.dataset.code }));
  });
}

async function loadAllTournamentsForSuperadmin(pin) {
  const box = document.getElementById('admin-all-tournaments');
  if (!box) return;
  try {
    const all = await api.adminGetAllTournaments(pin);
    const count = document.getElementById('adm-all-events-count');
    if (count) count.textContent = all.length;
    box.innerHTML = all.length === 0
      ? `<p class="prof-hint">${t('admin.noEventsSuper')}</p>`
      : `<div class="adm-list">${all.map(tr => renderTournamentCard(tr, { showCreator: true })).join('')}</div>`;
    bindTournamentLinks(box);
  } catch (err) {
    box.innerHTML = `<p class="text-red">${escapeHtml(err.message)}</p>`;
  }
}

async function loadAdminEvents(loggedIn, hasPinSession, user) {
  try {
    const allEvents = await api.getEvents();
    const list = document.getElementById('admin-events-list');

    // Filter: show own events if logged in, all events if superadmin
    let events;
    if (hasPinSession) {
      events = allEvents; // Superadmin sees everything
    } else if (loggedIn && user) {
      events = allEvents.filter(e => e.creatorId === user.id);
    } else {
      events = [];
    }

    // Standalone matches are from before events existed; show them only if there are any
    if (events.length === 0) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = `<div class="prof-section"><span>${getLang() === 'en' ? 'STANDALONE MATCHES' : 'FRISTÅENDE MATCHER'}</span></div>` + events.map((ev, i) => `
      <div class="card animate-in" style="animation-delay: ${i * 0.05}s">
        ${safeImageSrc(ev.imageUrl) ? `
          <div style="width: 100%; height: 90px; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: var(--space-sm); border: 1px solid var(--border-light);">
            <img src="${escapeHtml(safeImageSrc(ev.imageUrl))}" alt="" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
        ` : ''}
        <div class="flex-between mb-md">
          <div>
            <h3 style="font-family: var(--font-heading); font-weight: 700;">${escapeHtml(ev.name)}</h3>
            <p class="text-secondary" style="font-size: 0.8rem;">
              ${formatDate(ev.date)} · ${t('admin.code')}: <span class="text-gold">${escapeHtml(ev.shareCode)}</span>
              ${ev.closesAt ? ` · <span class="text-gold font-bold">⏰ ${formatDeadline(ev.closesAt)?.shortText || ''}</span>` : ''}
            </p>
          </div>
          <span class="badge ${statusBadgeClass(ev.status)}">${statusLabel(ev.status)}</span>
        </div>
        <div class="flex-between" style="font-size: 0.85rem;">
          <span>${ev.playerCount} ${t('admin.participants')} · ${ev.betCount} ${t('admin.betsCount')} · ${formatCurrency(ev.totalPool)}</span>
        </div>
        <div class="flex gap-sm mt-md" style="flex-wrap: wrap;">
          <button class="btn btn-sm btn-secondary admin-view-btn" data-code="${escapeHtml(ev.shareCode)}">${t('admin.btnView')}</button>
          <button class="btn btn-sm btn-secondary admin-add-player-btn" data-id="${ev.id}" data-name="${escapeHtml(ev.name)}">${t('admin.btnPlayers')}</button>
          <button class="btn btn-sm btn-secondary admin-cover-btn" data-id="${ev.id}" title="Byt eller lägg till match-omslag">📸 Omslag</button>
          ${ev.status === 'open' ? `
            <button class="btn btn-sm btn-primary admin-boost-btn" data-id="${ev.id}">🚀 Boosta</button>
            <button class="btn btn-sm btn-secondary admin-lock-btn" data-id="${ev.id}">${t('admin.btnLock')}</button>
          ` : ''}
          ${ev.status === 'locked' ? `
            <button class="btn btn-sm btn-secondary admin-reopen-btn" data-id="${ev.id}">${t('admin.btnUnlock')}</button>
          ` : ''}
          ${ev.status === 'open' || ev.status === 'locked' ? `
            <button class="btn btn-sm btn-success admin-finish-btn" data-id="${ev.id}" data-code="${ev.shareCode}">${t('admin.btnFinish')}</button>
          ` : ''}
          ${ev.status === 'open' ? `
            <button class="btn btn-sm btn-secondary admin-bets-btn" data-id="${ev.id}" data-code="${ev.shareCode}">${t('admin.btnBets')}</button>
          ` : ''}
          ${(ev.status === 'open' || ev.status === 'locked') && ev.betCount > 0 ? `
            <button class="btn btn-sm btn-danger admin-cancel-btn" data-id="${ev.id}" data-name="${escapeHtml(ev.name)}">🛑 Avbryt</button>
          ` : ''}
          ${ev.status === 'cancelled' || (ev.status !== 'finished' && !(ev.betCount > 0)) ? `
            <button class="btn btn-sm btn-danger admin-delete-btn" data-id="${ev.id}" data-name="${escapeHtml(ev.name)}" title="${t('admin.btnDelete')}">🗑</button>
          ` : ''}
        </div>
      </div>
    `).join('');

    // Event listeners
    list.querySelectorAll('.admin-view-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('event', { code: btn.dataset.code }));
    });

    list.querySelectorAll('.admin-cover-btn').forEach(btn => {
      btn.addEventListener('click', () => showCoverModal(btn.dataset.id, loggedIn, hasPinSession, user));
    });

    list.querySelectorAll('.admin-boost-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Vill du skicka en pushnotis till alla deltagare för att boosta detta spel? 🚀')) return;
        try {
          await api.boostEvent(btn.dataset.id);
          launchConfetti();
          showToast('Spelet boostat med pushnotis! 🚀', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    list.querySelectorAll('.admin-lock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.lockEvent(btn.dataset.id, getPin());
          showToast(t('admin.toastEventLocked'), 'info');
          loadAdminEvents(loggedIn, hasPinSession, user);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    list.querySelectorAll('.admin-reopen-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const reopenRes = await api.reopenEvent(btn.dataset.id, getPin());
          showToast(reopenRes?.status === 'locked' ? reopenRes.message : t('admin.toastEventOpened'), reopenRes?.status === 'locked' ? 'info' : 'success');
          loadAdminEvents(loggedIn, hasPinSession, user);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    list.querySelectorAll('.admin-finish-btn').forEach(btn => {
      btn.addEventListener('click', () => showFinishModal(btn.dataset.id, btn.dataset.code, loggedIn, hasPinSession, user));
    });

    // A match with bets is cancelled (every stake goes back) instead of deleted
    list.querySelectorAll('.admin-cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Avbryta "${btn.dataset.name}"?\n\nMatchen räknas inte och alla insatser går tillbaka. Det kan inte ångras.`)) return;
        try {
          await api.cancelEvent(btn.dataset.id, getPin());
          showToast('Matchen avbröts – insatserna gick tillbaka', 'success');
          loadAdminEvents(loggedIn, hasPinSession, user);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    list.querySelectorAll('.admin-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showModal(t('admin.deleteModalTitle'), `
          <p class="mb-lg">${t('admin.deleteModalConfirm')} <strong>${escapeHtml(btn.dataset.name)}</strong>? ${t('admin.deleteModalWarning')}</p>
          <div class="flex gap-sm">
            <button class="btn btn-danger btn-block" id="confirm-delete-btn">${t('admin.confirmDelete')}</button>
            <button class="btn btn-secondary btn-block" id="cancel-delete-btn">${t('admin.cancel')}</button>
          </div>
        `);
        document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
          try {
            await api.deleteEvent(btn.dataset.id, getPin());
            closeModal();
            showToast(t('admin.toastEventDeleted'), 'info');
            loadAdminEvents(loggedIn, hasPinSession, user);
          } catch (err) { showToast(err.message, 'error'); }
        });
        document.getElementById('cancel-delete-btn').addEventListener('click', closeModal);
      });
    });

    list.querySelectorAll('.admin-add-player-btn').forEach(btn => {
      btn.addEventListener('click', () => showPlayerModal(btn.dataset.id, btn.dataset.name, loggedIn, hasPinSession, user));
    });

    list.querySelectorAll('.admin-bets-btn').forEach(btn => {
      btn.addEventListener('click', () => showBetsModal(btn.dataset.id, btn.dataset.code, loggedIn, hasPinSession, user));
    });

  } catch (err) {
    document.getElementById('admin-events-list').innerHTML = `
      <div class="text-red text-center">${escapeHtml(err.message)}</div>`;
  }
}

async function showPlayerModal(eventId, eventName, loggedIn, hasPinSession, user) {
  try {
    const event = await api.getEvent(eventId);

    showModal(`${t('admin.managePlayersTitle')} — ${eventName}`, `
      <div class="form-group">
        <label class="form-label">${t('admin.addPlayerLabel')}</label>
        <div class="flex gap-sm" style="align-items: center;">
          <input type="text" class="form-input" id="add-player-input" placeholder="${t('admin.addPlayerPlaceholder')}" style="flex:1;" />
          <button type="button" class="btn btn-secondary btn-sm" id="modal-player-avatar-btn" title="Välj bild för deltagare">📷</button>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" id="modal-player-avatar-input" style="display: none;" />
          <button class="btn btn-primary btn-sm" id="add-player-btn">${t('admin.btnAdd')}</button>
        </div>
        <div id="modal-player-avatar-indicator" style="display: none; font-size: 0.75rem; color: var(--gold); margin-top: 4px;">
          Bild vald för deltagare ✅
        </div>
      </div>
      <div id="player-list-modal">
        ${event.players.map(p => `
          <div class="bet-item" style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}" class="player-avatar-mini" />` : `<span style="font-size: 1.1rem;">👤</span>`}
              <span class="bet-item-name">${p.name}</span>
            </div>
            <div class="flex gap-xs" style="align-items: center;">
              <button class="btn btn-sm btn-secondary change-player-img-btn" data-id="${p.id}" title="Byt bild">📷</button>
              <button class="btn btn-sm btn-danger remove-player-modal" data-id="${p.id}">&times;</button>
            </div>
          </div>
        `).join('') || `<p class="text-muted text-center">${t('admin.noPlayersYet')}</p>`}
      </div>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" id="change-player-file-input" style="display: none;" />
    `);

    let pendingNewPlayerAvatar = null;
    const playerAvatarBtn = document.getElementById('modal-player-avatar-btn');
    const playerAvatarInput = document.getElementById('modal-player-avatar-input');
    const playerAvatarIndicator = document.getElementById('modal-player-avatar-indicator');

    playerAvatarBtn?.addEventListener('click', () => playerAvatarInput.click());
    playerAvatarInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        pendingNewPlayerAvatar = await compressImage(file, 500, 0.8);
        playerAvatarIndicator.style.display = 'block';
        playerAvatarBtn.style.borderColor = 'var(--gold)';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Change existing player avatar
    let activePlayerIdToChange = null;
    const changeFileInput = document.getElementById('change-player-file-input');
    document.querySelectorAll('.change-player-img-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activePlayerIdToChange = btn.dataset.id;
        changeFileInput.click();
      });
    });

    changeFileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !activePlayerIdToChange) return;
      try {
        const compressed = await compressImage(file, 500, 0.8);
        await api.updatePlayerImage(eventId, activePlayerIdToChange, { imageUrl: compressed, pin: getPin() });
        showToast('Spelarbild uppdaterad! 📸', 'success');
        closeModal();
        showPlayerModal(eventId, eventName, loggedIn, hasPinSession, user);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('add-player-btn').addEventListener('click', async () => {
      const name = document.getElementById('add-player-input').value.trim();
      if (!name) return;
      try {
        await api.addPlayer(eventId, name, getPin(), pendingNewPlayerAvatar);
        showToast(`${name} ${t('admin.toastPlayerAdded')}`, 'success');
        closeModal();
        showPlayerModal(eventId, eventName, loggedIn, hasPinSession, user);
        loadAdminEvents(loggedIn, hasPinSession, user);
      } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('add-player-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('add-player-btn').click();
      }
    });

    document.querySelectorAll('.remove-player-modal').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.removePlayer(eventId, btn.dataset.id, getPin());
          showToast(t('admin.toastPlayerRemoved'), 'info');
          closeModal();
          showPlayerModal(eventId, eventName, loggedIn, hasPinSession, user);
          loadAdminEvents(loggedIn, hasPinSession, user);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

  } catch (err) { showToast(err.message, 'error'); }
}

async function showCoverModal(eventId, loggedIn, hasPinSession, user) {
  try {
    const event = await api.getEvent(eventId);
    showModal('📸 Ändra match-omslag', `
      <div class="form-group">
        <label class="form-label">Omslagsbild</label>
        <div class="image-picker-box" id="modal-cover-drop">
          <div id="modal-cover-preview-wrapper" class="image-preview-wrapper" style="${event.imageUrl ? 'display:inline-block;' : 'display:none;'}">
            <img id="modal-cover-preview" src="${event.imageUrl || ''}" alt="Omslag" />
            <button type="button" class="image-preview-remove" id="modal-cover-remove">✕</button>
          </div>
          <div id="modal-cover-placeholder" style="${event.imageUrl ? 'display:none;' : 'display:block;'}">
            <div style="font-size: 2rem; margin-bottom: 4px;">📷</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">Klicka för att fota / välja bild</div>
          </div>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" id="modal-cover-input" style="display:none;" />
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-block mt-md" id="modal-cover-save-btn">Spara omslag ✅</button>
    `);

    let currentCover = event.imageUrl || null;
    const input = document.getElementById('modal-cover-input');
    const drop = document.getElementById('modal-cover-drop');
    const preview = document.getElementById('modal-cover-preview');
    const previewWrapper = document.getElementById('modal-cover-preview-wrapper');
    const placeholder = document.getElementById('modal-cover-placeholder');
    const removeBtn = document.getElementById('modal-cover-remove');
    const saveBtn = document.getElementById('modal-cover-save-btn');

    drop?.addEventListener('click', (e) => {
      if (e.target === removeBtn) return;
      input.click();
    });

    input?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Komprimerar...';
      try {
        currentCover = await compressImage(file, 1000, 0.8);
        preview.src = currentCover;
        previewWrapper.style.display = 'inline-block';
        placeholder.style.display = 'none';
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Spara omslag ✅';
      }
    });

    removeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      currentCover = null;
      input.value = '';
      preview.src = '';
      previewWrapper.style.display = 'none';
      placeholder.style.display = 'block';
    });

    saveBtn?.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Sparar...';
      try {
        await api.updateEventImage(eventId, { imageUrl: currentCover, pin: getPin() });
        closeModal();
        showToast('Omslagsbild sparad! 📸', 'success');
        loadAdminEvents(loggedIn, hasPinSession, user);
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Spara omslag ✅';
      }
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function showBetsModal(eventId, shareCode, loggedIn, hasPinSession, user) {
  try {
    const event = await api.getEvent(shareCode);

    showModal(`${t('admin.manageBetsTitle')} — ${event.name}`, `
      <div class="bet-list" id="bets-list-modal">
        ${event.bets.length > 0 ? event.bets.map(b => {
          const player = event.players.find(p => p.id === b.playerId);
          return `
            <div class="bet-item">
              <div>
                <div class="bet-item-name">${b.bettorName}</div>
                <div class="bet-item-player">→ ${player?.name || '?'} · ${formatTime(b.timestamp)}</div>
              </div>
              <div class="flex gap-sm" style="align-items: center;">
                <span class="bet-item-amount">${formatCurrency(b.amount)}</span>
                <button class="btn-sm bet-item-delete delete-bet-modal" data-bet-id="${b.id}" title="${t('admin.btnDelete')}">🗑</button>
              </div>
            </div>
          `;
        }).join('') : `<p class="text-muted text-center">${t('admin.noBetsYet')}</p>`}
      </div>
    `);

    document.querySelectorAll('.delete-bet-modal').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteBet(eventId, btn.dataset.betId, getPin());
          showToast(t('admin.toastBetDeleted'), 'info');
          closeModal();
          showBetsModal(eventId, shareCode, loggedIn, hasPinSession, user);
          loadAdminEvents(loggedIn, hasPinSession, user);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

  } catch (err) { showToast(err.message, 'error'); }
}

async function showFinishModal(eventId, shareCode, loggedIn, hasPinSession, user) {
  try {
    const event = await api.getEvent(shareCode);
    openFinishEventModal(event, {
      pin: getPin(),
      onDone: () => loadAdminEvents(loggedIn, hasPinSession, user)
    });
  } catch (err) { showToast(err.message, 'error'); }
}

// ── PIN input helpers ────────────────────────────────
function setupPinInputs(container = document) {
  const digits = container.querySelectorAll('.pin-digit');
  digits.forEach((input, i) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.slice(0, 1);
      if (val && i < digits.length - 1) {
        digits[i + 1].focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        digits[i - 1].focus();
      }
    });
    input.addEventListener('focus', () => input.select());
  });
  digits[0]?.focus();
  container.querySelector('.admin-secret-input')?.focus();
}

function collectPin(container = document) {
  const secretInput = container.querySelector('.admin-secret-input');
  if (secretInput) return secretInput.value.trim();
  return Array.from(container.querySelectorAll('.pin-digit'))
    .map(el => el.value)
    .join('');
}

function showUnlockSuperAdminModal() {
  const isEn = getLang() === 'en';
  const modalTitle = `🔐 ${t('admin.unlockSuperadmin') || 'Lås upp Superadmin'}`;
  const contentHtml = `
    <div style="padding: 10px 0; text-align: center;">
      <div style="font-size: 2.2rem; margin-bottom: 8px;">🔐</div>
      <p class="text-secondary" style="font-size: 0.85rem; margin-bottom: 16px; line-height: 1.4;">
        ${t('admin.unlockSuperadminDesc') || 'Ange din 4-siffriga Superadmin-PIN för att få full systembehörighet och kunna hantera användare.'}
      </p>

      <form id="modal-unlock-pin-form">
        <div class="pin-input-group" style="margin-bottom: 16px;">
          <input type="password" class="form-input admin-secret-input" autocomplete="current-password" placeholder="Admin-lösenord (minst 8 tecken)" />
        </div>
        <button type="submit" class="btn btn-primary btn-block" style="padding: 12px; font-weight: 700;">
          ${t('admin.loginSuperadmin') || 'Lås upp'} 🔓
        </button>
      </form>
    </div>
  `;

  const { root, close } = showModal(modalTitle, contentHtml);
  setupPinInputs(root);

  const form = root.querySelector('#modal-unlock-pin-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = collectPin(root);
    if (pin.length < 8) {
      showToast(t('admin.toastEnterDigits'), 'error');
      return;
    }

    try {
      const status = await api.adminStatus();
      if (!status.hasPin) {
        await api.adminSetup(pin);
        savePin(pin);
        close();
        showToast(t('admin.toastPinCreated'), 'success');
        renderAdmin();
      } else {
        const result = await api.adminVerify(pin);
        if (result.verified) {
          savePin(pin);
          close();
          showToast(t('admin.toastSuperUnlocked') || 'Superadmin upplåst! 🔐', 'success');
          renderAdmin();
        } else {
          showToast(t('admin.toastWrongPin'), 'error');
        }
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Tournament Admin ──────────────────────────────────
async function loadAdminTournaments(loggedIn, hasPinSession, user) {
  const list = document.getElementById('admin-tournaments-list');
  if (!list) return;
  if (!loggedIn || !user) { list.innerHTML = ''; return; }
  const isEn = getLang() === 'en';
  try {
    const mine = (await api.getTournaments()).filter(tr => tr.creatorId === user.id);
    list.innerHTML = `
      <div class="prof-section"><span>${isEn ? 'MY EVENTS' : 'MINA EVENT'} (${mine.length})</span></div>
      ${mine.length === 0
        ? `<p class="prof-hint">${t('admin.noEvents')}</p>`
        : `<div class="adm-list">${mine.map(tr => renderTournamentCard(tr)).join('')}</div>`}
    `;
    bindTournamentLinks(list);
  } catch (err) {
    list.innerHTML = `<p class="text-red">${escapeHtml(err.message)}</p>`;
  }
}

function showCreateTournamentModal() {
  showModal(t('admin.createTournamentTitle'), `
    <form id="create-tournament-form">
      <div class="form-group">
        <label class="form-label">${t('admin.tournamentName')}</label>
        <input type="text" class="form-input" id="tournament-name" placeholder="${t('admin.tournamentNamePlaceholder')}" required autofocus />
      </div>

      <div class="form-group">
        <label class="form-label">${t('admin.tournamentVisibility')}</label>
        <div class="visibility-picker" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
          <label class="visibility-card selected" id="vis-card-friends" style="cursor: pointer; border: 1.5px solid var(--gold); border-radius: var(--radius-md); padding: 10px 8px; text-align: center; background: rgba(245, 166, 35, 0.12); transition: all 0.2s;">
            <input type="radio" name="tournament-visibility" value="friends" checked style="display: none;" />
            <div style="font-size: 1.25rem;">🔒</div>
            <div style="font-weight: 700; font-size: 0.78rem; margin-top: 3px;">${t('admin.visFriends')}</div>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">${t('admin.visFriendsDesc')}</div>
          </label>
          <label class="visibility-card" id="vis-card-fof" style="cursor: pointer; border: 1.5px solid var(--border-light); border-radius: var(--radius-md); padding: 10px 8px; text-align: center; background: var(--bg-card); transition: all 0.2s;">
            <input type="radio" name="tournament-visibility" value="friends_of_friends" style="display: none;" />
            <div style="font-size: 1.25rem;">👥</div>
            <div style="font-weight: 700; font-size: 0.78rem; margin-top: 3px;">${t('admin.visFriendsOfFriends')}</div>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">${t('admin.visFriendsOfFriendsDesc')}</div>
          </label>
          <label class="visibility-card" id="vis-card-private" style="cursor: pointer; border: 1.5px solid var(--border-light); border-radius: var(--radius-md); padding: 10px 8px; text-align: center; background: var(--bg-card); transition: all 0.2s;">
            <input type="radio" name="tournament-visibility" value="private" style="display: none;" />
            <div style="font-size: 1.25rem;">🔗</div>
            <div style="font-weight: 700; font-size: 0.78rem; margin-top: 3px;">${t('admin.visLink')}</div>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">${t('admin.visLinkDesc')}</div>
          </label>
        </div>
        <div style="margin-top: 8px; padding: 8px 10px; background: rgba(245, 166, 35, 0.06); border: 1px solid rgba(245, 166, 35, 0.25); border-radius: var(--radius-md); font-size: 0.72rem; color: var(--text-secondary); line-height: 1.4;">
          ⚖️ <strong style="color: var(--gold);">${t('admin.legalNoticeTitle')}</strong>: ${t('admin.legalNoticeDesc')}
        </div>
      </div>

      <!-- Optional VIP Friend Invites Drawer -->
      <div class="form-group" style="margin-top: var(--space-sm);">
        <div class="flex-between mb-xs" style="align-items: center;">
          <label class="form-label" style="margin: 0; font-size: 0.82rem;">👥 Bjud in vänner (valfritt)</label>
          <button type="button" class="btn btn-sm btn-ghost" id="ce-toggle-invites-btn" style="font-size: 0.72rem; padding: 2px 8px; color: var(--gold); border: 1px dashed rgba(245,166,35,0.4);">
            + Välj vänner
          </button>
        </div>
        <div id="ce-invites-drawer" style="display: none; padding: var(--space-sm); background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); margin-top: 4px;">
          <div class="flex-between mb-xs" style="align-items: center;">
            <span style="font-size: 0.72rem; color: var(--text-secondary);">De valda får pushnotis och direkt tillträde utan QR!</span>
            <button type="button" class="btn btn-ghost btn-xs" id="ce-select-all-friends" style="font-size: 0.7rem; color: var(--accent);">Välj alla</button>
          </div>
          <div id="ce-friends-invite-list" style="max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
            <div class="text-muted text-center" style="font-size: 0.75rem; padding: 6px;">Laddar vänner... 👥</div>
          </div>
        </div>
        <div id="ce-invited-summary" style="display: none; font-size: 0.75rem; color: var(--green); margin-top: 4px; font-weight: 600;"></div>
      </div>

      <button type="submit" class="btn btn-primary btn-block mt-md" id="tournament-submit-btn">${t('admin.submitCreateTournament')}</button>
    </form>
  `);

  let selectedFriendIds = [];
  const invitesDrawer = document.getElementById('ce-invites-drawer');
  const invitesList = document.getElementById('ce-friends-invite-list');
  const invitesSummary = document.getElementById('ce-invited-summary');
  const toggleInvitesBtn = document.getElementById('ce-toggle-invites-btn');
  let friendsLoaded = false;

  toggleInvitesBtn?.addEventListener('click', async () => {
    if (invitesDrawer.style.display === 'block') {
      invitesDrawer.style.display = 'none';
      return;
    }
    invitesDrawer.style.display = 'block';
    if (friendsLoaded) return;

    try {
      const friends = await api.getFriends();
      friendsLoaded = true;
      if (!friends || friends.length === 0) {
        invitesList.innerHTML = `<div class="text-muted text-center" style="font-size: 0.75rem; padding: 8px;">Du har inga vänner tillagda än. Gå till din profil för att lägga till vänner!</div>`;
        return;
      }
      invitesList.innerHTML = friends.map(f => `
        <label class="flex-between" style="padding: 5px 8px; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); align-items: center; cursor: pointer; margin-bottom: 2px;">
          <div class="flex gap-xs" style="align-items: center; min-width: 0;">
            ${safeImageSrc(f.avatarUrl) ? `<img src="${escapeHtml(safeImageSrc(f.avatarUrl))}" alt="${escapeHtml(f.nickname)}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;" />` : `<span>${escapeHtml(f.avatar || '👤')}</span>`}
            <span style="font-size: 0.8rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(f.realName || f.nickname)} <span class="text-gold">(@${escapeHtml(f.nickname)})</span>
            </span>
          </div>
          <input type="checkbox" class="t-invite-cb" data-id="${escapeHtml(f.id)}" />
        </label>
      `).join('');

      const updateSummary = () => {
        const cbs = invitesList.querySelectorAll('.t-invite-cb:checked');
        selectedFriendIds = Array.from(cbs).map(cb => cb.dataset.id);
        if (selectedFriendIds.length > 0) {
          invitesSummary.style.display = 'block';
          invitesSummary.textContent = `✓ ${selectedFriendIds.length} vän${selectedFriendIds.length > 1 ? 'ner' : ''} får VIP-push & direkt tillträde`;
          toggleInvitesBtn.textContent = `👥 ${selectedFriendIds.length} valda`;
        } else {
          invitesSummary.style.display = 'none';
          toggleInvitesBtn.textContent = '+ Välj vänner';
        }
      };

      invitesList.querySelectorAll('.t-invite-cb').forEach(cb => {
        cb.addEventListener('change', updateSummary);
      });

      document.getElementById('ce-select-all-friends')?.addEventListener('click', () => {
        const cbs = invitesList.querySelectorAll('.t-invite-cb');
        const allChecked = Array.from(cbs).every(c => c.checked);
        cbs.forEach(c => c.checked = !allChecked);
        updateSummary();
      });
    } catch (err) {
      invitesList.innerHTML = `<div class="text-red text-center" style="font-size: 0.75rem;">${escapeHtml(err.message)}</div>`;
    }
  });

  document.querySelectorAll('.visibility-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.visibility-card').forEach(c => {
        c.style.border = '1.5px solid var(--border-light)';
        c.style.background = 'var(--bg-card)';
        c.classList.remove('selected');
      });
      card.style.border = '1.5px solid var(--gold)';
      card.style.background = 'rgba(245, 166, 35, 0.12)';
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  document.getElementById('create-tournament-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('tournament-name').value.trim();
    if (!name || name.length < 2) {
      showToast('Ett eventnamn krävs (minst 2 tecken)', 'error');
      return;
    }

    const visibility = document.querySelector('input[name="tournament-visibility"]:checked')?.value || 'friends';

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Skapar...';
    }

    try {
      const result = await api.createTournament({
        name,
        players: [],
        visibility,
        invitedFriendIds: selectedFriendIds
      });
      closeModal();
      showToast(t('admin.toastTournamentCreated'), 'success');
      navigate('tournament', { code: result.shareCode });
    } catch (err) {
      showToast(err.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = t('admin.submitCreateTournament');
      }
    }
  });
}

async function loadAdminUsers(pin) {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  try {
    const users = await api.adminGetUsers(pin);
    const usersCount = document.getElementById('adm-users-count');
    if (usersCount) usersCount.textContent = (users || []).length;
    if (!users || users.length === 0) {
      container.innerHTML = `
        <div class="section-header mt-lg">
          <h2 class="section-title">${t('admin.usersTitle')}</h2>
        </div>
        <div class="card text-center text-muted" style="padding: var(--space-md);">${t('admin.noUsers')}</div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="section-header mt-lg">
        <h2 class="section-title">${t('admin.usersTitle')} (${users.length})</h2>
      </div>
      <div class="card" style="padding: var(--space-sm);">
        <div style="display: flex; flex-direction: column; gap: var(--space-xs);">
          ${users.map(u => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-sm); border-bottom: 1px solid var(--border-glass); flex-wrap: wrap; gap: 8px;">
              <div>
                <div style="font-weight: 600; font-size: 0.9rem;">
                  ${escapeHtml(u.real_name || u.nickname)} 
                  <span class="badge" style="background: rgba(255,215,0,0.15); color: var(--gold); font-size: 0.75rem;">@${escapeHtml(u.nickname)}</span>
                </div>
                <div class="text-muted" style="font-size: 0.75rem;">
                  ${u.swish_number ? `📱 Swish: ${escapeHtml(u.swish_number)}` : 'Inget Swish'} 
                  ${u.needs_pin_reset ? '· <span class="text-red font-bold">PIN Nollställd</span>' : (u.has_pin ? '· <span class="text-green">PIN Aktiv</span>' : '· Ingen PIN')}
                </div>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <button class="btn btn-secondary btn-sm reset-user-pin-btn" data-id="${u.id}" data-name="${escapeHtml(u.nickname)}" style="font-size: 0.75rem;">
                  ${t('admin.resetPinBtn')}
                </button>
                <button class="btn btn-danger btn-sm delete-user-btn" data-id="${u.id}" data-name="${escapeHtml(u.nickname)}" data-realname="${escapeHtml(u.real_name || u.nickname)}" style="font-size: 0.75rem; padding: 5px 9px;" title="Ta bort användare">
                  ${t('admin.deleteUserBtn')}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section-header mt-lg">
        <h2 class="section-title">💾 Databas & Säkerhetskopiering</h2>
      </div>
      <div class="card" style="padding: var(--space-md);">
        <p class="text-muted" style="font-size: 0.8rem; margin-bottom: var(--space-sm);">
          Skapa en omedelbar säkerhetskopia av SQLite-databasen (användare, spel, odds, turneringar och saldon) eller ladda ned den senaste databasfilen (.db) till din dator.
        </p>
        <div style="display: flex; gap: var(--space-sm); flex-wrap: wrap; align-items: center;">
          <button class="btn btn-primary btn-sm" id="btn-create-backup">
            💾 Säkerhetskopiera nu
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-download-backup">
            ⬇️ Ladda ned senaste backup (.db)
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-verify-backup" style="border: 1px solid var(--success);">
            🔍 Verifiera backup
          </button>
        </div>
        <div id="admin-backup-status" class="mt-xs text-muted" style="font-size: 0.75rem;"></div>
      </div>
    `;

    // Download via fetch so the admin PIN travels in a header, never in the URL
    container.querySelector('#btn-download-backup')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/admin/backup/download', { headers: { 'x-admin-pin': pin } });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Kunde inte ladda ned backup');
        }
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/);
        const blobUrl = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = match ? match[1] : 'whooply-backup.db';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Hook up backup create button
    container.querySelector('#btn-create-backup')?.addEventListener('click', async () => {
      const btn = container.querySelector('#btn-create-backup');
      const statusEl = container.querySelector('#admin-backup-status');
      btn.disabled = true;
      btn.textContent = 'Skapar backup... ⏳';
      try {
        const res = await fetch('/api/admin/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        }).then(r => r.json());
        if (res.ok && res.backup) {
          showToast('Säkerhetskopia skapad! 💾', 'success');
          if (statusEl) {
            statusEl.innerHTML = `<span class="text-green">✓ Senaste backup: ${escapeHtml(res.backup.filename)} (${Math.round(res.backup.sizeBytes / 1024)} KB)</span>`;
          }
        } else {
          showToast(res.error || 'Kunde inte skapa backup', 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Säkerhetskopiera nu';
      }
    });

    // Hook up backup verify button
    container.querySelector('#btn-verify-backup')?.addEventListener('click', async () => {
      const btn = container.querySelector('#btn-verify-backup');
      const statusEl = container.querySelector('#admin-backup-status');
      btn.disabled = true;
      btn.textContent = 'Verifierar... 🔍';
      try {
        const res = await api.adminVerifyBackup(pin);
        if (res.ok) {
          const c = res.contents;
          statusEl.innerHTML = `<span class="text-green">✅ Backup OK – ${c.users} användare, ${c.tournaments} turneringar, ${c.duels} dueller (${res.sizeKB} KB)</span>`;
          showToast('Backupen är giltig! ✅', 'success');
        } else {
          statusEl.innerHTML = `<span class="text-red">❌ ${escapeHtml(res.error || 'Verifiering misslyckades')}</span>`;
        }
      } catch (err) {
        statusEl.innerHTML = `<span class="text-red">❌ ${escapeHtml(err.message)}</span>`;
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Verifiera backup';
      }
    });

    container.querySelectorAll('.reset-user-pin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.id;
        const userName = btn.dataset.name;
        if (!confirm(`${t('admin.resetPinConfirm')} ${userName}?`)) return;

        btn.disabled = true;
        btn.textContent = '...';
        try {
          const res = await api.adminResetUserPin(userId, pin);
          if (res && res.resetCode) {
            alert(`PIN nollställd för ${userName}!\n\n🔑 Engångskod: ${res.resetCode}\n\nGe denna 6-siffriga kod till användaren så att hen kan logga in och välja en ny PIN.`);
          } else {
            showToast(t('admin.pinResetToast') || 'PIN nollställd!', 'success');
          }
          await loadAdminUsers(pin);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = t('admin.resetPinBtn');
        }
      });
    });

    container.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.id;
        const userName = btn.dataset.name;
        const realName = btn.dataset.realname;
        const currentUser = getStoredUser();
        const isSelf = currentUser && currentUser.id === userId;

        const warningMsg = isSelf 
          ? `⚠️ OBS: Detta är ditt eget inloggade konto!\n\n`
          : '';
        const confirmMsg = `${warningMsg}${t('admin.deleteUserConfirm')} @${userName} (${realName})?\n\nDetta raderar användarens inloggning, PIN och relationer permanent. Lagda bets frikopplas men matchens pott behålls.`;

        if (!confirm(confirmMsg)) return;

        btn.disabled = true;
        btn.textContent = '...';
        try {
          const res = await api.adminDeleteUser(userId, pin);
          showToast(res?.message || t('admin.deleteUserToast'), 'success');
          await loadAdminUsers(pin);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = t('admin.deleteUserBtn');
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="text-red text-center">${escapeHtml(err.message)}</div>`;
  }
}

// ── Admin Debt Management ────────────────────────────
async function loadAdminDebts(pin) {
  const container = document.getElementById('admin-debts-list');
  if (!container) return;

  try {
    const duels = await api.adminGetDebts(pin);
    if (!Array.isArray(duels) || duels.length === 0) {
      container.innerHTML = `
        <div class="card mt-md">
          <h3 style="font-size: 0.95rem; margin-bottom: var(--space-sm);">⚖️ Skulder & Tvister</h3>
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <p class="empty-state-text">Inga dueller med skuld</p>
          </div>
        </div>`;
      return;
    }

    const unsettled = duels.filter(d => !d.is_settled);
    const debtsCount = document.getElementById('adm-debts-count');
    if (debtsCount) debtsCount.textContent = unsettled.length;
    const settled = duels.filter(d => d.is_settled);

    container.innerHTML = `
      <div class="card mt-md">
        <h3 style="font-size: 0.95rem; margin-bottom: var(--space-sm);">⚖️ Skulder & Tvister</h3>
        <p class="text-muted" style="font-size: 0.75rem; margin-bottom: var(--space-sm);">
          ${unsettled.length} öppna skulder · ${settled.length} kvitterade
        </p>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${unsettled.map(d => renderDuelCard(d, 'unsettled')).join('')}
          ${settled.length > 0 ? `
            <details style="margin-top: 8px;">
              <summary class="text-muted" style="font-size: 0.8rem; cursor: pointer;">Visa ${settled.length} kvitterade dueller</summary>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                ${settled.map(d => renderDuelCard(d, 'settled')).join('')}
              </div>
            </details>
          ` : ''}
        </div>
      </div>`;

    // Wire up buttons
    container.querySelectorAll('.admin-delete-duel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Vill du verkligen MAKULERA denna duell? Skulden försvinner helt.')) return;
        btn.disabled = true;
        try {
          await api.adminDeleteDuel(id, pin);
          showToast('Duell makulerad', 'success');
          await loadAdminDebts(pin);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.admin-unsettle-duel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Ångra kvitteringen? Skulden återöppnas.')) return;
        btn.disabled = true;
        try {
          await api.adminUnsettleDuel(id, pin);
          showToast('Kvittering ångrad – skulden är åter öppen', 'info');
          await loadAdminDebts(pin);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="text-red text-center">${escapeHtml(err.message)}</div>`;
  }
}

function renderDuelCard(d, type) {
  const winner = escapeHtml(d.winner_nickname || d.winner_name || '?');
  const creator = escapeHtml(d.creator_nickname || d.creator_name || '?');
  const opponent = escapeHtml(d.opponent_nickname || d.opponent_name || '?');
  const amount = formatCurrency(d.stake_amount);
  const date = d.created_at ? formatDate(d.created_at) : '';
  const gameLabel = d.game_type === 'blind10' ? '🎯 Blind 10' :
    d.game_type === 'spaceblitz' ? '🚀 Space Blitz' :
    d.game_type === 'party' ? '🎉 Party' : (d.game_type || '🎮');

  const isSettled = type === 'settled';
  const borderColor = isSettled ? 'var(--success)' : 'var(--gold)';

  return `
    <div style="border-left: 3px solid ${borderColor}; padding: 8px 10px; background: var(--card-bg); border-radius: var(--radius-sm); font-size: 0.8rem;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
        <div>
          <div style="font-weight: 600;">${gameLabel} · ${amount}</div>
          <div class="text-muted" style="font-size: 0.7rem;">${creator} vs ${opponent}</div>
          <div class="text-muted" style="font-size: 0.7rem;">🏆 ${winner} · ${date}</div>
          ${isSettled ? '<span class="badge badge-success" style="font-size: 0.6rem;">✅ Kvitterad</span>' : '<span class="badge badge-warning" style="font-size: 0.6rem;">⏳ Öppen skuld</span>'}
        </div>
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
          ${isSettled ? `<button class="btn btn-sm btn-secondary admin-unsettle-duel-btn" data-id="${d.id}" style="font-size: 0.65rem; padding: 3px 6px;" title="Ångra kvittering">↩️</button>` : ''}
          <button class="btn btn-sm btn-danger admin-delete-duel-btn" data-id="${d.id}" style="font-size: 0.65rem; padding: 3px 6px;" title="Makulera duell">🗑</button>
        </div>
      </div>
    </div>`;
}

async function loadAdminBroadcastPushSection() {
  const container = document.getElementById('admin-broadcast-push-container');
  if (!container) return;

  let totalSubscribers = 0;
  try {
    const stats = await api.getAdminPushStats(getPin());
    totalSubscribers = stats.totalSubscribers || 0;
  } catch (e) {
    // silent
  }

  container.innerHTML = `
    <div class="card" style="border: 1px solid rgba(255, 215, 0, 0.35); background: linear-gradient(135deg, rgba(255, 215, 0, 0.05) 0%, rgba(20, 20, 30, 0.95) 100%); padding: var(--space-md);">
      <div class="flex-between" style="align-items: center; margin-bottom: var(--space-sm);">
        <div style="font-weight: 700; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gold); display: flex; align-items: center; gap: 8px;">
          <span>📢</span> <span>Skicka Pushnotis till alla</span>
        </div>
        <span class="badge ${totalSubscribers > 0 ? 'badge-success' : 'badge-warning'}" id="broadcast-subscribers-badge" style="font-size: 0.72rem; padding: 4px 8px; border-radius: 6px;">
          👥 ${totalSubscribers} aktiva enheter
        </span>
      </div>

      <p class="text-muted" style="font-size: 0.8rem; line-height: 1.4; margin-bottom: var(--space-md);">
        Skicka en direktsänd pushnotis till alla sparade mobiler (matchstart, påminnelser eller BlixtBet-race).
      </p>

      <form id="admin-broadcast-push-form">
        <div class="form-group mb-sm">
          <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 4px;">Rubrik:</label>
          <input type="text" id="broadcast-push-title" class="form-input" placeholder="T.ex. 🏆 Kvällens stormatch börjar om 15 minuter!" required maxlength="60" style="font-size: 0.85rem;" />
        </div>

        <div class="form-group mb-sm">
          <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 4px;">Meddelande:</label>
          <textarea id="broadcast-push-body" class="form-input" placeholder="T.ex. Lägg ditt tips nu eller utmana polarna på en snabb duell!" required rows="2" maxlength="160" style="font-size: 0.85rem;"></textarea>
        </div>

        <div class="form-group mb-md">
          <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 4px;">Länk (valfritt):</label>
          <input type="text" id="broadcast-push-url" class="form-input" placeholder="T.ex. /?page=leaderboard eller /" style="font-size: 0.85rem;" />
        </div>

        <!-- Live lock screen preview -->
        <div style="margin-bottom: var(--space-md); padding: 10px 12px; background: rgba(0,0,0,0.5); border-radius: var(--radius-md); border: 1px dashed rgba(255,215,0,0.3);">
          <div style="font-size: 0.7rem; color: var(--gold); text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">📱 Förhandsgranskning (Låsskärm):</div>
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="width: 34px; height: 34px; border-radius: 9px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--gold); box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
              <img src="/icons/icon-192.png" alt="MB" style="width: 100%; height: 100%; object-fit: cover;" />
            </div>
            <div style="flex: 1; font-size: 0.78rem; line-height: 1.35; min-width: 0;">
              <div id="preview-push-title" style="font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Whooply 🇲🇹</div>
              <div id="preview-push-body" class="text-muted" style="font-size: 0.75rem; word-break: break-word;">Skriv en text ovan för att förhandsgranska...</div>
            </div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block" id="btn-submit-broadcast-push" style="background: linear-gradient(135deg, var(--gold), #f59e0b); border: none; font-weight: 700; padding: 10px 16px;">
          🚀 Skicka Pushnotis till alla
        </button>
      </form>
    </div>
  `;

  // Attach live preview listeners
  const titleInput = document.getElementById('broadcast-push-title');
  const bodyInput = document.getElementById('broadcast-push-body');
  const previewTitle = document.getElementById('preview-push-title');
  const previewBody = document.getElementById('preview-push-body');

  titleInput?.addEventListener('input', () => {
    previewTitle.textContent = titleInput.value.trim() || 'Whooply 🇲🇹';
  });

  bodyInput?.addEventListener('input', () => {
    previewBody.textContent = bodyInput.value.trim() || 'Skriv en text ovan för att förhandsgranska...';
  });

  // Attach submit handler
  document.getElementById('admin-broadcast-push-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    const url = document.getElementById('broadcast-push-url')?.value.trim() || '/';

    if (!title || !body) {
      showToast('Ange både rubrik och meddelande', 'error');
      return;
    }

    if (!confirm(`Är du säker på att du vill skicka denna pushnotis till ${totalSubscribers} aktiva enheter? 🚀`)) {
      return;
    }

    const submitBtn = document.getElementById('btn-submit-broadcast-push');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Skickar pushnotis...';

    try {
      const res = await api.sendAdminBroadcastPush({ title, body, url, pin: getPin() });
      launchConfetti();
      showToast(res.message || `Pushnotis skickad till ${res.sentCount || 0} enheter!`, 'success');
      document.getElementById('admin-broadcast-push-form')?.reset();
      previewTitle.textContent = 'Whooply 🇲🇹';
      previewBody.textContent = 'Skriv en text ovan för att förhandsgranska...';

      // Refresh count
      const updatedStats = await api.getAdminPushStats(getPin()).catch(() => null);
      if (updatedStats && document.getElementById('broadcast-subscribers-badge')) {
        totalSubscribers = updatedStats.totalSubscribers || 0;
        document.getElementById('broadcast-subscribers-badge').textContent = `👥 ${totalSubscribers} aktiva enheter`;
      }
    } catch (err) {
      showToast(err.message || 'Kunde inte skicka pushnotis', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Skicka Pushnotis till alla';
    }
  });
}
