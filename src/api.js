// ── API layer + WebSocket client ──────────────────────
import { getAppBaseUrl } from './utils.js';
import { clearUser } from './auth.js';

const BASE = '/api';
const WS_BASE = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

const REQUEST_TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 120000;
let authCheckInFlight = null;

// A 401 can mean an expired session, but also e.g. a wrong current PIN. Ask /users/me
// whether the stored token is still valid, and only then treat the user as logged out.
function verifyStoredSession(token) {
  if (!authCheckInFlight) {
    authCheckInFlight = fetch(`${BASE}/users/me`, { headers: { 'x-user-token': token } })
      .then((res) => {
        if (res.status === 401 && localStorage.getItem('whooply_token') === token) {
          clearUser();
          window.dispatchEvent(new CustomEvent('auth-expired'));
        }
      })
      .catch(() => {})
      .finally(() => { authCheckInFlight = null; });
  }
  return authCheckInFlight;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // Attach user auth token if available
  const token = localStorage.getItem('whooply_token');
  if (token) headers['x-user-token'] = token;

  // A request must never hang forever: on iPhone, a request made while the app is waking
  // up from the background can otherwise leave a page stuck on "Laddar..."
  const body = options.body ? JSON.stringify(options.body) : undefined;
  // Image uploads can take a while on a slow connection
  const timeoutMs = body && body.length > 200000 ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers,
      ...options,
      ...(controller ? { signal: controller.signal } : {}),
      body
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Servern svarar inte just nu. Kontrollera uppkopplingen och försök igen.');
    }
    throw new Error('Ingen kontakt med servern. Kontrollera din uppkoppling och försök igen.');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  // Safari reports a non-JSON body (e.g. a proxy error page) as the cryptic
  // "The string did not match the expected pattern", so parse defensively.
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      await verifyStoredSession(token);
    }
    const err = new Error(data?.error || (res.status >= 500 || !data
      ? 'Servern svarar inte just nu. Försök igen om en stund.'
      : 'Något gick fel'));
    err.status = res.status;
    err.data = data;
    err.authRequired = res.status === 401;
    throw err;
  }
  if (data === null) {
    throw new Error('Servern svarar inte just nu. Försök igen om en stund.');
  }
  return data;
}

// ── WebSocket ──────────────────────────────────────────
let ws = null;
let wsEventCode = null;
let activeLiveId = null;
const wsListeners = new Set();
const wsMessageQueue = [];

export function setActiveLiveRoom(liveId) {
  activeLiveId = liveId;
  if (liveId && ws && ws.readyState === WebSocket.OPEN) {
    sendWebSocketMessage({ type: 'join_live', liveId });
  }
}

export function clearActiveLiveRoom() {
  if (activeLiveId && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'leave_live', liveId: activeLiveId }));
    } catch (e) {}
  }
  activeLiveId = null;
}

export function connectWebSocket(eventCode = null) {
  // Disconnect previous
  disconnectWebSocket();

  wsEventCode = eventCode;
  const token = localStorage.getItem('whooply_token');
  const params = new URLSearchParams();
  if (eventCode) params.set('event', eventCode);
  const qs = params.toString() ? `?${params.toString()}` : '';

  try {
    ws = new WebSocket(`${WS_BASE}${qs}`);

    ws.onopen = () => {
      if (token) {
        try {
          ws.send(JSON.stringify({ type: 'auth', token }));
        } catch (e) {}
      }

      // Automatically re-subscribe to live room upon reconnect or open
      if (activeLiveId) {
        try {
          ws.send(JSON.stringify({ type: 'join_live', liveId: activeLiveId }));
        } catch (e) {}
      }

      // Flush queued messages
      while (wsMessageQueue.length > 0) {
        const item = wsMessageQueue.shift();
        try {
          ws.send(JSON.stringify(item));
        } catch (e) {}
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'flashlive_started' || data.type === 'flashlive_stopped') {
          window.dispatchEvent(new CustomEvent('flashlive-stream-updated', { detail: data }));
        }
        for (const listener of wsListeners) {
          try { listener(data); } catch (err) { console.warn('WS listener error:', err); }
        }
      } catch (e) { /* silent */ }
    };

    ws.onclose = () => {
      // Auto-reconnect after 3s
      if (wsEventCode === eventCode) {
        setTimeout(() => {
          if (wsEventCode === eventCode) {
            connectWebSocket(eventCode);
          }
        }, 3000);
      }
    };

    ws.onerror = () => {};
  } catch (err) {
    console.warn('Could not establish WebSocket:', err);
  }
}

export function disconnectWebSocket() {
  wsEventCode = null;
  wsMessageQueue.length = 0;
  if (ws) {
    ws.onclose = null; // prevent reconnect
    ws.close();
    ws = null;
  }
}

export function onWebSocketMessage(callback) {
  wsListeners.add(callback);
  return () => wsListeners.delete(callback); // unsubscribe
}

export function sendWebSocketMessage(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket(wsEventCode);
    }
    // Queue message so it isn't dropped while socket connects
    wsMessageQueue.push(data);
    if (wsMessageQueue.length > 50) wsMessageQueue.shift();
    return true;
  }
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

// ── Admin ──────────────────────────────────────────────
export const adminStatus = () => request('/admin/status');
export const adminSetup = (pin) => request('/admin/setup', { method: 'POST', body: { pin } });
export const adminVerify = (pin) => request('/admin/verify', { method: 'POST', body: { pin } });
export const adminGetUsers = (pin) => request('/admin/users', { method: 'POST', body: { pin } });
export const adminResetUserPin = (userId, pin) => request(`/admin/users/${userId}/reset-pin`, { method: 'POST', body: { pin } });
export const adminDeleteUser = (userId, pin) => request(`/admin/users/${userId}`, { method: 'DELETE', body: { pin } });
export const adminGetDebts = (pin) => request('/admin/debts', { method: 'POST', body: { pin } });
export const adminGetAllTournaments = (pin) => request('/admin/tournaments', { method: 'POST', body: { pin } });
export const adminDeleteDuel = (id, pin) => request(`/admin/duels/${id}`, { method: 'DELETE', body: { pin } });
export const adminUnsettleDuel = (id, pin) => request(`/admin/duels/${id}/unsettle`, { method: 'POST', body: { pin } });
export const adminVerifyBackup = (pin) => request('/admin/backup/verify', { method: 'POST', body: { pin } });

// ── Events ─────────────────────────────────────────────
export const getEvents = () => request('/events');
export const getAllEvents = () => request('/events?all=1');
export const getEvent = (idOrCode) => request(`/events/${idOrCode}`);
export const createEvent = (data) => request('/events', { method: 'POST', body: data });
export const deleteEvent = (id, pin) => request(`/events/${id}`, { method: 'DELETE', body: { pin } });
export const getEventQR = (idOrCode, baseUrl = getAppBaseUrl()) => {
  const params = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
  return request(`/events/${idOrCode}/qr${params}`);
};

// ── Players ────────────────────────────────────────────
export const addPlayer = (eventId, name, pin, imageUrl = null) =>
  request(`/events/${eventId}/players`, { method: 'POST', body: { name, pin, imageUrl } });
export const updatePlayerImage = (eventId, playerId, data) =>
  request(`/events/${eventId}/players/${playerId}/image`, { method: 'PUT', body: data });
export const removePlayer = (eventId, playerId, pin) =>
  request(`/events/${eventId}/players/${playerId}`, { method: 'DELETE', body: { pin } });

// ── Bets ───────────────────────────────────────────────
export const placeBet = (idOrCode, data) =>
  request(`/events/${idOrCode}/bets`, { method: 'POST', body: data });
export const deleteBet = (eventId, betId, pin) =>
  request(`/events/${eventId}/bets/${betId}`, { method: 'DELETE', body: { pin } });
export const markBetPaid = (eventId, betId, paid) =>
  request(`/events/${eventId}/bets/${betId}/paid`, { method: 'POST', body: { paid } });

// ── Event Actions ──────────────────────────────────────
export const lockEvent = (id, pin) =>
  request(`/events/${id}/lock`, { method: 'POST', body: { pin } });
export const reopenEvent = (id, pin) =>
  request(`/events/${id}/reopen`, { method: 'POST', body: { pin } });
export const finishEvent = (id, winnerId, pin, winnerImageUrl = null) => {
  const isArray = Array.isArray(winnerId);
  const payload = {
    winnerId: isArray ? winnerId.join(',') : winnerId,
    winnerIds: isArray ? winnerId : (typeof winnerId === 'string' && winnerId.includes(',') ? winnerId.split(',').map(s => s.trim()) : [winnerId]),
    pin,
    winnerImageUrl
  };
  return request(`/events/${id}/finish`, { method: 'POST', body: payload });
};
export const getActiveEvent = () =>
  request('/events/active');
export const setEventPicks = (id, picks) =>
  request(`/events/${id}/picks`, { method: 'POST', body: { picks } });
// A coupon's result for one match: '1' / 'X' / '2', 'void' when struck, null to clear
export const setCouponResult = (id, match, result, pin) =>
  request(`/events/${id}/coupon-result`, { method: 'PUT', body: { match, result, pin } });
export const finishPickGame = (id, resultIds, pin, winnerImageUrl = null) =>
  request(`/events/${id}/finish`, { method: 'POST', body: { resultIds, pin, winnerImageUrl } });
export const cancelEvent = (id, pin) =>
  request(`/events/${id}/cancel`, { method: 'POST', body: { pin } });
export const boostEvent = (id) =>
  request(`/events/${id}/boost`, { method: 'POST' });
export const updateEventDeadline = (id, closesAt, remindBeforeMin) =>
  request(`/events/${id}/deadline`, { method: 'PUT', body: remindBeforeMin === undefined ? { closesAt } : { closesAt, remindBeforeMin } });
// The organiser's photo of the result: the AI suggests the winner (the organiser confirms)
export const readEventResult = (id, image, pin) =>
  request(`/events/${id}/read-result`, { method: 'POST', body: { image, pin } });
// Link to where the game is followed live, e.g. a GameBook leaderboard ('' removes it)
export const setEventResultUrl = (id, url, pin) =>
  request(`/events/${id}/result-url`, { method: 'PUT', body: { url, pin } });
export const updateEventImage = (id, data) =>
  request(`/events/${id}/image`, { method: 'PUT', body: data });

// ── Users ─────────────────────────────────────────────
export const registerUser = ({ name, nickname, swishNumber, pin, avatarEmoji, inviteCode }) =>
  request('/users/register', { method: 'POST', body: { name, nickname, swishNumber, pin, avatarEmoji, inviteCode } });
export const loginUser = ({ identifier, pin }) =>
  request('/users/login', { method: 'POST', body: { identifier, pin } });
export const completePinReset = (identifierOrObj, resetCode, newPin) => {
  const body = typeof identifierOrObj === 'object'
    ? identifierOrObj
    : { identifier: identifierOrObj, resetCode, newPin };
  return request('/users/reset-pin', { method: 'POST', body });
};
export const changePin = (currentPin, newPin) =>
  request('/users/change-pin', { method: 'POST', body: { currentPin, newPin } });
export const getMe = () => request('/users/me');
export const getMyBets = () => request('/users/me/bets');
export const getMyPhotos = () => request('/users/me/photos');
export const updateProfile = (data) =>
  request('/users/me/profile', { method: 'PUT', body: data });
export const updateAvatar = (imageData) =>
  request('/users/me/avatar', { method: 'PUT', body: { imageData } });
export const updateSwish = (swishNumber) =>
  request('/users/me/swish', { method: 'PUT', body: { swishNumber } });

// ── Friends ──────────────────────────────────────────
export const getFriends = () => request('/friends');
export const addFriend = (data) => request('/friends', { method: 'POST', body: typeof data === 'string' ? { nickname: data } : data });
export const removeFriend = (friendId) => request(`/friends/${friendId}`, { method: 'DELETE' });
export const getFriendRequests = () => request('/friends/requests');
export const acceptFriendRequest = (fromUserId) => request(`/friends/requests/${fromUserId}/accept`, { method: 'POST', body: {} });
export const declineFriendRequest = (fromUserId) => request(`/friends/requests/${fromUserId}/decline`, { method: 'POST', body: {} });
export const getFriendInviteToken = () => request('/friends/invite-token');

// Personal invite link: opening it creates the friendship directly (the sharer has consented)
export async function buildFriendInviteUrl() {
  const { token, nickname } = await getFriendInviteToken();
  return `${getAppBaseUrl()}/?addFriend=${encodeURIComponent(nickname)}&ft=${encodeURIComponent(token)}`;
}
export const searchUsers = (q) => request(`/users/search?q=${encodeURIComponent(q || '')}`);

// ── WebAuthn / FaceID / TouchID ──────────────────────
export const webauthnRegisterOptions = () =>
  request('/auth/webauthn/register-options', { method: 'POST' });
export const webauthnRegisterVerify = (credentialId, publicKey) =>
  request('/auth/webauthn/register-verify', { method: 'POST', body: { credentialId, publicKey } });
export const webauthnLoginOptions = () =>
  request('/auth/webauthn/login-options', { method: 'POST' });
export const webauthnLoginVerify = (credentialId) =>
  request('/auth/webauthn/login-verify', { method: 'POST', body: { credentialId } });
export const getMyCredentials = () =>
  request('/users/me/credentials');

// ── Leaderboard ──────────────────────────────────────
export const getLeaderboard = () => request('/leaderboard');

// ── Tournaments ──────────────────────────────────────
export const getTournaments = () => request('/tournaments');
// Superadmin may open any event (also friends-only ones they are not part of)
export const getTournament = (code) => {
  const pin = sessionStorage.getItem('whooply_pin');
  return request('/tournaments/' + encodeURIComponent(code), pin
    ? { headers: { 'Content-Type': 'application/json', 'x-user-token': localStorage.getItem('whooply_token') || '', 'x-admin-pin': pin } }
    : {});
};
export const getTournamentTemplates = () => request('/tournament-templates');
export const createTournament = (data) =>
  request('/tournaments', { method: 'POST', body: data });
export const createTournamentFromTemplate = (data) =>
  request('/tournaments/from-template', { method: 'POST', body: data });
export const addTournamentRound = (id, data) =>
  request('/tournaments/' + id + '/rounds', { method: 'POST', body: data });
export const addTournamentParticipant = (id, data) =>
  request('/tournaments/' + id + '/participants', { method: 'POST', body: data });
export const createSideBet = (id, data) =>
  request('/tournaments/' + id + '/sidebets', { method: 'POST', body: data });
export const settleTournament = (id, data = {}) =>
  request('/tournaments/' + id + '/settle', { method: 'POST', body: data });
export const reopenTournament = (id, data = {}) =>
  request('/tournaments/' + id + '/reopen', { method: 'POST', body: data });
export const getTournamentQR = (code, baseUrl = getAppBaseUrl()) => {
  const params = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
  return request('/tournaments/' + code + '/qr' + params);
};
export const toggleSettlementReceipt = (id, data) =>
  request('/tournaments/' + id + '/settlement/receipt', { method: 'POST', body: data });
export const deleteTournament = (id, data) =>
  request('/tournaments/' + id, { method: 'DELETE', body: data });
export const addTournamentBanner = (id, data) =>
  request('/tournaments/' + id + '/banners', { method: 'POST', body: data });
export const deleteTournamentBanner = (id, bannerId, data) =>
  request('/tournaments/' + id + '/banners/' + bannerId, { method: 'DELETE', body: data });
export const removeTournamentParticipant = (id, participantId, pin = '') =>
  request(`/tournaments/${id}/participants/${participantId}`, { method: 'DELETE', body: { pin } });
export const inviteFriendsToTournament = (id, friendIds, pin) =>
  request('/tournaments/' + id + '/invite', { method: 'POST', body: { friendIds, ...(pin ? { pin } : {}) } });

// ── Tournament Photos ────────────────────────────────
export const getTournamentPhotos = (id) => request('/tournaments/' + id + '/photos');
export const uploadTournamentPhoto = (id, data) =>
  request('/tournaments/' + id + '/photos', { method: 'POST', body: data });
export const deleteTournamentPhoto = (id, photoId, data) =>
  request('/tournaments/' + id + '/photos/' + photoId, { method: 'DELETE', body: data });
export const togglePhotoLike = (id, photoId) =>
  request('/tournaments/' + id + '/photos/' + photoId + '/like', { method: 'POST', body: {} });


// ── User Stats ───────────────────────────────────────
export const getMyStats = () => request('/users/me/stats');

// ── Minigame Duels & Swish settlements ────────────────
export const createDuel = (data) => request('/duels', { method: 'POST', body: data });
export const getPendingDuels = () => request('/duels/pending');
export const getInbox = (lang = 'sv') => request(`/inbox${lang === 'en' ? '?lang=en' : ''}`);
export const markInboxRead = () => request('/inbox/read', { method: 'POST', body: {} });
export const clearInbox = () => request('/inbox/clear', { method: 'POST', body: {} });
export const getDuelSettlements = () => request('/duels/settlements');
export const getSettlementsOverview = () => request('/settlements/overview');
export const getDuelHistory = () => request('/duels/history');
export const getDuel = (id) => request('/duels/' + id);
export const respondDuel = (id, accept) => request('/duels/' + id + '/respond', { method: 'POST', body: { accept } });
export const submitDuelRoll = (id, data) => request('/duels/' + id + '/roll', { method: 'POST', body: data });
export const settleDuel = (id) => request('/duels/' + id + '/settle', { method: 'POST', body: {} });
export const settleDuelsWithFriend = (friendId) => request('/duels/settle-with/' + friendId, { method: 'POST', body: {} });
export const clearSettlementWithFriend = (friendId, expectedAmount) =>
  request('/settlement/clear-with/' + encodeURIComponent(friendId), {
    method: 'POST',
    body: { expectedAmount, idempotencyKey: crypto.randomUUID() }
  });

// ── Minigame Party Rooms (The Blind 10.00 etc.) ───────
export const createPartyRoom = (data) => request('/minigames/party/create', { method: 'POST', body: data });
export const getPartyRoom = (query) => request('/minigames/party/' + encodeURIComponent(query));
export const joinPartyRoom = (data) => request('/minigames/party/join', { method: 'POST', body: data });
export const inviteToParty = (id, friendIds) => request('/minigames/party/' + id + '/invite', { method: 'POST', body: { friendIds } });
export const leavePartyRoom = (id) => request('/minigames/party/' + id + '/leave', { method: 'POST', body: {} });
export const startPartyGame = (id) => request('/minigames/party/' + id + '/start', { method: 'POST', body: {} });
export const submitPartyTime = (id, stoppedTime) => request('/minigames/party/' + id + '/submit', { method: 'POST', body: typeof stoppedTime === 'object' && stoppedTime !== null ? stoppedTime : { stoppedTime } });
export const submitPartyScore = (id, data) => request('/minigames/party/' + id + '/submit', { method: 'POST', body: typeof data === 'object' && data !== null ? data : { score: data } });
export const startSpaceSoloRound = () => request('/space/solo-start', { method: 'POST', body: {} });
export const submitSpaceSoloScore = (data) => request('/space/solo-score', { method: 'POST', body: data });
export const getServerTime = () => request('/time');
export const getSpaceLeaderboard = () => request('/space/leaderboard');
export const resolvePartyTie = (id, decision) => request('/minigames/party/' + id + '/resolve-tie', { method: 'POST', body: { decision } });
export const getPartyRoomQR = (query, baseUrl = getAppBaseUrl()) => request('/minigames/party/' + encodeURIComponent(query) + '/qr' + (baseUrl ? '?baseUrl=' + encodeURIComponent(baseUrl) : ''));

// ── Mafia (Varulv) Party Game ────────────────────────
export const startMafiaGame = (id, data) => request('/minigames/mafia/' + id + '/start', { method: 'POST', body: data || {} });
export const getMyMafiaRole = (id) => request('/minigames/mafia/' + id + '/my-role');
export const submitMafiaNightAction = (id, data) => request('/minigames/mafia/' + id + '/night-action', { method: 'POST', body: data });
export const advanceMafiaPhase = (id, data) => request('/minigames/mafia/' + id + '/advance-phase', { method: 'POST', body: data || {} });
export const voteMafiaLynch = (id, targetId) => request('/minigames/mafia/' + id + '/vote', { method: 'POST', body: { targetId } });

// ── AnyBet (Kompisbettet) ─────────────────────────────
export const createAnyBet = (data) => request('/anybets/create', { method: 'POST', body: data });
export const getAnyBets = () => request('/anybets');
export const getAnyBet = (id) => request('/anybets/' + id);
export const joinAnyBet = (id, choice) => request('/anybets/' + id + '/join', { method: 'POST', body: { choice } });
export const acceptAnyBet = (id) => request('/anybets/' + id + '/join', { method: 'POST', body: { choice: 'participant' } });
export const declineAnyBet = (id) => request('/anybets/' + id + '/decline', { method: 'POST' });
export const cancelAnyBet = (id) => request('/anybets/' + id + '/cancel', { method: 'POST' });
export const settleAnyBet = (id, data) => request('/anybets/' + id + '/settle', { method: 'POST', body: data });

// ── Web Push API ──────────────────────────────────────
export const getVapidPublicKey = () => request('/push/vapid-public-key');
export const subscribePush = (data) => request('/push/subscribe', { method: 'POST', body: data });
export const unsubscribePush = (data) => request('/push/unsubscribe', { method: 'POST', body: data });
export const getAdminPushStats = (pin) => request('/admin/push-stats', { headers: { 'x-admin-pin': pin || '' } });
export const sendAdminBroadcastPush = (data) => request('/admin/broadcast-push', { method: 'POST', body: data });

// ── BlixtBet (FlashBet) ──────────────────────────────
export const createFlashBet = (data) => request('/flashbets', { method: 'POST', body: data });
export const getActiveFlashBets = (tournamentId) => request('/flashbets/active' + (tournamentId ? '?tournamentId=' + encodeURIComponent(tournamentId) : ''));
export const getFlashBet = (id) => request('/flashbets/' + id);
export const placeFlashBet = (id, choice) => request('/flashbets/' + id + '/bet', { method: 'POST', body: { choice } });
export const settleFlashBet = (id, winningChoice) => request('/flashbets/' + id + '/settle', { method: 'POST', body: { winningChoice } });
export const deleteFlashBet = (id) => request('/flashbets/' + id, { method: 'DELETE' });

// ── Instant FlashLive (Spontan-Live) ─────────────────
export const startFlashLive = (data) => request('/flashlive/start', { method: 'POST', body: data });
export const getActiveFlashLives = () => request('/flashlive/active');
export const getFlashLive = (id) => request('/flashlive/' + id);
export const settleFlashLive = (id, winningChoice) => request('/flashlive/' + id + '/settle', { method: 'POST', body: { winningChoice } });
export const attachFlashLiveBet = (id, data) => request('/flashlive/' + id + '/bet', { method: 'POST', body: data });
export const stopFlashLive = (id) => request('/flashlive/' + id + '/stop', { method: 'POST', body: {} });

// ── Notification Preferences ─────────────────────────
export const getNotificationPrefs = () => request('/users/notification-prefs');
export const updateNotificationPrefs = (prefs) => request('/users/notification-prefs', { method: 'PUT', body: prefs });

// ── Tab Expenses (Dela utlägg / The Tab) ───────────
export const createTabExpense = (data) => request('/tab/expenses', { method: 'POST', body: data });
export const getMyTabExpenses = () => request('/tab/expenses/my');
export const getTabExpense = (id) => request('/tab/expenses/' + id);
export const deleteTabExpense = (id) => request('/tab/expenses/' + id, { method: 'DELETE' });

// ── App QR Code ───────────────────────────────────────
export const getAppQr = (url = getAppBaseUrl()) => request('/app/qr' + (url ? `?url=${encodeURIComponent(url)}` : ''));

// ── Löven Game (Björklöven Matchtips 4-3-2p) ────────────
export const createLovenGame = (data) => request('/loven-games', { method: 'POST', body: data });
export const getLovenGames = () => request('/loven-games');
export const getLovenGame = (id) => request('/loven-games/' + id);
export const joinLovenGame = (id, data) => request('/loven-games/' + id + '/join', { method: 'POST', body: data });
export const lockLovenGame = (id) => request('/loven-games/' + id + '/lock', { method: 'POST', body: {} });
export const settleLovenGame = (id, data) => request('/loven-games/' + id + '/settle', { method: 'POST', body: data });
export const cancelLovenGame = (id) => request('/loven-games/' + id + '/cancel', { method: 'POST', body: {} });

