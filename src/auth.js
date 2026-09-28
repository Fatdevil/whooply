// ── Auth Store ──────────────────────────────────────
// Simple user state management using localStorage

const STORAGE_KEY = 'whooply_token';
const USER_KEY = 'whooply_user';

export function getStoredUser() {
  try {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

// Lets per-account UI (like the bell) reset when someone logs in, out or switches account
function announceAuthChange() {
  try { window.dispatchEvent(new CustomEvent('auth-changed')); } catch { /* not in a browser */ }
}

export function storeUser(user) {
  const previousToken = localStorage.getItem(STORAGE_KEY);
  if (user.token) {
    localStorage.setItem(STORAGE_KEY, user.token);
  }
  localStorage.setItem(USER_KEY, JSON.stringify({
    id: user.id,
    nickname: user.nickname,
    realName: user.realName || user.real_name || '',
    swishNumber: user.swishNumber || user.swish_number || '',
    avatar: user.avatar || user.avatar_emoji || '👤',
    avatarUrl: user.avatarUrl || user.avatar_url || null,
    email: user.email || null
  }));
  if (user.token && user.token !== previousToken) announceAuthChange();
}

export function clearUser() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(USER_KEY);
  announceAuthChange();
}

export function isLoggedIn() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}
