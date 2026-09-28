// ── Components: PWA Install Modal & Guide ──────────────────
import { showModal, closeModal } from './modal.js';
import { showToast, launchConfetti } from '../utils.js';

let deferredPrompt = null;
const DISMISS_KEY = 'whooply_pwa_dismissed_at';
const COOLDOWN_DAYS = 7;

export function setDeferredPrompt(e) {
  deferredPrompt = e;
}

export function getDeferredPrompt() {
  return deferredPrompt;
}

export function isAppStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches 
    || window.navigator.standalone === true 
    || document.referrer.includes('android-app://');
}

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) 
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroidDevice() {
  return /android/i.test(navigator.userAgent);
}

export function shouldShowAutoPrompt() {
  if (isAppStandalone()) return false;
  const dismissedAt = localStorage.getItem(DISMISS_KEY);
  if (dismissedAt) {
    const elapsedDays = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
    if (elapsedDays < COOLDOWN_DAYS) return false;
  }
  return true;
}

export function recordPromptDismissed() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

export function showPwaInstallModal({ forced = false } = {}) {
  if (isAppStandalone()) {
    showToast('✓ Appen är redan installerad och körs på hemskärmen! 📱', 'success');
    return;
  }

  if (!forced && !shouldShowAutoPrompt()) {
    return;
  }

  const isIos = isIosDevice();
  const isAndroid = isAndroidDevice();
  const canNativePrompt = Boolean(deferredPrompt);

  let bodyHtml = '';

  if (isIos) {
    bodyHtml = `
      <div class="pwa-guide-container text-center animate-in">
        <div class="pwa-guide-header mb-md">
          <div class="pwa-app-icon-wrap" style="width: 72px; height: 72px; margin: 0 auto 12px; border-radius: 18px; overflow: hidden; box-shadow: 0 8px 24px rgba(255, 215, 0, 0.25); border: 2px solid var(--gold);">
            <img src="/icons/icon-192.png" alt="Whooply" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
          <h4 style="margin-bottom: 6px; font-weight: 800; color: var(--gold);">Spara Whooply på hemskärmen</h4>
          <p class="text-muted" style="font-size: 0.85rem; line-height: 1.4; margin-bottom: 0;">
            Få fullskärm utan adressfält, blixtsnabb start och stöd för live-notiser!
          </p>
        </div>

        <div class="pwa-steps-list mb-lg" style="text-align: left; display: flex; flex-direction: column; gap: 10px;">
          <div class="pwa-step-item" style="display: flex; align-items: flex-start; gap: 12px; background: rgba(255, 255, 255, 0.04); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
            <div class="pwa-step-num" style="background: var(--gold); color: #000; font-weight: 800; font-size: 0.8rem; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;">1</div>
            <div style="font-size: 0.85rem; line-height: 1.4;">
              Tryck på <strong>Dela-knappen</strong> 
              <span class="ios-share-badge" style="display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.15); padding: 2px 7px; border-radius: 6px; margin: 0 2px; vertical-align: middle;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: #60a5fa;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              </span>
              längst ner i Safaris menyrad.
            </div>
          </div>

          <div class="pwa-step-item" style="display: flex; align-items: flex-start; gap: 12px; background: rgba(255, 255, 255, 0.04); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
            <div class="pwa-step-num" style="background: var(--gold); color: #000; font-weight: 800; font-size: 0.8rem; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;">2</div>
            <div style="font-size: 0.85rem; line-height: 1.4;">
              Scrolla ned i menyn och tryck på <br/>
              <strong>"Lägg till på hemskärmen"</strong> <span style="font-size: 0.95rem;">➕</span>
            </div>
          </div>

          <div class="pwa-step-item" style="display: flex; align-items: flex-start; gap: 12px; background: rgba(255, 255, 255, 0.04); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
            <div class="pwa-step-num" style="background: var(--gold); color: #000; font-weight: 800; font-size: 0.8rem; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;">3</div>
            <div style="font-size: 0.85rem; line-height: 1.4;">
              Öppna appen från hemskärmen! Gå till <strong>Profil</strong> för att aktivera push-notiser. 🔔
            </div>
          </div>
        </div>

        <div class="pwa-guide-arrow-hint text-center mb-md" style="font-size: 0.75rem; color: var(--gold); display: flex; align-items: center; justify-content: center; gap: 6px; animation: bounceDown 1.5s infinite;">
          <span>↓</span> Safaris Dela-knapp finns längst ner på skärmen <span>↓</span>
        </div>

        <button class="btn btn-primary btn-block" id="btn-pwa-close-guide" style="font-weight: 700;">
          Jag förstår! 👍
        </button>
      </div>
    `;
  } else if (canNativePrompt) {
    bodyHtml = `
      <div class="pwa-guide-container text-center animate-in">
        <div class="pwa-app-icon-wrap" style="width: 72px; height: 72px; margin: 0 auto 12px; border-radius: 18px; overflow: hidden; box-shadow: 0 8px 24px rgba(255, 215, 0, 0.25); border: 2px solid var(--gold);">
          <img src="/icons/icon-192.png" alt="Whooply" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
        <h4 style="margin-bottom: 6px; font-weight: 800; color: var(--gold);">Installera Whooply</h4>
        <p class="text-muted" style="font-size: 0.85rem; line-height: 1.4; margin-bottom: var(--space-md);">
          Installera appen på din enhet för blixtsnabb åtkomst, helskärm utan webbläsarrader och realtidsnotiser!
        </p>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--space-lg); text-align: left; background: rgba(255,255,255,0.03); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-glass); font-size: 0.82rem;">
          <div style="display: flex; align-items: center; gap: 8px;"><span>⚡</span> <span>Blixtsnabb laddning & sparar data</span></div>
          <div style="display: flex; align-items: center; gap: 8px;"><span>🔔</span> <span>Pushnotiser för BlixtBets & dueller</span></div>
          <div style="display: flex; align-items: center; gap: 8px;"><span>📱</span> <span>Helskärmskänsla direkt från startskärmen</span></div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn-primary btn-block" id="btn-pwa-install-native" style="font-weight: 700; background: linear-gradient(135deg, var(--gold), #f59e0b); border: none; padding: 12px;">
            📲 Installera appen nu
          </button>
          <button class="btn btn-secondary btn-block btn-sm" id="btn-pwa-dismiss-prompt">
            Kanske senare
          </button>
        </div>
      </div>
    `;
  } else {
    // Android or Desktop fallback when beforeinstallprompt has not fired or browser requires menu
    bodyHtml = `
      <div class="pwa-guide-container text-center animate-in">
        <div class="pwa-app-icon-wrap" style="width: 72px; height: 72px; margin: 0 auto 12px; border-radius: 18px; overflow: hidden; box-shadow: 0 8px 24px rgba(255, 215, 0, 0.25); border: 2px solid var(--gold);">
          <img src="/icons/icon-192.png" alt="Whooply" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
        <h4 style="margin-bottom: 6px; font-weight: 800; color: var(--gold);">Spara appen på telefonen</h4>
        <p class="text-muted" style="font-size: 0.85rem; line-height: 1.4; margin-bottom: var(--space-md);">
          Lägg till Whooply på startskärmen för full app-upplevelse och notiser!
        </p>

        <div class="pwa-steps-list mb-lg" style="text-align: left; display: flex; flex-direction: column; gap: 10px;">
          <div class="pwa-step-item" style="display: flex; align-items: flex-start; gap: 12px; background: rgba(255, 255, 255, 0.04); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
            <div class="pwa-step-num" style="background: var(--gold); color: #000; font-weight: 800; font-size: 0.8rem; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;">1</div>
            <div style="font-size: 0.85rem; line-height: 1.4;">
              Tryck på webbläsarens meny <strong>(⋮)</strong> uppe till höger i Chrome / Samsung Internet.
            </div>
          </div>

          <div class="pwa-step-item" style="display: flex; align-items: flex-start; gap: 12px; background: rgba(255, 255, 255, 0.04); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
            <div class="pwa-step-num" style="background: var(--gold); color: #000; font-weight: 800; font-size: 0.8rem; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;">2</div>
            <div style="font-size: 0.85rem; line-height: 1.4;">
              Välj <strong>"Installera app"</strong> eller <strong>"Lägg till på startskärmen"</strong> ➕.
            </div>
          </div>
        </div>

        <button class="btn btn-primary btn-block" id="btn-pwa-close-guide" style="font-weight: 700;">
          Jag förstår! 👍
        </button>
      </div>
    `;
  }

  showModal('📲 Whooply App', bodyHtml, () => {
    recordPromptDismissed();
  });

  // Attach handlers
  document.getElementById('btn-pwa-close-guide')?.addEventListener('click', () => {
    recordPromptDismissed();
    closeModal();
  });

  document.getElementById('btn-pwa-dismiss-prompt')?.addEventListener('click', () => {
    recordPromptDismissed();
    closeModal();
  });

  document.getElementById('btn-pwa-install-native')?.addEventListener('click', async () => {
    if (!deferredPrompt) {
      closeModal();
      return;
    }
    const promptEvent = deferredPrompt;
    promptEvent.prompt();
    closeModal();

    try {
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        launchConfetti();
        showToast('Whooply installeras på din telefon! 🎉', 'success');
        deferredPrompt = null;
      } else {
        recordPromptDismissed();
      }
    } catch (e) {
      console.warn('Install prompt error:', e);
    }
  });
}
