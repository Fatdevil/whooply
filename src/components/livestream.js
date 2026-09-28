// ── Components: Live Stream Video & Interactive BlixtBet Overlay ──
import { showModal, closeModal } from './modal.js';
import { launchConfetti, escapeHtml, showToast, formatCurrency, createSwishUrl } from '../utils.js';
import {
  startBroadcasterSession,
  startViewerSession,
  startLocalCamera,
  stopLocalCamera,
  switchCamera,
  toggleAudio,
  isAudioEnabled,
  toggleViewerAudio,
  isViewerAudioMuted,
  testCameraAccess,
  publishRoomData,
  stopAllStreams
} from '../livekitClient.js';
import {
  getFlashBet,
  placeFlashBet,
  settleFlashBet,
  deleteFlashBet,
  getActiveFlashBets,
  sendWebSocketMessage,
  onWebSocketMessage,
  connectWebSocket,
  getFriends,
  startFlashLive,
  getFlashLive,
  settleFlashLive,
  attachFlashLiveBet,
  stopFlashLive,
  setActiveLiveRoom,
  clearActiveLiveRoom
} from '../api.js';
import { getStoredUser } from '../auth.js';
import { t, getLang } from '../i18n.js';

let streamActive = false;
let viewerCount = 1;
let wsUnsub = null;
let activeLiveId = null;
let heartbeatInterval = null;
let countdownInterval = null;
// The BlixtBet currently shown in the live view (so it can be settled after the stream ends)
let currentLiveBetId = null;
let currentLiveBetSettled = false;
let isClosingLiveStream = false;
let currentIsBroadcaster = false;

function addCommentToStream({ userName, userAvatar, text, isBetNotice = false }) {
  const container = document.getElementById('live-comments-stream');
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.className = 'live-comment-bubble';
  bubble.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: ${isBetNotice ? 'rgba(245, 166, 35, 0.25)' : 'rgba(0,0,0,0.55)'};
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid ${isBetNotice ? 'var(--gold)' : 'rgba(255,255,255,0.15)'};
    border-radius: 12px;
    padding: 4px 10px;
    font-size: 0.78rem;
    color: #fff;
    max-width: 85%;
    word-break: break-word;
    animation: fadeInSlideUp 0.25s ease-out;
    transition: opacity 0.5s ease-out;
  `;

  bubble.innerHTML = `
    <span style="font-size: 0.85rem;">${escapeHtml(userAvatar || '💬')}</span>
    <span>
      <strong style="color: ${isBetNotice ? 'var(--gold)' : '#ffd700'};">${escapeHtml(userName)}:</strong>
      <span style="color: #fff; margin-left: 2px;">${escapeHtml(text)}</span>
    </span>
  `;

  container.appendChild(bubble);

  // Auto-scroll to latest comment
  container.scrollTop = container.scrollHeight;

  // Auto-fade out after 8 seconds
  setTimeout(() => {
    bubble.style.opacity = '0';
    setTimeout(() => bubble.remove(), 500);
  }, 8000);
}

export async function openLiveStreamModal({
  tournamentId = null,
  tournamentCode = null,
  tournamentName = null,
  isBroadcaster = true,
  flashBetId = null,
  liveId = null,
  isStandalone = false,
  hasBet = true,
  initialQuestion = null,
  initialFlashBet = null,
  livekitToken = null,
  livekitUrl = null,
  livekitError = null,
  endsAt = null
} = {}) {
  const user = getStoredUser();
  streamActive = true;
  activeLiveId = liveId;
  currentIsBroadcaster = !!isBroadcaster;
  viewerCount = 1;

  let token = livekitToken;
  let url = livekitUrl;
  let serverError = livekitError;

  if (liveId && (!token || !url || !endsAt)) {
    try {
      const liveData = await getFlashLive(liveId);
      token = token || liveData.livekitToken;
      url = url || liveData.livekitUrl;
      serverError = liveData.livekitError || serverError;
      endsAt = endsAt || liveData.live?.endsAt || null;
      if (!initialFlashBet && liveData.flashBet) {
        initialFlashBet = liveData.flashBet;
      }
    } catch (e) {
      console.warn('Could not fetch live session info:', e);
    }
  }

  // Render Fullscreen Live Stream Modal
  showModal('', `
    <div id="livestream-fullscreen" style="
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      height: 100dvh;
      background: #000;
      z-index: 10;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    ">
      <!-- Viewer Connecting Placeholder (until remote stream loads) -->
      ${!isBroadcaster ? `
        <div id="livestream-placeholder" style="
          position: absolute;
          inset: 0;
          width: 100%; height: 100%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: radial-gradient(circle at center, #1b2838 0%, #0a0d14 100%);
          z-index: 1;
        ">
          <div style="font-size: 3.5rem; margin-bottom: 12px;">🏌️‍♂️</div>
          <div style="font-weight: 800; font-size: 1.1rem; color: #fff; margin-bottom: 6px;">
            ${escapeHtml(tournamentName || 'Livesändning')}
          </div>
          <div style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--gold);">
            <span style="width: 8px; height: 8px; background: #ff334b; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px #ff334b;"></span>
            Ansluter till videoströmmen...
          </div>
        </div>
      ` : ''}

      <!-- Video Element (Full screen camera background) -->
      <video id="livestream-video" autoplay playsinline muted style="
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 2;
        background: #000;
      "></video>

      <!-- Video Gradient Overlay for readability -->
      <div style="
        position: absolute;
        inset: 0;
        width: 100%; height: 100%;
        background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.85) 100%);
        z-index: 3;
        pointer-events: none;
      "></div>

      <!-- Top Bar HUD (Header) -->
      <div id="livestream-top-hud" style="
        position: absolute;
        top: max(env(safe-area-inset-top, 12px), 12px);
        left: 12px; right: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        z-index: 20;
        pointer-events: auto;
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
        ">
          <!-- Red pulsing Live badge -->
          <span style="
            background: #ff334b;
            color: #fff;
            font-size: 0.7rem;
            font-weight: 800;
            padding: 4px 7px;
            border-radius: 6px;
            letter-spacing: 0.05em;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            box-shadow: 0 0 10px rgba(255, 51, 75, 0.6);
            flex-shrink: 0;
          ">
            <span style="width: 6px; height: 6px; background: #fff; border-radius: 50%; display: inline-block;"></span>
            LIVE
          </span>

          <!-- Viewers count badge -->
          <span id="live-viewer-count" style="
            background: rgba(0,0,0,0.55);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 4px 7px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.15);
            white-space: nowrap;
            flex-shrink: 0;
          ">
            👁️ ${viewerCount}
          </span>

          <!-- Time left before the stream stops automatically -->
          <span id="live-time-left" style="
            display: none;
            background: rgba(0,0,0,0.55);
            color: #fff;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 4px 7px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.15);
            white-space: nowrap;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
          "></span>

          <span style="
            color: rgba(255,255,255,0.9);
            font-size: 0.75rem;
            font-weight: 600;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          ">
            ${escapeHtml(tournamentName || (isStandalone ? 'Spontan-Live ⚡' : 'Whooply Live'))}
          </span>
        </div>

        <!-- Top Right Controls -->
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        ">
          ${!isBroadcaster ? `
            <button type="button" id="btn-toggle-viewer-audio" style="
              background: rgba(0,0,0,0.5);
              border: 1px solid rgba(255,255,255,0.2);
              color: #fff;
              width: 34px; height: 34px;
              border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              font-size: 1rem;
              cursor: pointer;
            " title="Ljud av/på">🔊</button>
          ` : ''}

          ${isBroadcaster ? `
            <button type="button" id="btn-switch-camera" style="
              background: rgba(0,0,0,0.5);
              border: 1px solid rgba(255,255,255,0.2);
              color: #fff;
              width: 34px; height: 34px;
              border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              font-size: 1rem;
              cursor: pointer;
            " title="Byt kamera">🔄</button>

            <button type="button" id="btn-toggle-mic" style="
              background: rgba(0,0,0,0.5);
              border: 1px solid rgba(255,255,255,0.2);
              color: #fff;
              width: 34px; height: 34px;
              border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              font-size: 1rem;
              cursor: pointer;
            " title="Muta mikrofon">🎙️</button>
          ` : ''}

          <!-- Toggle Clean Camera View / Overlays button -->
          <button type="button" id="btn-toggle-overlay" style="
            background: rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.2);
            color: #fff;
            width: 34px; height: 34px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 1rem;
            cursor: pointer;
          " title="Ren kameravy / visa kontroller">👁️</button>

          <!-- Stop / Leave button -->
          <button type="button" id="btn-close-livestream" class="${isBroadcaster ? 'btn-stop-live-broadcaster' : 'btn-leave-live'}" style="
            background: ${isBroadcaster ? 'linear-gradient(135deg, #ff334b, #d90429)' : 'rgba(255, 255, 255, 0.2)'};
            border: 1px solid ${isBroadcaster ? '#ff334b' : 'rgba(255,255,255,0.3)'};
            color: #fff;
            height: 34px;
            padding: 0 10px;
            border-radius: 17px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            font-size: 0.75rem;
            font-weight: 700;
            cursor: pointer;
            box-shadow: ${isBroadcaster ? '0 2px 10px rgba(255,51,75,0.5)' : 'none'};
            flex-shrink: 0;
            white-space: nowrap;
          " title="${isBroadcaster ? 'Avsluta sändning' : 'Lämna'}">
            ${isBroadcaster ? '⏹️ Avsluta' : '✕ Lämna'}
          </button>
        </div>
      </div>

      <!-- Bottom Interactive Overlay: Floating BlixtBet card & actions -->
      <div id="livestream-bottom-overlay" style="
        position: absolute;
        bottom: env(safe-area-inset-bottom, 20px);
        left: 12px; right: 12px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: opacity 0.25s ease, transform 0.25s ease;
      ">
        <!-- Live Comments Overlay Stream (TikTok / Instagram style) -->
        <div id="live-comments-stream" style="
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 180px;
          overflow-y: hidden;
          pointer-events: none;
          margin-bottom: 2px;
          mask-image: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 35%);
          -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 35%);
        ">
          <!-- Comments inject here dynamically -->
        </div>

        <!-- Floating BlixtBet Live Card Container -->
        <div id="live-blixtbet-container" style="
          background: rgba(18, 22, 34, 0.85);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1.5px solid rgba(245, 166, 35, 0.6);
          border-radius: 14px;
          padding: 12px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        ">
          <div style="text-align: center; color: rgba(255,255,255,0.7); font-size: 0.8rem;">
            Laddar BlixtBet... ⚡
          </div>
        </div>

        ${isBroadcaster ? `
          <div style="display: flex; justify-content: flex-end; align-items: center;">
            <button type="button" id="btn-bottom-stop-live" style="
              background: linear-gradient(135deg, rgba(220, 38, 38, 0.9), rgba(185, 28, 28, 0.95));
              backdrop-filter: blur(8px);
              -webkit-backdrop-filter: blur(8px);
              border: 1px solid rgba(255,255,255,0.3);
              color: #fff;
              padding: 6px 14px;
              border-radius: 20px;
              font-size: 0.76rem;
              font-weight: 800;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 5px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            " title="Avsluta livesändning">
              ⏹️ Avsluta sändning
            </button>
          </div>
        ` : ''}

        <!-- Interactive Chat Input Bar & Reactions -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <form id="live-chat-form" style="
            flex: 1;
            display: flex;
            align-items: center;
            background: rgba(0,0,0,0.55);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 22px;
            padding: 4px 6px 4px 12px;
          ">
            <input type="text" id="live-chat-input" placeholder="Kommentera..." maxlength="120" autocomplete="off" style="
              flex: 1;
              background: transparent;
              border: none;
              color: #fff;
              font-size: 0.82rem;
              outline: none;
            " />
            <button type="submit" id="live-chat-send-btn" style="
              background: var(--gold);
              color: #000;
              border: none;
              width: 30px; height: 30px;
              border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              font-size: 0.85rem;
              cursor: pointer;
              font-weight: 800;
            ">➤</button>
          </form>

          <!-- Quick Emoji reaction buttons -->
          <button type="button" class="live-reaction-btn" data-emoji="🔥" style="
            background: rgba(255,255,255,0.15);
            border: none;
            width: 38px; height: 38px;
            border-radius: 50%;
            font-size: 1.15rem;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
          ">🔥</button>

          <button type="button" class="live-reaction-btn" data-emoji="⛳" style="
            background: rgba(255,255,255,0.15);
            border: none;
            width: 38px; height: 38px;
            border-radius: 50%;
            font-size: 1.15rem;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
          ">⛳</button>

          <button type="button" class="live-reaction-btn" data-emoji="❤️" style="
            background: rgba(255, 51, 75, 0.3);
            border: none;
            width: 38px; height: 38px;
            border-radius: 50%;
            font-size: 1.15rem;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
          ">❤️</button>
        </div>
      </div>
    </div>
  `, () => closeLiveStream(), {
    fullScreen: true,
    // Treat the live view like a game: automatic pop-ups (install app, invites, notification
    // links) must not replace it, or the camera keeps streaming with no way to stop it
    isGame: true,
    confirmClose: false,
    isBusy: () => streamActive
  });

  const videoEl = document.getElementById('livestream-video');

  // Countdown to the automatic stop (max 15 min per stream, set by the server)
  const endsAtMs = endsAt ? new Date(endsAt).getTime() : NaN;
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  if (Number.isFinite(endsAtMs)) {
    const warned = new Set();
    const tick = () => {
      if (!streamActive || activeLiveId !== liveId) return;
      const left = Math.max(0, Math.round((endsAtMs - Date.now()) / 1000));
      const el = document.getElementById('live-time-left');
      if (el) {
        el.style.display = 'inline-block';
        el.textContent = `⏱️ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        el.style.background = left <= 120 ? 'rgba(255, 51, 75, 0.8)' : 'rgba(0,0,0,0.55)';
      }
      if (isBroadcaster) {
        for (const at of [120, 30]) {
          if (left <= at && left > 0 && !warned.has(at)) {
            warned.add(at);
            showToast(at === 120 ? '⏱️ Sändningen stoppas automatiskt om 2 minuter' : '⏱️ Sändningen stoppas om 30 sekunder', 'warning');
          }
        }
      }
      // The server stops the stream at the max time; this is the fallback if that message is missed
      if (Date.now() > endsAtMs + 10000) {
        showToast('Sändningen stoppades automatiskt efter 15 minuter.', 'info');
        closeLiveStream();
      }
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function handleIncomingLiveCommentOrReaction(data) {
    if (!data) return;
    if (data.type === 'live_comment_received') {
      if (data.userName !== (user?.nickname || 'Jag')) {
        addCommentToStream(data);
      }
    } else if (data.type === 'live_reaction_received') {
      spawnFloatingEmoji(data.emoji);
    }
  }

  // Start LiveKit Cloud Session
  let broadcasterConnected = false;
  if (isBroadcaster) {
    if (url && token) {
      startBroadcasterSession({
        livekitUrl: url,
        token,
        videoElement: videoEl,
        onViewerCountChange: (count) => {
          viewerCount = count;
          const countEl = document.getElementById('live-viewer-count');
          if (countEl) countEl.innerHTML = `👁️ ${viewerCount} tittare`;
        },
        onDataReceived: (data) => {
          handleIncomingLiveCommentOrReaction(data);
        },
        onStatusChange: (status) => {
          // LiveKit gave up reconnecting (or the room was closed): stop instead of streaming to no one
          if (status === 'disconnected' && broadcasterConnected && streamActive && activeLiveId === liveId) {
            showToast('Anslutningen till sändningen bröts. Sändningen avslutades.', 'info');
            closeLiveStream();
          }
        }
      }).then(() => {
        broadcasterConnected = true;
        // Broadcaster heartbeat loop only once connected
        if (liveId) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            fetch(`/api/flashlive/${liveId}/heartbeat`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-user-token': localStorage.getItem('whooply_token') || ''
              }
            }).then(res => {
              // The server no longer knows this stream (ended, or the server restarted): stop the camera
              if (res.status === 404 && streamActive && activeLiveId === liveId) {
                showToast('Sändningen har avslutats.', 'info');
                closeLiveStream();
              }
            }).catch(() => {});
          }, 12000);
        }
      }).catch(err => {
        console.error('LiveKit broadcaster error:', err);
        showToast('Kunde inte koppla upp LiveKit SFU: ' + err.message + '. Sändningen avbröts.', 'error');
        if (liveId) {
          stopFlashLive(liveId).catch(() => {});
        }
        closeLiveStream();
      });
    } else {
      showToast(serverError || 'LiveKit Cloud är inte konfigurerat. Sändningen avbröts.', 'error');
      if (liveId) {
        stopFlashLive(liveId).catch(() => {});
      }
      closeLiveStream();
      return;
    }
  } else {
    // Viewer
    let viewerConnected = false;
    if (url && token) {
      startViewerSession({
        livekitUrl: url,
        token,
        videoElement: videoEl,
        onStatusChange: (status) => {
          if (status === 'connected') {
            viewerConnected = true;
            const ph = document.getElementById('livestream-placeholder');
            if (ph) ph.style.display = 'none';
          } else if (status === 'disconnected' && viewerConnected && streamActive && activeLiveId === liveId) {
            // The room was closed (stream ended) or the connection is gone for good
            showToast('Sändningen har avslutats.', 'info');
            closeLiveStream();
          }
        },
        onViewerCountChange: (count) => {
          viewerCount = count;
          const countEl = document.getElementById('live-viewer-count');
          if (countEl) countEl.innerHTML = `👁️ ${viewerCount} tittare`;
        },
        onAutoplayBlocked: () => {
          const audioBtn = document.getElementById('btn-toggle-viewer-audio');
          if (audioBtn) {
            audioBtn.innerHTML = '🔇';
            audioBtn.style.background = 'rgba(255, 51, 75, 0.7)';
          }
          showToast('Ljudet tystades av webbläsaren. Klicka på 🔇 för att slå på ljud!', 'info');
        },
        onDataReceived: (data) => {
          handleIncomingLiveCommentOrReaction(data);
        }
      }).catch(err => {
        console.error('LiveKit viewer error:', err);
        showToast('Kunde inte ansluta till videoströmmen: ' + err.message, 'error');
      });
    } else if (serverError) {
      showToast(serverError, 'error');
    }
  }

  // Camera switch listener
  document.getElementById('btn-switch-camera')?.addEventListener('click', async () => {
    const res = await switchCamera(videoEl);
    if (res.ok) {
      showToast('Bytte kamera! 🔄', 'info');
    } else {
      showToast('Kunde inte byta kamera: ' + res.error, 'error');
    }
  });

  // Mic toggle listener
  const micBtn = document.getElementById('btn-toggle-mic');
  micBtn?.addEventListener('click', async () => {
    const active = await toggleAudio();
    micBtn.innerHTML = active ? '🎙️' : '🔇';
    micBtn.style.background = active ? 'rgba(0,0,0,0.5)' : 'rgba(255, 51, 75, 0.6)';
    showToast(active ? 'Mikrofon på 🎙️' : 'Mikrofon avstängd 🔇', 'info');
  });

  // Viewer audio toggle listener
  const viewerAudioBtn = document.getElementById('btn-toggle-viewer-audio');
  viewerAudioBtn?.addEventListener('click', () => {
    const active = toggleViewerAudio();
    viewerAudioBtn.innerHTML = active ? '🔊' : '🔇';
    viewerAudioBtn.style.background = active ? 'rgba(0,0,0,0.5)' : 'rgba(255, 51, 75, 0.7)';
    showToast(active ? 'Ljud på 🔊' : 'Ljud av 🔇', 'info');
  });

  // Toggle Clean Camera View / Overlays listener
  const overlayToggleBtn = document.getElementById('btn-toggle-overlay');
  const bottomOverlay = document.getElementById('livestream-bottom-overlay');
  let overlayVisible = true;
  overlayToggleBtn?.addEventListener('click', () => {
    overlayVisible = !overlayVisible;
    if (bottomOverlay) {
      bottomOverlay.style.opacity = overlayVisible ? '1' : '0';
      bottomOverlay.style.pointerEvents = overlayVisible ? 'auto' : 'none';
      bottomOverlay.style.transform = overlayVisible ? 'translateY(0)' : 'translateY(20px)';
    }
    overlayToggleBtn.style.background = overlayVisible ? 'rgba(0,0,0,0.5)' : 'rgba(245, 166, 35, 0.7)';
    showToast(overlayVisible ? 'Kontroller visas' : 'Ren kameravy 🎥 (tryck 👁️ för kontroller)', 'info');
  });

  // Close / Exit listener
  const handleExitRequest = () => {
    if (isBroadcaster) {
      showStopBroadcastConfirmation();
    } else {
      closeLiveStream();
    }
  };

  document.getElementById('btn-close-livestream')?.addEventListener('click', handleExitRequest);
  document.getElementById('btn-bottom-stop-live')?.addEventListener('click', handleExitRequest);

  // Join live stream WS room if standalone
  if (liveId) {
    setActiveLiveRoom(liveId);
  }

  // Chat form submit
  const chatForm = document.getElementById('live-chat-form');
  const chatInput = document.getElementById('live-chat-input');

  chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    const myNick = user?.nickname || 'Jag';
    const myAvatar = user?.avatarEmoji || '🏌️‍♂️';

    // Broadcast over WebSocket
    sendWebSocketMessage({
      type: 'live_comment',
      tournamentCode,
      liveId,
      text,
      userName: myNick,
      userAvatar: myAvatar
    });

    // Render immediately locally as well
    addCommentToStream({
      userName: myNick,
      userAvatar: myAvatar,
      text
    });

    chatInput.value = '';
    chatInput.blur(); // dismiss mobile keyboard to see video
  });

  // Reactions flying emojis (and broadcast)
  document.querySelectorAll('.live-reaction-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const emoji = e.currentTarget.dataset.emoji;
      spawnFloatingEmoji(emoji);
      sendWebSocketMessage({
        type: 'live_reaction',
        tournamentCode,
        liveId,
        emoji
      });
    });
  });

  // Listen to incoming WebSocket live comments, reactions, status & WebRTC
  wsUnsub = onWebSocketMessage(async (msg) => {
    const isMatching = (tournamentCode && msg.tournamentCode === tournamentCode) || (liveId && msg.liveId === liveId);
    if (msg.type === 'live_comment_received' && isMatching) {
      // If message is from someone else, render it
      if (msg.userName !== (user?.nickname || 'Jag')) {
        addCommentToStream(msg);
      }
    } else if (msg.type === 'live_reaction_received' && isMatching) {
      spawnFloatingEmoji(msg.emoji);
    } else if (msg.type === 'live_viewer_count' && msg.liveId === liveId) {
      viewerCount = msg.viewerCount || 1;
      const countEl = document.getElementById('live-viewer-count');
      if (countEl) countEl.innerHTML = `👁️ ${viewerCount} tittare`;
    } else if (msg.type === 'flashlive_stopped' && msg.liveId === liveId) {
      const reasonNotice = msg.reason === 'max_duration'
        ? 'Sändningen stoppades automatiskt efter 15 minuter.'
        : msg.reason === 'no_viewers'
          ? 'Sändningen stoppades – ingen tittade på 3 minuter.'
          : msg.reason === 'heartbeat_timeout'
            ? 'Sändningen bröts – sändaren tappade anslutningen.'
            : 'Sändningen avslutades av sändaren.';
      const stopNotice = msg.pendingBetId && !isBroadcaster
        ? `${reasonNotice} Vadet rättas efteråt – du får en notis.`
        : reasonNotice;
      showToast(stopNotice, 'info');
      closeLiveStream();
    } else if (msg.type === 'flashlive_idle_warning' && msg.liveId === liveId && isBroadcaster) {
      showToast(`👀 Ingen tittar just nu – sändningen stoppas om ${Math.max(1, Math.round((msg.secondsLeft || 60) / 60))} min om ingen ansluter.`, 'warning');
    } else if (msg.type === 'flashlive_bet_started' && msg.liveId === liveId) {
      showToast(`⚡ Nytt BlixtBet startat: "${msg.flashBet?.question || ''}"!`, 'success');
      renderLiveBlixtBetWidget(tournamentId, msg.flashBet?.id, tournamentCode, liveId, isBroadcaster, msg.flashBet);
    } else if ((msg.type === 'flashlive_settled' && msg.liveId === liveId) ||
               (msg.type === 'flash_bet_settled' && msg.flashBet && (msg.flashBet.id === flashBetId || (tournamentId && (msg.flashBet.tournamentId || msg.flashBet.tournament_id) === tournamentId)))) {
      const winningChoice = msg.winningChoice || msg.flashBet?.winningChoice;
      showToast(`🏁 Live-vadet avgjort! ${winningChoice === 'yes' ? '👍 JA' : '👎 NEJ'} vann!`, 'success');
      launchConfetti();
      // Fetch personalized user entry so user sees their own outcome and Swish debts
      let personalizedBet = msg.flashBet;
      const targetBetId = flashBetId || msg.flashBet?.id;
      if (targetBetId) {
        try {
          personalizedBet = await getFlashBet(targetBetId);
        } catch (e) {
          personalizedBet = msg.flashBet;
        }
      }
      renderLiveBlixtBetWidget(tournamentId, targetBetId, tournamentCode, liveId, isBroadcaster, personalizedBet);
    } else if (msg.type === 'flash_bet_deleted' && (msg.flashBetId === (currentLiveBetId || flashBetId) || (tournamentId && msg.tournamentId === tournamentId))) {
      if (!isBroadcaster) showToast('BlixtBet togs bort – ditt bet räknas inte.', 'info');
      renderLiveBlixtBetWidget(null, null, tournamentCode, liveId, isBroadcaster, null);
    }
  });

  // Load and render BlixtBet inside overlay (or pure stream mode)
  if (hasBet || flashBetId || tournamentId) {
    await renderLiveBlixtBetWidget(tournamentId, flashBetId, tournamentCode, liveId, isBroadcaster, initialFlashBet);
  } else {
    const betContainer = document.getElementById('live-blixtbet-container');
    if (betContainer) {
      if (isBroadcaster) {
        betContainer.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.3rem;">📹</span>
              <div>
                <div style="font-weight: 700; font-size: 0.85rem; color: #fff;">Livesändning igång!</div>
                <div style="font-size: 0.72rem; color: var(--text-secondary);">Ren video & chatt (inget aktivt bet)</div>
              </div>
            </div>
            <button type="button" id="btn-trigger-new-flashbet" class="btn btn-sm btn-accent" style="font-size: 0.75rem; padding: 4px 10px; font-weight: 800;">
              ⚡ Starta BlixtBet
            </button>
          </div>
        `;
        document.getElementById('btn-trigger-new-flashbet')?.addEventListener('click', () => {
          betContainer.innerHTML = `
            <div>
              <div style="font-weight: 700; font-size: 0.85rem; color: var(--gold); margin-bottom: 6px;">⚡ Starta live BlixtBet</div>
              <input type="text" id="live-fb-title" class="form-input mb-xs" placeholder="t.ex. Sätter Johan putten?" style="font-size: 0.85rem;" />
              <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button type="button" id="live-fb-submit" class="btn btn-sm btn-primary" style="flex: 1; font-weight: 800;">Starta röstning (60s) ⏱️</button>
                <button type="button" id="live-fb-cancel" class="btn btn-sm btn-secondary" style="font-size: 0.75rem;">Avbryt</button>
              </div>
            </div>
          `;
          document.getElementById('live-fb-cancel')?.addEventListener('click', () => {
            betContainer.style.display = 'none';
          });
          document.getElementById('live-fb-submit')?.addEventListener('click', async () => {
            const title = document.getElementById('live-fb-title')?.value.trim() || 'Sätter han putten?';
            try {
              if (liveId) {
                const res = await attachFlashLiveBet(liveId, {
                  question: title,
                  stakeAmount: 20,
                  durationSeconds: 60
                });
                showToast(`⚡ BlixtBet startat: "${title}"`, 'success');
                renderLiveBlixtBetWidget(tournamentId, res.flashBet?.id, tournamentCode, liveId, isBroadcaster, res.flashBet);
              }
            } catch (err) {
              showToast('Kunde inte starta vad: ' + err.message, 'error');
            }
          });
        });
      } else {
        betContainer.style.display = 'none';
      }
    }
  }

}

export function showStopBroadcastConfirmation() {
  const existing = document.getElementById('live-confirm-stop-modal');
  if (existing) return;

  const fullscreenContainer = document.getElementById('livestream-fullscreen');
  if (!fullscreenContainer) {
    closeLiveStream();
    return;
  }

  const modalEl = document.createElement('div');
  modalEl.id = 'live-confirm-stop-modal';
  modalEl.style.cssText = `
    position: absolute;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  `;

  modalEl.innerHTML = `
    <div style="
      background: #181d28;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 18px;
      max-width: 320px;
      width: 100%;
      padding: 22px 20px;
      text-align: center;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
      font-family: inherit;
    ">
      <div style="font-size: 2.2rem; margin-bottom: 8px;">⏹️</div>
      <div style="font-size: 1.1rem; font-weight: 800; color: #fff; margin-bottom: 8px;">
        Avsluta livesändningen?
      </div>
      <div style="font-size: 0.82rem; color: rgba(255, 255, 255, 0.75); line-height: 1.4; margin-bottom: 20px;">
        Sändningen stoppas för alla tittare och kameran stängs av omedelbart.
        Ett vad som inte är rättat ligger kvar under ⚡ BlixtBet – där kan du rätta eller ta bort det efteråt.
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-confirm-stop-live" style="
          background: linear-gradient(135deg, #ff334b, #d90429);
          border: none;
          color: #fff;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 0.9rem;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(255, 51, 75, 0.4);
        ">
          Ja, avsluta sändning
        </button>
        <button type="button" id="btn-cancel-stop-live" style="
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #fff;
          padding: 10px 16px;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
        ">
          Fortsätt sända 🎥
        </button>
      </div>
    </div>
  `;

  fullscreenContainer.appendChild(modalEl);

  document.getElementById('btn-cancel-stop-live')?.addEventListener('click', () => {
    modalEl.remove();
  });

  document.getElementById('btn-confirm-stop-live')?.addEventListener('click', () => {
    modalEl.innerHTML = `
      <div style="background: #181d28; border-radius: 18px; padding: 24px; text-align: center; color: #fff;">
        <div style="font-size: 1.5rem; margin-bottom: 8px;">⏳</div>
        <div style="font-weight: 700; font-size: 0.9rem;">Avslutar sändning...</div>
      </div>
    `;
    showToast('Livesändningen har avslutats', 'success');
    closeLiveStream();
  });
}

export function closeLiveStream() {
  if (isClosingLiveStream) return;
  isClosingLiveStream = true;
  try {
    streamActive = false;
    const liveIdToStop = activeLiveId;
    const wasHost = currentIsBroadcaster;
    const pendingBetId = wasHost && currentLiveBetId && !currentLiveBetSettled ? currentLiveBetId : null;
    currentIsBroadcaster = false;
    currentLiveBetId = null;
    currentLiveBetSettled = false;

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    clearActiveLiveRoom();
    activeLiveId = null;
    if (wsUnsub) {
      wsUnsub();
      wsUnsub = null;
    }
    stopAllStreams();

    if (liveIdToStop && wasHost) {
      const stopPromise = stopFlashLive(liveIdToStop);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
      Promise.race([stopPromise, timeoutPromise]).catch(err => {
        console.warn('stopFlashLive background call error:', err);
      });
    }

    const modalConfirm = document.getElementById('live-confirm-stop-modal');
    if (modalConfirm) modalConfirm.remove();
    const fs = document.getElementById('livestream-fullscreen');
    if (fs) fs.remove();
    closeModal();

    // The bet outlives the stream: take the host straight to it so it can be settled or removed
    if (pendingBetId) {
      setTimeout(() => {
        import('./minigames.js').then(({ openFlashBetModal }) => {
          showToast('Vadet ligger kvar – rätta det eller ta bort det här.', 'info');
          openFlashBetModal(pendingBetId);
        }).catch(() => {});
      }, 300);
    }
  } finally {
    isClosingLiveStream = false;
  }
}

async function renderLiveBlixtBetWidget(tournamentId, specificFlashBetId = null, tournamentCode = null, liveId = null, isBroadcaster = true, initialFlashBet = null) {
  const container = document.getElementById('live-blixtbet-container');
  if (!container) return;

  try {
    let currentBet = initialFlashBet;
    if (!currentBet && specificFlashBetId) {
      currentBet = await getFlashBet(specificFlashBetId).catch(() => null);
    }
    if (!currentBet && tournamentId) {
      const activeBets = await getActiveFlashBets(tournamentId).catch(() => []);
      const matching = (activeBets || []).filter(b => (b.tournamentId || b.tournament_id) === tournamentId);
      if (matching.length > 0) currentBet = matching[0];
    }

    if (!currentBet) {
      currentLiveBetId = null;
      currentLiveBetSettled = false;
      container.style.display = '';
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.3rem;">⚡</span>
            <div>
              <div style="font-weight: 700; font-size: 0.85rem; color: #fff;">Inget aktivt BlixtBet just nu</div>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">Redo när nästa slag startar!</div>
            </div>
          </div>
          ${isBroadcaster ? `
            <button type="button" id="btn-trigger-new-flashbet" class="btn btn-sm btn-accent" style="font-size: 0.75rem; padding: 4px 10px; font-weight: 800;">
              + Skapa bet
            </button>
          ` : ''}
        </div>
      `;

      if (isBroadcaster) {
        document.getElementById('btn-trigger-new-flashbet')?.addEventListener('click', () => {
          container.innerHTML = `
            <div>
              <div style="font-weight: 700; font-size: 0.85rem; color: var(--gold); margin-bottom: 6px;">⚡ Starta live BlixtBet</div>
              <input type="text" id="live-fb-title" class="form-input mb-xs" placeholder="t.ex. Träffar Johan greenen?" style="font-size: 0.85rem;" />
              <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button type="button" id="live-fb-submit" class="btn btn-sm btn-primary" style="flex: 1; font-weight: 800;">Starta röstning (60s) ⏱️</button>
                <button type="button" id="live-fb-cancel" class="btn btn-sm btn-secondary" style="font-size: 0.75rem;">Avbryt</button>
              </div>
            </div>
          `;
          document.getElementById('live-fb-cancel')?.addEventListener('click', () => {
            renderLiveBlixtBetWidget(tournamentId, specificFlashBetId, tournamentCode, liveId, isBroadcaster);
          });
          document.getElementById('live-fb-submit')?.addEventListener('click', async () => {
            const title = document.getElementById('live-fb-title')?.value.trim() || 'Träffar bollen green på hål 7?';
            try {
              if (liveId) {
                const res = await attachFlashLiveBet(liveId, {
                  question: title,
                  stakeAmount: 20,
                  durationSeconds: 60
                });
                showToast(`⚡ BlixtBet startat: "${title}"`, 'success');
                renderLiveBlixtBetWidget(tournamentId, res.flashBet?.id, tournamentCode, liveId, isBroadcaster, res.flashBet);
              }
            } catch (err) {
              showToast('Kunde inte starta vad: ' + err.message, 'error');
            }
          });
        });
      }
      return;
    }

    renderMockActiveBlixtBet({
      title: currentBet.question || currentBet.title,
      options: currentBet.options || ['Ja', 'Nej'],
      betId: currentBet.id,
      tournamentCode,
      liveId,
      isBroadcaster,
      stakeAmount: currentBet.stakeAmount || 20,
      expiresAt: currentBet.expiresAt,
      status: currentBet.status,
      winnerChoice: currentBet.winningChoice || currentBet.winnerChoice,
      flashBetObj: currentBet
    });
  } catch (err) {
    container.innerHTML = `<div style="font-size: 0.75rem; color: #ff5555;">Kunde inte läsa in BlixtBet: ${escapeHtml(err.message)}</div>`;
  }
}

function renderMockActiveBlixtBet({
  title,
  options = ['Ja', 'Nej'],
  betId = 'demo',
  tournamentCode = null,
  liveId = null,
  isBroadcaster = false,
  stakeAmount = 20,
  expiresAt = null,
  status = 'active',
  winnerChoice = null,
  flashBetObj = null
}) {
  const container = document.getElementById('live-blixtbet-container');
  if (!container) return;

  const user = getStoredUser();
  currentLiveBetId = betId && betId !== 'demo' ? betId : null;
  currentLiveBetSettled = status === 'settled' || Boolean(winnerChoice) || status === 'cancelled';

  // If already settled, show results & Swish settlements
  if (status === 'settled' || winnerChoice) {
    const myChoice = flashBetObj?.myEntry?.choice || flashBetObj?.myChoice;
    const isWinner = myChoice && myChoice === winnerChoice;
    const isLoser = myChoice && myChoice !== winnerChoice;
    const debts = flashBetObj?.settlementSummary?.debts || [];

    container.innerHTML = `
      <div style="text-align: center; padding: 4px 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span class="badge ${winnerChoice === 'yes' ? 'badge-success' : 'badge-danger'}" style="font-size: 0.72rem; font-weight: 800; padding: 2px 8px;">
            🏁 RESULTAT: ${winnerChoice === 'yes' ? '👍 JA' : '👎 NEJ'}
          </span>
          <span style="font-size: 0.75rem; color: var(--gold); font-weight: 700;">Avgjort!</span>
        </div>
        <div style="font-size: 0.9rem; font-weight: 800; color: #fff; margin-bottom: 8px;">
          ${escapeHtml(title)}
        </div>
        ${!isBroadcaster && isLoser ? `
          <div style="background: rgba(231, 76, 60, 0.2); border: 1px solid #e74c3c; border-radius: 8px; padding: 8px; margin-top: 6px;">
            <div style="font-size: 0.8rem; color: #fff; margin-bottom: 6px;">
              Du röstade fel (${escapeHtml(myChoice ? myChoice.toUpperCase() : 'NEJ')}). Swisha din insats till vinnarna:
            </div>
            ${debts.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${debts.map(d => `
                  <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 6px;">
                    <span style="font-size: 0.8rem; color: #fff;">
                      ${escapeHtml(d.winnerAvatar || '🏆')} <strong>${escapeHtml(d.winnerName)}</strong>: ${formatCurrency(d.amount)}
                    </span>
                    ${d.winnerSwish ? `
                      <a href="${createSwishUrl({ phone: d.winnerSwish, amount: d.amount, message: 'Whooply Live - ' + title })}" target="_blank" class="btn btn-xs btn-primary" style="font-weight: 800; padding: 3px 8px; font-size: 0.75rem;">
                        📱 Swisha
                      </a>
                    ` : `
                      <span style="font-size: 0.72rem; color: var(--text-secondary);">Saknar Swish</span>
                    `}
                  </div>
                `).join('')}
              </div>
            ` : `
              <a href="${createSwishUrl({ amount: stakeAmount, message: 'Whooply Live - ' + title })}" target="_blank" class="btn btn-sm btn-primary" style="font-weight: 800; display: inline-flex; align-items: center; gap: 4px;">
                📱 Swisha ${stakeAmount} kr
              </a>
            `}
          </div>
        ` : `
          <div style="font-size: 0.82rem; color: #2ecc71; font-weight: 700;">
            ${isBroadcaster
              ? '✅ Vadet är avgjort och registrerat på deltagarnas saldon!'
              : (isWinner ? '🎉 Du vann! Snyggt gissat!' : (myChoice ? 'Tack för rösten!' : 'Vadet är avgjort!'))}
          </div>
        `}
        ${isBroadcaster && liveId ? `
          <button type="button" id="btn-live-next-bet" class="btn btn-sm btn-accent" style="margin-top: 8px; font-size: 0.75rem; padding: 4px 10px; font-weight: 800;">
            ⚡ Nytt BlixtBet
          </button>
        ` : ''}
      </div>
    `;
    document.getElementById('btn-live-next-bet')?.addEventListener('click', () => {
      renderLiveBlixtBetWidget(null, null, tournamentCode, liveId, true, null);
    });
    return;
  }

  // Calculate remaining seconds
  let remainingSecs = 60;
  if (expiresAt) {
    remainingSecs = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }

  container.innerHTML = `
    <div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span class="badge badge-accent" style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px;">⚡ BLIXTBET LIVE</span>
        <span id="live-countdown-timer" style="font-size: 0.75rem; color: var(--gold); font-weight: 800;">⏱️ ${remainingSecs}s kvar</span>
      </div>

      <div style="font-size: 0.95rem; font-weight: 800; color: #fff; margin-bottom: 10px; line-height: 1.25;">
        ${escapeHtml(title)} <span style="font-size: 0.75rem; color: var(--gold); font-weight: 600;">(${stakeAmount} kr)</span>
      </div>

      <!-- Voting options (only for viewers; broadcaster cannot bet in own stream) -->
      ${!isBroadcaster ? `
        <div id="live-bet-action-grid" style="display: grid; grid-template-columns: repeat(${options.length}, 1fr); gap: 8px;">
          ${options.map((opt, idx) => `
            <button type="button" class="btn live-bet-option-btn" data-opt="${escapeHtml(opt)}" style="
              background: ${idx === 0 ? 'linear-gradient(135deg, #2ecc71, #27ae60)' : 'linear-gradient(135deg, #e74c3c, #c0392b)'};
              color: #fff;
              border: none;
              font-weight: 800;
              font-size: 0.88rem;
              padding: 9px;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              cursor: pointer;
              transition: transform 0.1s;
            ">
              ${idx === 0 ? '👍 ' : '👎 '}${escapeHtml(opt)}
            </button>
          `).join('')}
        </div>
      ` : `
        <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7); text-align: center; padding: 4px 0;">
          🏌️‍♂️ Du sänder detta vad. Vännerna röstar!
        </div>
      `}

      <!-- Broadcaster direct settlement control -->
      ${isBroadcaster ? `
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.72rem; color: rgba(255,255,255,0.7); font-weight: 700;">Slaget klart? Rätta nu:</span>
          <div style="display: flex; gap: 6px;">
            <button type="button" id="btn-settle-yes" class="btn btn-sm btn-success" style="font-size: 0.75rem; padding: 3px 8px; font-weight: 800;">
              ✅ Rätta JA
            </button>
            <button type="button" id="btn-settle-no" class="btn btn-sm btn-danger" style="font-size: 0.75rem; padding: 3px 8px; font-weight: 800;">
              ❌ Rätta NEJ
            </button>
          </div>
        </div>
        ${betId && betId !== 'demo' ? `
          <button type="button" id="btn-live-delete-bet" style="margin-top: 6px; width: 100%; background: transparent; border: 1px dashed rgba(231,76,60,0.5); color: #ff8a80; font-size: 0.72rem; font-weight: 700; padding: 4px; border-radius: 6px; cursor: pointer;">
            🗑️ Ta bort vadet (går om högst 1 har lagt bet)
          </button>
        ` : ''}
      ` : ''}
    </div>
  `;

  // Countdown timer interval (dynamically calculated against absolute expiresAt)
  const updateCountdown = () => {
    const timerEl = document.getElementById('live-countdown-timer');
    if (!timerEl) {
      clearInterval(timerInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      return;
    }
    const now = Date.now();
    const end = expiresAt ? new Date(expiresAt).getTime() : (now + remainingSecs * 1000);
    const diff = Math.max(0, Math.ceil((end - now) / 1000));
    remainingSecs = diff;

    if (diff > 0) {
      timerEl.textContent = `⏱️ ${diff}s kvar`;
    } else {
      timerEl.textContent = '⏱️ Spelstopp!';
      timerEl.style.color = '#e74c3c';
      // Disable voting buttons immediately upon timeout
      document.querySelectorAll('.live-bet-option-btn').forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
      });
      clearInterval(timerInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    }
  };

  const handleVisibility = () => {
    if (!document.hidden) updateCountdown();
  };
  document.addEventListener('visibilitychange', handleVisibility);
  const timerInterval = setInterval(updateCountdown, 1000);

  // Settle buttons for broadcaster
  if (isBroadcaster) {
    const handleSettle = async (choice) => {
      try {
        let res = null;
        if (liveId) {
          res = await settleFlashLive(liveId, choice);
        } else if (betId && betId !== 'demo') {
          res = await settleFlashBet(betId, choice);
        }
        showToast(`🏁 Vadet rättades som ${choice.toUpperCase()}!`, 'success');
        launchConfetti();
        renderMockActiveBlixtBet({
          title,
          options,
          betId,
          tournamentCode,
          liveId,
          isBroadcaster,
          stakeAmount,
          status: 'settled',
          winnerChoice: choice,
          flashBetObj: res?.flashBet || flashBetObj
        });
      } catch (err) {
        showToast('Kunde inte rätta vadet: ' + err.message, 'error');
      }
    };

    document.getElementById('btn-settle-yes')?.addEventListener('click', () => handleSettle('yes'));
    document.getElementById('btn-settle-no')?.addEventListener('click', () => handleSettle('no'));

    // Too few bets: remove it and start a new one more friends can join
    document.getElementById('btn-live-delete-bet')?.addEventListener('click', async () => {
      if (!confirm('Ta bort vadet? Det går bara om högst en vän har lagt bet. Den som har lagt bet får en notis om att det inte räknas.')) return;
      try {
        await deleteFlashBet(betId);
        showToast('🗑️ Vadet är borttaget. Starta ett nytt när du vill!', 'info');
        renderLiveBlixtBetWidget(null, null, tournamentCode, liveId, true, null);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Voting option buttons
  container.querySelectorAll('.live-bet-option-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (remainingSecs <= 0) {
        showToast('Spelstopp har redan inträffat!', 'warning');
        return;
      }

      const chosen = btn.dataset.opt;
      const choiceValue = chosen.toLowerCase().includes('ja') || chosen.toLowerCase().includes('yes') ? 'yes' : 'no';
      const myNick = user?.nickname || 'Jag';

      // Call API if real betId
      if (betId && betId !== 'demo') {
        try {
          await placeFlashBet(betId, choiceValue);
        } catch (err) {
          showToast(err.message, 'error');
          return; // Crucial fix: return on error, do NOT confirm bet!
        }
      } else {
        showToast('Inget aktivt vad på servern', 'error');
        return;
      }

      launchConfetti();
      showToast(`🎯 Du röstade "${chosen}" på BlixtBet!`, 'success');

      // Broadcast golden notice into live chat stream
      const betNoticeText = `satsade på "${chosen}" 🎯`;
      sendWebSocketMessage({
        type: 'live_comment',
        tournamentCode,
        liveId,
        text: betNoticeText,
        userName: myNick,
        userAvatar: '⚡',
        isBetNotice: true
      });

      addCommentToStream({
        userName: myNick,
        userAvatar: '⚡',
        text: betNoticeText,
        isBetNotice: true
      });

      const grid = document.getElementById('live-bet-action-grid');
      if (grid) {
        grid.innerHTML = `
          <div style="grid-column: span ${options.length}; text-align: center; padding: 6px 0; background: rgba(46, 204, 113, 0.15); border-radius: 8px; border: 1px solid #2ecc71;">
            <div style="font-weight: 800; color: #2ecc71; font-size: 0.9rem;">✅ Röst mottagen: ${escapeHtml(chosen)}</div>
            <div style="font-size: 0.75rem; color: rgba(255,255,255,0.7); margin-top: 2px;">Följ slaget i videon nu! 🏌️‍♂️</div>
          </div>
        `;
      }
    });
  });
}

// ── Instant Live Modal (Start sändning & BlixtBet på 2 klick) ────
export async function openInstantLiveModal() {
  const user = getStoredUser();
  if (!user) {
    showToast('Logga in för att sända live med dina kompisar!', 'warning');
    return;
  }

  let friends = [];
  try {
    friends = await getFriends();
  } catch {}

  const questionPresets = [
    '⛳ Sätter han putten?',
    '🏌️ Träffar green på utslaget?',
    '🎯 Håller han nerverna?',
    '🌊 Hamnar bollen i vattnet?'
  ];

  let selectedQuestion = questionPresets[0];
  let isAllFriends = true;
  let selectedFriendIds = new Set(friends.map(f => f.id));
  let currentStake = 20;
  let currentDuration = 60; // 30, 60, 90, 120
  let includeBet = true;

  function renderModal() {
    showModal(`<span style="margin-right: 6px;">🔴</span>${t('arcade.flashliveTitle')}`, `
      <div style="padding: 4px 0;">
        <p class="game-modal-subheading">${t('arcade.flashliveDesc')}</p>
        <!-- Live Mode Switcher (Med BlixtBet / Endast Video) -->
        <div style="display: flex; gap: 8px; background: rgba(255,255,255,0.06); padding: 4px; border-radius: 10px; margin-bottom: 14px;">
          <button type="button" id="btn-mode-bet" class="btn btn-sm ${includeBet ? 'btn-primary' : 'btn-secondary'}" style="flex: 1; font-weight: 800; font-size: 0.82rem;">
            ⚡ Med BlixtBet
          </button>
          <button type="button" id="btn-mode-pure" class="btn btn-sm ${!includeBet ? 'btn-primary' : 'btn-secondary'}" style="flex: 1; font-weight: 800; font-size: 0.82rem;">
            📹 Bara Video (Inget bet)
          </button>
        </div>

        ${includeBet ? `
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 12px;">
            Sänd slaget live! Vännerna får blixtnotis i mobilen och har angiven tid på sig att rösta JA/NEJ innan spelstopp.
          </p>

          <!-- Question Presets & Input -->
          <label class="form-label" style="font-weight: 700;">1. Vad ska kompisarna betta om?</label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
            ${questionPresets.map((q, i) => `
              <button type="button" class="btn btn-sm ${selectedQuestion === q ? 'btn-primary' : 'btn-secondary'} preset-q-btn" data-q="${escapeHtml(q)}" style="font-size: 0.78rem; text-align: left; padding: 6px 8px; font-weight: 700; white-space: normal; line-height: 1.2;">
                ${escapeHtml(q)}
              </button>
            `).join('')}
          </div>

          <input type="text" id="custom-live-question" class="form-input mb-md" placeholder="Eller skriv egen fråga..." value="${questionPresets.includes(selectedQuestion) ? '' : escapeHtml(selectedQuestion)}" style="font-size: 0.85rem;" />

          <!-- Duration Selector -->
          <div class="flex-between mb-sm" style="align-items: center; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">⏱️ Tid för röstning:</div>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">Spelstopp inträffar därefter</div>
            </div>
            <div style="display: flex; gap: 4px;">
              ${[
                { sec: 30, label: '30s' },
                { sec: 60, label: '60s' },
                { sec: 90, label: '90s' },
                { sec: 120, label: '2 min' }
              ].map(d => `
                <button type="button" class="btn btn-sm ${currentDuration === d.sec ? 'btn-accent' : 'btn-secondary'} duration-btn" data-sec="${d.sec}" style="padding: 4px 7px; font-size: 0.78rem; font-weight: 800;">
                  ${d.label}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Stake Selector -->
          <div class="flex-between mb-md" style="align-items: center; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">💰 Insats per person:</div>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">Swishas direkt vid rättning</div>
            </div>
            <div style="display: flex; gap: 4px;">
              ${[10, 20, 50, 100].map(s => `
                <button type="button" class="btn btn-sm ${currentStake === s ? 'btn-accent' : 'btn-secondary'} stake-btn" data-stake="${s}" style="padding: 4px 8px; font-size: 0.8rem; font-weight: 800;">
                  ${s} kr
                </button>
              `).join('')}
            </div>
          </div>
        ` : `
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 12px;">
            Bara visa det spännande 18:e hålet eller avgörandet för polarna! Sändningen är igång så länge du vill, med livechatt och reaktioner, utan några insatser.
          </p>
          <label class="form-label" style="font-weight: 700;">Rubrik för sändningen:</label>
          <input type="text" id="pure-stream-title" class="form-input mb-md" placeholder="t.ex. 18:e hålet – Spännande match!" value="${selectedQuestion && !questionPresets.includes(selectedQuestion) ? escapeHtml(selectedQuestion) : '18:e hålet – Avgörandet! ⛳'}" style="font-size: 0.85rem;" />
        `}

        <!-- Audience Picker -->
        <label class="form-label" style="font-weight: 700; display: flex; justify-content: space-between; align-items: center;">
          <span>${includeBet ? '2.' : '1.'} Vilka ska bjudas in?</span>
          <span style="font-size: 0.75rem; color: var(--gold); font-weight: 600;">${selectedFriendIds.size} vänner valda</span>
        </label>

        <!-- Toggle All Friends -->
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.2rem;">📢</span>
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">Alla mina vänner (${friends.length})</div>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">Skickar push-larm till alla</div>
            </div>
          </div>
          <input type="checkbox" id="toggle-all-friends" ${isAllFriends ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent);" />
        </div>

        <!-- Friends Picker Chips -->
        ${friends.length > 0 ? `
          <div style="max-height: 110px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; padding: 4px 0;">
            ${friends.map(f => {
              const checked = selectedFriendIds.has(f.id);
              return `
                <div class="friend-chip ${checked ? 'active' : ''}" data-friend-id="${f.id}" style="
                  display: inline-flex; align-items: center; gap: 6px;
                  background: ${checked ? 'rgba(245, 166, 35, 0.25)' : 'rgba(255,255,255,0.08)'};
                  border: 1px solid ${checked ? 'var(--gold)' : 'rgba(255,255,255,0.15)'};
                  border-radius: 16px;
                  padding: 4px 10px;
                  font-size: 0.8rem;
                  cursor: pointer;
                  user-select: none;
                ">
                  <span>${escapeHtml(f.avatarEmoji || '🏌️')}</span>
                  <span style="font-weight: 600; color: #fff;">${escapeHtml(f.nickname || f.name)}</span>
                  <span style="font-size: 0.75rem;">${checked ? '✓' : '+'}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 14px;">
            💡 Tips: Lägg till vänner i menyn så kan de få direktnotis i mobilen när du sänder!
          </div>
        `}

        ${!isAllFriends && selectedFriendIds.size === 0 ? `
          <div style="font-size: 0.76rem; color: #ff6b6b; background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 8px; padding: 6px 10px; margin-bottom: 12px; text-align: center; font-weight: 600;">
            ⚠️ Välj minst en vän eller markera "Alla mina vänner"
          </div>
        ` : ''}

        <div style="font-size: 0.74rem; color: var(--text-muted); text-align: center; margin-bottom: 8px;">
          ⏱️ Max 15 min per sändning – den stoppas automatiskt
        </div>

        <!-- Launch Button -->
        <button type="button" id="btn-start-instant-live" class="btn btn-primary btn-block" ${(!isAllFriends && selectedFriendIds.size === 0) ? 'disabled style="opacity: 0.5; cursor: not-allowed; font-weight: 800; font-size: 1rem; padding: 12px;"' : 'style="font-weight: 800; font-size: 1rem; padding: 12px;"'}>
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ff334b; box-shadow: 0 0 8px #ff334b;"></span>
          🔴 ${includeBet ? 'Starta Live & Skicka Blixtnotis' : 'Starta Livesändning'}
        </button>
      </div>
    `);

    // Mode toggles
    document.getElementById('btn-mode-bet')?.addEventListener('click', () => {
      includeBet = true;
      renderModal();
    });
    document.getElementById('btn-mode-pure')?.addEventListener('click', () => {
      includeBet = false;
      renderModal();
    });

    // Question presets
    document.querySelectorAll('.preset-q-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedQuestion = btn.dataset.q;
        const customInput = document.getElementById('custom-live-question');
        if (customInput) customInput.value = '';
        renderModal();
      });
    });

    document.getElementById('custom-live-question')?.addEventListener('input', (e) => {
      if (e.target.value.trim()) {
        selectedQuestion = e.target.value.trim();
        document.querySelectorAll('.preset-q-btn').forEach(b => b.className = 'btn btn-sm btn-secondary preset-q-btn');
      }
    });

    document.getElementById('pure-stream-title')?.addEventListener('input', (e) => {
      if (e.target.value.trim()) {
        selectedQuestion = e.target.value.trim();
      }
    });

    // Duration buttons
    document.querySelectorAll('.duration-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentDuration = Number(btn.dataset.sec);
        renderModal();
      });
    });

    // Stake buttons
    document.querySelectorAll('.stake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentStake = Number(btn.dataset.stake);
        renderModal();
      });
    });

    // Toggle all friends
    document.getElementById('toggle-all-friends')?.addEventListener('change', (e) => {
      isAllFriends = e.target.checked;
      if (isAllFriends) {
        selectedFriendIds = new Set(friends.map(f => f.id));
      } else {
        selectedFriendIds.clear();
      }
      renderModal();
    });

    // Individual friend chip click
    document.querySelectorAll('.friend-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.friendId;
        if (selectedFriendIds.has(id)) {
          selectedFriendIds.delete(id);
          isAllFriends = false;
        } else {
          selectedFriendIds.add(id);
          if (selectedFriendIds.size === friends.length) isAllFriends = true;
        }
        renderModal();
      });
    });

    // Launch button click
    document.getElementById('btn-start-instant-live')?.addEventListener('click', async () => {
      let finalTitle = '';
      if (includeBet) {
        const customQ = document.getElementById('custom-live-question')?.value.trim();
        finalTitle = customQ || selectedQuestion || 'Sätter han putten?';
      } else {
        const pureTitle = document.getElementById('pure-stream-title')?.value.trim();
        finalTitle = pureTitle || '18:e hålet – Avgörandet! ⛳';
      }

      if (!isAllFriends && selectedFriendIds.size === 0) {
        showToast('Välj minst en vän eller markera "Alla mina vänner" för att sända.', 'warning');
        return;
      }

      // Pre-check camera access before creating session and broadcasting notifications
      const startBtn = document.getElementById('btn-start-instant-live');
      const originalBtnText = startBtn ? startBtn.innerHTML : '';
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '⏳ Kontrollerar kamera...';
      }

      const camCheck = await testCameraAccess();
      if (!camCheck.ok) {
        showToast('Kameratillstånd nekades eller kunde inte startas: ' + camCheck.error + '. Sändningen startades inte.', 'error');
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.innerHTML = originalBtnText;
        }
        return;
      }

      try {
        const res = await startFlashLive({
          question: finalTitle,
          streamTitle: finalTitle,
          stakeAmount: includeBet ? currentStake : 0,
          durationSeconds: includeBet ? currentDuration : 0,
          targetFriendIds: Array.from(selectedFriendIds),
          notifyAllFriends: isAllFriends,
          streamWithoutBet: !includeBet
        });

        showToast('🔴 Livesändning startad! Notis skickad till polarna.', 'success');

        // Open live streaming UI
        await openLiveStreamModal({
          isBroadcaster: true,
          isStandalone: true,
          liveId: res.live?.id,
          flashBetId: res.flashBet?.id,
          hasBet: includeBet,
          tournamentName: `${finalTitle} ⚡`,
          initialQuestion: finalTitle,
          initialFlashBet: res.flashBet,
          livekitToken: res.livekitToken,
          livekitUrl: res.livekitUrl,
          livekitError: res.livekitError,
          endsAt: res.live?.endsAt
        });
      } catch (err) {
        showToast('Kunde inte starta livesändning: ' + err.message, 'error');
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.innerHTML = originalBtnText;
        }
      }
    });
  }

  renderModal();
}

function spawnFloatingEmoji(emoji) {
  const container = document.getElementById('livestream-fullscreen');
  if (!container) return;

  const el = document.createElement('div');
  el.textContent = emoji;
  el.style.position = 'absolute';
  el.style.bottom = '80px';
  el.style.right = (Math.random() * 60 + 20) + 'px';
  el.style.fontSize = '2rem';
  el.style.zIndex = '100';
  el.style.pointerEvents = 'none';
  el.style.transition = 'all 1.8s cubic-bezier(0.25, 1, 0.5, 1)';
  el.style.opacity = '1';

  container.appendChild(el);

  requestAnimationFrame(() => {
    el.style.transform = `translateY(-${Math.random() * 250 + 150}px) scale(${Math.random() * 0.5 + 1.2})`;
    el.style.opacity = '0';
  });

  setTimeout(() => el.remove(), 1900);
}
