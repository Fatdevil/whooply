// ── Theme Switcher ──────────────────────────────────
// Manages dark/light mode and accent color for Whooply.
// Persists choices in localStorage, applies via data-attributes on <html>.

const THEME_KEY = 'whooply_theme';       // 'dark' | 'light'
const ACCENT_KEY = 'whooply_accent';     // color name

// Available accent colors — label, CSS value, and glow variant
export const ACCENT_COLORS = [
  { id: 'purple',  label: '💜', color: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.18)', dim: '#7c3aed' },
  { id: 'orange',  label: '🧡', color: '#f97316', glow: 'rgba(249, 115, 22, 0.18)',  dim: '#ea580c' },
  { id: 'gold',    label: '💛', color: '#ffd700', glow: 'rgba(255, 215, 0, 0.18)',   dim: '#b8960f' },
  { id: 'green',   label: '💚', color: '#22c55e', glow: 'rgba(34, 197, 94, 0.18)',   dim: '#16a34a' },
  { id: 'blue',    label: '💙', color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.18)',  dim: '#2563eb' },
  { id: 'pink',    label: '💗', color: '#ec4899', glow: 'rgba(236, 72, 153, 0.18)',  dim: '#db2777' },
];

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

export function getAccent() {
  return localStorage.getItem(ACCENT_KEY) || 'gold';
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme();
}

export function setAccent(accentId) {
  localStorage.setItem(ACCENT_KEY, accentId);
  applyAccent();
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

// Apply theme to <html> element — triggers CSS variable changes
export function applyTheme() {
  const theme = getTheme();
  document.documentElement.setAttribute('data-theme', theme);

  // Update theme-color meta for PWA status bar
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#f5f5f7' : '#4a1a8a');
  }
}

// Apply accent color as CSS custom properties
export function applyAccent() {
  const accentId = getAccent();
  const accent = ACCENT_COLORS.find(a => a.id === accentId) || ACCENT_COLORS[2]; // default: gold
  const root = document.documentElement;
  root.style.setProperty('--accent', accent.color);
  root.style.setProperty('--accent-dim', accent.dim);
  root.style.setProperty('--accent-glow', accent.glow);
  root.style.setProperty('--gold', accent.color);
  root.style.setProperty('--gold-dim', accent.dim);
  root.style.setProperty('--gold-glow', accent.glow);
}

// Initialize on page load — call once from main.js
export function initTheme() {
  applyTheme();
  applyAccent();
}
