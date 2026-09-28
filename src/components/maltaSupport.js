// ── Components: Malta AI Support (Malta Chatt) ─────────
import { showModal } from './modal.js';
import { getLang } from '../i18n.js';
import { escapeHtml, showToast } from '../utils.js';

let sessionChatHistory = [];
let isSending = false;

export function isMaltaFabDisabled() {
  return localStorage.getItem('malta_fab_disabled') === 'true';
}

export function setMaltaFabDisabled(disabled) {
  localStorage.setItem('malta_fab_disabled', disabled ? 'true' : 'false');
  const fab = document.getElementById('malta-support-fab');
  if (fab) {
    if (disabled) {
      fab.classList.add('hidden-manual');
    } else {
      fab.classList.remove('hidden-manual');
    }
  }
  window.dispatchEvent(new CustomEvent('malta-fab-visibility-changed', { detail: { disabled: !!disabled } }));
}

export function openMaltaSupportModal(initialQuestion = null) {
  const isEn = getLang() === 'en';
  const isFabDisabled = isMaltaFabDisabled();

  const modalTitle = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <img src="/malta-chip-sm.webp" alt="Whooply" style="width: 24px; height: 24px; object-fit: contain; filter: drop-shadow(0 2px 6px rgba(255,215,0,0.5));" />
      <span>${isEn ? 'Malta VIP Support 🇲🇹' : 'Malta Kundtjänst 🇲🇹'}</span>
    </div>
  `;

  const contentHtml = `
    <div class="malta-chat-container">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div class="malta-chat-badge" id="malta-chat-status" style="margin: 0;">
          <span class="malta-live-indicator"></span>
          <span>${isEn ? 'Checking…' : 'Kollar läget…'}</span>
        </div>
        <button type="button" id="malta-toggle-fab-visibility-btn" class="btn btn-xs ${isFabDisabled ? 'btn-primary' : 'btn-secondary'}" style="font-size: 0.72rem; padding: 4px 9px; border-radius: 999px; opacity: 0.95;">
          ${isFabDisabled ? (isEn ? '📌 Show floating button' : '📌 Fäst ikon på skärmen') : (isEn ? '👁️ Hide floating button' : '👁️ Dölj flytande ikon')}
        </button>
      </div>

      <!-- Quick topics: the most asked questions (filled from the server) -->
      <div class="malta-quick-chips" id="malta-quick-chips">
        ${DEFAULT_TOPICS.map(t => `<button type="button" class="malta-chip-btn" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>

      <!-- Chat messages log -->
      <div class="malta-chat-box" id="malta-chat-messages">
        <div class="malta-msg malta-msg-bot">
          <img src="/malta-chip-sm.webp" class="malta-msg-avatar" alt="Whooply" />
          <div class="malta-msg-bubble">
            ${isEn
              ? "Welcome to Whooply support! 🇲🇹 Ask me how to decide a match, who swishes whom on The Tab, adding games, friends – or get a quick swing tip. ⛳"
              : "Tjena mästaren! 🇲🇹 Välkommen till Whooply-supporten! Fråga hur du avgör en match, vem som swishar vem på THE TAB, hur du lägger till spel och vänner – eller be om ett snabbt svingtips. ⛳"}
          </div>
        </div>
      </div>

      <!-- Input area -->
      <form id="malta-chat-form" class="malta-chat-input-bar">
        <input 
          type="text" 
          id="malta-chat-input" 
          class="malta-chat-field" 
          placeholder="${isEn ? 'Ask about games, The Tab, friends…' : 'Fråga om spel, THE TAB, vänner…'}" 
          autocomplete="off" 
          maxlength="500"
        />
        <button type="submit" id="malta-chat-send-btn" class="btn btn-primary malta-send-btn">
          <span>${isEn ? 'Send' : 'Skicka'}</span> 🚀
        </button>
      </form>
    </div>
  `;

  showModal(modalTitle, contentHtml, () => {
    // on close
  }, {
    fullScreen: false
  });

  // Attach event listeners
  setTimeout(() => {
    const form = document.getElementById('malta-chat-form');
    const input = document.getElementById('malta-chat-input');
    const chatBox = document.getElementById('malta-chat-messages');
    const toggleFabBtn = document.getElementById('malta-toggle-fab-visibility-btn');

    // Toggle FAB visibility button
    const updateFabModalBtn = (disabled) => {
      if (!toggleFabBtn) return;
      toggleFabBtn.textContent = disabled
        ? (isEn ? '📌 Show floating button' : '📌 Fäst ikon på skärmen')
        : (isEn ? '👁️ Hide floating button' : '👁️ Dölj flytande ikon');
      toggleFabBtn.className = `btn btn-xs ${disabled ? 'btn-primary' : 'btn-secondary'}`;
    };

    toggleFabBtn?.addEventListener('click', () => {
      const currentlyDisabled = isMaltaFabDisabled();
      const newDisabledState = !currentlyDisabled;
      setMaltaFabDisabled(newDisabledState);

      if (newDisabledState) {
        showToast(
          isEn 
            ? 'Malta icon hidden. You can restore it anytime under Profile!' 
            : 'Malta-ikonen är dold. Du kan alltid återställa den under Profil!', 
          'info'
        );
      } else {
        showToast(
          isEn 
            ? 'Malta icon visible on screen! Drag to move around.' 
            : 'Whooply-ikonen visas nu på skärmen igen! Dra i den för att flytta.', 
          'success'
        );
      }

      updateFabModalBtn(newDisabledState);
    });

    // Render any previous history
    if (sessionChatHistory.length > 0) {
      chatBox.innerHTML = '';
      sessionChatHistory.forEach(item => {
        appendChatMessage(item.role === 'user' ? 'user' : 'bot', item.text, false);
      });
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Topic chips (top row and the suggestions under answers) send their question
    document.querySelector('.malta-chat-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.malta-chip-btn');
      const topic = btn?.getAttribute('data-topic');
      if (topic && input) {
        input.value = topic;
        handleSend();
      }
    });

    loadSupportStatus(isEn);

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSend();
      });
    }

    if (input) {
      input.focus();
    }

    // Auto send initial question if provided
    if (initialQuestion && input) {
      input.value = initialQuestion;
      handleSend();
    }
  }, 50);
}

async function handleSend() {
  const input = document.getElementById('malta-chat-input');
  const sendBtn = document.getElementById('malta-chat-send-btn');
  const chatBox = document.getElementById('malta-chat-messages');
  if (!input || !sendBtn || !chatBox || isSending) return;

  const text = (input.value || '').trim();
  if (!text) return;

  input.value = '';
  isSending = true;
  sendBtn.disabled = true;

  // Add user bubble
  appendChatMessage('user', text, true);
  sessionChatHistory.push({ role: 'user', text });

  // Add typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'malta-msg malta-msg-bot malta-typing-bubble';
  typingEl.id = 'malta-typing-indicator';
  typingEl.innerHTML = `
    <img src="/malta-chip-sm.webp" class="malta-msg-avatar" alt="Whooply" />
    <div class="malta-msg-bubble">
      <span class="malta-typing-dots">
        <span></span><span></span><span></span>
      </span>
      <span style="font-size: 0.78rem; opacity: 0.7; margin-left: 6px;">${getLang() === 'en' ? 'Malta Support is thinking…' : 'Malta Support funderar…'}</span>
    </div>
  `;
  chatBox.appendChild(typingEl);
  chatBox.scrollTop = chatBox.scrollHeight;

  try {
    const token = localStorage.getItem('whooply_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-user-token'] = token;

    const res = await fetch('/api/support/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: text,
        history: sessionChatHistory.slice(-6)
      })
    });

    const data = await res.json().catch(() => ({}));
    document.getElementById('malta-typing-indicator')?.remove();

    // Our own limit ("support is on a break") comes back as an error message: show it as is
    const reply = data?.reply || data?.error || 'Hoppsan! Nätet svajade till, men Malta Support finns alltid här. Prova igen!';
    appendChatMessage('bot', reply, true, data?.suggestions || []);
    if (data?.reply) sessionChatHistory.push({ role: 'bot', text: reply });
    if (data?.mode) setSupportStatus(data.mode, getLang() === 'en');
  } catch (err) {
    document.getElementById('malta-typing-indicator')?.remove();
    appendChatMessage('bot', 'Kunde inte nå Malta Support just nu. Kontrollera din internetuppkoppling!', true);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// Escaped first, then a little markdown: **bold**, *italic* and tappable https links
export function formatSupportText(rawText) {
  return escapeHtml(rawText)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:]|$)/g, '$1<em>$2</em>')
    .replace(/https:\/\/[^\s<]+[^\s<.,!?)]/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\n/g, '<br/>');
}

const DEFAULT_TOPICS = ['🏆 Avgöra en match', '💸 Swish & THE TAB', '⏳ Löpande skulder', '➕ Lägga till spel', '🎯 Välj flera', '👥 Vänner', '🔔 Notiser', '🔑 Glömt PIN'];

async function loadSupportStatus(isEn) {
  try {
    const res = await fetch('/api/support/status');
    const data = await res.json();
    setSupportStatus(data.mode || (data.live ? 'live' : 'offline'), isEn);
    const chips = document.getElementById('malta-quick-chips');
    if (chips && Array.isArray(data.topics) && data.topics.length) {
      chips.innerHTML = data.topics.map(t => `<button type="button" class="malta-chip-btn" data-topic="${escapeHtml(t.label)}">${escapeHtml(t.label)}</button>`).join('');
    }
  } catch {
    setSupportStatus('offline', isEn);
  }
}

// Honest status: the AI, or quick answers from the built-in handbook
function setSupportStatus(mode, isEn) {
  const el = document.getElementById('malta-chat-status');
  if (!el) return;
  const live = mode === 'live';
  el.classList.toggle('is-offline', !live);
  el.innerHTML = `<span class="malta-live-indicator"></span><span>${live
    ? (isEn ? 'AI support online' : 'AI-support online')
    : mode === 'resting'
      ? (isEn ? 'AI resting – quick answers' : 'AI:n vilar – snabbsvar')
      : (isEn ? 'Quick answers (AI offline)' : 'Snabbsvar (AI offline)')}</span>`;
}

function appendChatMessage(sender, rawText, scroll = true, suggestions = []) {
  const chatBox = document.getElementById('malta-chat-messages');
  if (!chatBox) return;

  const msgEl = document.createElement('div');
  msgEl.className = `malta-msg malta-msg-${sender}`;

  const formatted = formatSupportText(rawText);

  if (sender === 'bot') {
    msgEl.innerHTML = `
      <img src="/malta-chip-sm.webp" class="malta-msg-avatar" alt="Whooply" />
      <div class="malta-msg-bubble">${formatted}
        ${suggestions.length ? `<div class="malta-suggest">${suggestions.map(t => `<button type="button" class="malta-chip-btn" data-topic="${escapeHtml(t.label)}">${escapeHtml(t.label)}</button>`).join('')}</div>` : ''}
      </div>
    `;
  } else {
    msgEl.innerHTML = `
      <div class="malta-msg-bubble">${formatted}</div>
    `;
  }

  chatBox.appendChild(msgEl);
  if (scroll) {
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

/**
 * Injects the floating Malta Support button into the page with full Drag & Drop,
 * magnet snap to screen edges, auto-hiding during minigames, and minimization.
 */
export function initMaltaSupportWidget() {
  if (document.getElementById('malta-support-fab')) return;

  const isHiddenExplicitly = localStorage.getItem('malta_fab_disabled') === 'true';
  // A small round button; the name slides out only the very first time
  let showIntro = false;
  try { showIntro = localStorage.getItem('malta_fab_intro_seen') !== 'true'; } catch (e) {}

  const fab = document.createElement('div');
  fab.id = 'malta-support-fab';
  fab.className = `malta-fab-btn ${showIntro ? 'intro' : ''} ${isHiddenExplicitly ? 'hidden-manual' : ''}`;
  fab.setAttribute('role', 'button');
  fab.setAttribute('aria-label', 'Malta AI Kundtjänst (Dra för att flytta)');
  fab.title = 'Malta AI Kundtjänst 🇲🇹 (Dra för att flytta runt)';

  fab.innerHTML = `
    <div class="malta-fab-content" id="malta-fab-main-content">
      <img src="/malta-chip-sm.webp" class="malta-fab-icon" alt="Malta Support" draggable="false" />
      <span class="malta-fab-label">Malta Support</span>
    </div>
    <span class="malta-fab-dot" aria-hidden="true"></span>
  `;

  document.body.appendChild(fab);

  if (showIntro) {
    setTimeout(() => {
      fab.classList.remove('intro');
      try { localStorage.setItem('malta_fab_intro_seen', 'true'); } catch (e) {}
    }, 4500);
  }

  // Restore saved position
  restoreFabPosition(fab);

  // Setup Drag logic (Touch + Mouse with click detection)
  setupFabDrag(fab);

  // Setup MutationObserver to automatically HIDE button during minigames / modals
  setupModalAutoHider(fab);
}

function restoreFabPosition(fab) {
  try {
    const saved = JSON.parse(localStorage.getItem('malta_widget_pos') || 'null');
    if (saved && typeof saved.topRatio === 'number') {
      const fabWidth = 46;
      const fabHeight = 46;
      const targetTop = Math.max(50, Math.min(window.innerHeight * saved.topRatio, window.innerHeight - fabHeight - 65));
      const targetLeft = saved.side === 'left' ? 10 : (window.innerWidth - fabWidth - 10);
      fab.style.top = `${targetTop}px`;
      fab.style.left = `${targetLeft}px`;
      fab.style.bottom = 'auto';
      fab.style.right = 'auto';
      return;
    }
  } catch (e) {}

  // Default: bottom right above bottom navbar
  fab.style.bottom = '74px';
  fab.style.right = '14px';
}

function setupFabDrag(fab) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let moved = false;

  function onStart(clientX, clientY) {
    const rect = fab.getBoundingClientRect();
    startX = clientX;
    startY = clientY;
    initialLeft = rect.left;
    initialTop = rect.top;
    isDragging = true;
    moved = false;
    fab.classList.add('is-dragging');
  }

  function onMove(clientX, clientY) {
    if (!isDragging) return;
    const dx = clientX - startX;
    const dy = clientY - startY;

    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      moved = true;
    }

    if (moved) {
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      const fabWidth = fab.offsetWidth;
      const fabHeight = fab.offsetHeight;
      const maxLeft = window.innerWidth - fabWidth - 6;
      const maxTop = window.innerHeight - fabHeight - 65; // keep above bottom navbar

      newLeft = Math.max(6, Math.min(newLeft, maxLeft));
      newTop = Math.max(45, Math.min(newTop, maxTop)); // keep below top navbar

      fab.style.left = `${newLeft}px`;
      fab.style.top = `${newTop}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    fab.classList.remove('is-dragging');

    if (!moved) {
      // Tap!
      openMaltaSupportModal();
      return;
    }

    // Snap magnetically to nearest edge (left or right)
    const rect = fab.getBoundingClientRect();
    const fabWidth = fab.offsetWidth;
    const isLeft = (rect.left + fabWidth / 2) < (window.innerWidth / 2);
    const targetLeft = isLeft ? 10 : (window.innerWidth - fabWidth - 10);

    fab.style.transition = 'left 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
    fab.style.left = `${targetLeft}px`;
    setTimeout(() => {
      fab.style.transition = '';
    }, 250);

    // Save position to localStorage
    try {
      const topRatio = rect.top / window.innerHeight;
      localStorage.setItem('malta_widget_pos', JSON.stringify({
        side: isLeft ? 'left' : 'right',
        topRatio: Math.max(0.08, Math.min(topRatio, 0.85))
      }));
    } catch (e) {}
  }

  // Touch handlers
  fab.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    onStart(touch.clientX, touch.clientY);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    onMove(touch.clientX, touch.clientY);
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (isDragging) onEnd();
  }, { passive: true });

  // Mouse handlers
  fab.addEventListener('mousedown', (e) => {
    onStart(e.clientX, e.clientY);
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    onMove(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) onEnd();
  });

}

/**
 * MutationObserver that auto-hides the floating widget whenever ANY modal
 * (minigame, slot machine, Space Blitz, tournament modal) is active.
 */
function setupModalAutoHider(fab) {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  function checkModal() {
    const hasModal = modalRoot.children.length > 0 && modalRoot.innerHTML.trim() !== '';
    if (hasModal) {
      fab.classList.add('auto-hidden-modal');
    } else {
      fab.classList.remove('auto-hidden-modal');
    }
  }

  const observer = new MutationObserver(() => {
    checkModal();
  });

  observer.observe(modalRoot, { childList: true, subtree: true });
  checkModal();
}
