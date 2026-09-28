// ── Components: Navbar ───────────────────────────────
import { isLoggedIn, getStoredUser } from '../auth.js';
import { renderBell, initBellListeners } from './notifications.js';
import { t, getLang, setLang } from '../i18n.js';

// Navigation icons
const icons = {
  home: `<svg class="nav-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M9 6v12" stroke-dasharray="2 2"/><path d="M13.5 10.5h4M13.5 13.5h3"/></svg>`,
  leaderboard: `<svg class="nav-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`,
  join: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  profile: `<svg class="nav-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  admin: `<svg class="nav-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>`
};

import { openAppQrModal } from './appQrModal.js';
import { requestBack } from '../backNav.js';

// Pages below the main tabs get a back button where the QR button usually sits
// (the logo still opens the QR code)
const SUB_PAGES = new Set(['event', 'tournament']);

function bindOnce(id, handler) {
  const el = document.getElementById(id);
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  el.addEventListener('click', handler);
}

export function renderNavbar(activePage) {
  const user = getStoredUser();
  const loggedIn = isLoggedIn();
  const currentLang = getLang();

  const items = [
    { id: 'home', icon: icons.home, label: t('nav.home') },
    { id: 'leaderboard', icon: icons.leaderboard, label: t('nav.leaderboard') },
    // { id: 'join', icon: icons.join, label: t('nav.join') }, // Dold tills vidare
    { id: 'profile', icon: icons.profile, label: loggedIn ? (user?.nickname?.slice(0, 7) || t('nav.account')) : t('nav.account') },
    { id: 'admin', icon: icons.admin, label: t('nav.admin') }
  ];

  // The header can be drawn twice before this runs (e.g. opening a notification link),
  // so both callbacks would find the same buttons: bind each one only once
  setTimeout(() => {
    initBellListeners();
    bindOnce('top-header-back-btn', requestBack);
    bindOnce('top-header-qr-btn', () => openAppQrModal());
    bindOnce('top-header-logo-btn', () => openAppQrModal());
  }, 0);

  return `
    <div class="top-header">
      <div class="top-header-left">
        ${SUB_PAGES.has(activePage) ? `
        <button type="button" class="top-header-back-btn" id="top-header-back-btn" aria-label="${currentLang === 'sv' ? 'Tillbaka' : 'Back'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        ` : `
        <button class="top-header-qr-btn" id="top-header-qr-btn" title="${currentLang === 'sv' ? 'Dela app & QR-kod 📱' : 'Share app & QR code 📱'}" aria-label="Dela app och QR-kod">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            <path d="M7 7h.01"></path>
            <path d="M17 7h.01"></path>
            <path d="M7 17h.01"></path>
            <path d="M17 17h.01"></path>
          </svg>
        </button>
        `}
      </div>
      <div class="top-header-center">
        <span class="top-header-logo" id="top-header-logo-btn" title="${currentLang === 'sv' ? 'Dela app / QR-kod 📱' : 'Share app / QR code 📱'}">WHOOPLY</span>
      </div>
      <div class="top-header-right">
        ${renderBell()}
      </div>
    </div>
    <div class="navbar">
      ${items.map(item => `
        <button class="nav-item ${activePage === item.id ? 'active' : ''}"
                data-nav="${item.id}" id="nav-${item.id}">
          <span class="nav-icon">${item.icon}</span>
          <span>${item.label}</span>
        </button>
      `).join('')}
    </div>
  `;
}
