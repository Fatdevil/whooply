// ── Utility functions ─────────────────────────────────
import { t, getLang } from './i18n.js';

export function formatPoints(amount) {
  if (amount === null || amount === undefined) return '0 kr';
  return Math.round(amount).toLocaleString() + ' ' + t('common.pts');
}

// Alias for backward compat during migration
export const formatCurrency = formatPoints;

export function getAppBaseUrl() {
  if (typeof window === 'undefined') return 'https://betpals-production.up.railway.app';
  let origin = window.location.origin;
  if (!origin || origin === 'null') return 'https://betpals-production.up.railway.app';
  if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    origin = origin.replace(/^http:\/\//i, 'https://');
  }
  return origin.replace(/\/$/, '');
}

// The server stores timestamps as SQLite "YYYY-MM-DD HH:MM:SS" in UTC. Safari cannot parse
// that format (Invalid Date) and other browsers read it as local time, so it is normalized
// to ISO UTC here. Returns null for missing or invalid dates.
export function parseDateSafe(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
  }
  let str = String(dateVal).trim();
  const sqlTimestamp = str.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (sqlTimestamp) {
    str = `${sqlTimestamp[1]}T${sqlTimestamp[2]}${sqlTimestamp[3] || 'Z'}`;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// Kept for existing callers; same as parseDateSafe but always returns a Date
export function parseServerDate(value) {
  return parseDateSafe(value) || new Date(NaN);
}

export function formatOdds(odds) {
  if (odds === null || odds === undefined) return '—';
  return odds.toFixed(2) + 'x';
}

export function formatDate(dateStr) {
  const d = parseDateSafe(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(isoStr) {
  const d = parseDateSafe(isoStr);
  if (!d) return '';
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

export function launchConfetti() {
  const colors = ['#ffd700', '#00ff87', '#4488ff', '#ff4466', '#ff8800', '#aa44ff', '#fff5cc'];
  const shapes = ['50%', '2px', '0'];

  function burst(count, delayMs) {
    setTimeout(() => {
      for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = (10 + Math.random() * 80) + 'vw';
        piece.style.top = -20 + 'px';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = (Math.random() * 0.8) + 's';
        piece.style.animationDuration = (2.5 + Math.random() * 2) + 's';
        piece.style.width = (5 + Math.random() * 10) + 'px';
        piece.style.height = (5 + Math.random() * 10) + 'px';
        piece.style.borderRadius = shapes[Math.floor(Math.random() * shapes.length)];
        piece.style.opacity = (0.7 + Math.random() * 0.3);
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 5000);
      }
    }, delayMs);
  }

  burst(60, 0);
  burst(40, 400);
  burst(20, 800);
}

export function statusLabel(status) {
  const map = { open: 'Öppen', locked: 'Låst', finished: 'Avslutad', cancelled: 'Avbruten' };
  return map[status] || status;
}

export function statusBadgeClass(status) {
  const map = { open: 'badge-open', locked: 'badge-locked', finished: 'badge-finished', cancelled: 'badge-danger' };
  return map[status] || '';
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^(https?:\/\/|\/|mailto:|tel:|swish:)/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

// For <img src>: web and app-relative links plus uploaded images stored as data URLs
// (sanitizeUrl is for links and rejects data URLs, which left uploaded images blank)
export function safeImageSrc(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, '');
  }
  if (/^(https?:\/\/|\/)/i.test(trimmed) && !/["'<>]/.test(trimmed)) return trimmed;
  return '';
}

export function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits) return '';

  // Strip international exit prefix 00 (e.g. 0046... -> 46...)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Handle +46 070... or 0046 070... (which after stripping 00 starts with 460)
  if (digits.startsWith('460') && digits.length >= 10) {
    digits = digits.slice(2);
  } else if (digits.startsWith('46') && digits.length >= 9 && digits.length <= 13) {
    digits = '0' + digits.slice(2);
  } else if (digits.length === 9 && digits.startsWith('7')) {
    digits = '0' + digits;
  }
  return digits;
}

export function normalizeSwedishPhone(raw) {
  if (!raw) return null;
  const norm = normalizePhone(raw);
  return /^07\d{8}$/.test(norm) ? norm : null;
}

export function formatSwedishPhoneDisplay(raw) {
  if (!raw) return '';
  const norm = normalizePhone(raw);
  if (/^07\d{8}$/.test(norm)) {
    return `${norm.slice(0, 3)}-${norm.slice(3, 6)} ${norm.slice(6, 8)} ${norm.slice(8, 10)}`;
  }
  return String(raw).trim();
}

export function createSwishUrl({ phone, amount, message }) {
  const cleanPhone = normalizeSwedishPhone(phone);
  if (!cleanPhone) return '#';
  const swishData = JSON.stringify({
    version: 1,
    payee: { value: cleanPhone },
    amount: { value: Math.max(1, Math.round(Number(amount) || 1)) },
    message: { value: message || 'Whooply' }
  });
  return 'swish://payment?data=' + encodeURIComponent(swishData);
}

export function formatDeadline(closesAt) {
  if (!closesAt) return null;
  const d = parseDateSafe(closesAt);
  if (!d) return null;
  const target = d.getTime();
  const diff = target - Date.now();
  if (diff <= 0) {
    return {
      isExpired: true,
      remainingMs: 0,
      text: t('event.deadlineExpired') || 'Spelstopp har passerat ⌛',
      shortText: 'Tid ute ⌛'
    };
  }
  if (diff < 60 * 1000) {
    return {
      isExpired: false,
      remainingMs: diff,
      text: '<1 min kvar ⏱️',
      shortText: '<1m kvar ⏱️'
    };
  }
  if (diff < 60 * 60 * 1000) {
    const mins = Math.ceil(diff / (60 * 1000));
    return {
      isExpired: false,
      remainingMs: diff,
      text: `${mins} min kvar ⏱️`,
      shortText: `${mins}m kvar ⏱️`
    };
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hrs = Math.floor(diff / (3600 * 1000));
    const mins = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
    return {
      isExpired: false,
      remainingMs: diff,
      text: `${hrs}h ${mins}m kvar ⏱️`,
      shortText: `${hrs}h ${mins}m kvar`
    };
  }
  const days = Math.floor(diff / (86400 * 1000));
  return {
    isExpired: false,
    remainingMs: diff,
    text: `${days} dgr kvar 📅`,
    shortText: `${days}d kvar`
  };
}

export function generateIcsDataUrl({ title, description, startDate, endDate, url }) {
  const formatIcsDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const startObj = parseDateSafe(startDate) || new Date();
  const start = formatIcsDate(startObj);
  const endObj = parseDateSafe(endDate) || new Date(startObj.getTime() + 60 * 60 * 1000);
  const end = formatIcsDate(endObj);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Whooply//Game Event//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@maltabetting.app`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description || ''}`,
    url ? `URL:${url}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');

  return 'data:text/calendar;charset=utf8,' + encodeURIComponent(ics);
}

export function generateGoogleCalendarUrl({ title, description, startDate, endDate, location }) {
  const formatGDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const startObj = parseDateSafe(startDate) || new Date();
  const start = formatGDate(startObj);
  const endObj = parseDateSafe(endDate) || new Date(startObj.getTime() + 60 * 60 * 1000);
  const end = formatGDate(endObj);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${start}/${end}`,
    details: description || '',
    location: location || ''
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}


// ── Login prompt for pages that need a logged-in user ──
const RETURN_TO_KEY = 'whooply_return_to';

export function rememberReturnTo(page, params = {}) {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify({ page, params }));
  } catch {}
}

export function consumeReturnTo() {
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function renderLoginPrompt(message) {
  return `
    <div class="card text-center animate-in" style="padding: var(--space-lg); margin-top: var(--space-md);">
      <div style="font-size: 2.2rem; margin-bottom: 6px;">🔑</div>
      <h3 style="font-size: 1.05rem; margin-bottom: 6px;">${getLang() === 'en' ? 'Log in to continue' : 'Logga in för att fortsätta'}</h3>
      <p class="text-muted" style="font-size: 0.85rem; margin-bottom: var(--space-md);">${escapeHtml(message)}</p>
      <button type="button" class="btn btn-primary btn-block login-prompt-btn">${getLang() === 'en' ? 'Log in / Create profile' : 'Logga in / Skapa profil'}</button>
    </div>
  `;
}

export function attachLoginPrompt(container, returnTo = null) {
  container?.querySelectorAll('.login-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (returnTo) rememberReturnTo(returnTo.page, returnTo.params || {});
      window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'profile' } }));
    });
  });
}
