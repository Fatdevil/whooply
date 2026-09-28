// ── Notifications System ──────────────────────────────
// The bell is an inbox: things waiting for you (friend requests) with the
// action right there, then what happened to you. The server keeps it, so it survives
// closing the app. Game-page events seen in this session are listed below.
import { getInbox, markInboxRead, clearInbox, acceptFriendRequest, declineFriendRequest } from '../api.js';
import { isLoggedIn, getToken } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { getLang } from '../i18n.js';

const MAX_NOTIFICATIONS = 20;
let notifications = [];
let unreadCount = 0;
let inbox = { friendRequests: [], todos: [], items: [], count: 0 };
let inboxTimer = null;
let outsideClickBound = false;

// Load from sessionStorage
try {
  const saved = sessionStorage.getItem('whooply_notifications');
  if (saved) {
    const parsed = JSON.parse(saved);
    notifications = parsed.items || [];
    unreadCount = parsed.unread || 0;
  }
} catch (e) { /* silent */ }

function save() {
  try {
    sessionStorage.setItem('whooply_notifications', JSON.stringify({
      items: notifications.slice(0, MAX_NOTIFICATIONS),
      unread: unreadCount
    }));
  } catch (e) { /* silent */ }
}

export function addNotification(notification) {
  notifications.unshift({
    ...notification,
    id: Date.now(),
    time: new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  });
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications = notifications.slice(0, MAX_NOTIFICATIONS);
  }
  unreadCount++;
  save();
  updateBellBadge();
}

export function getNotifications() {
  return notifications;
}

export function clearUnread() {
  unreadCount = 0;
  save();
  updateBellBadge();
}

export function getUnreadCount() {
  return inbox.count || 0;
}

function updateBellBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const total = getUnreadCount();
  if (total > 0) {
    badge.textContent = total > 9 ? '9+' : total;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

const EMPTY_INBOX = { friendRequests: [], todos: [], items: [], count: 0 };

export async function refreshInbox() {
  if (!isLoggedIn()) {
    inbox = { ...EMPTY_INBOX };
    updateBellBadge();
    return;
  }
  const token = getToken();
  let fresh;
  try {
    fresh = await getInbox(getLang());
  } catch (e) {
    return;
  }
  // A reply for an account that has since logged out or switched is thrown away
  if (getToken() !== token) return;
  inbox = fresh;
  const dropdown = document.getElementById('notif-dropdown');
  if (dropdown) {
    renderDropdown(dropdown);
    markShownAsRead();
  }
  updateBellBadge();
}

function waitingCount() {
  return (inbox.friendRequests || []).length + (inbox.todos || []).length;
}

// Whatever the open bell shows has been seen
function markShownAsRead() {
  if (isLoggedIn() && (inbox.items || []).some(n => !n.read)) {
    markInboxRead().catch(() => {});
    inbox = { ...inbox, items: inbox.items.map(n => ({ ...n, read: true })), count: waitingCount() };
  }
}

export function renderBell() {
  return `
    <div class="notif-bell" id="notif-bell" role="button" tabindex="0" aria-label="Notiser">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span class="notif-badge" id="notif-badge" style="display: none;">0</span>
    </div>
  `;
}

export function initBellListeners() {
  const bell = document.getElementById('notif-bell');
  if (!bell) return;

  updateBellBadge();
  refreshInbox();

  // One timer and one outside-click handler, however often the header is redrawn
  if (!inboxTimer) {
    inboxTimer = setInterval(refreshInbox, 60 * 1000);
    window.addEventListener('friends-changed', () => refreshInbox());
    window.addEventListener('auth-changed', () => {
      // Never show one account's notifications to the next
      inbox = { ...EMPTY_INBOX };
      notifications = [];
      unreadCount = 0;
      save();
      document.getElementById('notif-dropdown')?.remove();
      updateBellBadge();
      refreshInbox();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshInbox();
    });
  }
  if (!outsideClickBound) {
    outsideClickBound = true;
    document.addEventListener('click', () => {
      document.getElementById('notif-dropdown')?.remove();
    });
  }

  // A header drawn twice in a row reaches here twice with the same bell: a second
  // listener would open and at once close the list
  if (bell.dataset.bound) return;
  bell.dataset.bound = '1';
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });
}

function timeLabel(createdAt) {
  const d = new Date(String(createdAt).replace(' ', 'T') + (String(createdAt).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'nyss';
  if (mins < 60) return `${mins} min sedan`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h sedan`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function goTo(url) {
  const hash = String(url || '').split('#')[1];
  document.getElementById('notif-dropdown')?.remove();
  if (hash) window.location.hash = hash;
}

function renderDropdown(dropdown) {
  const { friendRequests = [], todos = [], items = [] } = inbox;
  const hasTodo = friendRequests.length > 0 || todos.length > 0;
  const empty = !hasTodo && items.length === 0;

  dropdown.innerHTML = empty ? `
    <div class="notif-empty">
      <span style="font-size: 1.5rem;">🔔</span>
      <p>Inga notiser just nu</p>
    </div>
  ` : `
    <div class="notif-header">
      <span style="font-weight: 600; font-size: 0.85rem;">Notiser</span>
      ${items.length > 0 ? '<button class="notif-clear" id="notif-clear-btn">Rensa</button>' : ''}
    </div>
    <div class="notif-list">
      ${hasTodo ? '<div class="notif-group">Väntar på dig</div>' : ''}
      ${friendRequests.map(r => `
        <div class="notif-item notif-todo">
          <span class="notif-icon">${escapeHtml(r.avatarEmoji || '👥')}</span>
          <div class="notif-content">
            <div class="notif-text"><b>${escapeHtml(r.realName || r.nickname)}</b> vill bli din vän</div>
            <div class="notif-actions">
              <button type="button" class="notif-btn notif-btn-yes" data-accept="${escapeHtml(r.id)}">Godkänn</button>
              <button type="button" class="notif-btn" data-decline="${escapeHtml(r.id)}">Neka</button>
            </div>
          </div>
        </div>
      `).join('')}
      ${todos.map(t => `
        <button type="button" class="notif-item notif-todo notif-link" data-url="${escapeHtml(t.url || '')}">
          <span class="notif-icon">${escapeHtml(t.icon || '🔔')}</span>
          <div class="notif-content">
            <div class="notif-text"><b>${escapeHtml(t.title)}</b></div>
            ${t.subtitle ? `<div class="notif-detail">${escapeHtml(t.subtitle)}</div>` : ''}
          </div>
          ${t.action ? `<span class="notif-cta">${escapeHtml(t.action)} →</span>` : ''}
        </button>
      `).join('')}
      ${items.length > 0 ? '<div class="notif-group">Senaste</div>' : ''}
      ${items.map(n => `
        <button type="button" class="notif-item notif-link${n.read ? '' : ' is-unread'}" data-url="${escapeHtml(n.url || '')}">
          <span class="notif-icon">${escapeHtml(n.icon || '🔔')}</span>
          <div class="notif-content">
            <div class="notif-text">${escapeHtml(n.text)}</div>
            ${n.detail ? `<div class="notif-detail">${escapeHtml(n.detail)}</div>` : ''}
            <div class="notif-time">${escapeHtml(timeLabel(n.createdAt))}</div>
          </div>
        </button>
      `).join('')}
    </div>
  `;

  dropdown.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await acceptFriendRequest(btn.dataset.accept);
      showToast('Ni är nu vänner! 👥🎉', 'success');
      window.dispatchEvent(new CustomEvent('friends-changed'));
    } catch (err) {
      showToast(err.message, 'error');
    }
    refreshInbox();
  }));
  dropdown.querySelectorAll('[data-decline]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await declineFriendRequest(btn.dataset.decline);
      window.dispatchEvent(new CustomEvent('friends-changed'));
    } catch (err) {
      showToast(err.message, 'error');
    }
    refreshInbox();
  }));
  dropdown.querySelectorAll('.notif-link').forEach(el => el.addEventListener('click', () => goTo(el.dataset.url)));

  dropdown.querySelector('#notif-clear-btn')?.addEventListener('click', async () => {
    notifications = [];
    unreadCount = 0;
    save();
    inbox = { ...inbox, items: [], count: waitingCount() };
    renderDropdown(dropdown);
    updateBellBadge();
    if (isLoggedIn()) clearInbox().catch(() => {});
  });
}

function toggleDropdown() {
  const existing = document.getElementById('notif-dropdown');
  if (existing) {
    existing.remove();
    return;
  }

  const dropdown = document.createElement('div');
  dropdown.id = 'notif-dropdown';
  dropdown.className = 'notif-dropdown';
  dropdown.addEventListener('click', (e) => e.stopPropagation());
  renderDropdown(dropdown);
  document.body.appendChild(dropdown);

  // Position below bell (bell is in top right header)
  const bell = document.getElementById('notif-bell');
  if (bell) {
    const rect = bell.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 8}px`;
    const rightOffset = Math.max(10, window.innerWidth - rect.right);
    dropdown.style.right = `${rightOffset}px`;
    dropdown.style.left = 'auto';
  }

  // Opening the bell marks what happened as seen; things waiting for you stay counted
  unreadCount = 0;
  save();
  markShownAsRead();
  updateBellBadge();
}

// ── Game-page activity ─────────────────────────────
// Other people's bets and game updates live in the game's own feed, not in your bell
export function handleWebSocketNotification() {}
