// ── i18n: Internationalization ────────────────────────
import { sv } from './lang/sv.js';
import { en } from './lang/en.js';

const languages = { sv, en };
let currentLang = (typeof localStorage !== 'undefined' ? localStorage.getItem('whooply_lang') : null) || detectLanguage();

// The app is made for a Swedish group of friends: Swedish unless someone picks English
// in the language menu (an English phone setting alone should not mix the languages)
function detectLanguage() {
  return 'sv';
}

export function t(key) {
  const keys = key.split('.');
  let val = languages[currentLang];
  for (const k of keys) {
    val = val?.[k];
  }
  if (val === undefined) {
    // Fallback to English
    val = languages.en;
    for (const k of keys) {
      val = val?.[k];
    }
  }
  return val ?? key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (languages[lang]) {
    currentLang = lang;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('whooply_lang', lang);
    }
    // Trigger re-render
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lang-changed'));
    }
  }
}

export function getAvailableLanguages() {
  return [
    { code: 'sv', label: '🇸🇪 Svenska' },
    { code: 'en', label: '🇬🇧 English' }
  ];
}

// Format currency (kr)
export function formatPoints(amount) {
  if (amount === null || amount === undefined) return '0 kr';
  return Math.round(amount).toLocaleString() + ' ' + t('common.pts');
}
