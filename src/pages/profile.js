// ── Page: Profile ─────────────────────────────────────
import { registerUser, loginUser, completePinReset, changePin, getMe, getMyBets, getMyStats, getMyPhotos, updateAvatar, updateProfile, getMyCredentials, getFriends, addFriend, removeFriend, searchUsers, getFriendRequests, acceptFriendRequest, declineFriendRequest, buildFriendInviteUrl, getNotificationPrefs, updateNotificationPrefs, joinPartyRoom } from '../api.js';
import { getStoredUser, storeUser, clearUser, isLoggedIn } from '../auth.js';
import { formatCurrency, formatDate, showToast, statusLabel, statusBadgeClass, escapeHtml, safeImageSrc, getAppBaseUrl, normalizePhone, formatSwedishPhoneDisplay, consumeReturnTo, createSwishUrl } from '../utils.js';
import { showModal, closeModal } from '../components/modal.js';
import { t, getLang, setLang, getAvailableLanguages } from '../i18n.js';
import { isWebAuthnSupported, enableBiometricAuth, loginWithBiometrics } from '../webauthn.js';
import { isPushSupported, getPushPermissionState, subscribeToPush, unsubscribeFromPush, isPushActive as isPushActiveOnDevice, syncPushSubscription, detachPushFromAccount } from '../push.js';
import { navigate } from '../main.js';
import { compressImage } from '../imageUtils.js';
import { openBlind10Modal, openMafiaModal, openSpaceInvadersModal } from '../components/minigames.js';
import { openMaltaSupportModal, isMaltaFabDisabled, setMaltaFabDisabled } from '../components/maltaSupport.js';
import { isAppStandalone, isIosDevice, showPwaInstallModal } from '../components/pwaInstallModal.js';

const EMPTY_STATS = { totalBets: 0, finishedBets: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalBet: 0, totalWon: 0, totalLost: 0, netProfit: 0, streak: 0, streakType: 'none' };

// Accepting or declining from the bell refreshes the friend list if it is showing
window.addEventListener('friends-changed', (e) => {
  if (e.detail?.from !== 'profile' && document.getElementById('friend-requests-slot')) renderProfile();
});

export async function renderProfile() {
  const content = document.getElementById('page-content');

  if (!isLoggedIn()) {
    renderAuthScreen(content);
    return;
  }

  let user = getStoredUser();
  content.innerHTML = `<div class="text-center text-muted mt-lg">${t('common.loading')}</div>`;

  try {
    // The stored copy can be stale (changed on another phone), so show the server's version
    const me = await getMe().catch(err => {
      if (/token|inloggad/i.test(err?.message || '')) throw err;
      return null;
    });
    if (me) {
      user = { ...user, ...me };
      storeUser(user);
    }
    const [bets, stats, creds, friends, notifPrefs, photos] = await Promise.all([
      getMyBets(),
      getMyStats(),
      getMyCredentials().catch(() => ({ hasBiometric: false })),
      getFriends().catch(() => []),
      getNotificationPrefs().catch(() => ({ notifyFlashbets: true, notifyDuels: true, notifyTournaments: true, notifySupport: true })),
      getMyPhotos().catch(() => [])
    ]);
    renderProfileContent(content, user, bets, stats, creds, friends, notifPrefs, photos);
  } catch (err) {
    const isAuthError = err && err.message && (
      err.message.toLowerCase().includes('token') || 
      err.message.toLowerCase().includes('inloggad') || 
      err.message.toLowerCase().includes('unauthorized')
    );
    if (isAuthError) {
      clearUser();
      renderAuthScreen(content);
    } else {
      showToast('Kunde inte nå servern just nu. Visar sparad profil.', 'info');
      renderProfileContent(content, user, [], EMPTY_STATS, { hasBiometric: false }, [], { notifyFlashbets: true, notifyDuels: true, notifyTournaments: true, notifySupport: true }, []);
    }
  }
}

function setupPinToggles(container = document) {
  if (!container) return;
  container.querySelectorAll('.btn-toggle-pin').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.title = 'Dölj PIN';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
        btn.title = 'Visa PIN';
      }
    });
  });
}

function renderAuthScreen(content) {
  const hasBiometric = false; // Disabled until FIDO2 is fully implemented

  content.innerHTML = `
    <div class="animate-in">
      <div class="page-header text-center" style="margin-bottom: var(--space-md); padding-top: 4px;">
        <div class="profile-logo-wrap" style="max-width: 170px; margin: 0 auto 6px;">
          <img src="/profile-chip.png" alt="PROFILE" class="profile-logo-img" style="width: 100%; max-width: 150px; height: auto; object-fit: contain; filter: drop-shadow(0 8px 24px rgba(245,158,11,0.28));" />
        </div>
        <p class="page-subtitle" style="margin-top: 2px;">${t('profile.simpleAuthHint')}</p>
      </div>

      <div class="card" id="auth-main-card">
        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="register" id="tab-register">✨ ${t('profile.register')}</button>
          <button class="auth-tab" data-tab="login" id="tab-login">🔑 ${t('profile.login')}</button>
        </div>

        <!-- Tab 1: Skapa profil -->
        <form id="register-form" class="mt-md">
          <div class="form-group text-center mb-md">
            <div class="profile-avatar mb-xs" style="margin: 0 auto; width: 64px; height: 64px; font-size: 2rem;">👤</div>
            <div class="text-muted" style="font-size: 0.8rem;">${t('profile.registerLink')}</div>
          </div>

          <div class="form-group">
            <label class="form-label">${t('profile.realName')} <span class="text-gold">*</span></label>
            <input type="text" class="form-input" id="reg-name" 
                   placeholder="${t('profile.realNamePlaceholder')}" required minlength="2" maxlength="40" />
            <span class="form-help" style="font-size: 0.7rem; color: var(--text-muted);">Ditt för- och efternamn så polarna vet vem du är</span>
          </div>

          <div class="form-group">
            <label class="form-label">${t('profile.nickname')} <span class="text-gold">*</span></label>
            <input type="text" class="form-input" id="reg-nickname" 
                   placeholder="${t('profile.nicknamePlaceholder')}" required minlength="2" maxlength="20" />
            <span class="form-help" style="font-size: 0.7rem; color: var(--text-muted);">Ditt smeknamn som visas på spel & odds</span>
          </div>

          <div class="form-group">
            <label class="form-label">📱 ${t('profile.swishNumber')} <span class="text-gold">*</span></label>
            <input type="tel" inputmode="numeric" autocomplete="tel" class="form-input" id="reg-swish" 
                   placeholder="${t('profile.swishPlaceholder')}" required minlength="8" maxlength="25" />
            <div id="reg-swish-helper" style="font-size: 0.72rem; margin-top: 4px; min-height: 16px;"></div>
            <span class="form-help" style="font-size: 0.7rem; color: var(--text-muted);">${t('profile.swishHint')}</span>
          </div>

          <div class="form-group">
            <label class="form-label">🔒 ${t('profile.personalPin')} <span class="text-gold">*</span></label>
            <div style="position: relative;">
              <input type="password" inputmode="numeric" pattern="[0-9]*" class="form-input text-center" id="reg-pin" 
                     placeholder="••••" required minlength="4" maxlength="4" style="font-size: 1.5rem; letter-spacing: 0.3em; padding-right: 44px;" />
              <button type="button" class="btn-toggle-pin" data-target="reg-pin" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 1.2rem; padding: 4px;" title="Visa/dölj PIN">👁️</button>
            </div>
            <span class="form-help" style="font-size: 0.7rem; color: var(--text-muted);">${t('profile.pinHint')}</span>
          </div>

          <button type="submit" class="btn btn-primary btn-block" id="reg-submit-btn">${t('profile.startBetting')}</button>
        </form>

        <!-- Tab 2: Logga in -->
        <form id="login-form" class="mt-md" style="display: none;">
          ${hasBiometric ? `
            <div class="mb-md">
              <button type="button" class="btn btn-accent btn-block" id="btn-biometric-login" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span>📸</span> <span>${t('profile.biometricLogin')}</span>
              </button>
            </div>
            <div class="auth-divider mb-md" style="display: flex; align-items: center; text-align: center; color: var(--text-muted); font-size: 0.75rem;">
              <span style="flex: 1; border-bottom: 1px solid var(--border-glass);"></span>
              <span style="padding: 0 10px;">eller med mobil & PIN</span>
              <span style="flex: 1; border-bottom: 1px solid var(--border-glass);"></span>
            </div>
          ` : ''}

          <div class="form-group">
            <label class="form-label">📱 ${t('profile.loginIdentifier')} <span class="text-gold">*</span></label>
            <input type="text" class="form-input" id="login-identifier"
                   placeholder="${t('profile.loginIdentifierPlaceholder')}" required minlength="2" />
            <span class="form-help" style="font-size: 0.7rem; color: var(--text-muted);">Skriv mobilnummer (t.ex. 0701234567 eller +46...), bettarnamn eller ditt namn</span>
          </div>

          <div class="form-group">
            <label class="form-label">🔒 ${t('profile.loginPin')} <span class="text-gold">*</span></label>
            <div style="position: relative;">
              <input type="password" inputmode="numeric" pattern="[0-9]*" class="form-input text-center" id="login-pin"
                     placeholder="••••" required minlength="4" maxlength="4" style="font-size: 1.5rem; letter-spacing: 0.3em; padding-right: 44px;" />
              <button type="button" class="btn-toggle-pin" data-target="login-pin" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 1.2rem; padding: 4px;" title="Visa/dölj PIN">👁️</button>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block" id="login-submit-btn">${t('profile.loginBtn')}</button>

          <div class="text-center mt-md">
            <p class="text-muted" style="font-size: 0.75rem; line-height: 1.4;">
              💡 ${t('profile.forgotPinPrompt')}
            </p>
          </div>
        </form>

        <div style="margin-top: var(--space-md); padding-top: var(--space-sm); border-top: 1px solid var(--border-glass); text-align: center;">
          <button type="button" id="auth-malta-support-btn" style="background: none; border: none; color: var(--gold); font-size: 0.76rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: underline;">
            <img src="/malta-chip-sm.webp" alt="Whooply" style="width: 16px; height: 16px; object-fit: contain;" />
            <span>${getLang() === 'en' ? 'Need help or forgot PIN? Ask Whooply AI Support' : 'Frågor om inloggning eller PIN? Fråga Whooply AI Kundtjänst'}</span>
          </button>
        </div>
      </div>

      <!-- Reset PIN container (hidden by default) -->
      <div id="pin-reset-card" class="card mt-md" style="display: none;"></div>
    </div>
  `;

  // Whooply AI Support from Auth Screen
  document.getElementById('auth-malta-support-btn')?.addEventListener('click', () => {
    openMaltaSupportModal();
  });

  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('register-form').style.display = tab.dataset.tab === 'register' ? '' : 'none';
      document.getElementById('login-form').style.display = tab.dataset.tab === 'login' ? '' : 'none';
    });
  });

  // Biometric login button
  if (hasBiometric) {
    document.getElementById('btn-biometric-login')?.addEventListener('click', async () => {
      try {
        showToast('Verifierar FaceID / TouchID... 📸', 'info');
        const user = await loginWithBiometrics();
        storeUser(user);
        await checkPendingFriendInvite();
        await checkPendingPartyJoin();
        showToast(`Välkommen tillbaka, ${user.nickname}! 👋`, 'success');
        finishLogin();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Real-time helper and auto-formatting for register swish input
  const regSwishInput = document.getElementById('reg-swish');
  const regSwishHelper = document.getElementById('reg-swish-helper');
  if (regSwishInput && regSwishHelper) {
    const updateHelper = () => {
      const val = regSwishInput.value.trim();
      if (!val) {
        regSwishHelper.innerHTML = '';
        return;
      }
      const norm = normalizePhone(val);
      if (norm.startsWith('07')) {
        if (norm.length === 10) {
          regSwishHelper.innerHTML = `<span style="color: var(--success, #22c55e);">✓ Giltigt svenskt mobilnummer: ${escapeHtml(formatSwedishPhoneDisplay(norm))}</span>`;
        } else if (norm.length < 10) {
          regSwishHelper.innerHTML = `<span style="color: var(--gold, #eab308);">${norm.length} av 10 siffror inskrivna</span>`;
        } else {
          regSwishHelper.innerHTML = `<span style="color: var(--danger, #ef4444);">För många siffror (${norm.length} av 10)</span>`;
        }
      } else if (norm.length >= 8) {
        regSwishHelper.innerHTML = `<span style="color: var(--success, #22c55e);">✓ Telefonnummer godkänt: ${escapeHtml(norm)}</span>`;
      } else {
        regSwishHelper.innerHTML = `<span style="color: var(--text-muted);">${norm.length} siffror (minst 8 krävs)</span>`;
      }
    };

    regSwishInput.addEventListener('input', updateHelper);
    regSwishInput.addEventListener('blur', () => {
      const norm = normalizePhone(regSwishInput.value.trim());
      if (norm.startsWith('07') && norm.length === 10) {
        regSwishInput.value = formatSwedishPhoneDisplay(norm);
      }
      updateHelper();
    });
  }

  // Register form submit
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const rawSwish = document.getElementById('reg-swish').value.trim();
    const pin = document.getElementById('reg-pin').value.trim();

    const cleanSwish = normalizePhone(rawSwish) || rawSwish.replace(/[^0-9]/g, '');

    if (!cleanSwish || cleanSwish.length < 8) {
      showToast('Ange ditt Swish-nummer (minst 8 siffror) 📱', 'error');
      return;
    }

    if (cleanSwish.startsWith('07') && cleanSwish.length !== 10) {
      showToast('Svenska mobilnummer för Swish ska ha 10 siffror (t.ex. 070-123 45 67)', 'error');
      return;
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      showToast('PIN-koden måste bestå av exakt 4 siffror', 'error');
      return;
    }

    const btn = document.getElementById('reg-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Skapar profil... ⏳';

    try {
      const user = await registerUser({ name, nickname, swishNumber: cleanSwish, pin, avatarEmoji: '👤' });
      storeUser(user);
      await checkPendingFriendInvite();
      await checkPendingPartyJoin();
      if (user.alreadyRegistered) {
        showToast(user.message || `Välkommen tillbaka, ${user.nickname || user.realName}! 👋`, 'success');
      } else {
        showToast(`Välkommen, ${user.nickname || user.realName}! 🎉`, 'success');
      }
      finishLogin();
    } catch (err) {
      if (err.data?.code === 'SWISH_ALREADY_REGISTERED') {
        showToast(err.message || 'Ditt Swish-nummer är redan registrerat. Ange din PIN för att logga in!', 'info');
        // Switch to login tab
        document.querySelectorAll('.auth-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.tab === 'login');
        });
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = '';
        const idInput = document.getElementById('login-identifier');
        if (idInput) {
          idInput.value = err.data.swishNumber || cleanSwish;
        }
        const pinInput = document.getElementById('login-pin');
        if (pinInput) {
          pinInput.focus();
        }
      } else {
        showToast(err.message, 'error');
      }
      btn.disabled = false;
      btn.textContent = t('profile.startBetting');
    }
  });

  // Login form submit
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim();
    const pin = document.getElementById('login-pin').value.trim();

    const btn = document.getElementById('login-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Loggar in... ⏳';

    try {
      const res = await loginUser({ identifier, pin });

      if (res.needsPinReset) {
        showPinResetUI(identifier, res.nickname);
        return;
      }

      storeUser(res);
      await checkPendingFriendInvite();
      await checkPendingPartyJoin();
      showToast(`Välkommen tillbaka, ${res.nickname}! 👋`, 'success');
      finishLogin();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = t('profile.loginBtn');
    }
  });

  setupPinToggles(content);
}

// After logging in, go back to the page that asked for it (e.g. a shared match link)
function finishLogin() {
  // Link this device's notifications to the account that just logged in
  syncPushSubscription();
  const target = consumeReturnTo();
  if (target?.page && target.page !== 'profile') {
    navigate(target.page, target.params || {});
  } else {
    renderProfile();
  }
}

async function checkPendingFriendInvite() {
  const pending = sessionStorage.getItem('pending_friend_invite');
  if (pending) {
    sessionStorage.removeItem('pending_friend_invite');
    let invite;
    try {
      invite = JSON.parse(pending);
    } catch {
      invite = { nickname: pending };
    }
    try {
      const res = await addFriend(invite);
      showToast(res.message || `Du och @${invite.nickname} är nu vänner! 👥🎉`, res.status === 'pending' ? 'info' : 'success');
    } catch {
      // ignore
    }
  }
}

async function checkPendingPartyJoin() {
  const pendingCode = sessionStorage.getItem('pending_party_join');
  if (pendingCode) {
    sessionStorage.removeItem('pending_party_join');
    try {
      const joinRes = await joinPartyRoom({ code: pendingCode });
      if (joinRes && joinRes.room) {
        showToast(`Ansluten till rummet! 🎉`, 'success');
        navigate('home');
        if (joinRes.room.gameType === 'mafia') {
          openMafiaModal(joinRes.room);
        } else if (joinRes.room.gameType === 'space_invaders') {
          openSpaceInvadersModal({ mode: 'party', room: joinRes.room });
        } else {
          openBlind10Modal(joinRes.room);
        }
      }
    } catch (e) {
      showToast(e.message || 'Kunde inte ansluta till rummet', 'error');
    }
  }
}

function showPinResetUI(identifier, nickname) {
  const mainCard = document.getElementById('auth-main-card');
  const resetCard = document.getElementById('pin-reset-card');
  if (mainCard) mainCard.style.display = 'none';

  resetCard.style.display = 'block';
  resetCard.innerHTML = `
    <div class="text-center mb-md">
      <div style="font-size: 2.5rem; margin-bottom: var(--space-xs);">🔑</div>
      <h2 style="font-size: 1.2rem; font-weight: 700;">${t('profile.pinResetRequiredTitle')}</h2>
      <p class="text-muted" style="font-size: 0.85rem; line-height: 1.4;">
        Hej <strong>${escapeHtml(nickname)}</strong>! Ange din 6-siffriga engångskod från admin och välj en ny PIN-kod.
      </p>
    </div>

    <form id="pin-reset-form">
      <div class="form-group">
        <label class="form-label">6-siffrig engångskod från admin</label>
        <input type="text" inputmode="numeric" pattern="[0-9]*" class="form-input text-center" id="reset-code-input"
               placeholder="123456" required minlength="6" maxlength="6" style="font-size: 1.4rem; letter-spacing: 0.25em;" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('profile.newPin')}</label>
        <div style="position: relative;">
          <input type="password" inputmode="numeric" pattern="[0-9]*" class="form-input text-center" id="new-reset-pin"
                 placeholder="••••" required minlength="4" maxlength="4" style="font-size: 1.5rem; letter-spacing: 0.3em; padding-right: 44px;" />
          <button type="button" class="btn-toggle-pin" data-target="new-reset-pin" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 1.2rem; padding: 4px;" title="Visa/dölj PIN">👁️</button>
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-block" id="btn-submit-reset-pin">
        Spara ny PIN & Logga in 🚀
      </button>
    </form>
  `;

  setupPinToggles(resetCard);

  document.getElementById('pin-reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resetCode = document.getElementById('reset-code-input').value.trim();
    const newPin = document.getElementById('new-reset-pin').value.trim();

    if (resetCode.length !== 6 || !/^\d{6}$/.test(resetCode)) {
      showToast('Engångskoden måste bestå av 6 siffror', 'error');
      return;
    }
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      showToast('PIN-koden måste bestå av exakt 4 siffror', 'error');
      return;
    }

    const btn = document.getElementById('btn-submit-reset-pin');
    btn.disabled = true;
    btn.textContent = 'Sparar...';

    try {
      const user = await completePinReset({ identifier, resetCode, newPin });
      storeUser(user);
      showToast('PIN-koden har uppdaterats! 🎉', 'success');
      finishLogin();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Spara ny PIN & Logga in 🚀';
    }
  });
}

// The profile reads top-down: who you are, how you are doing, your friends, your
// latest games and photos, and all settings collected in one list at the bottom.
// Each setting opens in its own sheet, so the page fits on about two screens.
function renderProfileContent(content, user, bets, stats = EMPTY_STATS, creds, friends = [], notifPrefs = { notifyFlashbets: true, notifyDuels: true, notifyTournaments: true, notifySupport: true }, photos = []) {
  const isEn = getLang() === 'en';
  const albums = groupPhotoAlbums(photos);

  const pushSupported = isPushSupported();
  const pushPerm = pushSupported ? getPushPermissionState() : 'unsupported';
  // Permission stays "granted" after turning notifications off, so also respect that choice
  const isPushActive = isPushActiveOnDevice();
  const isStandalone = isAppStandalone();
  const isFabDisabled = isMaltaFabDisabled();
  const currentLang = getLang();
  const langLabel = (getAvailableLanguages().find(l => l.code === currentLang) || {}).label || currentLang;

  const avatarSrc = safeImageSrc(user.avatarUrl);
  const swishText = user.swishNumber ? `Swish ${escapeHtml(formatSwedishPhoneDisplay(user.swishNumber))}` : (isEn ? 'No Swish number' : 'Inget Swish-nummer');
  const net = stats.netProfit || 0;
  const streakHtml = stats.streak > 0
    ? `${stats.streakType === 'win' ? '🔥' : '❄️'} ${stats.streak}`
    : '–';
  const statsSub = [
    stats.finishedBets > 0 ? `${stats.winRate} % ${isEn ? 'hit rate' : 'träffsäkerhet'}` : null,
    stats.pending > 0 ? (isEn ? `${stats.pending} waiting for a result` : `${stats.pending} ${stats.pending === 1 ? 'spel väntar' : 'spel väntar'} på resultat`) : null
  ].filter(Boolean).join(' · ');

  const pushState = !pushSupported
    ? { cls: 'muted', text: isEn ? 'Not available' : 'Ej tillgängligt' }
    : isPushActive ? { cls: 'on', text: isEn ? 'On' : 'På' }
    : pushPerm === 'denied' ? { cls: 'bad', text: isEn ? 'Blocked' : 'Blockerad' }
    : { cls: 'warn', text: isEn ? 'Off' : 'Av' };

  content.innerHTML = `
    <div class="animate-in prof">
      <div class="prof-head">
        <button type="button" class="prof-avatar" id="profile-picture-btn" aria-label="${isEn ? 'Change profile picture' : 'Byt profilbild'}">
          ${avatarSrc ? `<img src="${escapeHtml(avatarSrc)}" alt="" />` : `<span>${escapeHtml(user.avatar || '👤')}</span>`}
          <i>📷</i>
        </button>
        <input type="file" id="profile-picture-input" accept="image/jpeg,image/png,image/webp,image/gif,image/*" hidden />
        <div class="prof-name">
          <b>${escapeHtml(user.realName || user.nickname)}</b>
          <span>@${escapeHtml(user.nickname)}</span>
          <span>${swishText}</span>
        </div>
        <button type="button" class="prof-edit" id="btn-edit-profile">${isEn ? 'Edit' : 'Redigera'}</button>
      </div>

      <div class="prof-stats">
        <div><b>${stats.finishedBets || 0}</b><span>${isEn ? 'Games' : 'Spel'}</span></div>
        <div><b class="pos">${stats.wins || 0}</b><span>${isEn ? 'Wins' : 'Vinster'}</span></div>
        <div><b class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${Math.round(net).toLocaleString('sv-SE')}</b><span>${isEn ? 'Net kr' : 'Netto kr'}</span></div>
        <div><b>${streakHtml}</b><span>${isEn ? 'In a row' : 'I rad'}</span></div>
      </div>
      ${statsSub ? `<p class="prof-stats-sub">${statsSub}</p>` : ''}

      <div class="prof-section">
        <span>${isEn ? 'FRIENDS' : 'VÄNNER'} (${friends.length})</span>
        <button type="button" id="btn-share-friend-link">${isEn ? 'Invite' : 'Bjud in'}</button>
      </div>
      <div id="friend-requests-slot"></div>
      <div class="prof-friends">
        <button type="button" class="prof-friend is-add" id="btn-add-friend">
          <div>+</div><span>${isEn ? 'Add' : 'Lägg till'}</span>
        </button>
        ${friends.map(f => {
          const src = safeImageSrc(f.avatarUrl);
          return `
          <button type="button" class="prof-friend friend-item" data-id="${escapeHtml(f.id)}" title="@${escapeHtml(f.nickname)}">
            <div>${src ? `<img src="${escapeHtml(src)}" alt="" />` : escapeHtml(f.avatar || f.avatarEmoji || '👤')}</div>
            <span>${escapeHtml((f.realName || f.nickname || '').split(' ')[0])}</span>
          </button>`;
        }).join('')}
      </div>
      ${friends.length === 0 ? `<p class="prof-hint">${isEn
        ? 'Add friends to pick them quickly in games and events.'
        : 'Lägg till polarna så väljer du dem snabbt i spel och event.'}</p>` : ''}

      <div class="prof-section">
        <span>${isEn ? 'LATEST GAMES' : 'SENASTE SPEL'}</span>
        ${bets.length > 3 ? `<button type="button" id="btn-all-bets">${isEn ? 'Show all' : 'Visa alla'} (${bets.length})</button>` : ''}
      </div>
      ${bets.length > 0
        ? `<div class="prof-list">${bets.slice(0, 3).map(betRow).join('')}</div>`
        : `<p class="prof-hint">${t('profile.noHistory')}</p>`}

      ${albums.length > 0 ? `
        <div class="prof-section"><span>${isEn ? 'PHOTOS' : 'FOTOMINNEN'}</span></div>
        <div class="prof-list">
          ${albums.map(alb => `
            <button type="button" class="prof-row prof-album" data-album="${escapeHtml(alb.id)}">
              <div>⛳ ${escapeHtml(alb.name)}<small>${alb.photos.length} ${isEn ? (alb.photos.length === 1 ? 'photo' : 'photos') : (alb.photos.length === 1 ? 'bild' : 'bilder')}</small></div>
              <span class="prof-chev">›</span>
            </button>`).join('')}
        </div>` : ''}

      <div class="prof-section"><span>${isEn ? 'SETTINGS' : 'INSTÄLLNINGAR'}</span></div>
      <div class="prof-list">
        <button type="button" class="prof-row" id="row-notifications">
          <div>🔔 ${isEn ? 'Notifications' : 'Notiser'}<small>${isEn ? 'BlixtBets, duels, events' : 'BlixtBets, dueller, event'}</small></div>
          <span class="prof-pill ${pushState.cls}">${pushState.text}</span>
        </button>
        <button type="button" class="prof-row" id="row-install">
          <div>📲 ${isEn ? 'App on home screen' : 'Appen på hemskärmen'}</div>
          ${isStandalone
            ? `<span class="prof-pill on">✓ ${isEn ? 'Installed' : 'Installerad'}</span>`
            : `<span class="prof-pill warn">${isEn ? 'Do it' : 'Gör det'}</span>`}
        </button>
        <button type="button" class="prof-row" id="row-pin">
          <div>🔑 ${t('profile.changePin')}</div><span class="prof-chev">›</span>
        </button>
        <button type="button" class="prof-row" id="row-support">
          <div>🇲🇹 Whooply Support<small>${isEn ? 'Chat and floating button' : 'Chatt och flytande knapp'}${isFabDisabled ? (isEn ? ' (hidden)' : ' (dold)') : ''}</small></div>
          <span class="prof-chev">›</span>
        </button>
        <button type="button" class="prof-row" id="row-language">
          <div>🌍 ${t('profile.language')}</div><span class="prof-value">${escapeHtml(langLabel)} ›</span>
        </button>
      </div>

      <button type="button" class="prof-logout" id="logout-btn">${t('profile.logout')}</button>
    </div>
  `;

  function betRow(b) {
    const result = b.outcome === 'won'
      ? `<em class="pos">+${formatCurrency(Math.abs(b.net || 0))}</em>`
      : b.outcome === 'lost'
        ? `<em class="neg">−${formatCurrency(b.amount)}</em>`
        : b.outcome === 'refunded'
          ? `<em class="muted">↩️ ${isEn ? 'Refunded' : 'Återbetald'}</em>`
          : `<em class="muted">${formatCurrency(b.amount)}</em>`;
    const when = b.outcome === 'open'
      ? (isEn ? 'waiting for result' : 'väntar på resultat')
      : formatDate(b.timestamp);
    return `
      <button type="button" class="prof-row prof-bet" data-code="${escapeHtml(b.eventCode)}">
        <div>${escapeHtml(b.eventName)}<small>${escapeHtml(b.playerName)} · ${escapeHtml(when)}</small></div>
        ${result}
      </button>`;
  }

  const bindBetRows = (root) => {
    root.querySelectorAll('.prof-bet[data-code]').forEach(item => {
      item.addEventListener('click', () => {
        closeModal();
        window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'event', code: item.dataset.code } }));
      });
    });
  };
  bindBetRows(content);

  document.getElementById('btn-all-bets')?.addEventListener('click', () => {
    showModal(isEn ? 'All games' : 'Alla spel', `<div class="prof-list prof-list-modal">${bets.map(betRow).join('')}</div>`);
    bindBetRows(document.getElementById('modal-root'));
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (!confirm(isEn ? 'Log out from Whooply on this phone?' : 'Logga ut från Whooply på den här telefonen?')) return;
    // Otherwise the phone keeps getting this account's notifications after logging out
    await detachPushFromAccount().catch(() => {});
    clearUser();
    renderProfile();
  });

  // Avatar upload
  const avatarInput = document.getElementById('profile-picture-input');
  document.getElementById('profile-picture-btn')?.addEventListener('click', () => avatarInput.click());
  avatarInput?.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    showToast(isEn ? 'Uploading picture… ⏳' : 'Laddar upp profilbild… ⏳', 'info');
    try {
      const base64Image = await compressImage(file, 800, 0.8);
      const res = await updateAvatar(base64Image);
      storeUser({ ...getStoredUser(), avatarUrl: res.avatarUrl });
      showToast(isEn ? 'Profile picture updated! 📸' : 'Profilbild uppdaterad! 📸', 'success');
      renderProfile();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-edit-profile')?.addEventListener('click', () => openEditProfileSheet(user));

  // Friends
  document.getElementById('btn-add-friend')?.addEventListener('click', () => showAddFriendModal(friends));
  loadFriendRequests();
  document.getElementById('btn-share-friend-link')?.addEventListener('click', async () => {
    let inviteUrl;
    try {
      inviteUrl = await buildFriendInviteUrl();
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    const text = isEn ? 'Add me on Whooply 🎲' : 'Lägg till mig i Whooply 🎲';
    if (navigator.share) {
      navigator.share({ title: 'Whooply', text, url: inviteUrl }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast(isEn ? 'Invite link copied! 📋' : 'Din inbjudningslänk är kopierad! 📋', 'success');
    } catch {
      prompt(isEn ? 'Copy your invite link:' : 'Kopiera din vänlänk:', inviteUrl);
    }
  });
  content.querySelectorAll('.friend-item[data-id]').forEach(item => {
    item.addEventListener('click', () => {
      const f = friends.find(x => x.id === item.dataset.id);
      if (f) showFriendOptionsModal(f);
    });
  });

  // Photo albums open in a sheet with the album's pictures
  content.querySelectorAll('.prof-album').forEach(row => {
    row.addEventListener('click', () => {
      const alb = albums.find(a => String(a.id) === row.dataset.album);
      if (alb) openAlbumSheet(alb);
    });
  });

  // Settings rows
  document.getElementById('row-notifications')?.addEventListener('click', () =>
    openNotificationsSheet({ pushSupported, pushPerm, isPushActive, notifPrefs }));
  document.getElementById('row-install')?.addEventListener('click', () => {
    if (isStandalone) {
      showToast(isEn ? 'The app is already on your home screen ✓' : 'Appen ligger redan på hemskärmen ✓', 'success');
    } else {
      showPwaInstallModal({ forced: true });
    }
  });
  document.getElementById('row-pin')?.addEventListener('click', openChangePinSheet);
  document.getElementById('row-support')?.addEventListener('click', openSupportSheet);
  document.getElementById('row-language')?.addEventListener('click', openLanguageSheet);
}

function groupPhotoAlbums(photos) {
  const albumsMap = new Map();
  photos.forEach(p => {
    if (!albumsMap.has(p.tournamentId)) {
      albumsMap.set(p.tournamentId, { id: p.tournamentId, name: p.tournamentName || 'Event', code: p.tournamentCode, photos: [] });
    }
    albumsMap.get(p.tournamentId).photos.push(p);
  });
  return Array.from(albumsMap.values());
}

function openAlbumSheet(alb) {
  const isEn = getLang() === 'en';
  showModal(`⛳ ${escapeHtml(alb.name)}`, `
    <div class="prof-album-grid">
      ${alb.photos.map(photo => `
        <button type="button" class="profile-photo-thumb" data-photo-id="${escapeHtml(photo.id)}">
          <img src="${escapeHtml(safeImageSrc(photo.thumbnailUrl || photo.url))}" alt="${escapeHtml(photo.caption || '')}" loading="lazy" />
          ${photo.likeCount > 0 ? `<span>❤️ ${photo.likeCount}</span>` : ''}
        </button>`).join('')}
    </div>
    <button type="button" class="btn btn-secondary btn-block mt-md" id="btn-album-go-event">🏆 ${isEn ? 'Go to the event' : 'Gå till eventet'}</button>
  `);
  const goToEvent = () => {
    closeModal();
    window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'tournament', code: alb.code } }));
  };
  document.getElementById('btn-album-go-event')?.addEventListener('click', goToEvent);
  document.querySelectorAll('#modal-root .profile-photo-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const photo = alb.photos.find(p => String(p.id) === thumb.dataset.photoId);
      if (!photo) return;
      showModal('📸 ' + escapeHtml(alb.name), `
        <div class="text-center">
          <div style="max-height: 65vh; display: flex; align-items: center; justify-content: center; background: #000; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: var(--space-sm);">
            <img src="${escapeHtml(safeImageSrc(photo.url))}" alt="${escapeHtml(photo.caption || '')}" style="max-width: 100%; max-height: 65vh; object-fit: contain;" />
          </div>
          ${photo.caption ? `<p style="font-size: 0.95rem; text-align: left; margin-bottom: var(--space-xs);">${escapeHtml(photo.caption)}</p>` : ''}
          <div class="flex-between text-muted" style="font-size: 0.75rem; margin-bottom: var(--space-md);">
            <span>${isEn ? 'Shared by' : 'Delad av'} <strong>${escapeHtml(photo.uploaderName || '')}</strong></span>
            <span>${formatDate(photo.createdAt)} · ❤️ ${photo.likeCount || 0}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-block" id="btn-back-to-album">← ${isEn ? 'Back to album' : 'Tillbaka till albumet'}</button>
        </div>
      `);
      document.getElementById('btn-back-to-album')?.addEventListener('click', () => openAlbumSheet(alb));
    });
  });
}

function openEditProfileSheet(user) {
  const isEn = getLang() === 'en';
  showModal(isEn ? 'Edit profile' : 'Redigera profil', `
    <div class="form-group mb-sm">
      <label class="form-label">${t('profile.realName')}</label>
      <input type="text" id="edit-real-name" class="form-input" value="${escapeHtml(user.realName || '')}" placeholder="${t('profile.realNamePlaceholder')}" />
    </div>
    <div class="form-group mb-sm">
      <label class="form-label">${t('profile.nickname')}</label>
      <input type="text" id="edit-nickname" class="form-input" value="${escapeHtml(user.nickname || '')}" placeholder="${t('profile.nicknamePlaceholder')}" />
    </div>
    <div class="form-group mb-md">
      <label class="form-label">📱 ${t('profile.swishNumber')}</label>
      <input type="tel" id="edit-swish" class="form-input" placeholder="070-123 45 67" value="${escapeHtml(formatSwedishPhoneDisplay(user.swishNumber) || '')}" maxlength="25" />
      <div class="text-muted" style="font-size: 0.72rem; margin-top: 4px;">${t('profile.swishHint')}</div>
    </div>
    <button class="btn btn-primary btn-block" id="save-profile-btn">${t('profile.saveChanges')}</button>
  `);

  document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
    const realName = document.getElementById('edit-real-name').value.trim();
    const nickname = document.getElementById('edit-nickname').value.trim();
    const rawSwish = document.getElementById('edit-swish').value.trim();
    let swishNumber = '';
    if (rawSwish) {
      swishNumber = normalizePhone(rawSwish) || rawSwish.replace(/[^0-9]/g, '');
      if (swishNumber.startsWith('07') && swishNumber.length !== 10) {
        showToast('Svenska mobilnummer för Swish ska ha 10 siffror (t.ex. 070-123 45 67)', 'error');
        return;
      }
      if (swishNumber.length < 8 || swishNumber.length > 15) {
        showToast('Ogiltigt Swish-nummer (ange 8-15 siffror)', 'error');
        return;
      }
    }

    const btn = document.getElementById('save-profile-btn');
    btn.disabled = true;
    btn.textContent = isEn ? 'Saving… ⏳' : 'Sparar… ⏳';
    try {
      const res = await updateProfile({ realName, nickname, swishNumber: swishNumber || null });
      if (res.user) storeUser({ ...getStoredUser(), ...res.user });
      showToast(t('profile.profileSaved') || 'Profilen sparades! 🎉', 'success');
      closeModal();
      renderProfile();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = t('profile.saveChanges');
    }
  });
}

function openChangePinSheet() {
  const isEn = getLang() === 'en';
  const pinInput = (id, label) => `
    <div class="form-group mb-sm">
      <label class="form-label">${label}</label>
      <div style="position: relative;">
        <input type="password" inputmode="numeric" pattern="[0-9]*" class="form-input text-center" id="${id}"
               placeholder="••••" maxlength="4" style="font-size: 1.2rem; letter-spacing: 0.2em; padding-right: 40px;" />
        <button type="button" class="btn-toggle-pin" data-target="${id}" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 1.1rem; padding: 2px;" title="Visa/dölj PIN">👁️</button>
      </div>
    </div>`;
  showModal(`🔑 ${t('profile.changePin')}`, `
    <form id="change-pin-form">
      ${pinInput('input-current-pin', t('profile.currentPin'))}
      ${pinInput('input-new-pin', t('profile.newPin'))}
      <button type="submit" class="btn btn-primary btn-block mt-sm">${t('profile.savePin')}</button>
    </form>
  `);
  setupPinToggles(document.getElementById('modal-root'));
  document.getElementById('change-pin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPin = document.getElementById('input-current-pin').value.trim();
    const newPin = document.getElementById('input-new-pin').value.trim();
    if (!/^\d{4}$/.test(newPin)) {
      showToast(isEn ? 'The new PIN must be exactly 4 digits' : 'Nya PIN-koden måste vara exakt 4 siffror', 'error');
      return;
    }
    try {
      await changePin(currentPin, newPin);
      showToast(t('profile.pinChanged') || 'PIN-koden har ändrats! 🔒', 'success');
      closeModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openLanguageSheet() {
  const current = getLang();
  showModal(`🌍 ${t('profile.language')}`, `
    <div class="prof-list">
      ${getAvailableLanguages().map(l => `
        <button type="button" class="prof-row lang-pill" data-lang="${escapeHtml(l.code)}">
          <div>${l.code === 'sv' ? '🇸🇪' : '🇬🇧'} ${escapeHtml(l.label)}</div>
          ${l.code === current ? '<span class="prof-pill on">✓</span>' : ''}
        </button>`).join('')}
    </div>
  `);
  document.querySelectorAll('#modal-root .lang-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      closeModal();
      renderProfile();
    });
  });
}

function openSupportSheet() {
  const isEn = getLang() === 'en';
  const render = () => {
    const hidden = isMaltaFabDisabled();
    showModal('🇲🇹 Whooply Support', `
      <p class="text-muted" style="font-size: 0.85rem; line-height: 1.45; margin: 0 0 12px;">
        ${isEn
          ? 'Ask about rules, events, The Tab, a forgotten PIN – or just ask for a golf tip.'
          : 'Fråga om regler, event, THE TAB, bortglömd PIN – eller be om ett golftips.'}
      </p>
      <button type="button" class="btn btn-primary btn-block" id="profile-open-malta-chat-btn">💬 ${isEn ? 'Open chat' : 'Öppna chatten'}</button>
      <div class="prof-list mt-md">
        <button type="button" class="prof-row" id="profile-toggle-malta-fab-btn">
          <div>${isEn ? 'Floating button' : 'Flytande knapp'}<small>${hidden
            ? (isEn ? 'Hidden' : 'Dold')
            : (isEn ? 'Shown bottom right' : 'Visas nere till höger')}</small></div>
          <span class="prof-pill ${hidden ? 'warn' : 'on'}">${hidden ? (isEn ? 'Show' : 'Visa') : (isEn ? 'Hide' : 'Dölj')}</span>
        </button>
      </div>
    `);
    document.getElementById('profile-open-malta-chat-btn')?.addEventListener('click', () => {
      closeModal();
      openMaltaSupportModal();
    });
    document.getElementById('profile-toggle-malta-fab-btn')?.addEventListener('click', () => {
      setMaltaFabDisabled(!isMaltaFabDisabled());
      render();
    });
  };
  render();
}

function openNotificationsSheet({ pushSupported, pushPerm, isPushActive, notifPrefs }) {
  const isEn = getLang() === 'en';
  const isIos = isIosDevice();
  const isStandalone = isAppStandalone();

  let body;
  if (!pushSupported) {
    body = isIos && !isStandalone ? `
      <p class="text-muted" style="font-size: 0.85rem; line-height: 1.45;">
        ${isEn
          ? 'On iPhone, Apple only allows notifications when Whooply is saved to the home screen and opened from there.'
          : 'På iPhone tillåter Apple bara notiser när Whooply är sparad på hemskärmen och öppnas därifrån.'}
      </p>
      <button type="button" class="btn btn-primary btn-block" id="btn-profile-guide-push-ios">📲 ${isEn ? 'Show me how' : 'Visa hur'}</button>`
      : `<p class="text-muted" style="font-size: 0.85rem;">${isEn ? 'This browser does not support notifications.' : 'Den här webbläsaren stöder inte notiser.'}</p>`;
  } else {
    const pref = (id, checked, label) => `
      <label class="prof-row prof-toggle">
        <div>${label}</div>
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
      </label>`;
    body = `
      <p class="text-muted" style="font-size: 0.85rem; line-height: 1.45; margin: 0 0 12px;">
        ${isEn
          ? 'Get a notification when someone starts a BlixtBet, challenges you or a result is in – even when the app is closed.'
          : 'Få en notis när någon startar en BlixtBet, utmanar dig eller när ett resultat är klart – även när appen är stängd.'}
      </p>
      ${pushPerm === 'denied' ? `
        <div class="tabx-warn" style="margin: 0 0 12px;">⚠️ ${isEn
          ? 'Notifications are blocked in the browser settings for this site.'
          : 'Notiser är blockerade i webbläsarens inställningar för sidan. Tillåt dem där först.'}</div>` : ''}
      <button type="button" class="btn ${isPushActive ? 'btn-secondary' : 'btn-primary'} btn-block" id="btn-toggle-push">
        ${isPushActive ? (isEn ? '🔕 Turn off on this phone' : '🔕 Stäng av på den här telefonen') : (isEn ? '🔔 Turn on notifications' : '🔔 Slå på notiser')}
      </button>
      ${isPushActive ? `
        <div class="prof-list mt-md">
          ${pref('pref-notify-flashbets', notifPrefs.notifyFlashbets, isEn ? '⚡ BlixtBets and quick games' : '⚡ BlixtBets och snabba spel')}
          ${pref('pref-notify-duels', notifPrefs.notifyDuels, isEn ? '⚔️ Challenges from friends' : '⚔️ Utmaningar från vänner')}
          ${pref('pref-notify-tournaments', notifPrefs.notifyTournaments, isEn ? '🏆 Events: new games and results' : '🏆 Event: nya spel och resultat')}
          ${pref('pref-notify-support', notifPrefs.notifySupport !== false, isEn ? '🇲🇹 Whooply Support' : '🇲🇹 Whooply Support')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm btn-block mt-md" id="btn-test-malta-push">${isEn ? 'Send a test notification' : 'Skicka en testnotis'}</button>
      ` : ''}`;
  }
  showModal(`🔔 ${isEn ? 'Notifications' : 'Notiser'}`, body);

  document.getElementById('btn-profile-guide-push-ios')?.addEventListener('click', () => {
    closeModal();
    showPwaInstallModal({ forced: true });
  });

  document.getElementById('btn-toggle-push')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-toggle-push');
    btn.disabled = true;
    try {
      if (isPushActive) {
        await unsubscribeFromPush();
        showToast(isEn ? '🔕 Notifications turned off on this phone' : '🔕 Notiser avstängda på den här telefonen', 'info');
      } else {
        await subscribeToPush();
        showToast(isEn ? '🔔 Notifications are on!' : '🔔 Notiser påslagna!', 'success');
      }
      closeModal();
      renderProfile();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  });

  const handlePrefChange = async () => {
    const val = (id) => document.getElementById(id)?.checked ?? true;
    const prefs = {
      notifyFlashbets: val('pref-notify-flashbets'),
      notifyDuels: val('pref-notify-duels'),
      notifyTournaments: val('pref-notify-tournaments'),
      notifySupport: val('pref-notify-support')
    };
    try {
      await updateNotificationPrefs(prefs);
      Object.assign(notifPrefs, prefs);
      showToast(isEn ? 'Saved ✓' : 'Sparat ✓', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  ['pref-notify-flashbets', 'pref-notify-duels', 'pref-notify-tournaments', 'pref-notify-support']
    .forEach(id => document.getElementById(id)?.addEventListener('change', handlePrefChange));

  const testPushBtn = document.getElementById('btn-test-malta-push');
  testPushBtn?.addEventListener('click', async () => {
    testPushBtn.disabled = true;
    try {
      // Re-register this device first, so a stale subscription is repaired before testing
      const endpoint = await syncPushSubscription();
      const res = await fetch('/api/support/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': localStorage.getItem('whooply_token') || '' },
        body: JSON.stringify(endpoint ? { endpoint } : {})
      });
      const data = await res.json();
      showToast(res.ok ? (data.message || 'Notis skickad! 🌴') : (data.error || 'Kunde inte skicka notis'), res.ok ? 'success' : 'error');
    } catch {
      showToast(isEn ? 'Could not reach the server' : 'Kunde inte nå servern', 'error');
    } finally {
      testPushBtn.disabled = false;
    }
  });
}

async function loadFriendRequests() {
  const slot = document.getElementById('friend-requests-slot');
  if (!slot) return;
  let requests;
  try {
    requests = await getFriendRequests();
  } catch {
    return;
  }
  const incoming = requests.incoming || [];
  const outgoing = requests.outgoing || [];
  if (incoming.length === 0 && outgoing.length === 0) {
    slot.innerHTML = '';
    return;
  }

  slot.innerHTML = `
    ${incoming.length > 0 ? `
      <div style="font-size: 0.75rem; font-weight: 700; color: var(--gold); margin: 4px 0 6px;">📨 Vänförfrågningar (${incoming.length})</div>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
        ${incoming.map(r => `
          <div class="flex-between" style="padding: 8px 12px; background: rgba(245,166,35,0.06); border: 1px solid rgba(245,166,35,0.3); border-radius: var(--radius-md); align-items: center; gap: 8px;">
            <div style="min-width: 0;">
              <div style="font-weight: 600; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.avatarEmoji || '👤')} ${escapeHtml(r.realName || r.nickname)}</div>
              <div class="text-muted" style="font-size: 0.72rem;">@${escapeHtml(r.nickname)}</div>
            </div>
            <div class="flex gap-xs" style="flex-shrink: 0;">
              <button class="btn btn-sm btn-primary friend-request-accept" data-id="${escapeHtml(r.id)}" style="font-size: 0.72rem; padding: 3px 10px;">Godkänn</button>
              <button class="btn btn-sm btn-secondary friend-request-decline" data-id="${escapeHtml(r.id)}" style="font-size: 0.72rem; padding: 3px 8px;">Neka</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${outgoing.length > 0 ? `
      <div class="text-muted" style="font-size: 0.72rem; margin: 4px 0 6px;">⏳ Väntar på svar</div>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
        ${outgoing.map(r => `
          <div class="flex-between" style="padding: 6px 12px; border: 1px dashed var(--border-glass); border-radius: var(--radius-md); align-items: center; gap: 8px;">
            <span style="font-size: 0.82rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(r.avatarEmoji || '👤')} @${escapeHtml(r.nickname)}</span>
            <button class="btn btn-sm btn-secondary friend-request-withdraw" data-id="${escapeHtml(r.id)}" data-nick="${escapeHtml(r.nickname)}" style="font-size: 0.72rem; padding: 3px 10px; flex-shrink: 0;">Ångra</button>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  slot.querySelectorAll('.friend-request-accept').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await acceptFriendRequest(btn.dataset.id);
        showToast('Ni är nu vänner! 👥🎉', 'success');
        window.dispatchEvent(new CustomEvent('friends-changed', { detail: { from: 'profile' } }));
        renderProfile();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
  // Withdraw a request you sent (the same endpoint lets the sender take it back)
  slot.querySelectorAll('.friend-request-withdraw').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await declineFriendRequest(btn.dataset.id);
        showToast(`Förfrågan till @${btn.dataset.nick} är ångrad`, 'info');
        loadFriendRequests();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
  slot.querySelectorAll('.friend-request-decline').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await declineFriendRequest(btn.dataset.id);
        window.dispatchEvent(new CustomEvent('friends-changed', { detail: { from: 'profile' } }));
        loadFriendRequests();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

function showFriendOptionsModal(friend) {
  const avatarHtml = friend.avatarUrl ? `
    <img src="${friend.avatarUrl}" alt="${escapeHtml(friend.nickname)}" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 2.5px solid var(--gold); box-shadow: 0 4px 16px rgba(0,0,0,0.5);" />
  ` : `
    <div style="width: 72px; height: 72px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; font-size: 2.4rem; border: 2.5px solid var(--border-glass);">
      ${escapeHtml(friend.avatar || friend.avatarEmoji || '👤')}
    </div>
  `;

  showModal(`👤 @${escapeHtml(friend.nickname)}`, `
    <div class="friend-modal-wrap text-center">
      <div style="display: flex; justify-content: center; margin-bottom: var(--space-xs);">
        ${avatarHtml}
      </div>

      <h3 style="font-family: var(--font-heading); font-size: 1.25rem; font-weight: 700; margin-bottom: 2px;">
        ${escapeHtml(friend.realName || friend.nickname)}
      </h3>
      <div class="text-gold font-bold mb-md" style="font-size: 0.9rem;">
        @${escapeHtml(friend.nickname)}
      </div>

      <!-- Stats Grid -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: var(--space-md); text-align: center;">
        <div class="card p-xs" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 8px 4px;">
          <div style="font-size: 1.15rem; font-weight: 800; color: var(--gold);">
            ${friend.wins || 0}
          </div>
          <div class="text-muted" style="font-size: 0.68rem; text-transform: uppercase;">Vinster 🏆</div>
        </div>
        <div class="card p-xs" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 8px 4px;">
          <div style="font-size: 1.15rem; font-weight: 800; color: ${friend.streak > 0 && friend.streakType === 'win' ? '#f59e0b' : 'var(--text-primary)'};">
            ${friend.streak > 0 ? `${friend.streakType === 'win' ? '🔥 ' : '❄️ '}${friend.streak}` : '—'}
          </div>
          <div class="text-muted" style="font-size: 0.68rem; text-transform: uppercase;">Streak</div>
        </div>
        <div class="card p-xs" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 8px 4px;">
          <div style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary);">
            ${friend.totalBets || 0}
          </div>
          <div class="text-muted" style="font-size: 0.68rem; text-transform: uppercase;">Spel & Bets</div>
        </div>
      </div>

      <!-- Swish Info -->
      ${friend.swishNumber ? `
        <div class="card mb-md p-sm text-left" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-md);">
          <div class="flex-between" style="align-items: center;">
            <div>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">📱 Swish</div>
              <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); font-family: monospace;">
                ${escapeHtml(formatSwedishPhoneDisplay(friend.swishNumber))}
              </div>
            </div>
            <a href="${createSwishUrl({ phone: friend.swishNumber, amount: 50, message: 'Whooply' })}" class="btn btn-sm btn-secondary" style="font-size: 0.75rem; padding: 6px 12px; display: inline-flex; align-items: center; gap: 4px;">
              💸 Swisha
            </a>
          </div>
        </div>
      ` : ''}

      ${friend.friendshipDate ? `
        <div class="text-muted mb-md" style="font-size: 0.75rem;">
          🤝 Vänner sedan ${formatDate(friend.friendshipDate)}
        </div>
      ` : ''}

      <!-- Safe Unfriend Area -->
      <div id="friend-modal-unfriend-trigger-wrap" style="margin-top: var(--space-md); border-top: 1px solid var(--border-glass); padding-top: var(--space-md);">
        <button type="button" class="btn btn-secondary btn-block btn-sm" id="btn-unfriend-trigger" style="color: #ff6b6b; border-color: rgba(255,107,107,0.3); background: rgba(255,107,107,0.06); font-size: 0.8rem; padding: 9px;">
          🗑️ Ta bort som vän
        </button>
      </div>

      <!-- Hidden Two-Step Confirmation Area -->
      <div id="friend-unfriend-confirm-box" style="display: none; margin-top: var(--space-md); padding: 14px; background: rgba(231,76,60,0.1); border: 1.5px solid rgba(231,76,60,0.4); border-radius: var(--radius-md); text-align: center;">
        <div style="font-size: 1.4rem; margin-bottom: 4px;">⚠️</div>
        <div style="font-weight: 700; font-size: 0.95rem; color: #ff5555; margin-bottom: 6px;">
          Vill du ta bort @${escapeHtml(friend.nickname)}?
        </div>
        <p class="text-secondary" style="font-size: 0.78rem; line-height: 1.4; margin-bottom: 12px;">
          Ni tas bort från varandras vänlistor och kan inte längre se varandras privata spel automatiskt.
        </p>
        <div class="flex gap-sm" style="justify-content: center;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-unfriend" style="flex: 1; padding: 8px;">
            Avbryt
          </button>
          <button type="button" class="btn btn-danger btn-sm" id="btn-confirm-unfriend" style="flex: 1; padding: 8px; font-weight: 700;">
            Ja, ta bort
          </button>
        </div>
      </div>
    </div>
  `);

  const triggerWrap = document.getElementById('friend-modal-unfriend-trigger-wrap');
  const triggerBtn = document.getElementById('btn-unfriend-trigger');
  const confirmBox = document.getElementById('friend-unfriend-confirm-box');
  const cancelBtn = document.getElementById('btn-cancel-unfriend');
  const confirmBtn = document.getElementById('btn-confirm-unfriend');

  triggerBtn?.addEventListener('click', () => {
    if (triggerWrap) triggerWrap.style.display = 'none';
    if (confirmBox) confirmBox.style.display = 'block';
  });

  cancelBtn?.addEventListener('click', () => {
    if (confirmBox) confirmBox.style.display = 'none';
    if (triggerWrap) triggerWrap.style.display = 'block';
  });

  confirmBtn?.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Tar bort...';
    try {
      await removeFriend(friend.id);
      closeModal();
      showToast(`Tog bort @${friend.nickname} från vänner`, 'info');
      renderProfile();
    } catch (err) {
      showToast(err.message || 'Kunde inte ta bort vän', 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Ja, ta bort';
    }
  });
}

function showAddFriendModal(currentFriends = []) {
  const friendIdSet = new Set(currentFriends.map(f => f.id));
  const currentUser = getStoredUser();
  const myNick = currentUser?.nickname || '';
  let inviteUrl = `${getAppBaseUrl()}/?addFriend=${encodeURIComponent(myNick)}`;
  let inviteText = `Tja! Häng med på Whooply och betta med oss: ${inviteUrl}`;
  buildFriendInviteUrl().then(url => {
    inviteUrl = url;
    inviteText = `Tja! Häng med på Whooply och betta med oss: ${inviteUrl}`;
  }).catch(() => {});

  showModal('👥 Lägg till vän', `
    <div>
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">Sök på mobilnummer, @smeknamn eller namn</label>
        <input type="search" class="form-input" id="friend-search-input" placeholder="T.ex. 070-123 45 67, Johan eller @johand..." autofocus />
      </div>
      <div id="friend-search-results" style="min-height: 80px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
        <div class="text-center text-muted" style="font-size: 0.8rem; padding: 20px 0;">
          Skriv ett mobilnummer, smeknamn eller namn för att söka
        </div>
      </div>
    </div>
  `);

  const searchInput = document.getElementById('friend-search-input');
  const resultsDiv = document.getElementById('friend-search-results');
  let debounceTimer = null;

  async function performSearch() {
    const q = searchInput.value.trim();
    if (q.length < 2) {
      resultsDiv.innerHTML = `
        <div class="text-center text-muted" style="font-size: 0.8rem; padding: 20px 0;">
          Skriv ett mobilnummer, smeknamn eller namn för att söka
        </div>
      `;
      return;
    }

    resultsDiv.innerHTML = `<div class="text-center text-muted" style="font-size: 0.8rem; padding: 20px 0;">Söker... 🔍</div>`;

    const digits = q.replace(/\D/g, '');
    const looksLikePhone = digits.length >= 7;

    try {
      const users = await searchUsers(q);
      if (users.length === 0) {
        if (looksLikePhone) {
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
          const smsSeparator = isIOS ? '&' : '?';
          const smsLink = `sms:${encodeURIComponent(digits)}${smsSeparator}body=${encodeURIComponent(inviteText)}`;

          let intlPhone = digits;
          if (intlPhone.startsWith('0')) {
            intlPhone = '46' + intlPhone.slice(1);
          }
          const waLink = `https://wa.me/${intlPhone}?text=${encodeURIComponent(inviteText)}`;

          resultsDiv.innerHTML = `
            <div class="card text-center" style="padding: var(--space-md); border: 1px dashed rgba(255,215,0,0.35); background: rgba(255,215,0,0.03); margin-top: 4px;">
              <div style="font-size: 2.2rem; margin-bottom: 6px;">📱</div>
              <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 4px;">Inget konto för ${escapeHtml(q)}</div>
              <p class="text-muted" style="font-size: 0.8rem; line-height: 1.4; margin-bottom: var(--space-md);">
                Kompisen har inte registrerat sig än. Bjud in hen via SMS eller WhatsApp så kopplas ni automatiskt ihop som vänner när hen klickar på länken!
              </p>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <a href="${smsLink}" class="btn btn-primary btn-block" style="text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.85rem;">
                  <span>💬</span> <span>Skicka SMS till ${escapeHtml(q)}</span>
                </a>
                <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-block" style="text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.85rem; border-color: #25D366; color: #25D366;">
                  <span>🟢</span> <span>Öppna i WhatsApp</span>
                </a>
                ${navigator.share ? `
                  <button type="button" class="btn btn-secondary btn-block" id="btn-native-share-invite" style="font-size: 0.8rem;">
                    📤 Dela via annan app...
                  </button>
                ` : ''}
              </div>
            </div>
          `;

          document.getElementById('btn-native-share-invite')?.addEventListener('click', async () => {
            try {
              await navigator.share({
                title: 'Whooply Inbjudan',
                text: inviteText,
                url: inviteUrl
              });
            } catch {}
          });
          return;
        }

        resultsDiv.innerHTML = `
          <div class="text-center text-muted" style="font-size: 0.8rem; padding: 20px 0;">
            <div>Inga användare hittades som matchar "${escapeHtml(q)}"</div>
            <div class="mt-sm">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-fallback-copy-invite">
                🔗 Kopiera din inbjudningslänk
              </button>
            </div>
          </div>
        `;
        document.getElementById('btn-fallback-copy-invite')?.addEventListener('click', async () => {
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(inviteUrl);
              showToast('Kopierade din inbjudningslänk till urklipp! 📋', 'success');
            } else {
              prompt('Kopiera din inbjudningslänk:', inviteUrl);
            }
          } catch {
            prompt('Kopiera din inbjudningslänk:', inviteUrl);
          }
        });
        return;
      }

      resultsDiv.innerHTML = users.map(u => {
        const isAlreadyFriend = friendIdSet.has(u.id);
        return `
          <div class="flex-between" style="padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); align-items: center;">
            <div class="flex gap-sm" style="align-items: center; min-width: 0;">
              ${u.avatarUrl ? `
                <img src="${u.avatarUrl}" alt="${escapeHtml(u.nickname)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />
              ` : `
                <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
                  ${escapeHtml(u.avatar || '👤')}
                </div>
              `}
              <div style="min-width: 0;">
                <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(u.realName || u.nickname)}</div>
                <div class="text-muted" style="font-size: 0.75rem; color: var(--gold);">@${escapeHtml(u.nickname)}</div>
              </div>
            </div>
            <div style="flex-shrink: 0; margin-left: 8px;">
              ${isAlreadyFriend ? `
                <span class="badge badge-success" style="font-size: 0.7rem;">Redan vän ✓</span>
              ` : `
                <button class="btn btn-sm btn-accent add-friend-action-btn" data-id="${u.id}" data-nickname="${escapeHtml(u.nickname)}" style="font-size: 0.75rem; padding: 3px 10px;">
                  + Lägg till
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');

      resultsDiv.querySelectorAll('.add-friend-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fid = btn.dataset.id;
          const fnick = btn.dataset.nickname;
          btn.disabled = true;
          btn.textContent = 'Lägger till...';
          try {
            const res = await addFriend({ friendId: fid });
            if (res.status === 'pending') {
              showToast(`Vänförfrågan skickad till @${fnick}! 📨`, 'success');
              btn.parentElement.innerHTML = `<span class="badge" style="font-size: 0.7rem;">Förfrågan skickad ⏳</span>`;
              loadFriendRequests();
              return;
            }
            showToast(`Lade till @${fnick} som vän! 🎉`, 'success');
            friendIdSet.add(fid);
            btn.parentElement.innerHTML = `<span class="badge badge-success" style="font-size: 0.7rem;">Redan vän ✓</span>`;
            // Refresh main profile in background so when closed, friends are updated
            const [b, s, c, updatedFriends] = await Promise.all([
              getMyBets(),
              getMyStats(),
              getMyCredentials().catch(() => ({ hasBiometric: false })),
              getFriends().catch(() => [])
            ]);
            const u = getStoredUser();
            renderProfileContent(document.getElementById('page-content'), u, b, s, c, updatedFriends);
          } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '+ Lägg till';
          }
        });
      });
    } catch (err) {
      resultsDiv.innerHTML = `<div class="text-center text-red" style="font-size: 0.8rem; padding: 20px 0;">${escapeHtml(err.message)}</div>`;
    }
  }

  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performSearch, 300);
  });
}
