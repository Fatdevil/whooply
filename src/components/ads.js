// ── Components: Ads + GDPR Consent ────────────────────
import { t } from '../i18n.js';

const CONSENT_KEY = 'whooply_ad_consent';

export function initAds() {
  return; // Ads disabled during beta
  const consent = localStorage.getItem(CONSENT_KEY);
  if (consent === null) {
    showCookieConsent();
  } else if (consent === 'accepted') {
    loadAdScript();
  }
}

function showCookieConsent() {
  const banner = document.createElement('div');
  banner.className = 'cookie-consent';
  banner.id = 'cookie-consent';
  banner.innerHTML = `
    <div class="cookie-consent-text">
      <strong>${t('ads.cookieTitle')}</strong> ${t('ads.cookieText')}
    </div>
    <div class="cookie-consent-buttons">
      <button class="btn btn-sm btn-secondary" id="cookie-decline">${t('ads.decline')}</button>
      <button class="btn btn-sm btn-primary" id="cookie-accept">${t('ads.accept')}</button>
    </div>
  `;
  document.body.appendChild(banner);

  document.getElementById('cookie-accept').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    banner.remove();
    loadAdScript();
  });

  document.getElementById('cookie-decline').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'declined');
    banner.remove();
  });
}

function loadAdScript() {
  // Only load if not already loaded
  if (document.querySelector('script[src*="adsbygoogle"]')) return;

  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  // Replace with your real AdSense publisher ID
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX';
  document.head.appendChild(script);
}

/**
 * Render an ad slot placeholder
 * @param {string} slot - AdSense ad slot ID  
 * @param {'horizontal'|'vertical'|'rectangle'} format
 */
export function renderAd(slot = '', format = 'horizontal') {
  const consent = localStorage.getItem(CONSENT_KEY);
  if (consent !== 'accepted') return '';

  return `
    <div class="ad-container">
      <ins class="adsbygoogle"
           style="display:block"
           data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
           data-ad-slot="${slot}"
           data-ad-format="auto"
           data-full-width-responsive="true"></ins>
    </div>
  `;
}
