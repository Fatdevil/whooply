// ── Components: App QR Modal ─────────────────────────
import { showModal } from './modal.js';
import { getAppQr } from '../api.js';
import { getLang } from '../i18n.js';
import { escapeHtml, getAppBaseUrl } from '../utils.js';

export async function openAppQrModal(customUrl) {
  const isEn = getLang() === 'en';
  const targetUrl = customUrl || getAppBaseUrl();
  
  const modalTitle = isEn ? 'Share Whooply 📱' : 'Dela Whooply 📱';

  const contentHtml = `
    <div style="text-align: center; padding: 4px 0;">
      <!-- Logo Banner -->
      <div style="margin-bottom: 12px;">
        <img src="/logo-banner.png" alt="Whooply" style="max-height: 46px; max-width: 220px; object-fit: contain; margin: 0 auto; display: block; filter: drop-shadow(0 4px 16px rgba(255,215,0,0.35));" />
        <div style="font-size: 0.75rem; color: var(--gold); font-weight: 700; letter-spacing: 0.1em; margin-top: 6px; text-transform: uppercase;">
          Whooply
        </div>
      </div>

      <p style="font-size: 0.88rem; color: var(--text-secondary); margin: 0 auto 16px; max-width: 320px; line-height: 1.4;">
        ${isEn 
          ? 'Scan the QR code with your phone camera to open Whooply directly on your device — no download needed!' 
          : 'Scanna QR-koden med mobilkameran för att öppna Whooply direkt i mobilen — ingen nedladdning behövs!'}
      </p>

      <!-- QR Code Display Area -->
      <div id="app-qr-container" style="
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #07070e;
        border: 2px solid rgba(245, 158, 11, 0.45);
        border-radius: 20px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.7), 0 0 25px rgba(245,158,11,0.15);
        margin: 0 auto 18px;
        min-width: 230px;
        min-height: 230px;
      ">
        <div id="app-qr-loading" style="color: var(--gold); font-size: 0.85rem; font-weight: 600; display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <div class="spinner" style="width: 28px; height: 28px; border: 3px solid rgba(245,158,11,0.2); border-top-color: var(--gold); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>${isEn ? 'Generating QR Code...' : 'Skapar QR-kod...'}</span>
        </div>
        <img id="app-qr-image" src="" alt="App QR" style="display: none; width: 220px; height: 220px; max-width: 100%; border-radius: 12px; object-fit: contain;" />
      </div>

      <!-- URL display & Actions -->
      <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 10px 14px; margin: 0 auto 16px; max-width: 340px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="font-family: monospace; font-size: 0.82rem; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; flex: 1;">
          ${escapeHtml(targetUrl)}
        </div>
        <button type="button" id="btn-copy-app-link" class="btn btn-secondary btn-xs" style="font-weight: 700; white-space: nowrap; padding: 6px 10px; font-size: 0.78rem;">
          📋 ${isEn ? 'Copy' : 'Kopiera'}
        </button>
      </div>

      <!-- Share Buttons -->
      <div style="display: flex; gap: 10px; justify-content: center; max-width: 340px; margin: 0 auto 18px;">
        <button type="button" id="btn-share-app-native" class="btn btn-primary" style="flex: 1; font-weight: 700; padding: 10px 14px; font-size: 0.85rem; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; color: #000; box-shadow: 0 4px 14px rgba(245,158,11,0.3);">
          📤 ${isEn ? 'Share with Friends' : 'Dela med vänner'}
        </button>
      </div>

      <!-- PWA / Home Screen Tips -->
      <div style="background: rgba(245, 158, 11, 0.05); border: 1px dashed rgba(245, 158, 11, 0.25); border-radius: 14px; padding: 12px 14px; text-align: left; max-width: 340px; margin: 0 auto;">
        <div style="font-size: 0.78rem; font-weight: 700; color: var(--gold); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span>📲</span>
          <span>${isEn ? 'Save as an App on your phone:' : 'Spara som en app på hemskärmen:'}</span>
        </div>
        <div style="font-size: 0.74rem; color: var(--text-secondary); line-height: 1.45;">
          <div style="margin-bottom: 4px;">
            🍏 <strong>iPhone (Safari):</strong> ${isEn ? 'Tap Share ⎋ and choose' : 'Tryck på Dela ⎋ och välj'} <span style="color: #fff; font-weight: 600;">"${isEn ? 'Add to Home Screen' : 'Lägg till på hemskärmen'}"</span> ➕
          </div>
          <div>
            🤖 <strong>Android (Chrome):</strong> ${isEn ? 'Tap ⋮ and select' : 'Tryck på menyn ⋮ och välj'} <span style="color: #fff; font-weight: 600;">"${isEn ? 'Install App / Add to Home' : 'Installera app'}"</span> ➕
          </div>
        </div>
      </div>
    </div>
  `;

  const { root } = showModal(modalTitle, contentHtml);

  // Fetch QR Code
  const loadingEl = root.querySelector('#app-qr-loading');
  const imgEl = root.querySelector('#app-qr-image');

  try {
    const data = await getAppQr(targetUrl);
    if (imgEl && data.qr) {
      imgEl.src = data.qr;
      imgEl.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'none';
    } else {
      throw new Error('No QR data returned');
    }
  } catch (err) {
    // Graceful fallback to client-side or public QR generation
    if (imgEl) {
      imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&color=FFD700&bgcolor=07070E&margin=2&data=${encodeURIComponent(targetUrl)}`;
      imgEl.onload = () => {
        imgEl.style.display = 'block';
        if (loadingEl) loadingEl.style.display = 'none';
      };
      imgEl.onerror = () => {
        if (loadingEl) {
          loadingEl.innerHTML = `<span style="color: #ef4444;">${isEn ? 'Failed to load QR' : 'Kunde inte ladda QR'}</span>`;
        }
      };
    }
  }

  // Copy Link
  root.querySelector('#btn-copy-app-link')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(targetUrl);
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `✓ ${isEn ? 'Copied!' : 'Kopierad!'}`;
      btn.style.color = '#4ade80';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.style.color = '';
      }, 2500);
    } catch (_) {
      prompt(isEn ? 'Copy link:' : 'Kopiera länk:', targetUrl);
    }
  });

  // Native Share Button
  root.querySelector('#btn-share-app-native')?.addEventListener('click', async () => {
    const shareData = {
      title: 'Whooply',
      text: isEn 
        ? 'Join Whooply! Play minigames, social betting and duels with friends 🎲📱'
        : 'Häng med i Whooply! Spela minispel, betta och utmana kompisarna 🎲📱',
      url: targetUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== 'AbortError') {
          await navigator.clipboard?.writeText(targetUrl);
          alert(isEn ? 'Link copied to clipboard!' : 'Länk kopierad till urklipp!');
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(targetUrl);
        alert(isEn ? 'Link copied to clipboard!' : 'Länk kopierad till urklipp!');
      } catch (_) {
        prompt(isEn ? 'Copy link:' : 'Kopiera länk:', targetUrl);
      }
    }
  });
}
