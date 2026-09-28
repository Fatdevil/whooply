import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import webpush from 'web-push';
import * as db from './db.js';
import { TOURNAMENT_TEMPLATES } from './templates.js';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { readResultFromImage, canReadResults } from './resultReader.js';
import { generateMaltaSupportReply, getMaltaFallbackReply, getSupportSuggestions, SUPPORT_TOPICS, getSupportMode, generateMaltaSupportPush, getMaltaPushFallback, isGeminiLive, getSearchQuotaInfo, getLastApiDiagnostic } from './support.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env if present
try {
  if (typeof process.loadEnvFile === 'function') {
    const rootEnv = path.resolve(__dirname, '../.env');
    const serverEnv = path.resolve(__dirname, '.env');
    if (fs.existsSync(rootEnv)) {
      process.loadEnvFile(rootEnv);
    } else if (fs.existsSync(serverEnv)) {
      process.loadEnvFile(serverEnv);
    }
  }
} catch (e) {
  // Ignore missing .env or parse issues
}

// ── LiveKit Cloud Configuration & Token Generation ──
function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL || db.getSetting('livekit_url') || '';
  const apiKey = process.env.LIVEKIT_API_KEY || db.getSetting('livekit_api_key') || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || db.getSetting('livekit_api_secret') || '';
  return { url, apiKey, apiSecret, configured: Boolean(url && apiKey && apiSecret) };
}

async function generateLiveKitToken({ roomName, identity, name, metadata = {}, isPublisher = false }) {
  const config = getLiveKitConfig();
  if (!config.configured) {
    return {
      token: null,
      url: null,
      error: 'LiveKit Cloud är inte konfigurerat. Vänligen ange LIVEKIT_URL, LIVEKIT_API_KEY och LIVEKIT_API_SECRET i .env eller inställningar.'
    };
  }

  try {
    const at = new AccessToken(config.apiKey, config.apiSecret, {
      identity: String(identity),
      name: String(name || 'Användare'),
      metadata: JSON.stringify(metadata),
      // A live stream lasts at most LIVE_MAX_DURATION_MS, so the join token never needs to live longer
      ttl: '20m'
    });
    at.addGrant({
      room: String(roomName),
      roomJoin: true,
      canPublish: Boolean(isPublisher),
      canSubscribe: true,
      canPublishData: true
    });
    const token = await at.toJwt();
    return { token, url: config.url, error: null };
  } catch (err) {
    console.error('Error creating LiveKit token:', err);
    return { token: null, url: config.url, error: err.message };
  }
}

// Deleting the LiveKit room disconnects everyone in it, so no participant keeps using
// streaming minutes after a live stream has ended (also when their app missed our message)
async function deleteLiveKitRoom(roomName) {
  const config = getLiveKitConfig();
  if (!config.configured || !roomName) return;
  try {
    const host = String(config.url).replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    const client = new RoomServiceClient(host, config.apiKey, config.apiSecret);
    await client.deleteRoom(String(roomName));
  } catch (err) {
    // The room is already gone when everyone has left; nothing to do then
    if (!/not.?found|404/i.test(String(err?.message || err))) {
      console.warn('[livekit] Could not delete room', roomName, err?.message || err);
    }
  }
}

// ── Process Crash Resilience ─────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [unhandledRejection] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 [uncaughtException] Uncaught Exception:', err);
  console.error('💥 Processen avslutas om 5 sekunder – Railway startar om automatiskt.');
  setTimeout(() => process.exit(1), 5000).unref();
});

const app = express();
app.set('trust proxy', 1);

// Force HTTPS redirect (Railway, cloud proxies)
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// Photo uploads have their own larger limit on the route; the default 1 MB parser must not
// reject them first (it runs before any route-level parser)
const defaultJson = express.json({ limit: '1mb' });
const LARGE_JSON_ROUTES = [
  /^\/api\/users\/me\/avatar$/,
  /^\/api\/tournaments\/[^/]+\/photos$/,
  /^\/api\/events\/[^/]+\/read-result$/
];
app.use((req, res, next) => (LARGE_JSON_ROUTES.some(r => r.test(req.path)) ? next() : defaultJson(req, res, next)));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve frontend in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  setHeaders(res, filePath) {
    // Hashed build files never change; index.html must always be fresh so phones get new deploys
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache');
    }
  }
}));
// A build file from an older deploy must 404, not fall through to index.html (the app
// would then fail to load the page with a MIME type error)
app.use('/assets', (req, res) => res.status(404).end());

// ── Healthcheck (Public endpoint for Railway & uptime monitoring) ──
app.get('/api/health', (req, res) => {
  const dbOk = db.isHealthy ? db.isHealthy() : true;
  if (!dbOk) {
    return res.status(503).json({ status: 'unhealthy', database: false });
  }
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: true
  });
});

// ── Client Error Reporting (Logs uncaught frontend errors) ──────────
app.post('/api/client-errors', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const limit = db.checkRateLimit ? db.checkRateLimit('client_err:' + ip) : { allowed: true };
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many error reports' });
  }
  if (db.recordFailedAttempt) {
    db.recordFailedAttempt('client_err:' + ip, 20, 5); // Max 20 reports per 5 min
  }

  const { message, source, lineno, colno, url } = req.body || {};
  console.warn(`[CLIENT-ERROR] IP: ${ip} | URL: ${url || 'unknown'} | ${message} at ${source || 'unknown'}:${lineno || '?'}:${colno || '?'}`);
  res.json({ ok: true });
});

// ── HTTP server + WebSocket ──────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track clients per event, user, and duel room
const eventClients = new Map(); // eventId/code → Set<ws>
const userClients = new Map();  // userId → Set<ws>
const duelClients = new Map();  // duelId → Set<ws>
const partyRooms = new Map();   // partyId → room object
const partyClients = new Map(); // partyId → Set<ws>
const partyCodeToId = new Map();// 4-char code → partyId
const liveClients = new Map();  // liveId → Set<ws>
const activeFlashLiveStreams = new Map();
// Every live stream stops automatically after this long, so a forgotten stream cannot use up
// the LiveKit minutes. Starting a new BlixtBet does not extend it.
const LIVE_MAX_DURATION_MS = 15 * 60 * 1000;
// A stream nobody watches stops after this long (counted from the start or the last viewer leaving)
const LIVE_IDLE_STOP_MS = 3 * 60 * 1000;
const LIVE_IDLE_WARN_MS = 2 * 60 * 1000;
function liveEndsAtMs(session) {
  const created = new Date(session.createdAt).getTime();
  return (Number.isFinite(created) ? created : Date.now()) + LIVE_MAX_DURATION_MS;
} // liveId → stream object { id, hostId, hostName, question, expiresAt, targetUserIds, flashBetId }

// ── Party Room Cleanup ───────────────────────────────
const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function cleanupStaleRooms() {
  const now = Date.now();
  let cleaned = 0;
  for (const [roomId, room] of partyRooms) {
    const age = now - new Date(room.createdAt).getTime();
    const isFinished = room.status === 'results' || room.status === 'finished';
    const isStale = age > ROOM_TTL_MS;
    const isFinishedOld = isFinished && age > 30 * 60 * 1000; // 30 min after results
    
    if (isStale || isFinishedOld) {
      clearPartyRoundTimer(roomId);
      partyRooms.delete(roomId);
      partyCodeToId.delete(room.code);
      partyClients.delete(roomId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[cleanup] Removed ${cleaned} stale party room(s)`);
  }
}

// Run cleanup every 15 minutes (stale party rooms & expired rate limits)
setInterval(() => {
  cleanupStaleRooms();
  try {
    if (db.cleanupExpiredRateLimits) db.cleanupExpiredRateLimits();
  } catch (err) {
    console.error('Error cleaning up rate limits:', err);
  }
}, 15 * 60 * 1000).unref();

// Remind hosts to end quiet events, so nobody's money is left waiting forever
function remindHostsToSettle() {
  try {
    for (const t of db.getTournamentsNeedingSettleReminder(48)) {
      db.markTournamentSettleReminded(t.id);
      if (!t.creator_id) continue;
      sendPushToUsers([t.creator_id], {
        title: `🏁 Dags att avsluta ${t.name}?`,
        body: 'Det har varit tyst ett tag. Avsluta eventet så räknas allt ihop och alla kan göra upp på THE TAB.',
        url: `/#tournament/${t.share_code}`
      }, 'tournaments').catch(() => {});
    }
  } catch (err) {
    console.error('Error sending settle reminders:', err);
  }
}
setInterval(remindHostsToSettle, 60 * 60 * 1000).unref();

// Reminders before betting closes: "15 min left – place your tip"
function sendDeadlineReminders(now = Date.now()) {
  try {
    for (const e of db.getEventsDueForReminder(now)) {
      db.markEventReminded(e.id);
      const targets = db.getReminderTargets(e);
      if (targets.length === 0) continue;
      const mins = Math.max(1, Math.round((new Date(e.closes_at).getTime() - now) / 60000));
      const tour = e.tournament_id ? db.getTournamentById(e.tournament_id) : null;
      sendPushToUsers(targets, {
        title: `⏰ ${mins} min kvar: ${e.name}`,
        body: 'Bettningen stänger snart – du har inte lagt ditt tips än!',
        url: tour ? `/#tournament/${tour.share_code}` : `/#event/${e.share_code}`
      }, 'tournaments', { bellType: 'deadline_reminder' }).catch(() => {});
    }
  } catch (err) {
    console.error('Error sending deadline reminders:', err);
  }
}
setInterval(sendDeadlineReminders, 60 * 1000).unref();

// Run daily automated database backup (every 24 hours)
setInterval(async () => {
  try {
    if (db.backupDatabase) {
      const res = await db.backupDatabase();
      console.log(`[backup] Daily automated database backup created: ${res.filename} (${Math.round(res.sizeBytes / 1024)} KB)`);
    }
  } catch (err) {
    console.error('Error creating daily backup:', err);
  }
}, 24 * 60 * 60 * 1000).unref();

// Run startup database backup snapshot (delayed by 5s to allow DB init)
if (process.env.NODE_ENV !== 'test') {
  setTimeout(async () => {
    try {
      if (db.backupDatabase) {
        const res = await db.backupDatabase();
        console.log(`[backup] Startup automated database backup created: ${res.filename} (${Math.round(res.sizeBytes / 1024)} KB)`);
      }
    } catch (err) {
      console.error('Error creating startup backup:', err);
    }
  }, 5000).unref();
}

// Clean up any stale active streams from previous runs upon startup (WebRTC does not survive restart)
try {
  const dbActiveStreams = db.getActiveFlashLiveStreams ? db.getActiveFlashLiveStreams() : [];
  for (const s of dbActiveStreams) {
    try {
      db.updateFlashLiveStreamStatus(s.id, 'ended');
      // The stream's bet (if any) stays so the host can still settle or remove it in BlixtBet
      deleteLiveKitRoom(s.id).catch(() => {});
    } catch (e) {}
  }
  if (dbActiveStreams.length > 0) {
    console.log(`[startup] Cleaned up ${dbActiveStreams.length} stale active flash live stream(s)`);
  }
} catch (e) {
  console.warn('Could not cleanup active flash live streams from DB:', e);
}

function endFlashLiveStream(id, session = null, reason = 'ended') {
  if (!session) session = activeFlashLiveStreams.get(id);
  if (!session) {
    const dbSession = db.getFlashLiveStream(id);
    if (dbSession) {
      session = {
        ...dbSession,
        targetUserIds: dbSession.targetUserIds || []
      };
    }
  }
  if (!session) return { cancelledBet: false };

  session.status = 'ended';
  activeFlashLiveStreams.delete(id);
  try {
    db.updateFlashLiveStreamStatus(id, 'ended');
  } catch (e) {}

  // An unsettled bet outlives the stream: the host settles (or removes) it afterwards in BlixtBet
  let pendingBetId = null;
  if (session.flashBetId) {
    try {
      const fb = db.getFlashBet(session.flashBetId);
      if (fb && (fb.status === 'open' || fb.status === 'locked')) pendingBetId = fb.id;
    } catch (e) {}
  }

  const stopPayload = {
    type: 'flashlive_stopped',
    liveId: id,
    reason,
    cancelledBet: false,
    pendingBetId
  };

  broadcastToLive(id, stopPayload);
  if (Array.isArray(session.targetUserIds)) {
    for (const fId of session.targetUserIds) {
      broadcastToUser(fId, stopPayload);
    }
  }
  broadcastToUser(session.hostId, stopPayload);
  broadcastGlobal(stopPayload);
  deleteLiveKitRoom(id).catch(() => {});

  const clients = liveClients.get(id);
  if (clients) {
    clients.clear();
    liveClients.delete(id);
  }

  return { ok: true, cancelledBet: false, pendingBetId };
}

// Background cleanup for stale FlashLive streams (heartbeat timeout > 35s or past the max duration)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeFlashLiveStreams.entries()) {
    const isHeartbeatDead = session.lastHeartbeat && (now - session.lastHeartbeat > 35000);
    if (isHeartbeatDead || now >= liveEndsAtMs(session)) {
      endFlashLiveStream(id, session, isHeartbeatDead ? 'heartbeat_timeout' : 'max_duration');
      continue;
    }

    // Nobody watching: warn the host, then stop so the stream does not use minutes for nothing
    if (liveViewerCount(id, session) > 0) {
      session.lastViewerAt = now;
      session.idleWarned = false;
      continue;
    }
    const idleSince = session.lastViewerAt || new Date(session.createdAt).getTime() || now;
    const idleMs = now - idleSince;
    if (idleMs >= LIVE_IDLE_STOP_MS) {
      endFlashLiveStream(id, session, 'no_viewers');
    } else if (idleMs >= LIVE_IDLE_WARN_MS && !session.idleWarned) {
      session.idleWarned = true;
      broadcastToUser(session.hostId, {
        type: 'flashlive_idle_warning',
        liveId: id,
        secondsLeft: Math.round((LIVE_IDLE_STOP_MS - idleMs) / 1000)
      });
    }
  }
}, 5000).unref();

// Viewers = people other than the host with the live view open
function liveViewerCount(liveId, session) {
  const clients = liveClients.get(liveId);
  if (!clients) return 0;
  const viewers = new Set();
  for (const client of clients) {
    if (client.liveUserId && client.liveUserId !== session.hostId) viewers.add(client.liveUserId);
  }
  return viewers.size;
}

function updateLiveViewerCount(liveId) {
  if (!liveId) return;
  const count = liveClients.get(liveId)?.size || 0;
  broadcastToLive(liveId, {
    type: 'live_viewer_count',
    liveId,
    viewerCount: Math.max(1, count)
  });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const eventCode = url.searchParams.get('event');
  const duelId = url.searchParams.get('duel');
  const partyId = url.searchParams.get('party');
  const liveIdParam = url.searchParams.get('live');

  let boundUserId = null;
  let boundEventCode = eventCode || null;
  let boundLiveId = liveIdParam || null;
  let lastLiveCommentTime = 0;
  let liveReactionCount = 0;
  let liveReactionResetAt = 0;
  const subscribedDuels = new Set();
  const subscribedParties = new Set();

  function tryJoinLive(lId) {
    if (!lId) return false;
    const session = activeFlashLiveStreams.get(lId);
    if (!session) return false;
    if (boundUserId && (session.hostId === boundUserId || (session.targetUserIds && session.targetUserIds.includes(boundUserId)))) {
      subscribedLives.add(lId);
      ws.liveUserId = boundUserId;
      if (!liveClients.has(lId)) liveClients.set(lId, new Set());
      liveClients.get(lId).add(ws);
      updateLiveViewerCount(lId);
      return true;
    }
    return false;
  }

  const subscribedLives = new Set();
  if (liveIdParam) {
    tryJoinLive(liveIdParam);
  }

  function tryJoinDuel(dId) {
    if (!dId) return false;
    const duel = db.getDuelById(dId);
    if (!duel) return false;
    // Allow join if duel is table mode or caller is a participant
    if (duel.mode === 'table' || (boundUserId && (boundUserId === duel.creator_id || boundUserId === duel.opponent_id))) {
      subscribedDuels.add(dId);
      if (!duelClients.has(dId)) duelClients.set(dId, new Set());
      duelClients.get(dId).add(ws);
      return true;
    }
    return false;
  }

  function tryJoinParty(pId) {
    if (!pId) return false;
    const room = partyRooms.get(pId);
    if (!room) return false;
    // Allow join if user is in room.players
    if (boundUserId && room.players.some(p => p.id === boundUserId)) {
      subscribedParties.add(pId);
      if (!partyClients.has(pId)) partyClients.set(pId, new Set());
      partyClients.get(pId).add(ws);
      return true;
    }
    return false;
  }

  // Don't join event channel yet – wait until auth confirms tournament access
  let pendingEventCode = eventCode || null;
  // A standalone game is public by its share link, so its page listens without logging in
  if (pendingEventCode && !db.getTournamentByCode(pendingEventCode)) {
    const game = db.getEventByCode(pendingEventCode);
    if (game && canViewEvent(game, null)) {
      if (!eventClients.has(pendingEventCode)) eventClients.set(pendingEventCode, new Set());
      eventClients.get(pendingEventCode).add(ws);
      boundEventCode = pendingEventCode;
      pendingEventCode = null;
    }
  }

  if (duelId) {
    tryJoinDuel(duelId);
  }

  if (partyId) {
    tryJoinParty(partyId);
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'auth' && msg.token) {
        const user = db.getUserByToken(msg.token);
        if (user) {
          boundUserId = user.id;
          ws.whooplyUserId = user.id;
          if (!userClients.has(user.id)) userClients.set(user.id, new Set());
          userClients.get(user.id).add(ws);

          // Join pending event channel after verifying tournament access
          if (pendingEventCode) {
            const tourney = db.getTournamentByCode(pendingEventCode);
            // A game page listens on the game's own code, with the same access as viewing it
            const game = tourney ? null : db.getEventByCode(pendingEventCode);
            if ((tourney && db.canUserAccessTournament(tourney, boundUserId)) || (game && canViewEvent(game, user))) {
              if (!eventClients.has(pendingEventCode)) eventClients.set(pendingEventCode, new Set());
              eventClients.get(pendingEventCode).add(ws);
              boundEventCode = pendingEventCode;
            }
            pendingEventCode = null;
          }

          if (boundLiveId) {
            tryJoinLive(boundLiveId);
          }
        }
      } else if (msg.type === 'join_live' && msg.liveId) {
        boundLiveId = msg.liveId;
        tryJoinLive(msg.liveId);
      } else if (msg.type === 'leave_live' && msg.liveId) {
        if (boundLiveId === msg.liveId) boundLiveId = null;
        subscribedLives.delete(msg.liveId);
        liveClients.get(msg.liveId)?.delete(ws);
        if (liveClients.get(msg.liveId)?.size === 0) liveClients.delete(msg.liveId);
        updateLiveViewerCount(msg.liveId);
      } else if ((msg.type === 'join_duel' || msg.action === 'join_duel') && (msg.duelId || msg.id)) {
        const dId = msg.duelId || msg.id;
        tryJoinDuel(dId);
      } else if ((msg.type === 'leave_duel' || msg.action === 'leave_duel') && (msg.duelId || msg.id)) {
        const dId = msg.duelId || msg.id;
        subscribedDuels.delete(dId);
        duelClients.get(dId)?.delete(ws);
        if (duelClients.get(dId)?.size === 0) duelClients.delete(dId);
      } else if ((msg.type === 'join_party' || msg.action === 'join_party') && (msg.partyId || msg.id)) {
        const pId = msg.partyId || msg.id;
        tryJoinParty(pId);
      } else if ((msg.type === 'leave_party' || msg.action === 'leave_party') && (msg.partyId || msg.id)) {
        const pId = msg.partyId || msg.id;
        subscribedParties.delete(pId);
        partyClients.get(pId)?.delete(ws);
        if (partyClients.get(pId)?.size === 0) partyClients.delete(pId);
      } else if (msg.type === 'duel_live_roll' && msg.duelId) {
        const duel = db.getDuelById(msg.duelId);
        if (duel && boundUserId && (boundUserId === duel.creator_id || boundUserId === duel.opponent_id)) {
          broadcastToDuel(msg.duelId, {
            type: 'duel_live_roll',
            duelId: msg.duelId,
            rollerId: boundUserId,
            rollerRole: msg.rollerRole,
            diceValues: msg.diceValues,
            total: msg.total
          }, ws); // exclude sender
        }
      } else if (msg.type === 'duel_live_flip' && msg.duelId) {
        const duel = db.getDuelById(msg.duelId);
        if (duel && boundUserId && (boundUserId === duel.creator_id || boundUserId === duel.opponent_id)) {
          broadcastToDuel(msg.duelId, {
            type: 'duel_live_flip',
            duelId: msg.duelId,
            flipperId: boundUserId,
            outcome: msg.outcome,
            targetDeg: msg.targetDeg
          }, ws); // exclude sender
        }
      } else if (msg.type === 'live_stream_start' && msg.tournamentCode) {
        const tourney = db.getTournamentByCode ? db.getTournamentByCode(msg.tournamentCode) : null;
        if (tourney && boundUserId && tourney.creator_id === boundUserId) {
          const authUser = db.getUserById(boundUserId);
          broadcastToEvent(msg.tournamentCode, {
            type: 'tournament_live_started',
            tournamentCode: msg.tournamentCode,
            broadcasterName: authUser ? (authUser.nickname || authUser.real_name) : 'Värden'
          }, ws);
        }
      } else if (msg.type === 'live_stream_stop' && msg.tournamentCode) {
        const tourney = db.getTournamentByCode ? db.getTournamentByCode(msg.tournamentCode) : null;
        if (tourney && boundUserId && tourney.creator_id === boundUserId) {
          broadcastToEvent(msg.tournamentCode, {
            type: 'tournament_live_stopped',
            tournamentCode: msg.tournamentCode
          }, ws);
        }
      } else if (msg.type === 'live_comment' && (msg.tournamentCode || msg.liveId) && msg.text) {
        const now = Date.now();
        if (now - lastLiveCommentTime < 500) return; // rate limit: max 2 comments/sec
        lastLiveCommentTime = now;

        const cleanText = String(msg.text).slice(0, 140).trim();
        if (cleanText && boundUserId) {
          if (msg.liveId) {
            const session = activeFlashLiveStreams.get(msg.liveId);
            const isAllowed = session && (session.hostId === boundUserId || (session.targetUserIds && session.targetUserIds.includes(boundUserId)));
            if (!isAllowed) return;
          }
          // Validate tournament access for comments sent to a tournament channel
          if (msg.tournamentCode && !msg.liveId) {
            const tourney = db.getTournamentByCode(msg.tournamentCode);
            if (!tourney || !db.canUserAccessTournament(tourney, boundUserId)) return;
          }
          const authUser = db.getUserById(boundUserId);
          const payload = {
            type: 'live_comment_received',
            tournamentCode: msg.tournamentCode || null,
            liveId: msg.liveId || null,
            userName: authUser ? (authUser.nickname || authUser.real_name) : 'Kompis',
            userAvatar: authUser ? (authUser.avatar_emoji || '💬') : '💬',
            text: cleanText,
            isBetNotice: !!msg.isBetNotice,
            timestamp: Date.now()
          };
          if (msg.liveId) broadcastToLive(msg.liveId, payload);
          if (msg.tournamentCode) broadcastToEvent(msg.tournamentCode, payload);
        }
      } else if (msg.type === 'live_reaction' && (msg.tournamentCode || msg.liveId) && msg.emoji && boundUserId) {
        const now = Date.now();
        if (now > liveReactionResetAt) {
          liveReactionCount = 0;
          liveReactionResetAt = now + 3000;
        }
        if (liveReactionCount >= 10) return; // rate limit: max 10 reactions/3s
        liveReactionCount++;

        if (msg.liveId) {
          const session = activeFlashLiveStreams.get(msg.liveId);
          const isAllowed = session && (session.hostId === boundUserId || (session.targetUserIds && session.targetUserIds.includes(boundUserId)));
          if (!isAllowed) return;
        }
        // Validate tournament access for reactions sent to a tournament channel
        if (msg.tournamentCode && !msg.liveId) {
          const tourney = db.getTournamentByCode(msg.tournamentCode);
          if (!tourney || !db.canUserAccessTournament(tourney, boundUserId)) return;
        }
        const payload = {
          type: 'live_reaction_received',
          tournamentCode: msg.tournamentCode || null,
          liveId: msg.liveId || null,
          emoji: String(msg.emoji).slice(0, 5)
        };
        if (msg.liveId) broadcastToLive(msg.liveId, payload);
        if (msg.tournamentCode) broadcastToEvent(msg.tournamentCode, payload);
      } else if (msg.type === 'webrtc_viewer_join' && msg.liveId && boundUserId) {
        const session = activeFlashLiveStreams.get(msg.liveId);
        if (session && session.hostId) {
          // Verify viewer is allowed in this live session
          const viewerOk = session.hostId === boundUserId ||
            (session.targetUserIds && session.targetUserIds.includes(boundUserId));
          if (!viewerOk) return;
          broadcastToUser(session.hostId, {
            type: 'webrtc_viewer_join',
            liveId: msg.liveId,
            viewerId: boundUserId
          });
        }
      } else if (msg.type === 'webrtc_signal' && msg.liveId && msg.targetUserId && boundUserId) {
        // Verify both sender and target belong to the live session
        const session = activeFlashLiveStreams.get(msg.liveId);
        if (!session) return;
        const senderOk = session.hostId === boundUserId ||
          (session.targetUserIds && session.targetUserIds.includes(boundUserId));
        const targetOk = session.hostId === msg.targetUserId ||
          (session.targetUserIds && session.targetUserIds.includes(msg.targetUserId));
        if (!senderOk || !targetOk) return;
        broadcastToUser(msg.targetUserId, {
          type: 'webrtc_signal',
          liveId: msg.liveId,
          fromUserId: boundUserId,
          signal: msg.signal
        });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    for (const lId of subscribedLives) {
      liveClients.get(lId)?.delete(ws);
      if (liveClients.get(lId)?.size === 0) liveClients.delete(lId);
      updateLiveViewerCount(lId);
    }
    subscribedLives.clear();

    if (boundEventCode) {
      eventClients.get(boundEventCode)?.delete(ws);
      if (eventClients.get(boundEventCode)?.size === 0) eventClients.delete(boundEventCode);
    }
    if (boundUserId) {
      userClients.get(boundUserId)?.delete(ws);
      if (userClients.get(boundUserId)?.size === 0) userClients.delete(boundUserId);
    }
    for (const dId of subscribedDuels) {
      duelClients.get(dId)?.delete(ws);
      if (duelClients.get(dId)?.size === 0) duelClients.delete(dId);
    }
    subscribedDuels.clear();

    for (const pId of subscribedParties) {
      partyClients.get(pId)?.delete(ws);
      if (partyClients.get(pId)?.size === 0) partyClients.delete(pId);
    }
    subscribedParties.clear();
  });


  ws.on('pong', () => {
    if (ws.whooplyPingAt && ws.whooplyUserId) {
      recordUserRtt(ws.whooplyUserId, performance.now() - ws.whooplyPingAt);
      ws.whooplyPingAt = null;
    }
  });

  ws.on('error', () => {});
});

function broadcastToEvent(shareCode, message) {
  const clients = eventClients.get(shareCode);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastToLive(liveId, message, excludeWs = null) {
  const clients = liveClients.get(liveId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function broadcastToUser(userId, message) {
  const clients = userClients.get(userId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastToDuel(duelId, message, excludeWs = null) {
  const clients = duelClients.get(duelId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function broadcastToParty(partyId, message, excludeWs = null) {
  const clients = partyClients.get(partyId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function broadcastGlobal(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch {}
    }
  }
}

// Broadcast a FlashBet event only to the creator and the target audience
function broadcastFlashBetToTargets(flashBet, payload) {
  broadcastToUser(flashBet.creatorId, payload);
  const targets = flashBet.targetUserIds || [];
  for (const tid of targets) {
    if (tid !== flashBet.creatorId) broadcastToUser(tid, payload);
  }
}

// ── Web Push Setup (VAPID) ───────────────────────────
// Keys can be pinned via env so they survive a database reset. If the keys ever change,
// every existing phone subscription stops working (push services answer 403), so the
// client re-syncs its subscription against the current public key on every app start.
// The pair is taken as a whole: mixing an env key with the other half from the database
// would sign every push with a mismatched key and nothing would be delivered.
const envVapidPublic = process.env.VAPID_PUBLIC_KEY;
const envVapidPrivate = process.env.VAPID_PRIVATE_KEY;
if (Boolean(envVapidPublic) !== Boolean(envVapidPrivate)) {
  console.error('VAPID_PUBLIC_KEY och VAPID_PRIVATE_KEY måste sättas tillsammans (eller ingen av dem).');
  process.exit(1);
}
let vapidPublicKey = envVapidPublic || db.getSetting('vapid_public_key');
let vapidPrivateKey = envVapidPrivate || db.getSetting('vapid_private_key');

if (!vapidPublicKey || !vapidPrivateKey) {
  const generated = webpush.generateVAPIDKeys();
  vapidPublicKey = generated.publicKey;
  vapidPrivateKey = generated.privateKey;
  db.setSetting('vapid_public_key', vapidPublicKey);
  db.setSetting('vapid_private_key', vapidPrivateKey);
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:support@whooply.se',
  vapidPublicKey,
  vapidPrivateKey
);

// Sends a push to every device of the given users. Returns what happened so callers
// (e.g. the test button) can report real delivery instead of assuming success.
//
// Everything pushed to a person also lands in their bell, so nothing is lost when push is
// off or missed. Pass { bell: false } for pushes the bell covers another way (friend
// requests are shown as actions) or that lead nowhere in the app.
async function sendPushToUsers(userIds, payload, category = null, { bell = true, bellType = null } = {}) {
  if (!userIds || userIds.length === 0) return { attempted: 0, sent: 0, failed: [] };
  if (bell && category !== 'support') {
    const { icon, text } = splitPushTitle(payload.title);
    for (const uid of new Set(userIds)) {
      try {
        db.addUserNotification(uid, { type: bellType || category || 'push', icon, text, detail: payload.body || null, url: payload.url || null });
      } catch (err) {
        console.warn('[bell] could not save notification:', err.message);
      }
    }
  }
  return sendPushToSubscriptions(db.getPushSubscriptionsForUsers(userIds, category), payload);
}

// "🏆 Inbjudan till event!" → icon 🏆 and the text without it
function splitPushTitle(title = '') {
  const m = String(title).match(/^(\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)\s*(.*)$/u);
  return m ? { icon: m[1], text: m[2] || String(title) } : { icon: '🔔', text: String(title) };
}

async function sendPushToSubscriptions(subscriptions, payload) {
  const result = { attempted: 0, sent: 0, failed: [] };
  if (!subscriptions || subscriptions.length === 0) return result;

  const jsonPayload = JSON.stringify(payload);

  for (const sub of subscriptions) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };
    result.attempted++;
    try {
      // High urgency + a TTL so phones in power-saving mode still get it promptly
      await webpush.sendNotification(pushSub, jsonPayload, { TTL: 60 * 60, urgency: 'high' });
      result.sent++;
    } catch (err) {
      const statusCode = err.statusCode || null;
      const host = (() => { try { return new URL(sub.endpoint).host; } catch { return 'unknown'; } })();
      result.failed.push({ statusCode, host });
      if (statusCode === 410 || statusCode === 404) {
        db.deletePushSubscriptionByEndpoint(sub.endpoint);
      } else {
        console.warn(`[push] Delivery failed (${statusCode || err.code || 'error'}) via ${host} for user ${sub.user_id}: ${String(err.body || err.message || '').slice(0, 200)}`);
      }
    }
  }
  return result;
}

async function sendMaltaSupportNotification(userId, { eventType, details = {}, force = false, url = null }) {
  if (!userId) return;
  if (!db.canSendSupportPush(userId, force)) return;

  const user = db.getUserById(userId);
  if (!user) return;

  try {
    const pushData = await generateMaltaSupportPush({
      eventType,
      user,
      details,
      apiKey: process.env.GEMINI_API_KEY
    });

    if (url) {
      pushData.url = url;
    }

    await sendPushToUsers([userId], pushData, 'support');
    db.recordSupportPushSent(userId);
  } catch (err) {
    console.warn('[malta-support-push] Error sending push notification:', err.message);
  }
}

// ── Helpers ──────────────────────────────────────────
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function generateShareCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

const MIN_ADMIN_PIN_LENGTH = 8;

function isValidAdminPinFormat(pin) {
  return typeof pin === 'string' && pin.trim().length >= MIN_ADMIN_PIN_LENGTH && pin.trim().length <= 128;
}

// ADMIN_PIN from the environment is the source of truth: it is (re)synced into the DB on start
if (process.env.ADMIN_PIN) {
  const envPin = String(process.env.ADMIN_PIN).trim();
  if (isValidAdminPinFormat(envPin)) {
    if (db.getAdminPin() !== hashPin(envPin)) {
      db.setAdminPin(hashPin(envPin));
      console.log('[admin] Superadmin PIN synced from process.env.ADMIN_PIN');
    }
  } else {
    console.warn(`[admin] ADMIN_PIN is set but shorter than ${MIN_ADMIN_PIN_LENGTH} characters — ignored. Use a longer secret.`);
  }
}

function getClientIp(req) {
  return (req && (req.ip || req.socket?.remoteAddress)) || 'unknown';
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// Every admin PIN check goes through here and is rate limited per IP, so the PIN
// cannot be brute forced through any endpoint that accepts it.
function verifyPin(pin, req) {
  if (!pin || typeof pin !== 'string') return false;
  const stored = db.getAdminPin();
  if (!stored) return false;

  const key = 'admin:' + getClientIp(req);
  if (!db.checkRateLimit(key).allowed) return false;

  if (safeEqualHex(hashPin(pin.trim()), stored)) {
    db.clearRateLimit(key);
    return true;
  }
  db.recordFailedAttempt(key, 5, 15);
  return false;
}

// Checks the admin PIN only when it is actually needed, so a stale PIN sent along with
// an otherwise authorized request (e.g. by the creator) never counts as a failed attempt.
function lazyAdminPin(req, pin) {
  let result;
  return () => {
    if (result === undefined) result = Boolean(pin) && verifyPin(pin, req);
    return result;
  };
}

function requireAdminPin(req, res) {
  const limitCheck = db.checkRateLimit('admin:' + getClientIp(req));
  if (!limitCheck.allowed) {
    res.status(429).json({ error: `För många felaktiga PIN-försök. Admin-funktioner spärrade i ${limitCheck.minutesLeft} minuter.` });
    return false;
  }
  const pin = req.body?.pin || req.headers['x-admin-pin'];
  if (!verifyPin(pin, req)) {
    res.status(403).json({ error: 'Ingen behörighet (fel PIN)' });
    return false;
  }
  return true;
}

// Get user from request token
function getUserFromToken(req) {
  let token = req.headers['x-user-token'];
  if (!token && req.headers['authorization']) {
    const parts = req.headers['authorization'].split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1];
    }
  }
  if (!token) return null;
  return db.getUserByToken(token);
}

// Validate that a tournamentId refers to an existing, active tournament the user can access
function validateTournamentContext(user, tournamentId) {
  if (!tournamentId) return { valid: true, tournament: null };
  const t = db.getFullTournament(tournamentId);
  if (!t) return { valid: false, error: 'Turneringen hittades inte' };
  if (t.status === 'settled' || t.status === 'cancelled') {
    return { valid: false, error: 'Turneringen är avslutad' };
  }
  if (!db.canUserAccessTournament(t, user.id)) {
    return { valid: false, error: 'Du har inte tillgång till denna turnering' };
  }
  return { valid: true, tournament: t };
}

// Middleware: require authenticated user
function requireAuth(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  req.user = user;
  next();
}

// Check if user is creator of event, creator of parent tournament, OR has valid PIN
function verifyEventAdmin(req, event) {
  // Check creator token first
  const user = getUserFromToken(req);
  const creatorId = event.creator_id || event.creatorId;
  if (user && creatorId === user.id) return true;
  // If event belongs to a tournament, tournament creator is also an admin
  const tourId = event.tournament_id || event.tournamentId;
  if (user && tourId) {
    const tour = db.getTournamentById(tourId);
    if (tour && (tour.creator_id === user.id || tour.creatorId === user.id)) return true;
  }
  // Fall back to PIN
  const { pin } = req.body || {};
  if (pin && verifyPin(pin, req)) return true;
  return false;
}

// ── Config ──────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({});
});

// ── Admin PIN ────────────────────────────────────────
app.post('/api/admin/setup', (req, res) => {
  if (db.getAdminPin()) {
    return res.status(403).json({ error: 'PIN är redan satt' });
  }
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Superadmin-PIN sätts via miljövariabeln ADMIN_PIN i produktion' });
  }
  const { pin } = req.body || {};
  if (!isValidAdminPinFormat(pin)) {
    return res.status(400).json({ error: `Admin-PIN måste vara minst ${MIN_ADMIN_PIN_LENGTH} tecken` });
  }
  db.setAdminPin(hashPin(pin.trim()));
  res.json({ ok: true });
});

app.post('/api/admin/verify', (req, res) => {
  const limitCheck = db.checkRateLimit('admin:' + getClientIp(req));
  if (!limitCheck.allowed) {
    return res.status(429).json({
      error: `För många felaktiga PIN-försök. Admin-inloggning spärrad i ${limitCheck.minutesLeft} minuter.`
    });
  }

  const { pin } = req.body || {};
  if (!db.getAdminPin()) return res.json({ verified: false, needsSetup: true });

  if (!verifyPin(pin, req)) {
    return res.status(401).json({ verified: false, error: 'Felaktig PIN-kod' });
  }

  db.clearRateLimit('admin:' + getClientIp(req));
  res.json({ verified: true });
});

app.get('/api/admin/status', (req, res) => {
  res.json({
    hasPin: !!db.getAdminPin(),
    geminiLive: isGeminiLive(),
    searchQuota: getSearchQuotaInfo(),
    livekitConfigured: Boolean(process.env.LIVEKIT_URL || db.getSetting('livekit_url'))
  });
});

app.get('/api/admin/gemini', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const key = (process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key') || '').trim();
  res.json({
    live: Boolean(key),
    model: 'gemini-3.6-flash',
    source: process.env.GEMINI_API_KEY ? 'env' : (db.getSetting('gemini_api_key') ? 'db' : 'none'),
    apiKeyMasked: key ? `${key.slice(0, 4)}...${key.slice(-4)}` : '',
    searchQuota: getSearchQuotaInfo()
  });
});

app.post('/api/admin/gemini', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const { apiKey } = req.body || {};
  if (apiKey !== undefined) {
    db.setSetting('gemini_api_key', String(apiKey).trim());
  }
  res.json({ ok: true, live: isGeminiLive() });
});

app.get('/api/admin/livekit', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const cfg = getLiveKitConfig();
  res.json({
    configured: cfg.configured,
    url: cfg.url,
    apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}...${cfg.apiKey.slice(-4)}` : '',
    hasSecret: Boolean(cfg.apiSecret)
  });
});

app.post('/api/admin/livekit', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const { url, apiKey, apiSecret } = req.body || {};
  if (url !== undefined) db.setSetting('livekit_url', String(url).trim());
  if (apiKey !== undefined) db.setSetting('livekit_api_key', String(apiKey).trim());
  if (apiSecret !== undefined) db.setSetting('livekit_api_secret', String(apiSecret).trim());
  res.json({ ok: true, configured: getLiveKitConfig().configured });
});

// Get all users (Superadmin only)
app.post('/api/admin/users', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const users = db.getAllUsers();
  res.json(users);
});

// Reset user PIN (Superadmin only)
app.post('/api/admin/users/:id/reset-pin', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const targetUser = db.getUserById(req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'Användare hittades inte' });

  const resetCode = String(crypto.randomInt(100000, 1000000));
  db.resetUserPin(targetUser.id, resetCode);
  db.clearRateLimit('pinreset:' + targetUser.id);
  res.json({
    ok: true,
    resetCode,
    message: `PIN nollställd för ${targetUser.nickname}. Engångskod: ${resetCode}`
  });
});

// Delete user (Superadmin only)
app.delete('/api/admin/users/:id', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const targetUser = db.getUserById(req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'Användare hittades inte' });

  // Disconnect any active WebSockets for this user
  const clients = userClients.get(targetUser.id);
  if (clients) {
    for (const ws of clients) {
      try {
        ws.send(JSON.stringify({ type: 'account_deleted', message: 'Ditt konto har raderats av administratör' }));
        ws.close(1008, 'Account deleted');
      } catch {}
    }
    userClients.delete(targetUser.id);
  }

  const success = db.deleteUser(targetUser.id);
  if (!success) {
    return res.status(500).json({ error: 'Kunde inte ta bort användaren' });
  }

  res.json({
    ok: true,
    message: `Användaren @${targetUser.nickname} (${targetUser.real_name || targetUser.nickname}) har tagits bort.`
  });
});


// ── Admin Database Backup Operations ─────────────────
app.post('/api/admin/backup', async (req, res) => {
  if (!requireAdminPin(req, res)) return;

  try {
    const backupResult = await db.backupDatabase();
    res.json({ ok: true, backup: backupResult });
  } catch (err) {
    console.error('Backup failed:', err);
    res.status(500).json({ error: 'Kunde inte skapa säkerhetskopia: ' + err.message });
  }
});

app.get('/api/admin/backup/latest', (req, res) => {
  if (!requireAdminPin(req, res)) return;

  const latest = db.getLatestBackup();
  res.json({ ok: true, backup: latest });
});

app.get('/api/admin/backup/download', (req, res) => {
  if (!requireAdminPin(req, res)) return;

  const latest = db.getLatestBackup();
  if (!latest || !fs.existsSync(latest.path)) {
    return res.status(404).json({ error: 'Ingen säkerhetskopia hittades. Skapa en backup först.' });
  }

  res.download(latest.path, latest.name);
});

app.post('/api/admin/backup/verify', async (req, res) => {
  if (!requireAdminPin(req, res)) return;

  const latest = db.getLatestBackup();
  if (!latest || !fs.existsSync(latest.path)) {
    return res.status(404).json({ error: 'Ingen säkerhetskopia hittades' });
  }

  try {
    const { default: Database } = await import('better-sqlite3');
    const testDb = new Database(latest.path, { readonly: true });
    const users = testDb.prepare('SELECT count(*) as c FROM users').get().c;
    const tournaments = testDb.prepare('SELECT count(*) as c FROM tournaments').get().c;
    const duels = testDb.prepare('SELECT count(*) as c FROM minigame_duels').get().c;
    testDb.close();

    res.json({
      ok: true,
      filename: latest.name,
      sizeKB: Math.round(fs.statSync(latest.path).size / 1024),
      contents: { users, tournaments, duels }
    });
  } catch (err) {
    res.status(500).json({ error: 'Backupen kunde inte verifieras: ' + err.message });
  }
});

// ── Admin Debt Management ────────────────────────────
app.post('/api/admin/debts', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  try {
    const duels = db.getAllUnsettledDuels();
    res.json(duels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/duels/:id', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  try {
    const deleted = db.adminDeleteDuel(req.params.id);
    res.json({ ok: true, message: 'Duell makulerad', duel: deleted });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/admin/duels/:id/unsettle', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  try {
    const duel = db.adminUnsettleDuel(req.params.id);
    res.json({ ok: true, message: 'Kvittering ångrad', duel });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/admin/tournaments', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  res.json(db.getAllTournamentsForAdmin());
});

app.get('/api/admin/push-stats', (req, res) => {
  if (!requireAdminPin(req, res)) return;
  const allSubs = db.getAllPushSubscriptions();
  res.json({
    totalSubscribers: allSubs.length
  });
});

app.post('/api/admin/broadcast-push', async (req, res) => {
  if (!requireAdminPin(req, res)) return;

  const { title, body, url, category = 'all' } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Ange en rubrik för notisen' });
  }
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Ange ett meddelande för notisen' });
  }

  const allSubs = db.getAllPushSubscriptions();
  if (!allSubs || allSubs.length === 0) {
    return res.json({ ok: true, sentCount: 0, totalSubscribers: 0, message: 'Inga aktiva push-prenumerationer hittades i systemet.' });
  }

  const payload = JSON.stringify({
    title: title.trim(),
    body: body.trim(),
    url: url?.trim() || '/'
  });

  let sentCount = 0;
  let failedCount = 0;
  let expiredCount = 0;

  for (const sub of allSubs) {
    if (category && category !== 'all' && sub.user_id) {
      const prefs = db.getUserNotificationPrefs(sub.user_id);
      if (category === 'flashbets' && !prefs.notifyFlashbets) continue;
      if (category === 'duels' && !prefs.notifyDuels) continue;
      if (category === 'tournaments' && !prefs.notifyTournaments) continue;
      if (category === 'support' && !prefs.notifySupport) continue;
    }

    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };

    try {
      await webpush.sendNotification(pushSub, payload);
      sentCount++;
    } catch (err) {
      failedCount++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.deletePushSubscriptionByEndpoint(sub.endpoint);
        expiredCount++;
      }
    }
  }

  res.json({
    ok: true,
    sentCount,
    failedCount,
    expiredCount,
    totalSubscribers: allSubs.length,
    message: `Pushnotis skickad till ${sentCount} enheter! 🚀`
  });
});

// ── Users ────────────────────────────────────────────
app.post('/api/users/register', (req, res) => {
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
  const regKey = 'register:' + clientIp;
  const regLimit = db.checkRateLimit(regKey);
  if (!regLimit.allowed) {
    return res.status(429).json({
      error: `För många registreringsförsök från denna IP-adress. Försök igen om ${regLimit.minutesLeft} minuter.`
    });
  }

  const { name, realName, nickname, swishNumber, pin, avatarEmoji } = req.body;

  const finalName = (name || realName || '').trim();
  const finalNickname = (nickname || '').trim();

  if (!finalName || finalName.length < 2) {
    db.recordFailedAttempt(regKey, 10, 15);
    return res.status(400).json({ error: 'Ange ditt riktiga för- och efternamn (minst 2 tecken)' });
  }

  if (!finalNickname || finalNickname.length < 2) {
    return res.status(400).json({ error: 'Bettarnamnet måste vara minst 2 tecken' });
  }

  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'Välj en 4-siffrig personlig PIN-kod (exakt 4 siffror)' });
  }

  const cleanSwish = swishNumber ? (db.normalizePhone(swishNumber) || String(swishNumber).replace(/[^0-9]/g, '')) : null;
  if (!cleanSwish || cleanSwish.length < 8) {
    return res.status(400).json({ error: 'Swish-nummer är obligatoriskt (minst 8 siffror)' });
  }

  // Swedish mobile numbers start with 07 and must be exactly 10 digits
  if (cleanSwish.startsWith('07') && cleanSwish.length !== 10) {
    return res.status(400).json({
      error: 'Svenska mobilnummer för Swish ska ha 10 siffror (t.ex. 070-123 45 67). Kontrollera numret.'
    });
  }

  if (cleanSwish.length > 15) {
    return res.status(400).json({ error: 'Ogiltigt telefonnummer för Swish (ange 8-15 siffror)' });
  }

  // Check if Swish is already registered BEFORE nickname check so returning users aren't falsely blocked
  const existingSwish = db.getUserBySwish(cleanSwish);
  if (existingSwish) {
    // If account has a PIN set, verify it
    if (existingSwish.pin_hash) {
      const limitCheck = checkPinRateLimit(existingSwish.id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          error: `Detta Swish-nummer är redan registrerat och kontot är tillfälligt spärrat på grund av felaktiga PIN-försök. Försök igen om ${limitCheck.minutesLeft} minuter.`
        });
      }

      if (db.verifyUserPin(existingSwish, pin)) {
        // Correct PIN! Returning user logging in via register form
        clearPinAttempts(existingSwish.id);
        db.clearRateLimit(regKey);
        const newToken = crypto.randomBytes(32).toString('hex');
        db.updateUserToken(existingSwish.id, newToken);
        return res.json({
          id: existingSwish.id,
          nickname: existingSwish.nickname,
          realName: existingSwish.real_name,
          swishNumber: existingSwish.swish_number,
          token: newToken,
          avatar: existingSwish.avatar_emoji,
          avatarUrl: existingSwish.avatar_url,
          alreadyRegistered: true,
          message: `Välkommen tillbaka, ${existingSwish.nickname}! Du var redan registrerad, så du loggades in automatiskt.`
        });
      }

      // Wrong PIN entered
      recordFailedPinAttempt(existingSwish.id);
      return res.status(400).json({
        error: `Det här Swish-numret är redan registrerat på "${existingSwish.nickname}". Logga in med din 4-siffriga PIN-kod istället.`,
        code: 'SWISH_ALREADY_REGISTERED',
        existingNickname: existingSwish.nickname,
        swishNumber: cleanSwish
      });
    }

    // Legacy account without a PIN: set PIN and log in
    db.setUserPin(existingSwish.id, pin);
    db.clearRateLimit(regKey);
    const newToken = crypto.randomBytes(32).toString('hex');
    db.updateUserToken(existingSwish.id, newToken);
    return res.json({
      id: existingSwish.id,
      nickname: existingSwish.nickname,
      realName: existingSwish.real_name,
      swishNumber: existingSwish.swish_number,
      token: newToken,
      avatar: existingSwish.avatar_emoji,
      avatarUrl: existingSwish.avatar_url,
      alreadyRegistered: true,
      message: `Välkommen tillbaka, ${existingSwish.nickname}! Vi har uppdaterat ditt konto med din PIN-kod och loggat in dig.`
    });
  }

  // Nickname check for new registrations
  const existingNick = db.getUserByNickname(finalNickname);
  if (existingNick) {
    return res.status(400).json({ error: 'Detta bettarnamn är redan taget. Välj ett annat!' });
  }

  const id = generateId();
  const token = crypto.randomBytes(32).toString('hex');
  const emoji = sanitizeEmoji(avatarEmoji, '👤');

  db.createUser(id, finalNickname, token, emoji, finalName, cleanSwish, pin);
  db.clearRateLimit(regKey);

  res.json({
    id,
    nickname: finalNickname,
    realName: finalName,
    swishNumber: cleanSwish,
    token,
    avatar: emoji,
    avatarUrl: null
  });
});

// Rate limiting for PIN verification (SQLite backed with 15 min lockout after 5 fails)
function checkPinRateLimit(userId) {
  return db.checkRateLimit('pin:' + userId);
}

function recordFailedPinAttempt(userId) {
  return db.recordFailedAttempt('pin:' + userId, 5, 15);
}

function clearPinAttempts(userId) {
  db.clearRateLimit('pin:' + userId);
}

// Emoji Sanitization Helper
export function sanitizeEmoji(str, fallback = '👤') {
  if (!str || typeof str !== 'string') return fallback;
  const trimmed = str.trim();
  if (trimmed.length === 0 || trimmed.length > 8) return fallback;
  if (/[<>"'&;\\\/=`\0]/.test(trimmed)) return fallback;
  const isEmoji = /^[\p{Emoji}\p{Emoji_Component}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}\u200d\ufe0f]+$/u.test(trimmed);
  return isEmoji ? trimmed : fallback;
}

// URL & Image Sanitization Helpers
function isValidImageUrl(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!s || s.length > 15000000) return false;
  if (s.startsWith('data:image/')) {
    const cleaned = s.replace(/[\r\n\s]+/g, '');
    if (/[<>"'\0]/.test(cleaned)) return false;
    return /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml|heic|heif|avif);base64,[A-Za-z0-9+/=]+$/.test(cleaned);
  }
  if (/[<>"'\r\n\0]/.test(s)) return false;
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }
  return false;
}

function isValidHttpUrl(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }
  return false;
}

app.post('/api/users/login', (req, res) => {
  // IP-based rate limit to prevent brute-force from a single source
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
  const ipKey = 'login_ip:' + clientIp;
  const ipLimit = db.checkRateLimit(ipKey);
  if (!ipLimit.allowed) {
    return res.status(429).json({
      error: `För många inloggningsförsök från denna adress. Försök igen om ${ipLimit.minutesLeft} minuter.`
    });
  }

  const { identifier, nickname, swishNumber, pin } = req.body;
  const query = (identifier || nickname || swishNumber || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Ange ditt Bettarnamn eller mobilnummer' });
  }

  const user = db.getUserByNicknameOrSwish(query);
  if (!user) {
    db.recordFailedAttempt(ipKey, 15, 15); // 15 attempts per IP before lockout
    return res.status(404).json({ error: 'Ingen användare hittades med det namnet eller mobilnumret. Skapa profil först!' });
  }

  // Check if admin reset the PIN
  if (user.needs_pin_reset) {
    return res.status(200).json({
      needsPinReset: true,
      nickname: user.nickname,
      message: 'Din PIN-kod har nollställts av admin. Ange din 6-siffriga engångskod och välj en ny PIN!'
    });
  }

  // Check PIN if user has a PIN configured
  if (user.pin_hash) {
    const limitCheck = checkPinRateLimit(user.id);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: `För många felaktiga PIN-försök. Kontot är tillfälligt spärrat i ${limitCheck.minutesLeft} minuter.`
      });
    }

    if (!pin || !db.verifyUserPin(user, pin)) {
      const rec = recordFailedPinAttempt(user.id);
      db.recordFailedAttempt(ipKey, 15, 15); // Also track per IP
      if (rec.count >= 5) {
        return res.status(429).json({
          error: 'För många felaktiga PIN-försök. Kontot har spärrats i 15 minuter.'
        });
      }
      return res.status(401).json({ error: 'Felaktig 4-siffrig PIN-kod. Försök igen!' });
    }

    clearPinAttempts(user.id);
  }

  // Clear IP rate limit on successful login
  db.clearRateLimit(ipKey);

  // Rotate token on every successful login
  const newToken = crypto.randomBytes(32).toString('hex');
  db.updateUserToken(user.id, newToken);

  res.json({
    id: user.id,
    nickname: user.nickname,
    realName: user.real_name,
    swishNumber: user.swish_number,
    token: newToken,
    avatar: user.avatar_emoji,
    avatarUrl: user.avatar_url,
    email: user.email
  });
});

// Complete PIN reset after admin reset
app.post('/api/users/reset-pin', (req, res) => {
  const { identifier, userId, resetCode, newPin } = req.body;
  const cleanCode = (resetCode !== undefined && resetCode !== null) ? String(resetCode).trim() : '';
  const cleanPin = (newPin !== undefined && newPin !== null) ? String(newPin).trim() : '';

  if (!cleanCode || !/^\d{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'Ange den 6-siffriga engångskoden från admin' });
  }
  if (!cleanPin || !/^\d{4}$/.test(cleanPin)) {
    return res.status(400).json({ error: 'Ny PIN måste vara exakt 4 siffror' });
  }

  let user = null;
  if (identifier) {
    user = db.getUserByNicknameOrSwish(String(identifier).trim());
  } else if (userId) {
    user = db.getUserById(userId);
  }

  if (!user) return res.status(404).json({ error: 'Användare hittades inte' });
  if (!user.needs_pin_reset) {
    return res.status(400).json({ error: 'Kontot är inte i återställningsläge' });
  }

  // Limit guesses per account and per IP so the 6-digit code cannot be brute forced
  const resetKey = 'pinreset:' + user.id;
  const resetIpKey = 'pinreset_ip:' + getClientIp(req);
  const resetLimit = db.checkRateLimit(resetKey);
  const resetIpLimit = db.checkRateLimit(resetIpKey);
  if (!resetLimit.allowed || !resetIpLimit.allowed) {
    const minutesLeft = Math.max(resetLimit.minutesLeft || 0, resetIpLimit.minutesLeft || 0);
    return res.status(429).json({
      error: `För många felaktiga försök. Vänta ${minutesLeft} minuter eller be admin om en ny engångskod.`
    });
  }

  const codeMatches = typeof user.reset_code === 'string' && user.reset_code.length === cleanCode.length &&
    crypto.timingSafeEqual(Buffer.from(user.reset_code), Buffer.from(cleanCode));
  if (!codeMatches) {
    db.recordFailedAttempt(resetKey, 5, 15);
    db.recordFailedAttempt(resetIpKey, 10, 15);
    return res.status(401).json({ error: 'Felaktig 6-siffrig engångskod' });
  }

  if (user.reset_code_expires && new Date(user.reset_code_expires) < new Date()) {
    return res.status(400).json({ error: 'Engångskoden har löpt ut. Be admin nollställa PIN på nytt.' });
  }

  const newToken = crypto.randomUUID();
  db.setUserPin(user.id, cleanPin, newToken);
  clearPinAttempts(user.id);
  db.clearRateLimit(resetKey);
  const updated = db.getUserById(user.id);
  res.json({
    id: updated.id,
    nickname: updated.nickname,
    realName: updated.real_name,
    swishNumber: updated.swish_number,
    token: updated.token,
    avatar: updated.avatar_emoji,
    avatarUrl: updated.avatar_url,
    email: updated.email
  });
});

// Change PIN when logged in
app.post('/api/users/change-pin', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });

  const { currentPin, newPin } = req.body;
  if (!newPin || !/^\d{4}$/.test(newPin)) {
    return res.status(400).json({ error: 'Ny PIN måste vara exakt 4 siffror' });
  }

  if (user.pin_hash) {
    const limitCheck = checkPinRateLimit(user.id);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: `För många felaktiga PIN-försök. Kontot är tillfälligt spärrat i ${limitCheck.minutesLeft} minuter.`
      });
    }

    if (!currentPin || !db.verifyUserPin(user, currentPin)) {
      const rec = recordFailedPinAttempt(user.id);
      if (rec.count >= 5) {
        return res.status(429).json({
          error: 'För många felaktiga PIN-försök. Kontot har spärrats i 15 minuter.'
        });
      }
      return res.status(401).json({ error: 'Nuvarande PIN-kod är felaktig' });
    }

    clearPinAttempts(user.id);
  }

  // Rotate token on PIN change for security
  const newToken = crypto.randomBytes(32).toString('hex');
  db.setUserPin(user.id, newPin, newToken);
  res.json({ ok: true, message: 'PIN-koden har ändrats! 🔒', token: newToken });
});

// Logout — invalidate current token
app.post('/api/users/logout', requireAuth, (req, res) => {
  const newToken = crypto.randomBytes(32).toString('hex');
  db.updateUserToken(req.user.id, newToken);
  res.json({ ok: true, message: 'Utloggad' });
});

// WebAuthn / FaceID / TouchID (Disabled temporarily for security hardening)
const webauthnChallenges = new Map();

app.post('/api/auth/webauthn/register-options', (req, res) => {
  res.status(503).json({ error: 'Biometrisk registrering (FaceID / TouchID) uppdateras för utökad FIDO2-säkerhet och är tillfälligt inaktiverad. Använd PIN-kod.' });
});

app.post('/api/auth/webauthn/register-verify', (req, res) => {
  res.status(503).json({ error: 'Biometrisk registrering är tillfälligt inaktiverad av säkerhetsskäl.' });
});

app.post('/api/auth/webauthn/login-options', (req, res) => {
  res.status(503).json({ error: 'Biometrisk inloggning är tillfälligt inaktiverad av säkerhetsskäl.' });
});

app.post('/api/auth/webauthn/login-verify', (req, res) => {
  res.status(503).json({ error: 'Biometrisk inloggning (FaceID / TouchID) uppdateras för högre säkerhet och är tillfälligt inaktiverad. Vänligen logga in med din 4-siffriga PIN-kod eller lösenord.' });
});

app.get('/api/users/me/credentials', (req, res) => {
  res.json({ count: 0, hasBiometric: false, disabledForSecurity: true });
});

app.put('/api/users/me/profile', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });

  const { name, realName, nickname, swishNumber, avatarEmoji, avatar_emoji } = req.body;
  if (name || realName) {
    db.updateUserRealName(user.id, (name || realName).trim());
  }
  if (nickname && nickname.trim().length >= 2) {
    const existing = db.getUserByNickname(nickname.trim());
    if (existing && existing.id !== user.id) {
      return res.status(400).json({ error: 'Detta bettarnamn är redan upptaget' });
    }
    db.updateUserNickname(user.id, nickname.trim());
  }
  const newEmoji = avatarEmoji || avatar_emoji;
  if (newEmoji !== undefined && newEmoji !== null) {
    db.updateUserAvatar(user.id, sanitizeEmoji(newEmoji, user.avatar_emoji || '👤'));
  }
  if (swishNumber !== undefined && swishNumber !== null && String(swishNumber).trim() !== '') {
    const cleanSwish = db.normalizePhone(swishNumber) || String(swishNumber).replace(/[^0-9]/g, '');
    if (cleanSwish.startsWith('07') && cleanSwish.length !== 10) {
      return res.status(400).json({ error: 'Svenska mobilnummer för Swish ska ha 10 siffror (t.ex. 070-123 45 67)' });
    }
    if (cleanSwish.length < 8 || cleanSwish.length > 15) {
      return res.status(400).json({ error: 'Ogiltigt Swish-nummer (ange 8-15 siffror)' });
    }
    const existingSwish = db.getUserBySwish(cleanSwish);
    if (existingSwish && existingSwish.id !== user.id) {
      return res.status(400).json({ error: 'Detta Swish-nummer är redan registrerat på en annan användare' });
    }
    db.updateUserSwish(user.id, cleanSwish);
  } else if (swishNumber === null || (swishNumber !== undefined && String(swishNumber).trim() === '')) {
    db.updateUserSwish(user.id, null);
  }

  const updated = db.getUserById(user.id);
  res.json({
    ok: true,
    user: {
      id: updated.id,
      nickname: updated.nickname,
      realName: updated.real_name,
      swishNumber: updated.swish_number,
      avatar: updated.avatar_emoji,
      avatarUrl: updated.avatar_url
    }
  });
});

app.put('/api/users/me/swish', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });

  const raw = req.body.swishNumber;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const cleanSwish = db.normalizePhone(raw) || String(raw).replace(/[^0-9]/g, '');
    if (cleanSwish.startsWith('07') && cleanSwish.length !== 10) {
      return res.status(400).json({ error: 'Svenska mobilnummer för Swish ska ha 10 siffror (t.ex. 070-123 45 67)' });
    }
    if (cleanSwish.length < 8 || cleanSwish.length > 15) {
      return res.status(400).json({ error: 'Ogiltigt Swish-nummer (ange 8-15 siffror)' });
    }
    const existingSwish = db.getUserBySwish(cleanSwish);
    if (existingSwish && existingSwish.id !== user.id) {
      return res.status(400).json({ error: 'Detta Swish-nummer är redan registrerat på en annan användare' });
    }
    db.updateUserSwish(user.id, cleanSwish);
    res.json({ ok: true, swishNumber: cleanSwish });
  } else {
    db.updateUserSwish(user.id, null);
    res.json({ ok: true, swishNumber: null });
  }
});

app.get('/api/users/me', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });
  res.json({
    id: user.id,
    nickname: user.nickname,
    realName: user.real_name,
    swishNumber: user.swish_number,
    avatar: user.avatar_emoji,
    avatarUrl: user.avatar_url,
    email: user.email
  });
});

app.get('/api/users/me/bets', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });

  const bets = db.getUserBets(user.id);
  const cache = new Map();
  res.json(bets.map(b => {
    const r = db.getEventBetOutcome(b, cache);
    return {
      id: b.id,
      eventName: b.event_name,
      eventCode: b.share_code,
      eventStatus: b.event_status,
      playerName: b.player_name,
      amount: b.amount,
      timestamp: b.timestamp,
      outcome: r.outcome,
      net: Math.round(r.net),
      won: r.outcome === 'won'
    };
  }));
});

app.get('/api/users/me/photos', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });

  const photos = db.getUserTournamentPhotos(user.id);
  res.json(photos);
});

app.put('/api/users/me/avatar', express.json({ limit: '10mb' }), async (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });

  let { imageData } = req.body;
  if (!imageData) return res.status(400).json({ error: 'Bilddata saknas' });
  if (!isValidImageUrl(imageData)) {
    return res.status(400).json({ error: 'Ogiltigt bildformat. Måste vara data:image/ eller giltig http/https-URL.' });
  }
  if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
    imageData = imageData.replace(/[\r\n\s]+/g, '');
  }

  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    let url = '';

    if (cloudName && apiKey && apiSecret) {
      const timestamp = Math.round(Date.now() / 1000);
      const folder = `whooply/avatars`;
      const signStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha1').update(signStr).digest('hex');

      const formData = new URLSearchParams();
      formData.append('file', imageData);
      formData.append('folder', folder);
      formData.append('timestamp', timestamp);
      formData.append('api_key', apiKey);
      formData.append('signature', signature);

      const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
      });

      if (!cloudRes.ok) {
        const errText = await cloudRes.text();
        console.error('Cloudinary Error Data:', errText);
        throw new Error('Cloudinary fel: ' + errText);
      }
      const cloudData = await cloudRes.json();
      // Use Cloudinary transformation for a perfect square avatar thumbnail natively
      url = cloudData.secure_url.replace('/upload/', '/upload/w_200,h_200,c_fill,g_face/');
    } else {
      // Fallback
      url = imageData;
    }

    db.updateUserAvatarUrl(user.id, url);
    res.json({ ok: true, avatarUrl: url });
  } catch (err) {
    console.error('Avatar upload error:', err.message);
    res.status(500).json({ error: 'Kunde inte uppdatera profilbilden' });
  }
});

// ── Tournament Photos ─────────────────────────────────
app.get('/api/tournaments/:id/photos', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });
  const user = getUserFromToken(req); // Optional for fetching likes

  const photos = db.getPhotosByTournament(tournament.id, user ? user.id : null);
  res.json(photos.map(p => ({
    id: p.id,
    url: p.url,
    thumbnailUrl: p.thumbnail_url,
    caption: p.caption,
    userId: p.user_id,
    uploaderName: p.uploader_name,
    uploaderAvatar: p.uploader_avatar,
    uploaderEmoji: p.uploader_emoji || '🎲',
    createdAt: p.created_at,
    likeCount: p.like_count || 0,
    userLiked: !!p.user_liked
  })));
});

app.post('/api/tournaments/:id/photos', express.json({ limit: '10mb' }), async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs för att ladda upp bilder' });

  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  let { imageData, caption } = req.body;
  if (!imageData) return res.status(400).json({ error: 'Ingen bild skickades' });
  if (!isValidImageUrl(imageData)) {
    return res.status(400).json({ error: 'Ogiltigt bildformat. Måste vara data:image/ eller giltig http/https-URL.' });
  }
  if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
    imageData = imageData.replace(/[\r\n\s]+/g, '');
  }

  const shareCode = tournament.shareCode || tournament.share_code;

  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    let url = '';
    let thumbUrl = '';

    // If Cloudinary is configured, use it. Otherwise, fallback to base64 inline (not recommended for prod, but good for test).
    if (cloudName && apiKey && apiSecret) {
      const timestamp = Math.round(Date.now() / 1000);
      const folder = `whooply/tournaments/${shareCode}`;
      const signStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha1').update(signStr).digest('hex');

      const formData = new URLSearchParams();
      formData.append('file', imageData);
      formData.append('folder', folder);
      formData.append('timestamp', timestamp);
      formData.append('api_key', apiKey);
      formData.append('signature', signature);

      const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
      });

      if (!cloudRes.ok) {
        const errText = await cloudRes.text();
        console.error('Cloudinary Error Data (Feed):', errText);
        throw new Error('Cloudinary fel: ' + errText);
      }
      const cloudData = await cloudRes.json();
      url = cloudData.secure_url;
      thumbUrl = url.replace('/upload/', '/upload/w_400,h_400,c_fill/');
    } else {
      // Fallback: Just save the raw Base64 string directly
      url = imageData;
      thumbUrl = imageData; // no thumbnailing for base64 fallback
    }

    const photoId = generateId();
    db.addTournamentPhoto(photoId, tournament.id, user.id, url, thumbUrl, caption);

    if (shareCode) {
      broadcastToEvent(shareCode, {
        type: 'tournament_updated',
        tournamentCode: shareCode
      });
    }

    res.json({
      id: photoId,
      url,
      thumbnailUrl: thumbUrl,
      caption,
      uploaderName: user.nickname,
      uploaderAvatar: user.avatar_url,
      uploaderEmoji: user.avatar_emoji || '🎲',
      userId: user.id
    });
  } catch (err) {
    console.error('Photo upload error:', err.message);
    res.status(500).json({ error: 'Uppladdningen misslyckades' });
  }
});

app.delete('/api/tournaments/:id/photos/:photoId', (req, res) => {
  const user = getUserFromToken(req);
  const tournament = db.getFullTournament(req.params.id);

  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  // Verify ownership or super admin
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!user && !hasPin()) return res.status(401).json({ error: 'Inloggning krävs' });

  const isCreator = Boolean(user && tournament.creatorId === user.id);

  const photos = db.getPhotosByTournament(tournament.id);
  const photo = photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Bilden hittades inte' });

  if ((!user || photo.user_id !== user.id) && !isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet att ta bort denna bild' });
  }

  db.deleteTournamentPhoto(req.params.photoId);
  const shareCode = tournament.shareCode || tournament.share_code;
  if (shareCode) {
    broadcastToEvent(shareCode, {
      type: 'tournament_updated',
      tournamentCode: shareCode
    });
  }
  res.json({ ok: true });
});

app.post('/api/tournaments/:id/photos/:photoId/like', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs för att gilla bilder' });

  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const photos = db.getPhotosByTournament(tournament.id);
  const photo = photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Bilden hittades inte i denna turnering' });

  const liked = db.togglePhotoLike(req.params.photoId, user.id);
  const shareCode = tournament.shareCode || tournament.share_code;
  if (shareCode) {
    broadcastToEvent(shareCode, {
      type: 'tournament_updated',
      tournamentCode: shareCode
    });
  }
  res.json({ liked });
});

app.get('/api/users/me/stats', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Ej inloggad' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Ogiltig token' });
  res.json(db.getUserStats(user.id));
});

// ── Friends ──────────────────────────────────────────
app.get('/api/friends', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });
  res.json(db.getFriends(user.id));
});

// Signed personal invite link: whoever shares their link has consented up front,
// so opening someone's link creates the friendship directly.
function getFriendInviteSecret() {
  let secret = db.getSetting('friend_invite_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    db.setSetting('friend_invite_secret', secret);
  }
  return secret;
}

function friendInviteToken(userId) {
  return crypto.createHmac('sha256', getFriendInviteSecret()).update(String(userId)).digest('hex').slice(0, 32);
}

function isValidFriendInviteToken(userId, token) {
  if (typeof token !== 'string') return false;
  const expected = friendInviteToken(userId);
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function publicFriend(target) {
  return {
    id: target.id,
    nickname: target.nickname,
    realName: target.real_name,
    avatarEmoji: target.avatar_emoji,
    avatarUrl: target.avatar_url
  };
}

app.get('/api/friends/invite-token', requireAuth, (req, res) => {
  res.json({ token: friendInviteToken(req.user.id), nickname: req.user.nickname });
});

app.get('/api/friends/requests', requireAuth, (req, res) => {
  res.json(db.getFriendRequests(req.user.id));
});

app.post('/api/friends', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });

  const { friendId, nickname, inviteToken } = req.body || {};
  let target = null;
  if (friendId) {
    target = db.getUserById(friendId);
  } else if (nickname) {
    target = db.getUserByNicknameOrSwish(String(nickname).trim());
  }

  if (!target) {
    return res.status(404).json({ error: 'Kunde inte hitta användaren' });
  }

  if (target.id === user.id) {
    return res.status(400).json({ error: 'Du kan inte lägga till dig själv som vän' });
  }

  if (db.isFriend(user.id, target.id)) {
    return res.json({ ok: true, status: 'already_friends', message: `Du och ${target.nickname} är redan vänner! 👥`, friend: publicFriend(target) });
  }

  if (inviteToken && isValidFriendInviteToken(target.id, inviteToken)) {
    db.addFriend(user.id, target.id);
    db.declineFriendRequest(user.id, target.id);
    db.declineFriendRequest(target.id, user.id);
    broadcastToUser(target.id, { type: 'friend_added', friend: publicFriend(user) });
    db.addUserNotification(target.id, { type: 'friend_via_link', icon: '👥', text: `${user.nickname || 'Någon'} blev din vän via din inbjudningslänk`, url: '/#profile' });
    return res.json({ ok: true, status: 'accepted', message: `${target.nickname} har lagts till som vän! 👥`, friend: publicFriend(target) });
  }

  const result = db.requestFriend(user.id, target.id);
  if (result.status === 'accepted') {
    broadcastToUser(target.id, { type: 'friend_added', friend: publicFriend(user) });
    notifyFriendAccepted(target.id, user);
    return res.json({ ok: true, status: 'accepted', message: `Du och ${target.nickname} är nu vänner! 👥`, friend: publicFriend(target) });
  }

  const requesterName = user.nickname || user.real_name || 'Någon';
  broadcastToUser(target.id, { type: 'friend_request', from: publicFriend(user) });
  sendPushToUsers([target.id], {
    title: '👥 Ny vänförfrågan',
    body: `${requesterName} vill bli vän med dig i Whooply.`,
    url: '/#profile'
  }, null, { bell: false }).catch(() => {});

  res.json({
    ok: true,
    status: 'pending',
    message: `Vänförfrågan skickad till ${target.nickname}! 📨`,
    friend: publicFriend(target)
  });
});

app.post('/api/friends/requests/:fromUserId/accept', requireAuth, (req, res) => {
  const ok = db.acceptFriendRequest(req.params.fromUserId, req.user.id);
  if (!ok) return res.status(404).json({ error: 'Vänförfrågan hittades inte' });
  broadcastToUser(req.params.fromUserId, { type: 'friend_added', friend: publicFriend(req.user) });
  notifyFriendAccepted(req.params.fromUserId, req.user);
  res.json({ ok: true });
});

// Tell whoever asked that they are now friends (bell + push)
function notifyFriendAccepted(requesterId, accepter) {
  const name = accepter.nickname || accepter.real_name || 'En vän';
  sendPushToUsers([requesterId], {
    title: '🤝 Ny vän!',
    body: `${name} godkände din vänförfrågan – ni är nu vänner!`,
    url: '/#profile'
  }, null, { bellType: 'friend_accepted' }).catch(() => {});
}

// ── Inbox (the bell) ─────────────────────────────────
app.get('/api/inbox', requireAuth, (req, res) => {
  res.json(db.getInbox(req.user.id, req.query.lang === 'en' ? 'en' : 'sv'));
});

app.post('/api/inbox/read', requireAuth, (req, res) => {
  db.markInboxRead(req.user.id);
  res.json({ ok: true });
});

app.post('/api/inbox/clear', requireAuth, (req, res) => {
  db.clearInbox(req.user.id);
  res.json({ ok: true });
});

app.post('/api/friends/requests/:fromUserId/decline', requireAuth, (req, res) => {
  // Also lets the sender withdraw their own outgoing request
  const declined = db.declineFriendRequest(req.params.fromUserId, req.user.id) ||
    db.declineFriendRequest(req.user.id, req.params.fromUserId);
  if (!declined) return res.status(404).json({ error: 'Vänförfrågan hittades inte' });
  res.json({ ok: true });
});

app.delete('/api/friends/:friendId', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });

  db.removeFriend(user.id, req.params.friendId);
  res.json({ ok: true, message: 'Vän borttagen' });
});

app.get('/api/users/search', requireAuth, (req, res) => {
  const query = req.query.q || '';
  const results = db.searchUsers(query, req.user.id);
  res.json(results);
});

// ── Leaderboard ──────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  res.json(db.getLeaderboard());
});

// ── Events ───────────────────────────────────────────
// Events in a tournament follow the tournament's visibility (friends / friends of friends / link)
function canViewEvent(event, user) {
  const tournamentId = event.tournamentId || event.tournament_id;
  if (!tournamentId) return true;
  const tournament = db.getTournamentById(tournamentId);
  if (!tournament) return true;
  return db.canUserAccessTournament(tournament, user ? user.id : null);
}

// Anonymous viewers may see a match (so shared links work before logging in), but not
// anyone's Swish number or user ids.
function publicEventView(event) {
  const { swishNumber, winnerSwishNumber, ...rest } = event;
  return {
    ...rest,
    bets: (event.bets || []).map(({ userId, ...bet }) => bet),
    ...(Array.isArray(event.entries) ? { entries: event.entries.map(({ userId, ...entry }) => entry) } : {})
  };
}

app.get('/api/events', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const user = getUserFromToken(req);
  // Standalone matches by default; tournament rounds are listed under their tournament.
  // With ?all=1, rounds are included only for tournaments the caller may see.
  const includeAll = req.query.all === '1';
  const summaries = db.getEventSummaries(includeAll).filter(e => canViewEvent(e, user));
  res.json(summaries);
});

app.post('/api/events', (req, res) => {
  const { pin, name, date, payoutPercent, minBet, maxBet, players, swishNumber, tournamentId, imageUrl } = req.body || {};

  // Allow creation with user token OR admin PIN
  const user = getUserFromToken(req);
  const hasPin = lazyAdminPin(req, pin);
  if (!user && !hasPin()) {
    return res.status(403).json({ error: 'Logga in eller ange admin-PIN för att skapa match' });
  }

  // If adding to a tournament, verify that the caller is tournament creator or superadmin
  if (tournamentId) {
    const tournament = db.getFullTournament(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Turneringen hittades inte' });
    }
    const isTournamentCreator = user && tournament.creatorId === user.id;
    if (!isTournamentCreator && !hasPin()) {
      return res.status(403).json({ error: 'Du har inte behörighet att lägga till matcher i denna turnering' });
    }
    if (tournament.status === 'settled') {
      return res.status(400).json({ error: 'Turneringen är avslutad. Återöppna turneringen för att lägga till matcher.' });
    }
  }

  const finalName = (name || '').trim();
  if (!finalName || finalName.length < 2) {
    return res.status(400).json({ error: 'Ett matchnamn krävs (minst 2 tecken)' });
  }

  if (imageUrl && !isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för matchen' });
  }

  // Parse and deduplicate players (supports both string names and objects with imageUrl)
  const playerData = [];
  const seenNames = new Set();
  for (const p of (players || [])) {
    const pName = (typeof p === 'string' ? p : (p?.name || '')).trim();
    const pImg = (typeof p === 'object' && p?.imageUrl) ? p.imageUrl : null;
    if (pImg && !isValidImageUrl(pImg)) {
      return res.status(400).json({ error: 'Ogiltig bild-URL för deltagare' });
    }
    if (pName && !seenNames.has(pName.toLowerCase())) {
      seenNames.add(pName.toLowerCase());
      playerData.push({ id: generateId(), name: pName, imageUrl: pImg });
    }
  }

  if (playerData.length < 2) {
    return res.status(400).json({ error: 'Minst 2 deltagare krävs för att skapa en match' });
  }

  const min = Math.max(1, Number(minBet) || 10);
  const max = Math.max(min, Number(maxBet) || 10000);
  const payout = payoutPercent !== undefined ? Math.min(100, Math.max(0, Number(payoutPercent))) : 100;
  const swish = swishNumber ? swishNumber.replace(/[^0-9]/g, '') : (user?.swish_number || null);

  let validClosesAt = null;
  if (req.body.closesAt) {
    const d = new Date(req.body.closesAt);
    if (!isNaN(d.getTime())) validClosesAt = d.toISOString();
  }

  const eventData = {
    id: generateId(),
    name: finalName,
    date: date || new Date().toISOString().split('T')[0],
    status: 'open',
    shareCode: generateShareCode(),
    payoutPercent: payout,
    minBet: min,
    maxBet: max,
    creatorId: user ? user.id : null,
    swishNumber: swish,
    tournamentId: tournamentId || null,
    isSideBet: 0,
    linkedRoundId: null,
    betMode: 'open',
    imageUrl: imageUrl || null,
    closesAt: validClosesAt
  };

  db.createEvent(eventData, playerData);

  const full = db.getFullEvent(eventData.id);
  res.json(full);
});

app.get('/api/events/active', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.json({ activeEvent: null });
  const activeEvent = db.getActiveTournamentForUser(user.id);
  res.json({ activeEvent });
});

app.get('/api/events/:idOrCode', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const event = db.getFullEvent(req.params.idOrCode);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });

  const user = getUserFromToken(req);
  if (!canViewEvent(event, user)) {
    return user
      ? res.status(403).json({ error: 'Du har inte tillgång till detta event' })
      : res.status(401).json({ error: 'Logga in för att se detta event' });
  }
  hidePicksWhileOpen(event, user);
  // Whether the result dialog can offer "read the result from a photo". Not sensitive, and
  // organisers who manage a game with the PIN (no login) need it too
  const out = user ? event : publicEventView(event);
  out.canReadResultPhoto = canReadResults();
  res.json(out);
});

// The organiser's photo of the result (scorecard, GameBook leaderboard): the AI suggests the
// winner among the game's options. Only a suggestion; settling is still the organiser's tap.
// Every reading is a paid AI call: a few per organiser, one at a time, and a cap per IP
const resultReads = new Map(); // key -> timestamps
const readsInFlight = new Set();
function allowResultRead(key, max, windowMs) {
  const now = Date.now();
  if (resultReads.size > 2000) {
    for (const [k, times] of resultReads) if (!times.some(t => now - t < 60 * 60 * 1000)) resultReads.delete(k);
  }
  const recent = (resultReads.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) {
    resultReads.set(key, recent);
    return false;
  }
  recent.push(now);
  resultReads.set(key, recent);
  return true;
}

app.post('/api/events/:id/read-result', express.json({ limit: '8mb' }), async (req, res) => {
  const event = db.getFullEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Spelet hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });
  if (event.status === 'finished' || event.status === 'cancelled') return res.status(400).json({ error: 'Spelet är redan avgjort' });
  if (!canReadResults()) return res.status(503).json({ error: 'AI-avläsning är inte påslagen' });
  const who = getUserFromToken(req)?.id || 'ip:' + getClientIp(req);
  if (readsInFlight.has(who)) return res.status(429).json({ error: 'Vänta, bilden läses redan av' });
  if (!allowResultRead('user:' + who, 6, 10 * 60 * 1000) || !allowResultRead('ip:' + getClientIp(req), 20, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Många avläsningar på kort tid – välj vinnaren själv eller försök igen om en stund' });
  }
  readsInFlight.add(who);
  try {
    const result = await readResultFromImage(event, req.body?.image);
    if (!result.ok) return res.status(result.error === 'Bilden kunde inte läsas' ? 400 : 503).json({ error: result.error });
    res.json({ winnerIds: result.winnerIds, reason: result.reason });
  } finally {
    readsInFlight.delete(who);
  }
});

// Link to where the game is followed live, e.g. a GameBook leaderboard
app.put('/api/events/:id/result-url', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Spelet hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });
  const raw = String(req.body?.url || '').trim();
  if (raw && !db.cleanResultUrl(raw)) return res.status(400).json({ error: 'Länken måste börja med https://' });
  db.setEventResultUrl(event.id, raw);
  broadcastToEvent(event.share_code, { type: 'event_updated', eventCode: event.share_code });
  const t = event.tournament_id ? db.getTournamentById(event.tournament_id) : null;
  if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  res.json({ ok: true, resultUrl: db.cleanResultUrl(raw) });
});

// In a pick game nobody can copy anyone: others' tips show once betting has closed
function hidePicksWhileOpen(event, user) {
  if (event.betMode !== 'picks' || !Array.isArray(event.entries)) return;
  const open = event.status === 'open' && !(event.closesAt && new Date(event.closesAt).getTime() <= Date.now());
  if (!open) return;
  event.entries = event.entries.map(e => (user && e.userId === user.id ? e : { ...e, picks: null }));
}

app.post('/api/events/:id/picks', requireAuth, (req, res) => {
  const event = db.getFullEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Spelet hittades inte' });
  if (!canViewEvent(event, req.user)) return res.status(403).json({ error: 'Du har inte tillgång till detta spel' });
  if (!req.user.swish_number) return res.status(400).json({ error: 'Lägg till ditt Swish-nummer i profilen först' });
  try {
    const entry = db.setEventPicks(event.id, req.user, req.body?.picks);
    const t = event.tournamentId ? db.getTournamentById(event.tournamentId) : null;
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
    broadcastToEvent(event.shareCode, { type: 'event_updated', eventCode: event.shareCode });
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// A coupon is corrected match by match as the matches finish; everyone sees the standings live
app.put('/api/events/:id/coupon-result', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Spelet hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });
  try {
    const out = db.setCouponResult(event.id, req.body?.match, req.body?.result ?? null);
    if (out.locked) broadcastToEvent(event.share_code, { type: 'event_locked', eventCode: event.share_code });
    broadcastToEvent(event.share_code, { type: 'event_updated', eventCode: event.share_code });
    const t = event.tournament_id ? db.getTournamentById(event.tournament_id) : null;
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// ── Helper for public HTTPS base URL ────────────────
function getPublicBaseUrl(req) {
  let base = req.query?.baseUrl;
  if (!base) {
    const host = req.get('host') || 'betpals-production.up.railway.app';
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : req.protocol) || 'https';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const formattedHost = isLocal ? host.replace('3001', '5173') : host;
    base = `${proto}://${formattedHost}`;
  }
  if (!base.includes('localhost') && !base.includes('127.0.0.1')) {
    base = base.replace(/^http:\/\//i, 'https://');
  }
  return base.replace(/\/$/, '');
}

// ── QR Code ──────────────────────────────────────────
app.get('/api/events/:idOrCode/qr', async (req, res) => {
  const event = db.getFullEvent(req.params.idOrCode);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });

  const baseUrl = getPublicBaseUrl(req);
  const url = `${baseUrl}/?page=event&code=${event.shareCode}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#FFD700', light: '#07070e' }
    });
    res.json({ qr: qrDataUrl, url });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte generera QR-kod' });
  }
});

// Tournament QR
app.get('/api/tournaments/:code/qr', async (req, res) => {
  const tournament = db.getTournamentByCode(req.params.code);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const baseUrl = getPublicBaseUrl(req);
  const url = `${baseUrl}/?page=tournament&code=${tournament.share_code}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#FFD700', light: '#07070e' }
    });
    res.json({ qr: qrDataUrl, url });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte generera QR-kod' });
  }
});

// ── Players ──────────────────────────────────────────
app.post('/api/events/:id/players', (req, res) => {
  const { pin, name, imageUrl } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });
  if (db.isCouponEvent(event.id)) return res.status(400).json({ error: 'En tipsrads matcher kan inte ändras – skapa en ny tipsrad' });

  const cleanName = (name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'Spelarnamn krävs' });

  if (imageUrl && !isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för spelare' });
  }

  const existingPlayers = db.getPlayersByEvent(event.id);
  if (existingPlayers.some(p => p.name.toLowerCase() === cleanName.toLowerCase())) {
    return res.status(400).json({ error: 'En spelare med detta namn finns redan i matchen' });
  }

  const playerId = generateId();
  db.addPlayer(req.params.id, playerId, cleanName, imageUrl || null);

  broadcastToEvent(event.share_code, { type: 'player_added', eventCode: event.share_code });
  res.json({ id: playerId, name: cleanName, imageUrl: imageUrl || null });
});

app.put('/api/events/:id/players/:playerId/image', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  const player = db.getPlayerById(req.params.playerId);
  if (!player || player.event_id !== event.id) return res.status(404).json({ error: 'Spelaren hittades inte' });

  const { imageUrl } = req.body;
  if (imageUrl && !isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för spelare' });
  }

  db.updatePlayerImage(player.id, imageUrl || null);

  broadcastToEvent(event.share_code, { type: 'player_updated', eventCode: event.share_code });
  res.json({ ok: true, id: player.id, imageUrl: imageUrl || null });
});

app.delete('/api/events/:id/players/:playerId', (req, res) => {
  const { pin } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });
  if (db.isCouponEvent(event.id)) return res.status(400).json({ error: 'En tipsrads matcher kan inte ändras – skapa en ny tipsrad' });

  const player = db.getPlayerById(req.params.playerId);
  if (!player || player.event_id !== event.id) {
    return res.status(404).json({ error: 'Spelaren hittades inte i denna match' });
  }

  db.removePlayer(req.params.id, req.params.playerId);
  broadcastToEvent(event.share_code, { type: 'player_removed', eventCode: event.share_code });

  const updated = db.getFullEvent(event.share_code);
  broadcastToEvent(event.share_code, {
    type: 'odds_update',
    eventCode: event.share_code,
    odds: updated.odds,
    totalPool: updated.totalPool,
    betCount: updated.bets.length
  });

  res.json({ ok: true });
});

// ── Bets ─────────────────────────────────────────────
app.post('/api/events/:idOrCode/bets', (req, res) => {
  const event = db.getFullEvent(req.params.idOrCode);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if ((event.betMode || event.bet_mode) === 'picks') {
    return res.status(400).json({ error: 'I det här spelet väljer du dina tips i listan' });
  }
  if (event.status !== 'open') {
    return res.status(400).json({ error: 'Bettning är stängd för detta event' });
  }

  if (event.closesAt && new Date() > new Date(event.closesAt)) {
    return res.status(400).json({ error: 'Tiden har gått ut! Bettning är stängd för detta spel' });
  }

  if (event.tournamentId) {
    const tournament = db.getFullTournament(event.tournamentId);
    if (tournament && tournament.status === 'settled') {
      return res.status(400).json({ error: 'Turneringen är avslutad och tar inte emot fler bets' });
    }
  }

  const { playerId, amount } = req.body;
  if (!playerId) return res.status(400).json({ error: 'Välj en spelare' });
  if (!event.players.find(p => p.id === playerId)) {
    return res.status(400).json({ error: 'Spelare finns inte' });
  }

  const betAmount = Number(amount);
  if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Ogiltigt belopp' });
  if (betAmount < event.minBet) return res.status(400).json({ error: `Minsta insats är ${event.minBet} kr` });
  if (betAmount > event.maxBet) return res.status(400).json({ error: `Högsta insats är ${event.maxBet} kr` });

  // Require user authentication
  const loggedInUser = getUserFromToken(req);
  if (!loggedInUser) {
    return res.status(401).json({ error: 'Du måste vara inloggad för att lägga ett bet' });
  }

  if (!loggedInUser.swish_number) {
    return res.status(400).json({ error: 'Du behöver ange ett Swish-nummer i din profil för att kunna lägga bets' });
  }

  const cleanBettor = (loggedInUser.real_name || loggedInUser.nickname || '').trim();
  if (!cleanBettor) {
    return res.status(400).json({ error: 'Profilen saknar namn' });
  }
  const userId = loggedInUser.id;

  if (event.tournamentId) {
    const tournament = db.getFullTournament(event.tournamentId);
    if (tournament && !db.canUserAccessTournament(tournament, userId)) {
      return res.status(403).json({ error: 'Du har inte tillträde till detta event' });
    }
  }

  const betId = generateId();
  db.addBet(betId, event.id, cleanBettor, playerId, betAmount, userId);

  // Broadcast updated odds + bet notification
  const updated = db.getFullEvent(event.shareCode);
  const playerName = event.players.find(p => p.id === playerId)?.name || '?';
  broadcastToEvent(event.shareCode, {
    type: 'odds_update',
    eventCode: event.shareCode,
    odds: updated.odds,
    totalPool: updated.totalPool,
    betCount: updated.bets.length,
    // Notification data
    notification: {
      type: 'bet_placed',
      bettor: cleanBettor,
      player: playerName,
      amount: betAmount
    }
  });

  if (event.tournamentId) {
    const t = db.getTournamentById(event.tournamentId);
    if (t) {
      broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
    }
  }

  res.json({ id: betId, bettorName: cleanBettor, playerId, amount: betAmount });
});

app.post('/api/events/:id/bets/:betId/paid', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });

  if (event.tournament_id) {
    return res.status(400).json({ error: 'Matcher i en turnering avräknas samlat i THE TAB' });
  }

  const full = db.getFullEvent(event.id);
  const bet = full?.bets.find(b => b.id === req.params.betId);
  if (!bet) return res.status(404).json({ error: 'Bet hittades inte' });

  const user = getUserFromToken(req);
  const isAdmin = verifyEventAdmin(req, event);
  const isBettor = user && ((bet.userId && bet.userId === user.id) || (bet.bettorName && (user.nickname === bet.bettorName || user.real_name === bet.bettorName)));

  if (!isAdmin && !isBettor) {
    return res.status(403).json({ error: 'Endast skaparen, admin eller spelaren själv kan markera bet som betalt' });
  }

  const { paid } = req.body;
  db.markBetPaid(req.params.id, req.params.betId, !!paid);

  broadcastToEvent(event.share_code, {
    type: 'bet_paid_update',
    eventCode: event.share_code,
    betId: req.params.betId,
    paid: !!paid
  });
  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({ ok: true, paid: !!paid });
});

app.delete('/api/events/:id/bets/:betId', (req, res) => {
  const { pin } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  db.removeBet(req.params.id, req.params.betId);

  const updated = db.getFullEvent(event.share_code);
  broadcastToEvent(event.share_code, {
    type: 'odds_update',
    eventCode: event.share_code,
    odds: updated.odds,
    totalPool: updated.totalPool,
    betCount: updated.bets.length
  });

  res.json({ ok: true });
});

// ── Event Actions ────────────────────────────────────
app.post('/api/events/:id/lock', (req, res) => {
  const { pin } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  db.lockEvent(req.params.id);
  broadcastToEvent(event.share_code, { type: 'event_locked', eventCode: event.share_code });

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({ ok: true, status: 'locked' });
});

app.post('/api/events/:id/reopen', (req, res) => {
  const { pin } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  const newStatus = db.reopenEvent(req.params.id);
  // The result was taken back: its result notifications no longer hold
  db.deleteNotificationsByRef(`game:${req.params.id}`);
  broadcastToEvent(event.share_code, { type: 'event_reopened', eventCode: event.share_code, status: newStatus });

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({
    ok: true,
    status: newStatus,
    message: newStatus === 'locked' ? 'Resultatet är upplåst för rättning. Bettningen förblir stängd eftersom resultatet redan har visats.' : undefined
  });
});

app.post('/api/events/:id/boost', async (req, res) => {
  const event = db.getFullEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });
  if (event.status !== 'open') {
    return res.status(400).json({ error: 'Endast öppna spel kan boostas' });
  }

  // Cooldown check (max 1 boost per 10 minutes)
  if (event.lastBoostedAt) {
    const lastBoostTime = new Date(event.lastBoostedAt).getTime();
    const elapsedMinutes = (Date.now() - lastBoostTime) / (1000 * 60);
    if (elapsedMinutes < 10) {
      const waitMin = Math.ceil(10 - elapsedMinutes);
      return res.status(429).json({ error: `Spelet boostades nyligen. Vänta ${waitMin} minuter innan nästa boost.` });
    }
  }

  const user = getUserFromToken(req);
  let targetUserIds = [];
  let tourShareCode = null;

  if (event.tournamentId) {
    const tournament = db.getFullTournament(event.tournamentId);
    if (tournament) {
      tourShareCode = tournament.shareCode;
      targetUserIds = db.getTournamentParticipantUserIds(event.tournamentId)
        .filter(uid => !user || uid !== user.id);
    }
  } else {
    const bettorUserIds = (event.bets || []).map(b => b.userId).filter(Boolean);
    const friendIds = user ? db.getFriends(user.id).map(f => f.id) : [];
    targetUserIds = [...new Set([...bettorUserIds, ...friendIds])].filter(uid => !user || uid !== user.id);
  }

  let durationText = '';
  if (event.closesAt) {
    try {
      const closesDate = new Date(event.closesAt);
      const diffMs = closesDate.getTime() - Date.now();
      if (diffMs > 0) {
        const diffMin = Math.round(diffMs / (1000 * 60));
        if (diffMin < 60) {
          durationText = ` (${diffMin} min kvar!)`;
        } else {
          const hours = Math.floor(diffMin / 60);
          const mins = diffMin % 60;
          durationText = ` (${hours}t ${mins > 0 ? mins + 'm ' : ''}kvar!)`;
        }
      }
    } catch (_) {}
  }

  const poolText = event.totalPool > 0 ? `Pott: ${event.totalPool} kr. ` : '';
  const pushPayload = {
    title: `🔥 Spelboost: "${event.name}"!`,
    body: `${poolText}Bettningen stänger snart${durationText}! Lägg ditt tips nu.`,
    url: tourShareCode ? `/#tournament/${tourShareCode}` : `/#event/${event.shareCode}`
  };

  sendPushToUsers(targetUserIds, pushPayload, 'tournaments').catch(() => {});

  db.updateEventLastBoosted(event.id);

  broadcastToEvent(event.shareCode, {
    type: 'event_boosted',
    eventCode: event.shareCode,
    eventId: event.id,
    eventName: event.name
  });

  if (event.tournamentId && tourShareCode) {
    broadcastToEvent(tourShareCode, {
      type: 'tournament_updated',
      tournamentCode: tourShareCode
    });
  }

  res.json({ ok: true, lastBoostedAt: new Date().toISOString() });
});

// A reminder has to fall before the deadline, or the scheduler would send it at once
const REMINDER_TOO_LATE = 'Påminnelsen måste ligga före spelstoppet. Välj en kortare påminnelse.';
function reminderFits(minutesBefore, closesAt) {
  const m = Math.round(Number(minutesBefore) || 0);
  if (m <= 0) return true;
  return new Date(closesAt).getTime() - m * 60000 > Date.now();
}

app.put('/api/events/:id/deadline', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  let validClosesAt = null;
  if (req.body.closesAt) {
    const d = new Date(req.body.closesAt);
    if (!isNaN(d.getTime())) validClosesAt = d.toISOString();
  }

  if (validClosesAt && !reminderFits(req.body.remindBeforeMin, validClosesAt)) {
    return res.status(400).json({ error: REMINDER_TOO_LATE });
  }

  db.updateEventClosesAt(event.id, validClosesAt);
  if ('remindBeforeMin' in (req.body || {})) db.setEventReminder(event.id, validClosesAt ? req.body.remindBeforeMin : null);

  broadcastToEvent(event.share_code, {
    type: 'event_deadline_updated',
    eventCode: event.share_code,
    closesAt: validClosesAt
  });

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({ ok: true, closesAt: validClosesAt });
});

app.put('/api/events/:id/image', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  const { imageUrl } = req.body;
  if (imageUrl && !isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för matchen' });
  }

  db.updateEventImage(event.id, imageUrl || null);

  broadcastToEvent(event.share_code, { type: 'event_updated', eventCode: event.share_code });
  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({ ok: true, id: event.id, imageUrl: imageUrl || null });
});

app.post('/api/events/:id/finish', (req, res) => {
  const { pin, winnerId, winnerIds: reqWinnerIds, winnerImageUrl } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t && t.status === 'settled') {
      return res.status(400).json({ error: 'Turneringen är avslutad och dess resultat är låsta' });
    }
  }

  if (event.status === 'cancelled') {
    return res.status(400).json({ error: 'Matchen är inställd och kan inte avgöras' });
  }

  if (winnerImageUrl && !isValidImageUrl(winnerImageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för vinnaren' });
  }

  let winnerIds = [];
  let pickScores = null;
  if (event.bet_mode === 'picks') {
    try {
      pickScores = db.isCouponEvent(event.id) ? db.scoreCouponGame(event.id) : db.scorePickGame(event.id, req.body.resultIds);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
    }
    winnerIds = pickScores.winnerIds;
  } else if (Array.isArray(reqWinnerIds) && reqWinnerIds.length > 0) {
    winnerIds = reqWinnerIds;
  } else if (typeof winnerId === 'string' && winnerId.includes(',')) {
    winnerIds = winnerId.split(',').map(s => s.trim()).filter(Boolean);
  } else if (winnerId) {
    winnerIds = [winnerId];
  }

  if (winnerIds.length === 0) {
    return res.status(400).json({ error: 'Minst en vinnare måste anges' });
  }

  const winnerPlayers = winnerIds.map(wId => db.getPlayerById(wId));
  if (winnerPlayers.some(wp => !wp || wp.event_id !== event.id)) {
    return res.status(400).json({ error: 'Ogiltig vinnare för denna match' });
  }

  const storedWinnerId = winnerIds.join(',');
  db.finishEvent(req.params.id, storedWinnerId, winnerImageUrl || null);

  // Calculate payouts
  const full = db.getFullEvent(req.params.id);
  const totalPool = full.totalPool;
  const effectivePool = totalPool * (full.payoutPercent / 100);

  const winnerBets = full.bets.filter(b => winnerIds.includes(b.playerId));
  const winnerPools = {};
  let totalBackedWinners = 0;
  for (const wId of winnerIds) {
    const p = full.bets.filter(b => b.playerId === wId).reduce((s, b) => s + b.amount, 0);
    winnerPools[wId] = p;
    if (p > 0) totalBackedWinners++;
  }

  const sharePerOutcome = totalBackedWinners > 0 ? effectivePool / totalBackedWinners : 0;
  const oddsByWinner = {};
  for (const wId of winnerIds) {
    oddsByWinner[wId] = winnerPools[wId] > 0 ? sharePerOutcome / winnerPools[wId] : 0;
  }

  const payouts = winnerBets.map(b => {
    const odds = oddsByWinner[b.playerId] || 0;
    return {
      bettorName: b.bettorName,
      betAmount: b.amount,
      winnings: +(b.amount * odds).toFixed(2),
      profit: +(b.amount * odds - b.amount).toFixed(2)
    };
  });

  const winnerNames = winnerPlayers.map(wp => wp.name).join(', ');

  // Everyone who bet sees their own result in the bell
  const netByUser = new Map();
  for (const b of full.bets) {
    if (!b.userId) continue;
    const back = winnerIds.includes(b.playerId) ? b.amount * (oddsByWinner[b.playerId] || 0) : 0;
    netByUser.set(b.userId, (netByUser.get(b.userId) || 0) + back - b.amount);
  }
  let resultUrl = `/#event/${event.share_code}`;
  if (event.tournament_id) {
    const tour = db.getTournamentById(event.tournament_id);
    if (tour) resultUrl = `/#tournament/${tour.share_code}`;
  }
  // One result per game: a corrected result replaces the earlier one
  const resultRef = `game:${event.id}`;
  db.deleteNotificationsByRef(resultRef);
  for (const [uid, net] of netByUser) {
    const kr = Math.round(net);
    db.addUserNotification(uid, {
      type: 'game_result',
      icon: kr > 0 ? '🏆' : kr < 0 ? '💸' : '🤝',
      text: pickScores
        ? (pickScores.refund ? `${full.name}: ingen hade rätt – insatserna tillbaka` : `${full.name}: ${winnerNames} vann med ${pickScores.best} rätt`)
        : `${full.name}: ${winnerNames} vann`,
      detail: (pickScores ? `Du hade ${pickScores.entries.find(e => e.userId === uid)?.correct ?? 0} rätt – ` : '')
        + (kr > 0 ? `${pickScores ? 'du' : 'Du'} vann ${kr} kr` : kr < 0 ? `${pickScores ? 'du' : 'Du'} förlorade ${Math.abs(kr)} kr` : `${pickScores ? 'du' : 'Du'} gick jämnt ut`),
      url: resultUrl,
      ref: resultRef
    });
  }

  broadcastToEvent(event.share_code, {
    type: 'event_finished',
    eventCode: event.share_code,
    winner: winnerNames,
    winnerImageUrl: winnerImageUrl || null,
    isTie: winnerIds.length > 1
  });

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({
    ok: true,
    status: 'finished',
    winner: winnerNames,
    winnerIds,
    isTie: winnerIds.length > 1,
    totalPool,
    effectivePool,
    payouts
  });
});

app.post('/api/events/:id/cancel', (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  // A decided game keeps its result (cancelling would wipe the wins and debts)
  if (event.status === 'finished') {
    return res.status(400).json({ error: 'Ett avgjort spel kan inte avbrytas' });
  }

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t && t.status === 'settled') {
      return res.status(400).json({ error: 'Turneringen är avslutad och kan inte ändras' });
    }
  }

  db.cancelEvent(event.id);
  broadcastToEvent(event.share_code, {
    type: 'event_cancelled',
    eventCode: event.share_code
  });

  if (event.tournament_id) {
    const t = db.getTournamentById(event.tournament_id);
    if (t) broadcastToEvent(t.share_code, { type: 'tournament_updated', tournamentCode: t.share_code });
  }

  res.json({ ok: true, status: 'cancelled' });
});

app.delete('/api/events/:id', (req, res) => {
  const { pin } = req.body;
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event hittades inte' });
  if (!verifyEventAdmin(req, event)) return res.status(403).json({ error: 'Ingen behörighet' });

  // Deleting erases the bets, and with them the wins and debts on The Tab
  if (event.status === 'finished') {
    return res.status(400).json({ error: 'Ett avgjort spel kan inte tas bort – resultatet ligger på THE TAB' });
  }
  if (event.status !== 'cancelled' && db.getBetCountForEvent(event.id) > 0) {
    return res.status(400).json({ error: 'Spelet har bets – avbryt det i stället så går insatserna tillbaka' });
  }

  db.deleteEvent(req.params.id);
  res.json({ ok: true });
});
// ── Tournaments ──────────────────────────────────────
app.get('/api/tournaments', (req, res) => {
  const user = getUserFromToken(req);
  res.json(db.getAllTournaments(user ? user.id : null));
});

app.post('/api/tournaments', (req, res) => {
  const body = req.body || {};
  const user = getUserFromToken(req);
  const hasPin = lazyAdminPin(req, body?.pin);
  if (!user && !hasPin()) {
    return res.status(403).json({ error: 'Logga in för att skapa turnering' });
  }

  const { name, players } = body;
  const finalName = (name || '').trim();
  if (!finalName || finalName.length < 2) {
    return res.status(400).json({ error: 'Ett turneringsnamn krävs (minst 2 tecken)' });
  }

  const cleanPlayers = [...new Set((players || [])
    .map(p => (typeof p === 'string' ? p : (p?.name || '')).trim())
    .filter(Boolean))];

  const min = Math.max(1, Number(req.body.minBet) || 10);
  const max = Math.max(min, Number(req.body.maxBet) || 10000);
  const swish = req.body.swishNumber ? req.body.swishNumber.replace(/[^0-9]/g, '') : (user?.swish_number || null);

  const allowedVisibilities = ['friends', 'friends_of_friends', 'private', 'link'];
  let visibility = req.body.visibility;
  if (visibility === 'link') visibility = 'private';
  if (!allowedVisibilities.includes(visibility)) visibility = 'friends';

  const id = generateId();
  const shareCode = generateShareCode();
  db.createTournament(id, finalName, shareCode, user ? user.id : null, visibility, cleanPlayers);

  // Invite friends directly (VIP access & push notification)
  // Only people who are your friends can be pulled in (and pushed); superadmin is exempt
  const invitedFriendIds = (Array.isArray(body.invitedFriendIds) ? body.invitedFriendIds : [])
    .filter(fId => user ? db.isFriend(user.id, fId) : hasPin());
  if (invitedFriendIds.length > 0) {
    const creatorName = user ? (user.nickname || user.real_name || 'En vän') : 'Arrangören';
    for (const fId of invitedFriendIds) {
      if (!fId) continue;
      const friendUser = db.getUserById(fId);
      if (friendUser) {
        db.addTournamentParticipant(id, friendUser.nickname, friendUser.id);
        sendPushToUsers([friendUser.id], {
          title: '🏆 Inbjudan till event!',
          body: `${creatorName} har bjudit in dig till ${finalName}!`,
          url: `/#tournament/${shareCode}`
        }, 'tournaments').catch(() => {});

        broadcastToUser(friendUser.id, {
          type: 'tournament_invited',
          tournament: { id, name: finalName, shareCode }
        });
      }
    }
  }

  res.json(db.getFullTournament(id));
});

app.post('/api/tournaments/:id/invite', (req, res) => {
  const user = getUserFromToken(req);
  const tournament = db.getTournamentById(req.params.id) || db.getTournamentByCode(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turneringen hittades inte' });
  const isCreator = user && tournament.creator_id === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Endast arrangören kan bjuda in vänner' });
  }

  const requestedIds = Array.isArray(req.body.friendIds) ? req.body.friendIds : [];
  if (requestedIds.length === 0) {
    return res.status(400).json({ error: 'Inga vänner valdes' });
  }
  // Only the organiser's friends can be added and notified (superadmin may add anyone)
  const friendIds = isCreator && user
    ? requestedIds.filter(fId => db.isFriend(user.id, fId))
    : requestedIds;
  if (friendIds.length === 0) {
    return res.status(403).json({ error: 'Du kan bara bjuda in dina vänner' });
  }

  const creatorName = user ? (user.nickname || user.real_name || 'Arrangören') : 'Arrangören';
  let invitedCount = 0;

  for (const fId of friendIds) {
    if (!fId) continue;
    const friendUser = db.getUserById(fId);
    if (friendUser) {
      db.addTournamentParticipant(tournament.id, friendUser.nickname, friendUser.id);
      invitedCount++;

      sendPushToUsers([friendUser.id], {
        title: '🏆 Inbjudan till event!',
        body: `${creatorName} har bjudit in dig till ${tournament.name}!`,
        url: `/#tournament/${tournament.share_code}`
      }, 'tournaments').catch(() => {});

      broadcastToUser(friendUser.id, {
        type: 'tournament_invited',
        tournament: { id: tournament.id, name: tournament.name, shareCode: tournament.share_code }
      });
    }
  }

  res.json({ ok: true, invitedCount, tournament: db.getFullTournament(tournament.id) });
});

app.post('/api/tournaments/:id/participants', (req, res) => {
  const user = getUserFromToken(req);
  const tournament = db.getTournamentById(req.params.id) || db.getTournamentByCode(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turneringen hittades inte' });
  const isCreator = user && tournament.creator_id === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Endast spelledaren kan lägga till deltagare' });
  }

  const name = (req.body.name || '').trim();
  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Ett giltigt namn krävs (minst 2 tecken)' });
  }
  db.addTournamentParticipant(tournament.id, name, req.body.userId || null);
  res.json(db.getFullTournament(tournament.id));
});

// ── Tournament Templates Endpoints ──────────────────
app.get('/api/tournament-templates', (req, res) => {
  res.json(TOURNAMENT_TEMPLATES);
});

app.post('/api/tournaments/from-template', (req, res) => {
  const body = req.body || {};
  const user = getUserFromToken(req);
  const hasPin = lazyAdminPin(req, body?.pin);
  if (!user && !hasPin()) {
    return res.status(403).json({ error: 'Logga in för att skapa turnering' });
  }

  const { templateId, name, players } = body;
  const template = TOURNAMENT_TEMPLATES.find(t => t.id === templateId);
  if (!template) {
    return res.status(400).json({ error: 'Ogiltig mall angiven' });
  }

  const finalName = (name || template.defaultName || template.title).trim();
  if (!finalName || finalName.length < 2) {
    return res.status(400).json({ error: 'Ett turneringsnamn krävs (minst 2 tecken)' });
  }

  const cleanPlayers = [...new Set((players || [])
    .map(p => (typeof p === 'string' ? p : (p?.name || '')).trim())
    .filter(Boolean))];

  if (cleanPlayers.length < 2) {
    return res.status(400).json({ error: 'Minst 2 deltagare krävs för att skapa en turnering från mall' });
  }

  const min = Math.max(1, Number(req.body.minBet) || 10);
  const max = Math.max(min, Number(req.body.maxBet) || 10000);
  const swish = req.body.swishNumber ? req.body.swishNumber.replace(/[^0-9]/g, '') : (user?.swish_number || null);

  const allowedVisibilities = ['friends', 'friends_of_friends', 'private', 'link'];
  let visibility = req.body.visibility;
  if (visibility === 'link') visibility = 'private';
  if (!allowedVisibilities.includes(visibility)) visibility = 'friends';

  const tournamentId = generateId();
  const shareCode = generateShareCode();
  db.createTournament(tournamentId, finalName, shareCode, user ? user.id : null, visibility);

  // 1. Create rounds from template (or default Rond 1)
  const templateRounds = (template.rounds && template.rounds.length > 0)
    ? template.rounds
    : [{ name: 'Rond 1' }];

  const createdRounds = [];
  for (let i = 0; i < templateRounds.length; i++) {
    const roundConfig = templateRounds[i];
    const roundEventId = generateId();
    const roundData = {
      id: roundEventId,
      name: roundConfig.name || `Rond ${i + 1}`,
      date: new Date().toISOString().split('T')[0],
      status: 'open',
      shareCode: generateShareCode(),
      payoutPercent: 100,
      minBet: min,
      maxBet: max,
      creatorId: user ? user.id : null,
      swishNumber: swish,
      tournamentId,
      isSideBet: 0,
      linkedRoundId: null,
      betMode: 'open'
    };
    const pData = cleanPlayers.map(p => ({ id: generateId(), name: p }));
    db.createEvent(roundData, pData);
    createdRounds.push(roundData);
  }

  // 2. Create side bets from template
  if (template.sideBets && template.sideBets.length > 0) {
    const firstRoundId = createdRounds[0]?.id || null;
    for (const sb of template.sideBets) {
      const sideBetId = generateId();
      const sbAmount = Math.max(1, Number(sb.betAmount) || 50);
      const sbMode = sb.betMode || 'self';
      const sideBetData = {
        id: sideBetId,
        name: sb.name,
        date: new Date().toISOString().split('T')[0],
        status: sbMode === 'self' ? 'locked' : 'open',
        shareCode: generateShareCode(),
        payoutPercent: 100,
        minBet: sbAmount,
        maxBet: sbAmount,
        creatorId: user ? user.id : null,
        swishNumber: swish,
        tournamentId,
        isSideBet: 1,
        linkedRoundId: firstRoundId,
        betMode: sbMode,
        imageUrl: null
      };
      const sbPlayers = cleanPlayers.map(p => ({ id: generateId(), name: p }));
      db.createEvent(sideBetData, sbPlayers);

      // In 'self' mode, register bets on each participant
      if (sbMode === 'self') {
        const createdSbPlayers = db.getFullEvent(sideBetId).players;
        // Fas 2: Use tournament participant list for user_id instead of name-guessing
        const participants = db.getTournamentParticipants(id);
        for (const p of createdSbPlayers) {
          const participant = participants.find(tp => tp.name === p.name && tp.user_id);
          db.addBet(generateId(), sideBetId, p.name, p.id, sbAmount, participant ? participant.user_id : null);
        }
      }
    }
  }

  res.json(db.getFullTournament(tournamentId));
});

app.get('/api/tournaments/:code', (req, res) => {
  const tournament = db.getFullTournament(req.params.code);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const hasPin = lazyAdminPin(req, req.headers['x-admin-pin']);

  if (!db.canUserAccessTournament(tournament, user ? user.id : null) && !hasPin()) {
    const creator = tournament.creatorId ? db.getUserById(tournament.creatorId) : null;
    return res.status(403).json({
      error: 'ACCESS_RESTRICTED',
      restriction: tournament.visibility || 'friends',
      creatorId: tournament.creatorId,
      creatorName: creator ? (creator.real_name || creator.nickname) : 'Arrangören',
      creatorNickname: creator ? creator.nickname : null
    });
  }

  // Auto-register logged-in user as participant when opening the tournament
  if (user) {
    const userName = (user.real_name || user.nickname || '').trim();
    if (userName) {
      db.addTournamentParticipant(tournament.id, userName, user.id, { auto: true });
    }
  }

  const full = db.getFullTournament(tournament.id);
  // Each game card shows the viewer's own bets ("✓ Du bettade: …")
  if (user && full) {
    const mine = db.getUserBetsInTournament(user.id, tournament.id);
    for (const g of [...(full.rounds || []), ...(full.sideBets || [])]) {
      // A pick game's stake sits on a hidden entry: show what the person tipped instead
      const tipped = g.pickCount ? db.pickEntryLabel(g.id, user.id) : null;
      g.myBets = mine
        .filter(b => b.eventId === g.id)
        .map(b => ({ playerName: tipped || (g.players.find(p => p.id === b.playerId) || {}).name || '?', amount: b.amount }));
    }
  }
  res.json(full);
});

app.post('/api/tournaments/:id/rounds', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet' });
  }

  if (tournament.status === 'settled') {
    return res.status(400).json({ error: 'Turneringen är avslutad. Återöppna turneringen för att lägga till nya ronder.' });
  }

  // Get players from latest round to reuse or from request body
  const full = db.getFullTournament(tournament.id);
  const roundNumber = full.rounds.length + 1;
  const lastRound = full.rounds[full.rounds.length - 1];
  const requestedPlayers = req.body.players && req.body.players.length > 0
    ? req.body.players
    : (lastRound ? lastRound.players.map(p => p.name) : []);

  const cleanPlayers = [...new Set(requestedPlayers
    .map(p => (typeof p === 'string' ? p : (p?.name || '')).trim())
    .filter(Boolean))];

  if (cleanPlayers.length < 2) {
    return res.status(400).json({ error: 'Minst 2 deltagare krävs för en ny rond' });
  }

  const min = Math.max(1, Number(req.body.minBet) || lastRound?.minBet || 10);
  const max = Math.max(min, Number(req.body.maxBet) || lastRound?.maxBet || 10000);
  const swish = req.body.swishNumber ? req.body.swishNumber.replace(/[^0-9]/g, '') : (lastRound?.swishNumber || user?.swish_number || null);

  let validClosesAt = null;
  if (req.body.closesAt) {
    const d = new Date(req.body.closesAt);
    if (!isNaN(d.getTime())) validClosesAt = d.toISOString();
  }

  const eventData = {
    id: generateId(),
    name: (req.body.name || '').trim() || ('Rond ' + roundNumber),
    date: new Date().toISOString().split('T')[0],
    status: 'open',
    shareCode: generateShareCode(),
    payoutPercent: 100,
    minBet: min,
    maxBet: max,
    creatorId: user ? user.id : null,
    swishNumber: swish,
    tournamentId: tournament.id,
    isSideBet: 0,
    linkedRoundId: null,
    betMode: 'open',
    closesAt: validClosesAt
  };

  const playerData = cleanPlayers.map(name => ({ id: generateId(), name }));
  db.createEvent(eventData, playerData);

  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });

  // Push notification to tournament participants
  const participantIds = db.getTournamentParticipantUserIds(tournament.id)
    .filter(uid => !user || uid !== user.id);
  sendPushToUsers(participantIds, {
    title: `🏌️ Ny rond i ${tournament.name}!`,
    body: `"${eventData.name}" har startat och är öppen för bets. Lägg ditt tips nu!`,
    url: `/#tournament/${tournament.shareCode}`
  }, 'tournaments').catch(() => {});

  res.json(db.getFullTournament(tournament.id));
});

// Side bets
app.post('/api/tournaments/:id/sidebets', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet' });
  }

  if (tournament.status === 'settled') {
    return res.status(400).json({ error: 'Turneringen är avslutad. Återöppna turneringen för att lägga till nya sido-spel.' });
  }

  const { name, players, linkedRoundId, betAmount, imageUrl, closesAt } = req.body;
  // A "Tipsrad" is a pick game over matches: one sign per match, most correct takes the pot
  const isCoupon = req.body.betMode === 'coupon';
  const betMode = isCoupon ? 'picks' : ['open', 'self', 'picks'].includes(req.body.betMode) ? req.body.betMode : 'open';
  const couponMatches = isCoupon ? db.cleanCouponMatches(req.body.matches) : null;
  if (isCoupon && !couponMatches) {
    return res.status(400).json({ error: 'En tipsrad har 2–13 matcher med två olika namn i varje' });
  }
  const finalName = (name || '').trim().slice(0, 120);
  if (!finalName || finalName.length < 2) {
    return res.status(400).json({ error: 'Ett namn krävs (minst 2 tecken)' });
  }

  if (imageUrl && !isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för sido-spel' });
  }

  const cleanPlayers = [...new Set((players || [])
    .map(p => (typeof p === 'string' ? p : (p?.name || '')).trim())
    .filter(Boolean))];

  if (cleanPlayers.length < 2 && !isCoupon) {
    return res.status(400).json({ error: 'Minst 2 deltagare krävs för ett sido-spel' });
  }
  // Pick N: choose fewer than there are options, or everyone would be right
  const pickCount = Math.round(Number(req.body.pickCount) || 0);
  if (betMode === 'picks' && !isCoupon && !(pickCount >= 1 && pickCount < cleanPlayers.length)) {
    return res.status(400).json({ error: `Antal att välja måste vara 1–${cleanPlayers.length - 1}` });
  }

  const amount = Math.max(1, Math.min(10000, Math.round(Number(betAmount) || 100)));
  // Pool games may have a free stake between min and max; winner-takes-all is always the
  // same amount for everyone (each participant is entered with exactly that amount)
  let minBetAmount = amount;
  let maxBetAmount = amount;
  if (betMode === 'open' && req.body.minBet !== undefined && req.body.maxBet !== undefined) {
    minBetAmount = Math.max(1, Math.min(10000, Math.round(Number(req.body.minBet) || 1)));
    maxBetAmount = Math.max(minBetAmount, Math.min(10000, Math.round(Number(req.body.maxBet) || minBetAmount)));
  }
  const swish = req.body.swishNumber ? req.body.swishNumber.replace(/[^0-9]/g, '') : (user?.swish_number || null);

  let validClosesAt = null;
  if (closesAt) {
    const d = new Date(closesAt);
    if (!isNaN(d.getTime())) validClosesAt = d.toISOString();
  }

  if (validClosesAt && !reminderFits(req.body.remindBeforeMin, validClosesAt)) {
    return res.status(400).json({ error: REMINDER_TOO_LATE });
  }
  if (req.body.resultUrl && !db.cleanResultUrl(req.body.resultUrl)) {
    return res.status(400).json({ error: 'Länken till topplistan måste börja med https://' });
  }

  const eventId = generateId();
  const eventData = {
    id: eventId,
    name: finalName,
    date: new Date().toISOString().split('T')[0],
    status: betMode === 'self' ? 'locked' : 'open',
    shareCode: generateShareCode(),
    payoutPercent: 100,
    minBet: minBetAmount,
    maxBet: maxBetAmount,
    creatorId: user ? user.id : null,
    swishNumber: swish,
    tournamentId: tournament.id,
    isSideBet: 1,
    linkedRoundId: linkedRoundId || null,
    betMode: betMode || 'open',
    imageUrl: imageUrl || null,
    closesAt: validClosesAt
  };

  const playerData = isCoupon ? [] : cleanPlayers.map(p => ({ id: generateId(), name: p }));
  db.createEvent(eventData, playerData);
  if (isCoupon) db.addCouponOptions(eventId, couponMatches);
  else if (betMode === 'picks') db.setEventPickCount(eventId, pickCount);
  if (validClosesAt && req.body.remindBeforeMin) db.setEventReminder(eventId, req.body.remindBeforeMin);
  if (req.body.resultUrl) db.setEventResultUrl(eventId, req.body.resultUrl);

  // For 'self' mode: auto-create bets — each player bets on themselves
  if (betMode === 'self') {
    const createdPlayers = db.getFullEvent(eventId).players;
    // Fas 2: Use tournament participant list for user_id instead of name-guessing
    const participants = db.getTournamentParticipants(tournament.id);
    for (const p of createdPlayers) {
      const participant = participants.find(tp => tp.name === p.name && tp.user_id);
      db.addBet(generateId(), eventId, p.name, p.id, amount, participant ? participant.user_id : null);
    }
  }

  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });

  res.json(db.getFullTournament(tournament.id));
});

app.post('/api/tournaments/:id/settle', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet' });
  }

  const allEvents = [...(tournament.rounds || []), ...(tournament.sideBets || [])];
  const unfinished = allEvents.filter(e => e.status !== 'finished' && e.status !== 'cancelled');
  if (unfinished.length > 0) {
    return res.status(400).json({ error: 'Alla ronder och sido-spel måste vara avgjorda eller avbrutna innan turneringen kan avslutas' });
  }

  db.settleTournament(req.params.id);
  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });

  // Push notification for settled tournament
  const participantIds = db.getTournamentParticipantUserIds(tournament.id)
    .filter(uid => !user || uid !== user.id);
  // Now is the time to settle up: tell each person in the event exactly what they swish or
  // get. Friends who could only see the event get the plain message.
  const memberIds = new Set(db.getTournamentMemberIds(tournament.id));
  const pushIds = [...new Set([...participantIds, ...memberIds])].filter(uid => !user || uid !== user.id);
  for (const pid of pushIds) {
    let body = 'Slutresultatet är fastställt! Se prispallen och nettavräkningen i Whooply.';
    let url = `/#tournament/${tournament.shareCode}`;
    if (memberIds.has(pid)) try {
      const o = db.getUnifiedSettlementOverview(pid);
      const payTo = (o.friends || []).filter(f => !f.isLive && f.totalNet < 0);
      if (o.readyOwed > 0) {
        const who = payTo.length === 1 ? (payTo[0].friendNickname || payTo[0].friendName) : `${payTo.length} personer`;
        body = `Dags att göra upp: du ska swisha ${Math.round(o.readyOwed)} kr till ${who}. Allt är ihopräknat på THE TAB.`;
        url = '/#swishlist';
      } else if (o.readyDue > 0) {
        body = `Dags att göra upp: du får ${Math.round(o.readyDue)} kr. Se vem som swishar på THE TAB.`;
        url = '/#swishlist';
      }
    } catch {}
    sendPushToUsers([pid], { title: `🏆 ${tournament.name} är klart!`, body, url }, 'tournaments').catch(() => {});
  }

  for (const pid of participantIds) {
    sendMaltaSupportNotification(pid, {
      eventType: 'tournament_settled',
      details: {
        tournamentName: tournament.name,
        netAmount: 0
      },
      url: `/#tournament/${tournament.shareCode}`
    }).catch(() => {});
  }

  res.json({ ok: true });
});

app.post('/api/tournaments/:id/reopen', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet' });
  }

  db.reopenTournament(tournament.id);
  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });

  res.json({ ok: true });
});

// ── Tournament Banners ───────────────────────────────
app.post('/api/tournaments/:id/banners', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet' });
  }

  let { imageData, linkUrl, label } = req.body;
  if (!imageData) return res.status(400).json({ error: 'Bild krävs' });
  if (!isValidImageUrl(imageData)) {
    return res.status(400).json({ error: 'Ogiltigt bildformat. Måste vara data:image/ eller giltig http/https-URL.' });
  }
  if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
    imageData = imageData.replace(/[\r\n\s]+/g, '');
  }
  if (linkUrl && !isValidHttpUrl(linkUrl)) {
    return res.status(400).json({ error: 'Ogiltig länk-URL. Måste börja med http:// eller https://' });
  }

  const id = generateId();
  const banners = db.getBanners(tournament.id);
  db.addBanner(id, tournament.id, imageData, linkUrl || null, label || null, banners.length);

  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });

  res.json({ ok: true, banner: { id, imageData, linkUrl, label } });
});

app.delete('/api/tournaments/:id/banners/:bannerId', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet' });
  }

  db.removeBanner(req.params.bannerId, tournament.id);
  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });
  res.json({ ok: true });
});

// ── Remove someone from an event (host), or leave it yourself ──
app.delete('/api/tournaments/:id/participants/:participantId', (req, res) => {
  const tournament = db.getTournamentById(req.params.id) || db.getTournamentByCode(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Eventet hittades inte' });
  const user = getUserFromToken(req);
  const participant = db.getTournamentParticipants(tournament.id).find(p => p.id === req.params.participantId);
  if (!participant) return res.status(404).json({ error: 'Deltagaren hittades inte' });
  const isCreator = user && tournament.creator_id === user.id;
  const isSelf = user && participant.user_id === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !isSelf && !hasPin()) return res.status(403).json({ error: 'Ingen behörighet' });
  try {
    db.removeTournamentParticipant(tournament.id, participant.id);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  broadcastToEvent(tournament.share_code, { type: 'tournament_updated', tournamentCode: tournament.share_code });
  res.json({ ok: true, left: Boolean(isSelf) });
});

// ── Delete Tournament ────────────────────────────────
app.delete('/api/tournaments/:id', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);
  if (!isCreator && !hasPin()) {
    return res.status(403).json({ error: 'Ingen behörighet att radera turneringen' });
  }
  if (db.tournamentHasMoney(tournament.id)) {
    return res.status(400).json({ error: 'Eventet har spel med insatser – det kan inte raderas, då försvinner vinster och skulder från THE TAB. Avbryt spelen som inte är avgjorda, eller låt eventet ligga kvar.' });
  }

  db.deleteTournament(tournament.id);
  res.json({ ok: true });
});

// ── Settlement Receipts (Kvittering) ────────────────
app.post('/api/tournaments/:id/settlement/receipt', (req, res) => {
  const tournament = db.getFullTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnering hittades inte' });

  const user = getUserFromToken(req);
  const { fromName, toName, fromUserId, toUserId, amount, receiptId } = req.body;
  const isCreator = user && tournament.creatorId === user.id;
  const hasPin = lazyAdminPin(req, req.body?.pin);

  if (receiptId) {
    const existing = db.getSettlementReceiptById(receiptId);
    if (!existing || existing.tournament_id !== tournament.id) {
      return res.status(404).json({ error: 'Kvittot hittades inte i denna turnering' });
    }

    // Fas 2: Prioritize userId — name fallback only for legacy receipts without to_user_id
    const isReceiptCreditor = user && (
      (existing.to_user_id && user.id === existing.to_user_id) ||
      (!existing.to_user_id && (user.nickname === existing.to_name || user.real_name === existing.to_name))
    );
    if (!isCreator && !isReceiptCreditor && !hasPin()) {
      return res.status(403).json({ error: 'Endast mottagaren/borgenären eller arrangören kan ta bort detta kvitto' });
    }

    db.deleteSettlementReceiptById(receiptId);
    broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });
    return res.json({ ok: true, isPaid: false });
  }

  if (!fromName || !toName) {
    return res.status(400).json({ error: 'Avsändare och mottagare krävs' });
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0 || !Number.isInteger(numAmount)) {
    return res.status(400).json({ error: 'Belopp måste vara ett positivt heltal' });
  }
  const parsedAmount = numAmount;

  // Calculate current settlement first to find the authoritative server transfer
  const currentSettlement = db.getTournamentNetSettlement(tournament.id);
  // Match on userId when the transfer has one; names only identify guests. Two people
  // with the same name must never be able to settle each other's debts.
  const sameParty = (tId, tName, reqId, reqName) => (tId && reqId) ? tId === reqId : tName === reqName;
  const matchingTransfer = (currentSettlement.transfers || []).find(t =>
    sameParty(t.fromUserId, t.from, fromUserId, fromName) &&
    sameParty(t.toUserId, t.to, toUserId, toName)
  );

  if (!matchingTransfer) {
    return res.status(400).json({ error: 'Ingen giltig oreglerad överföring hittades mellan angivna parter' });
  }

  // Fas 2: Enforce creditor authorization — userId first, name fallback ONLY for legacy transfers without userId
  const isCreditor = user && (
    (matchingTransfer.toUserId && user.id === matchingTransfer.toUserId) ||
    (!matchingTransfer.toUserId && (user.nickname === matchingTransfer.to || user.real_name === matchingTransfer.to))
  );
  if (!isCreator && !isCreditor && !hasPin()) {
    return res.status(403).json({ error: 'Endast mottagaren/borgenären eller arrangören kan kvittera denna överföring' });
  }

  if (parsedAmount > matchingTransfer.amount) {
    return res.status(400).json({ error: `Beloppet (${parsedAmount} kr) överstiger återstående skuld (${matchingTransfer.amount} kr)` });
  }

  const newReceiptId = generateId();
  db.createSettlementReceipt(
    newReceiptId,
    tournament.id,
    matchingTransfer.from,
    matchingTransfer.to,
    parsedAmount,
    matchingTransfer.fromUserId || null,
    matchingTransfer.toUserId || null
  );
  broadcastToEvent(tournament.shareCode, { type: 'tournament_updated', tournamentCode: tournament.shareCode });

  res.json({ ok: true, isPaid: true, receiptId: newReceiptId });
});

// ── Minigame Duels API ──────────────────────────────
const MAX_DUEL_STAKE = 10000;
app.post('/api/duels', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { gameType, opponentId, stakeAmount, mode, tournamentId } = req.body;
  if (stakeAmount !== undefined && (typeof stakeAmount !== 'number' || !Number.isFinite(stakeAmount) || stakeAmount < 0)) {
    return res.status(400).json({ error: 'Ogiltig insats' });
  }
  if (typeof stakeAmount === 'number' && stakeAmount > MAX_DUEL_STAKE) {
    return res.status(400).json({ error: `Insatsen får vara högst ${MAX_DUEL_STAKE} kr` });
  }
  const stake = typeof stakeAmount === 'number' ? Math.round(stakeAmount * 100) / 100 : 1;
  const duelMode = mode === 'table' ? 'table' : 'online';

  const rawTournamentId = tournamentId ? String(tournamentId).trim() : null;
  let validatedTournamentId = null;
  if (rawTournamentId) {
    const tournament = db.getFullTournament(rawTournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Turneringen hittades inte' });
    }
    if (tournament.status === 'settled') {
      return res.status(400).json({ error: 'Turneringen är avslutad. Återöppna turneringen för att spela turneringsdueller.' });
    }
    if (!db.canUserAccessTournament(tournament, user.id)) {
      return res.status(403).json({ error: 'Du har inte tillgång till denna turnering' });
    }
    const participantUserIds = db.getTournamentParticipantUserIds(tournament.id);
    const isCallerParticipant = tournament.creatorId === user.id || participantUserIds.includes(user.id);
    if (!isCallerParticipant) {
      return res.status(403).json({ error: 'Endast deltagare eller skapare kan spela dueller i turneringen' });
    }
    if (opponentId && String(opponentId) !== tournament.creatorId && !participantUserIds.includes(String(opponentId))) {
      return res.status(400).json({ error: 'Motståndaren måste delta i turneringen' });
    }
    validatedTournamentId = tournament.id;
  }

  const duel = db.createDuel({
    gameType: gameType || 'dice',
    creatorId: user.id,
    opponentId: opponentId || null,
    stakeAmount: stake,
    mode: duelMode,
    tournamentId: validatedTournamentId
  });

  if (opponentId && duelMode === 'online') {
    broadcastToUser(opponentId, {
      type: 'duel_challenge',
      duel
    });

    const gameTitles = {
      dice: 'Tärningsduell 🎲',
      coin: 'Slantduell 🪙',
      stopwatch: 'Reaktionsduell ⏱️',
      space_invaders: 'Space Blitz 👾'
    };
    const gameName = gameTitles[gameType] || 'Duell ⚔️';
    const creatorName = user.nickname || user.real_name || 'En vän';
    sendPushToUsers([opponentId], {
      title: `⚔️ Utmaning på ${gameName}!`,
      body: `${creatorName} utmanar dig (${stake} kr)! Anta utmaningen i Arcade.`,
      url: '/#arcade'
    }, 'duels', { bell: false }).catch(() => {});

    sendMaltaSupportNotification(opponentId, {
      eventType: 'duel_challenge',
      details: {
        opponentName: creatorName,
        gameType: gameName,
        stakeAmount: stake
      },
      url: '/#arcade'
    }).catch(() => {});
  }

  res.json({ duel });
});

app.get('/api/duels/pending', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const duels = db.getPendingDuelsForUser(user.id);
  res.json(duels);
});

app.get('/api/duels/settlements', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const summary = db.getDuelSettlementSummary(user.id);
  res.json(summary);
});

app.get('/api/settlements/overview', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const overview = db.getUnifiedSettlementOverview(user.id);
  res.json(overview);
});

// ── Atomic Settlement Clearing ──────────────────────────
app.post('/api/settlement/clear-with/:friendId', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const friendId = req.params.friendId;
  if (!friendId || friendId === user.id) {
    return res.status(400).json({ error: 'Ogiltig vän angiven' });
  }

  const { expectedAmount, idempotencyKey } = req.body || {};
  if (!expectedAmount || typeof expectedAmount !== 'number' || expectedAmount <= 0) {
    return res.status(400).json({ error: 'expectedAmount krävs och måste vara ett positivt heltal' });
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return res.status(400).json({ error: 'idempotencyKey krävs' });
  }

  try {
    const result = db.atomicSettleWithFriend(user.id, friendId, expectedAmount, idempotencyKey);

    // Broadcast and push AFTER successful commit
    broadcastToUser(friendId, {
      type: 'settlement_cleared',
      friendId: user.id,
      totalCleared: result.totalCleared
    });

    const settlerName = user.nickname || user.real_name || 'En vän';
    sendPushToUsers([friendId], {
      title: '✅ Skulder kvitterade!',
      body: `${settlerName} har kvitterat alla era gemensamma skulder (${result.totalCleared} kr)!`,
      url: '/#swishlist'
    }, 'settlement').catch(() => {});

    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({ error: err.message });
  }
});

app.get('/api/duels/history', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const duels = db.getUserDuels(user.id);
  res.json(duels);
});

app.get('/api/duels/:id', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const duel = db.getDuelById(req.params.id);
  if (!duel) return res.status(404).json({ error: 'Duell hittades inte' });

  if (duel.creator_id !== user.id && duel.opponent_id !== user.id) {
    return res.status(403).json({ error: 'Åtkomst nekad. Du deltar inte i denna duell.' });
  }

  res.json(duel);
});

app.post('/api/duels/:id/respond', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { accept } = req.body;
  const duel = db.respondDuel(req.params.id, user.id, Boolean(accept));
  if (!duel) return res.status(400).json({ error: 'Kunde inte besvara duellen' });

  const payload = {
    type: accept ? 'duel_accepted' : 'duel_declined',
    duel
  };
  broadcastToDuel(duel.id, payload);
  if (duel.creator_id) {
    broadcastToUser(duel.creator_id, payload);
  }

  if (accept && duel.creator_id) {
    const responderName = user.nickname || user.real_name || 'Motståndaren';
    sendPushToUsers([duel.creator_id], {
      title: '⚔️ Utmaning antagen!',
      body: `${responderName} antog din duell! Gör ditt drag nu i Arcade.`,
      url: '/#arcade'
    }, 'duels', { bell: false }).catch(() => {});
  }

  res.json({ duel });
});

app.post(['/api/duels/:id/roll', '/api/duels/:id/result'], (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const duel = db.getDuelById(req.params.id);
  if (!duel) return res.status(404).json({ error: 'Duell hittades inte' });

  if (user.id !== duel.creator_id && user.id !== duel.opponent_id) {
    return res.status(403).json({ error: 'Du deltar inte i denna duell' });
  }

  if (duel.status !== 'active') {
    return res.status(400).json({ error: 'Endast aktiva dueller kan registreras' });
  }

  const { creatorScore, opponentScore, winnerId, score } = req.body;

  const rawCreator = creatorScore ?? (user.id === duel.creator_id ? score : undefined);
  const rawOpponent = opponentScore ?? (user.id === duel.opponent_id ? score : undefined);

  const parsedCreatorScore = typeof rawCreator === 'number' && Number.isFinite(rawCreator) ? rawCreator : (Number(rawCreator) || 0);
  const parsedOpponentScore = typeof rawOpponent === 'number' && Number.isFinite(rawOpponent) ? rawOpponent : (Number(rawOpponent) || 0);

  // Determine legitimate winner based on scores
  let derivedWinnerId = null;
  if (parsedCreatorScore > parsedOpponentScore) {
    derivedWinnerId = duel.creator_id;
  } else if (parsedOpponentScore > parsedCreatorScore) {
    derivedWinnerId = duel.opponent_id;
  }

  // If winnerId was explicitly passed, it must match the score-derived winner
  if (winnerId !== undefined && winnerId !== null && winnerId !== derivedWinnerId) {
    return res.status(400).json({ error: 'Angiven vinnare matchar inte poängställningen' });
  }

  const effectiveWinnerId = derivedWinnerId;

  // The result only counts once the other participant confirms it (or the reporter concedes)
  const report = db.reportDuelResult({
    duelId: req.params.id,
    reporterId: user.id,
    creatorScore: parsedCreatorScore,
    opponentScore: parsedOpponentScore,
    winnerId: effectiveWinnerId
  });

  if (report.error === 'mismatch') {
    return res.status(409).json({ error: 'Resultatet matchar inte motståndarens rapport. Kom överens och rapportera igen.' });
  }
  if (report.error) {
    return res.status(404).json({ error: 'Duell hittades inte' });
  }

  const updated = report.duel;

  if (!report.confirmed) {
    const otherId = user.id === duel.creator_id ? duel.opponent_id : duel.creator_id;
    const reporterName = user.nickname || user.real_name || 'Motståndaren';
    if (otherId) {
      broadcastToUser(otherId, { type: 'duel_result_reported', duel: updated });
      sendPushToUsers([otherId], {
        title: '⚔️ Bekräfta duellresultat',
        body: `${reporterName} har rapporterat resultatet. Bekräfta det i Arcade.`,
        url: '/#arcade'
      }, 'duels', { bell: false }).catch(() => {});
    }
    return res.json({ duel: updated, awaitingConfirmation: true });
  }

  broadcastToDuel(req.params.id, {
    type: 'duel_finished',
    duel: updated
  });

  if (updated && updated.status === 'completed') {
    const creator = db.getUserById(updated.creator_id);
    const opponent = db.getUserById(updated.opponent_id);
    const creatorName = creator ? (creator.nickname || creator.real_name) : 'Spelare 1';
    const opponentName = opponent ? (opponent.nickname || opponent.real_name) : 'Spelare 2';

    if (updated.winner_id) {
      const winnerId = updated.winner_id;
      const loserId = winnerId === updated.creator_id ? updated.opponent_id : updated.creator_id;
      const winnerName = winnerId === updated.creator_id ? creatorName : opponentName;
      const loserName = winnerId === updated.creator_id ? opponentName : creatorName;

      sendPushToUsers([winnerId], {
        title: '👑 Du vann duellen!',
        body: `Grattis! Du besegrade ${loserName} (+${updated.stake_amount} kr).`,
        url: '/#arcade'
      }, 'duels').catch(() => {});

      sendPushToUsers([loserId], {
        title: '💸 Duell avgjord',
        body: `${winnerName} vann duellen (${updated.stake_amount} kr). Bättre lycka nästa gång!`,
        url: '/#arcade'
      }, 'duels').catch(() => {});

      sendMaltaSupportNotification(loserId, {
        eventType: 'duel_loss',
        details: {
          opponentName: winnerName,
          gameType: updated.game_type,
          stakeAmount: updated.stake_amount
        },
        url: '/#arcade'
      }).catch(() => {});
    } else {
      sendPushToUsers([updated.creator_id, updated.opponent_id], {
        title: '🤝 Oavgjort i duellen!',
        body: `Duellen mellan ${creatorName} och ${opponentName} slutade oavgjort!`,
        url: '/#arcade'
      }, 'duels').catch(() => {});
    }
  }

  res.json({ duel: updated });
});

app.post('/api/duels/:id/settle', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const duel = db.getDuelById(req.params.id);
  if (!duel) return res.status(404).json({ error: 'Duell hittades inte' });

  if (duel.tournament_id) {
    return res.status(400).json({ error: 'Denna duell ingår i en turnering och avräknas samlat under THE TAB' });
  }

  if (user.id !== duel.creator_id && user.id !== duel.opponent_id) {
    return res.status(403).json({ error: 'Du deltar inte i denna duell' });
  }

  if (duel.status !== 'completed') {
    return res.status(400).json({ error: 'Endast avslutade dueller kan kvitteras' });
  }

  // Only the creditor/winner can settle the debt (or either if tie)
  if (duel.winner_id && duel.winner_id !== user.id) {
    return res.status(403).json({ error: 'Endast vinnaren/borgenären kan kvittera denna duell' });
  }

  db.settleDuelById(req.params.id);
  broadcastToDuel(req.params.id, {
    type: 'duel_settled',
    duelId: req.params.id
  });

  res.json({ ok: true });
});

app.post('/api/duels/settle-with/:friendId', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const friendId = req.params.friendId;
  if (!friendId || friendId === user.id) {
    return res.status(400).json({ error: 'Ogiltig vän angiven' });
  }

  const friend = db.getUserById(friendId);
  if (!friend) {
    return res.status(404).json({ error: 'Användaren hittades inte' });
  }

  const summary = db.getDuelSettlementSummary(user.id);
  const friendSummary = (summary.friends || []).find(f => f.friendId === friendId);

  // If there are no unsettled duels between these users in Swishlistan:
  if (!friendSummary) {
    return res.status(400).json({ error: 'Det finns inga okvitterade dueller att kvittera med denna vän' });
  }

  // If user is debtor (netAmount < 0), reject! Only creditor or even balance can settle.
  if (friendSummary.netAmount < 0) {
    return res.status(403).json({ error: 'Endast mottagaren/borgenären kan kvittera denna skuld' });
  }

  db.settleDuelsBetweenUsers(user.id, friendId);
  broadcastToUser(friendId, {
    type: 'duels_settled',
    friendId: user.id
  });

  const settlerName = user.nickname || user.real_name || 'En vän';
  sendPushToUsers([friendId], {
    title: '🤝 Swish-skulder kvitterade!',
    body: `${settlerName} har kvitterat era gemensamma dueller i Swishlistan!`,
    url: '/#arcade'
  }, 'duels').catch(() => {});

  res.json({ ok: true });
});

// ── Minigame Party Rooms API (The Blind 10.00 etc.) ──────────────────
app.post('/api/minigames/party/create', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { gameType, stakeAmount } = req.body;
  const allowedGames = ['blind10', 'mafia', 'space_invaders'];
  const finalGameType = allowedGames.includes(gameType) ? gameType : 'blind10';
  const parsedStake = typeof stakeAmount === 'number' && Number.isFinite(stakeAmount)
    ? Math.min(500, Math.max(0, Math.floor(stakeAmount)))
    : 0;

  const roomId = crypto.randomUUID();
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (partyCodeToId.has(code));

  const room = {
    id: roomId,
    code,
    gameType: finalGameType,
    hostId: user.id,
    hostNickname: user.nickname,
    stakeAmount: parsedStake,
    status: 'lobby', // 'lobby' | 'countdown' | 'running' | 'results' | 'tie'
    createdAt: new Date().toISOString(),
    players: [
      {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url || null,
        avatarEmoji: user.avatar_emoji || '👑',
        isHost: true,
        stoppedTime: null,
        diff: null,
        rank: null
      }
    ],
    results: [],
    tiedPlayerIds: []
  };

  partyRooms.set(roomId, room);
  partyCodeToId.set(code, roomId);
  res.json({ room });
});

app.get('/api/minigames/party/:query', (req, res) => {
  const query = req.params.query.toUpperCase();
  const roomId = partyCodeToId.get(query) || req.params.query;
  const room = partyRooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });
  const sanitizedRoom = (room.gameType === 'mafia' || room.mafiaState)
    ? sanitizeMafiaRoomForBroadcast(room)
    : room;
  res.json({ room: sanitizedRoom });
});

// Party Room QR Code
app.get('/api/minigames/party/:query/qr', async (req, res) => {
  const query = req.params.query.toUpperCase();
  const roomId = partyCodeToId.get(query) || req.params.query;
  const room = partyRooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });

  const baseUrl = getPublicBaseUrl(req);
  const url = `${baseUrl}/?party=${room.code}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: '#FFD700', light: '#07070e' }
    });
    res.json({ qr: qrDataUrl, url, code: room.code, gameType: room.gameType });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte generera QR-kod' });
  }
});

// General App QR Code (for sharing the web app)
app.get('/api/app/qr', async (req, res) => {
  const defaultBase = getPublicBaseUrl(req);
  let targetUrl = req.query.url || defaultBase;
  try {
    new URL(targetUrl);
  } catch {
    targetUrl = defaultBase;
  }
  if (!targetUrl.includes('localhost') && !targetUrl.includes('127.0.0.1')) {
    targetUrl = targetUrl.replace(/^http:\/\//i, 'https://');
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 360,
      margin: 2,
      color: { dark: '#FFD700', light: '#07070e' }
    });
    res.json({ qr: qrDataUrl, url: targetUrl });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte generera QR-kod' });
  }
});

app.post('/api/minigames/party/join', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { code, roomId } = req.body;
  const targetId = roomId || partyCodeToId.get((code || '').toUpperCase());
  const room = partyRooms.get(targetId);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });
  let player = room.players.find(p => p.id === user.id);
  // New players may only join in the lobby: joining mid-round (or during a tie-break)
  // would make them a loser of a round they never played.
  if (!player && room.status !== 'lobby' && room.status !== 'completed') {
    return res.status(400).json({ error: 'Spelet har redan startat' });
  }

  // Re-opening the invitation (e.g. tapping the notification again) must not disturb
  // the others: only a genuinely new player is announced
  const isNewPlayer = !player;
  if (!player && room.status === 'completed') {
    // A rematch with a new player: back to the lobby so the host gets the start button
    room.status = 'lobby';
    room.results = [];
    room.tiedPlayerIds = [];
  }
  if (!player) {
    player = {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatar_url || null,
      avatarEmoji: user.avatar_emoji || '👤',
      isHost: false,
      stoppedTime: null,
      diff: null,
      rank: null
    };
    room.players.push(player);
  }

  if (isNewPlayer) {
    broadcastToParty(room.id, {
      type: 'party_updated',
      room
    });
  }

  res.json({ room });
});

// Leaving a room between rounds. Without this a player who walked away stayed in the room
// and lost their stake (DNF) in the next round.
app.post('/api/minigames/party/:id/leave', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const room = partyRooms.get(req.params.id);
  if (!room) return res.json({ ok: true });
  const idx = room.players.findIndex(p => p.id === user.id);
  if (idx === -1) return res.json({ ok: true });
  if (room.status === 'running' || room.status === 'tie') {
    return res.status(400).json({ error: 'Du kan inte lämna mitt i en omgång' });
  }

  room.players.splice(idx, 1);
  if (room.players.length === 0) {
    partyRooms.delete(room.id);
    partyCodeToId.delete(room.code);
    return res.json({ ok: true });
  }
  if (room.hostId === user.id) {
    // The next player takes over as host
    const next = room.players[0];
    room.hostId = next.id;
    room.hostNickname = next.nickname;
    room.players.forEach(p => { p.isHost = p.id === next.id; });
  }
  broadcastToParty(room.id, { type: 'party_updated', room });
  res.json({ ok: true });
});

app.post('/api/minigames/party/:id/invite', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });

  if (!room.players.some(p => p.id === user.id)) {
    return res.status(403).json({ error: 'Endast deltagare i rummet kan bjuda in vänner' });
  }

  const { friendIds } = req.body;
  if (Array.isArray(friendIds) && friendIds.length > 0) {
    for (const fId of friendIds) {
      broadcastToUser(fId, {
        type: 'party_invitation',
        room: {
          id: room.id,
          code: room.code,
          gameType: room.gameType,
          hostNickname: user.nickname,
          stakeAmount: room.stakeAmount
        }
      });
    }

    const hostName = user.nickname || user.real_name || 'En polare';
    const gameTitles = {
      space_invaders: 'Space Blitz 👾',
      blind10: 'Blind 10 ⏱️'
    };
    const gameName = gameTitles[room.gameType] || 'Party 🎮';
    const stakeText = room.stakeAmount > 0 ? `(${room.stakeAmount} kr insats)` : '(Ära)';

    sendPushToUsers(friendIds, {
      title: `🎉 Inbjudan till ${gameName}!`,
      body: `${hostName} bjuder in dig till rum #${room.code} ${stakeText}. Klicka för att joina!`,
      // Deep link straight into the room (joins it and opens the game)
      url: `/?party=${encodeURIComponent(room.code)}`
    }, 'duels').catch(() => {});
  }

  res.json({ ok: true });
});

// ── Party round integrity (Blind 10 & Space Blitz with money on the line) ──
const BLIND10_TARGET_SEC = 10;
const BLIND10_ROUND_TIMEOUT_MS = 30000;
const SPACE_BLITZ_DURATION_MS = 60000;
const SPACE_BLITZ_GRACE_MS = 10000;
const SPACE_FIRE_INTERVAL_MS = 220;
const SPACE_ALIENS_PER_WAVE = 28;
const SPACE_WAVE_POINTS = 560; // 7×30 + 14×20 + 7×10
const SPACE_WAVE_CLEAR_BONUS = 300; // the game awards this for every cleared wave
const SPACE_ALIEN_POINTS_DESC = [...Array(7).fill(30), ...Array(14).fill(20), ...Array(7).fill(10)];
const SPACE_UFO_POINTS = 200;
const SPACE_FIRST_UFO_MS = 12000;
const SPACE_UFO_MIN_GAP_MS = 18000;
const MAX_LATENCY_COMPENSATION_MS = 400;
const PARTY_PING_ROUNDS = 3;

const partyRoundTimers = new Map(); // roomId → timeout handle (kept out of the room so it can be JSON-broadcast)
const userRttSamples = new Map();   // userId → recent WebSocket round-trip times (ms)

// RTT is measured with protocol-level WebSocket ping/pong, which page JavaScript cannot delay or fake
function recordUserRtt(userId, rttMs) {
  if (!userId || !Number.isFinite(rttMs) || rttMs < 0) return;
  const samples = userRttSamples.get(userId) || [];
  samples.push(rttMs);
  while (samples.length > 5) samples.shift();
  userRttSamples.set(userId, samples);
}

function getLatencyCompensationMs(userId) {
  const samples = [...(userRttSamples.get(userId) || [])].sort((a, b) => a - b);
  if (samples.length === 0) return 0;
  const median = samples[Math.floor(samples.length / 2)];
  return Math.min(MAX_LATENCY_COMPENSATION_MS, median);
}

function pingPartyPlayers(roomId) {
  for (let i = 0; i < PARTY_PING_ROUNDS; i++) {
    setTimeout(() => {
      for (const ws of partyClients.get(roomId) || []) {
        if (ws.readyState !== 1 || !ws.whooplyUserId) continue;
        try {
          ws.whooplyPingAt = performance.now();
          ws.ping();
        } catch {}
      }
    }, i * 600).unref?.();
  }
}

// Checks a Space Blitz result against the game's rules: fire rate, points per alien row,
// aliens per wave and UFO spawn timing. Returns null when plausible, otherwise a reason.
export function spaceBlitzImplausibilityReason({ score, aliensKilled, wave, elapsedMs }) {
  if (![score, aliensKilled, wave].every(n => Number.isInteger(n) && n >= 0)) return 'Ogiltiga värden';
  if (wave < 1) return 'Ogiltig våg';
  if (score % 10 !== 0) return 'Poängen går inte ihop';

  const maxShots = Math.floor(elapsedMs / SPACE_FIRE_INTERVAL_MS) + 1;
  if (aliensKilled > maxShots) return 'Fler träffar än möjliga skott';

  const clearedWaves = wave - 1;
  const partialKills = aliensKilled - clearedWaves * SPACE_ALIENS_PER_WAVE;
  if (partialKills < 0 || partialKills > SPACE_ALIENS_PER_WAVE) return 'Våg och antal träffar går inte ihop';

  const maxPartial = SPACE_ALIEN_POINTS_DESC.slice(0, partialKills).reduce((a, b) => a + b, 0);
  const minPartial = SPACE_ALIEN_POINTS_DESC.slice(SPACE_ALIEN_POINTS_DESC.length - partialKills).reduce((a, b) => a + b, 0);
  const maxUfos = elapsedMs < SPACE_FIRST_UFO_MS ? 0 : 1 + Math.floor((elapsedMs - SPACE_FIRST_UFO_MS) / SPACE_UFO_MIN_GAP_MS);

  for (let ufos = 0; ufos <= maxUfos; ufos++) {
    // A cleared wave is worth its aliens plus the clear bonus; without the bonus every honest
    // player who cleared a wave was invalidated to 0 points
    const partialScore = score - clearedWaves * (SPACE_WAVE_POINTS + SPACE_WAVE_CLEAR_BONUS) - ufos * SPACE_UFO_POINTS;
    if (partialScore >= minPartial && partialScore <= maxPartial) return null;
  }
  return 'Poängen går inte ihop med antal träffar';
}

function hasFinishedRound(p) {
  return p.stoppedTime !== null && p.stoppedTime !== undefined || p.dnf === true;
}

function clearPartyRoundTimer(roomId) {
  const handle = partyRoundTimers.get(roomId);
  if (handle) clearTimeout(handle);
  partyRoundTimers.delete(roomId);
}

function schedulePartyRoundTimeout(room) {
  clearPartyRoundTimer(room.id);
  const limitMs = room.gameType === 'space_invaders'
    ? SPACE_BLITZ_DURATION_MS + SPACE_BLITZ_GRACE_MS
    : BLIND10_ROUND_TIMEOUT_MS;
  const delay = Math.max(0, room.startTime + limitMs - Date.now());
  const handle = setTimeout(() => {
    partyRoundTimers.delete(room.id);
    if (partyRooms.get(room.id) === room && room.status === 'running') {
      finalizePartyRound(room, { timedOut: true });
    }
  }, delay);
  handle.unref?.();
  partyRoundTimers.set(room.id, handle);
}

function getActivePartyPlayers(room) {
  return room.tiedPlayerIds.length > 0
    ? room.players.filter(p => room.tiedPlayerIds.includes(p.id))
    : room.players;
}

function recordPartyDebts(room, winners, stakePerLoser) {
  if (!(room.stakeAmount > 0) || winners.length === 0) return;
  const winnerIds = new Set(winners.map(w => w.id));
  const losers = room.players.filter(p => !winnerIds.has(p.id));
  const share = Math.round((stakePerLoser / winners.length) * 100) / 100;
  if (share <= 0) return;
  const isSpace = room.gameType === 'space_invaders';

  for (const loser of losers) {
    for (const winner of winners) {
      try {
        const duel = db.createDuel({
          gameType: room.gameType,
          creatorId: winner.id,
          opponentId: loser.id,
          stakeAmount: share,
          mode: isSpace ? 'party' : 'online'
        });
        if (duel) {
          db.submitDuelResult({
            duelId: duel.id,
            creatorScore: isSpace ? (winner.score || 1) : 1,
            opponentScore: isSpace ? (loser.score || 0) : 0,
            winnerId: winner.id
          });

          sendMaltaSupportNotification(loser.id, {
            eventType: 'duel_loss',
            details: {
              opponentName: winner.nickname || winner.real_name || 'Polaren',
              gameType: isSpace ? 'Space Blitz' : (room.gameType === 'blind10' ? 'Blind 10' : 'Partyspel'),
              stakeAmount: share
            },
            url: '/#arcade'
          }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to log party duel settlement:', e);
      }
    }
  }
}

// Decides the round once every active player has finished (or the round timed out).
// Players who never finished are marked DNF and rank last.
function finalizePartyRound(room, { timedOut = false } = {}) {
  const isSpace = room.gameType === 'space_invaders';
  const activePlayers = getActivePartyPlayers(room);

  if (!timedOut && !activePlayers.every(hasFinishedRound)) return false;
  clearPartyRoundTimer(room.id);

  for (const p of activePlayers) {
    if (!hasFinishedRound(p)) {
      p.dnf = true;
      if (isSpace) p.score = 0;
    }
  }

  const finishers = activePlayers.filter(p => !p.dnf);
  const ranked = [
    ...finishers.sort((a, b) => isSpace ? (b.score || 0) - (a.score || 0) : a.diff - b.diff),
    ...activePlayers.filter(p => p.dnf)
  ];
  room.results = ranked.map((p, idx) => ({ ...p, rank: idx + 1 }));

  if (finishers.length === 0) {
    room.status = 'completed';
    if (room.tiedPlayerIds.length > 1) {
      // Nobody finished the tie-break: the tied players share the pot as agreed before it
      const tiedWinners = room.players.filter(p => room.tiedPlayerIds.includes(p.id));
      recordPartyDebts(room, tiedWinners, room.stakeAmount);
      broadcastToParty(room.id, { type: 'party_pot_split', room, tiedWinners });
      return true;
    }
    broadcastToParty(room.id, { type: 'party_results', room, isTie: false, winner: null });
    return true;
  }

  const best = ranked[0];
  const tied = finishers.filter(p => isSpace ? (p.score || 0) === (best.score || 0) : p.diff === best.diff);

  if (tied.length > 1) {
    room.status = 'tie';
    room.tiedPlayerIds = tied.map(p => p.id);
    broadcastToParty(room.id, { type: 'party_results', room, isTie: true, tiedPlayerIds: room.tiedPlayerIds });
    return true;
  }

  room.status = 'completed';
  recordPartyDebts(room, [best], room.stakeAmount);
  broadcastToParty(room.id, { type: 'party_results', room, isTie: false, winner: best });
  return true;
}

function startPartyRound(room, playerIds) {
  const countdownSec = 3;
  room.status = 'running';
  room.countdownSec = countdownSec;
  room.startTime = Date.now() + (countdownSec * 1000);
  for (const p of room.players) {
    if (!playerIds || playerIds.includes(p.id)) {
      p.stoppedTime = null;
      p.diff = null;
      p.rank = null;
      p.dnf = false;
      p.invalidated = false;
      if (room.gameType === 'space_invaders') {
        p.score = null;
        p.aliensKilled = null;
        p.waveReached = null;
      }
    }
  }
  pingPartyPlayers(room.id);
  schedulePartyRoundTimeout(room);
  return countdownSec;
}

app.post('/api/minigames/party/:id/start', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });
  if (room.hostId !== user.id) return res.status(403).json({ error: 'Endast hosten kan starta spelet' });

  // The host must not be able to wipe a round in progress (e.g. when losing)
  if (room.status === 'running' || room.status === 'tie') {
    return res.status(400).json({ error: 'En omgång pågår redan' });
  }

  if (room.stakeAmount > 0 && room.players.length < 2) {
    return res.status(400).json({ error: 'Minst 2 deltagare krävs för att starta ett rum med insats' });
  }

  room.results = [];
  room.tiedPlayerIds = [];
  const countdownSec = startPartyRound(room, null);

  broadcastToParty(room.id, {
    type: 'party_started',
    room,
    countdownSec,
    startTime: room.startTime,
    serverNow: Date.now()
  });

  res.json({ ok: true, room });
});

app.post('/api/minigames/party/:id/submit', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });

  const player = room.players.find(p => p.id === user.id);
  if (!player) {
    return res.status(403).json({ error: 'Du deltar inte i detta rum' });
  }

  if (room.status !== 'running') {
    return res.status(400).json({ error: 'Spelet pågår inte just nu' });
  }

  const activePlayers = getActivePartyPlayers(room);
  if (!activePlayers.some(p => p.id === user.id)) {
    return res.status(400).json({ error: 'Du deltar inte i denna omgång' });
  }

  if (hasFinishedRound(player)) {
    return res.status(400).json({ error: 'Du har redan stoppat klockan' });
  }

  const now = Date.now();
  if (room.startTime && now < room.startTime) {
    return res.status(400).json({ error: 'Spelet har inte startat ännu' });
  }
  const elapsedMs = now - (room.startTime || now);

  if (room.gameType === 'space_invaders') {
    if (elapsedMs > SPACE_BLITZ_DURATION_MS + SPACE_BLITZ_GRACE_MS) {
      return res.status(400).json({ error: 'Tidsfönstret för inlämning har löpt ut' });
    }

    const pick = (key) => typeof req.body[key] === 'number'
      ? req.body[key]
      : (req.body.stoppedTime && typeof req.body.stoppedTime[key] === 'number' ? req.body.stoppedTime[key] : NaN);
    const reported = {
      score: pick('score'),
      aliensKilled: pick('aliensKilled'),
      wave: pick('waveReached'),
      elapsedMs
    };

    const reason = spaceBlitzImplausibilityReason(reported);
    if (reason) {
      // An impossible result counts as 0 points instead of being silently clamped
      console.warn(`[party] Invalidated Space Blitz result from ${user.id} in room ${room.id}: ${reason}`, reported);
      player.score = 0;
      player.aliensKilled = 0;
      player.waveReached = 1;
      player.invalidated = true;
    } else {
      player.score = reported.score;
      player.aliensKilled = reported.aliensKilled;
      player.waveReached = reported.wave;
    }
    player.stoppedTime = now;

    broadcastToParty(room.id, {
      type: 'party_player_stopped',
      userId: user.id,
      nickname: user.nickname,
      score: player.score,
      invalidated: Boolean(player.invalidated),
      stoppedCount: activePlayers.filter(hasFinishedRound).length,
      totalCount: activePlayers.length
    });

    finalizePartyRound(room);
    return res.json({ ok: true, room, score: player.score, invalidated: Boolean(player.invalidated) });
  }

  // Blind 10: the server measures the time. The client's own number is ignored; only the
  // player's network round-trip (measured by the server) is subtracted, capped at 400 ms.
  const compensationMs = getLatencyCompensationMs(user.id);
  const finalTime = Math.round(Math.max(0, elapsedMs - compensationMs)) / 1000;
  const diff = Math.round(Math.abs(finalTime - BLIND10_TARGET_SEC) * 1000) / 1000;
  player.stoppedTime = finalTime;
  player.diff = diff;

  broadcastToParty(room.id, {
    type: 'party_player_stopped',
    userId: user.id,
    nickname: user.nickname,
    stoppedCount: activePlayers.filter(hasFinishedRound).length,
    totalCount: activePlayers.length
  });

  finalizePartyRound(room);
  res.json({ ok: true, room, stoppedTime: finalTime, diff, latencyCompensationMs: Math.round(compensationMs) });
});

// Server clock, so phones can estimate their clock offset (half the round trip is transit)
app.get('/api/time', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ now: Date.now() });
});

// ── Space Blitz solo: best score per player, compared with friends ──
// A solo round is started on the server and its result can be handed in once, within the
// round's time, and is checked against the time that really passed
const spaceSoloRounds = new Map(); // roundId → { userId, startedAt }

app.post('/api/space/solo-start', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const now = Date.now();
  for (const [id, r] of spaceSoloRounds) {
    if (now - r.startedAt > SPACE_BLITZ_DURATION_MS + SPACE_BLITZ_GRACE_MS) spaceSoloRounds.delete(id);
  }
  const roundId = crypto.randomUUID();
  spaceSoloRounds.set(roundId, { userId: user.id, startedAt: now });
  res.json({ roundId });
});

app.post('/api/space/solo-score', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const { roundId, score, aliensKilled, waveReached } = req.body || {};
  const round = roundId ? spaceSoloRounds.get(roundId) : null;
  if (!round || round.userId !== user.id) {
    return res.status(400).json({ error: 'Ingen pågående runda att lämna in' });
  }
  spaceSoloRounds.delete(roundId);
  const elapsedMs = Date.now() - round.startedAt;
  if (elapsedMs > SPACE_BLITZ_DURATION_MS + SPACE_BLITZ_GRACE_MS) {
    return res.status(400).json({ error: 'Rundan är för gammal för att lämnas in' });
  }
  // The same rule check as money games, against the time that really passed
  const reason = spaceBlitzImplausibilityReason({ score, aliensKilled, wave: waveReached, elapsedMs });
  if (reason) return res.status(400).json({ error: 'Resultatet går inte ihop med spelets regler' });
  res.json(db.recordSpaceSoloScore(user.id, score, waveReached));
});

app.get('/api/space/leaderboard', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  res.json(db.getSpaceSoloLeaderboard(user.id));
});

app.post('/api/minigames/party/:id/resolve-tie', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });

  if (room.hostId !== user.id) {
    return res.status(403).json({ error: 'Endast hosten kan avgöra oavgjort' });
  }

  if (room.status !== 'tie' || room.tiedPlayerIds.length < 2) {
    return res.status(400).json({ error: 'Det finns inget oavgjort resultat att avgöra' });
  }

  const { decision } = req.body;

  if (decision === 'sudden_death') {
    const countdownSec = startPartyRound(room, room.tiedPlayerIds);
    broadcastToParty(room.id, {
      type: 'party_sudden_death_start',
      room,
      countdownSec,
      startTime: room.startTime,
      serverNow: Date.now()
    });
    return res.json({ ok: true, room });
  }

  room.status = 'completed';
  const tiedWinners = room.players.filter(p => room.tiedPlayerIds.includes(p.id));
  recordPartyDebts(room, tiedWinners, room.stakeAmount);

  broadcastToParty(room.id, {
    type: 'party_pot_split',
    room,
    tiedWinners
  });
  res.json({ ok: true, room });
});

// ── MAFFIA / WEREWOLF PARTY ENGINE ────────────────────────────────
function assignMafiaRoles(players, narratorMode = 'ai', hostId = null) {
  // If host chosen as narrator, host does not play actively
  const activePlayers = narratorMode === 'human'
    ? players.filter(p => p.id !== hostId)
    : [...players];

  const total = activePlayers.length;
  // Role distribution rules:
  // 4-6 players: 1 mafia, 1 detective, 1 doctor, rest villagers
  // 7-9 players: 2 mafia, 1 detective, 1 doctor, rest villagers
  // 10-14 players: 3 mafia, 1 detective, 1 doctor, rest villagers
  // 15+ players: 4 mafia, 1 detective, 1 doctor, rest villagers
  let mafiaCount = 1;
  if (total >= 15) mafiaCount = 4;
  else if (total >= 10) mafiaCount = 3;
  else if (total >= 7) mafiaCount = 2;

  const roles = [];
  for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
  roles.push('detective');
  if (total >= 5) roles.push('doctor');
  while (roles.length < total) roles.push('villager');

  // Shuffle roles cryptographically
  for (let i = roles.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  const assigned = {};
  activePlayers.forEach((p, idx) => {
    assigned[p.id] = {
      role: roles[idx],
      isAlive: true,
      nickname: p.nickname,
      avatarEmoji: p.avatarEmoji || '👤'
    };
  });

  if (narratorMode === 'human' && hostId) {
    assigned[hostId] = {
      role: 'narrator',
      isAlive: true,
      nickname: players.find(p => p.id === hostId)?.nickname || 'Spelledare',
      avatarEmoji: '🎩'
    };
  }

  return assigned;
}

app.post('/api/minigames/mafia/:id/start', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Rummet hittades inte' });
  if (room.hostId !== user.id) return res.status(403).json({ error: 'Endast hosten kan starta Maffia' });

  if (room.gameType !== 'mafia') {
    return res.status(400).json({ error: 'Detta rum är inte ett Maffiaspel' });
  }

  if (room.status !== 'lobby') {
    return res.status(400).json({ error: 'Spelet har redan startat eller avslutats' });
  }

  const narratorMode = req.body.narratorMode === 'human' ? 'human' : 'ai';
  const minPlayers = narratorMode === 'human' ? 5 : 4;
  if (room.players.length < minPlayers) {
    return res.status(400).json({
      error: `Minst ${minPlayers} spelare krävs för att starta Maffia${narratorMode === 'human' ? ' med mänsklig spelledare' : ''}`
    });
  }

  const mafiaState = {
    narratorMode,
    phase: 'night', // 'roles' -> 'night' -> 'morning' -> 'day' -> 'lynch' -> 'ended'
    roundNumber: 1,
    subPhase: 'mafia', // 'mafia' -> 'detective' -> 'doctor' -> 'done'
    roles: assignMafiaRoles(room.players, narratorMode, user.id),
    nightActions: {
      mafiaTargetId: null,
      mafiaVotes: {}, // voterId -> targetId
      detectiveCheckedId: null,
      detectiveResult: null,
      doctorProtectedId: null
    },
    dayVotes: {}, // voterId -> targetId
    voteCounts: {},
    history: [],
    lastKilled: null,
    lastLynched: null,
    lastLynchTie: false,
    winner: null // 'villagers' | 'mafia'
  };

  room.status = 'mafia_running';
  room.mafiaState = mafiaState;

  broadcastToParty(room.id, {
    type: 'mafia_game_started',
    room: sanitizeMafiaRoomForBroadcast(room)
  });

  res.json({ ok: true, room: sanitizeMafiaRoomForBroadcast(room) });
});

function sanitizeMafiaRoomForBroadcast(room) {
  if (!room.mafiaState) return room;
  // Return room without leaking secret roles publicly to everyone
  const publicRoles = {};
  for (const [pId, pData] of Object.entries(room.mafiaState.roles || {})) {
    publicRoles[pId] = {
      isAlive: pData.isAlive,
      nickname: pData.nickname,
      avatarEmoji: pData.avatarEmoji,
      // If dead or game ended, reveal role
      role: (!pData.isAlive || room.mafiaState.phase === 'ended') ? pData.role : null
    };
  }

  const voteCounts = {};
  if (room.mafiaState.dayVotes) {
    for (const [voterId, targetId] of Object.entries(room.mafiaState.dayVotes)) {
      if (targetId && room.mafiaState.roles?.[voterId]?.isAlive && room.mafiaState.roles?.[voterId]?.role !== 'narrator') {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      }
    }
  }

  return {
    ...room,
    mafiaState: {
      narratorMode: room.mafiaState.narratorMode,
      phase: room.mafiaState.phase,
      roundNumber: room.mafiaState.roundNumber,
      subPhase: room.mafiaState.subPhase,
      roles: publicRoles,
      voteCounts: room.mafiaState.voteCounts || voteCounts,
      lastKilled: room.mafiaState.lastKilled || null,
      lastLynched: room.mafiaState.lastLynched || null,
      lastLynchTie: !!room.mafiaState.lastLynchTie,
      winner: room.mafiaState.winner || null
    }
  };
}

// Get player's secret mafia perspective
app.get('/api/minigames/mafia/:id/my-role', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room || !room.mafiaState) return res.status(404).json({ error: 'Inget aktivt Maffiaspel' });

  const myPlayerRole = room.mafiaState.roles[user.id];
  if (!myPlayerRole) return res.status(403).json({ error: 'Du deltar inte i detta Maffiaspel' });

  // If mafia, also return list of fellow mafia members
  let fellowMafia = [];
  if (myPlayerRole.role === 'mafia') {
    fellowMafia = Object.entries(room.mafiaState.roles)
      .filter(([id, data]) => data.role === 'mafia')
      .map(([id, data]) => ({ id, nickname: data.nickname, isAlive: data.isAlive }));
  }

  // If human narrator, return full God Mode state
  const isNarrator = myPlayerRole.role === 'narrator';
  const godModeRoles = isNarrator ? room.mafiaState.roles : null;

  res.json({
    role: myPlayerRole.role,
    isAlive: myPlayerRole.isAlive,
    fellowMafia,
    godModeRoles,
    nightActions: isNarrator ? room.mafiaState.nightActions : undefined,
    phase: room.mafiaState.phase,
    subPhase: room.mafiaState.subPhase
  });
});

// Submit night action (Mafia target, Detective investigate, Doctor protect)
app.post('/api/minigames/mafia/:id/night-action', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room || !room.mafiaState) return res.status(404).json({ error: 'Inget aktivt Maffiaspel' });

  const state = room.mafiaState;
  if (state.phase !== 'night' || state.phase === 'ended') {
    return res.status(400).json({ error: 'Nattdrag kan endast utföras under natten' });
  }

  const myPlayer = state.roles[user.id];
  if (!myPlayer || !myPlayer.isAlive) {
    return res.status(403).json({ error: 'Endast levande spelare kan agera' });
  }

  const { actionType, targetId } = req.body;
  const target = state.roles[targetId];
  if (!target || !target.isAlive || target.role === 'narrator') {
    return res.status(400).json({ error: 'Ogiltig eller redan utslagen måltavla' });
  }

  let detectiveResult = null;

  if (actionType === 'mafia_kill') {
    if (myPlayer.role !== 'mafia') return res.status(403).json({ error: 'Endast maffian kan mörda' });
    if (target.role === 'mafia') {
      return res.status(400).json({ error: 'Maffian kan inte mörda sina egna medlemmar' });
    }
    state.nightActions.mafiaVotes[user.id] = targetId;

    // Tally majority among alive mafia members
    const tally = {};
    for (const [voterId, tId] of Object.entries(state.nightActions.mafiaVotes)) {
      if (state.roles[voterId]?.isAlive && state.roles[voterId]?.role === 'mafia') {
        tally[tId] = (tally[tId] || 0) + 1;
      }
    }
    let chosenTarget = null;
    let maxVotes = 0;
    for (const [tId, cnt] of Object.entries(tally)) {
      if (cnt > maxVotes) {
        maxVotes = cnt;
        chosenTarget = tId;
      }
    }
    state.nightActions.mafiaTargetId = chosenTarget;
  } else if (actionType === 'detective_check') {
    if (myPlayer.role !== 'detective') return res.status(403).json({ error: 'Endast detektiven kan undersöka' });
    detectiveResult = target.role === 'mafia' ? 'mafia' : 'innocent';
    state.nightActions.detectiveCheckedId = targetId;
    state.nightActions.detectiveResult = detectiveResult;
  } else if (actionType === 'doctor_protect') {
    if (myPlayer.role !== 'doctor') return res.status(403).json({ error: 'Endast läkaren kan skydda' });
    state.nightActions.doctorProtectedId = targetId;
  } else {
    return res.status(400).json({ error: 'Ogiltig åtgärdstyp' });
  }

  broadcastToParty(room.id, {
    type: 'mafia_night_progress',
    subPhase: state.subPhase,
    actionReceivedFrom: user.id
  });

  res.json({ ok: true, detectiveResult });
});

// Advance phase (Night -> Day / Day -> Vote -> Lynch)
app.post('/api/minigames/mafia/:id/advance-phase', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room || !room.mafiaState) return res.status(404).json({ error: 'Inget aktivt Maffiaspel' });
  if (room.hostId !== user.id) return res.status(403).json({ error: 'Endast hosten kan växla fas' });

  const state = room.mafiaState;

  if (req.body.expectedPhase && req.body.expectedPhase !== state.phase) {
    return res.status(400).json({
      error: `Fasfel: Förväntade fas '${req.body.expectedPhase}' men spelet är i '${state.phase}'`,
      room: sanitizeMafiaRoomForBroadcast(room)
    });
  }

  if (state.phase === 'ended') {
    return res.json({ ok: true, room: sanitizeMafiaRoomForBroadcast(room), winner: state.winner || null });
  }

  if (state.phase === 'night') {
    // Resolve majority mafia vote among alive mafia
    const tally = {};
    for (const [voterId, tId] of Object.entries(state.nightActions.mafiaVotes || {})) {
      if (state.roles[voterId]?.isAlive && state.roles[voterId]?.role === 'mafia') {
        tally[tId] = (tally[tId] || 0) + 1;
      }
    }
    let majorityTarget = null;
    let maxVotes = 0;
    for (const [tId, cnt] of Object.entries(tally)) {
      if (cnt > maxVotes) {
        maxVotes = cnt;
        majorityTarget = tId;
      }
    }
    const targetId = majorityTarget || state.nightActions.mafiaTargetId;
    const protectedId = state.nightActions.doctorProtectedId;
    let killedPlayer = null;

    if (targetId && targetId !== protectedId) {
      if (state.roles[targetId] && state.roles[targetId].isAlive) {
        state.roles[targetId].isAlive = false;
        killedPlayer = {
          id: targetId,
          nickname: state.roles[targetId].nickname,
          role: state.roles[targetId].role
        };
      }
    }

    state.lastKilled = killedPlayer;
    state.phase = 'morning';

    // Check win condition
    const winCheck = evaluateMafiaWinner(state.roles);
    if (winCheck) {
      state.phase = 'ended';
      state.winner = winCheck;
      resolveMafiaDebts(room, winCheck);
    }

    broadcastToParty(room.id, {
      type: 'mafia_morning',
      killedPlayer,
      saved: targetId && targetId === protectedId,
      winner: state.winner,
      room: sanitizeMafiaRoomForBroadcast(room)
    });

  } else if (state.phase === 'morning') {
    // Start discussion
    state.phase = 'day';
    state.dayVotes = {};
    state.voteCounts = {};

    broadcastToParty(room.id, {
      type: 'mafia_day_started',
      room: sanitizeMafiaRoomForBroadcast(room)
    });

  } else if (state.phase === 'day') {
    // Resolve day votes / lynch
    const voteCounts = {};
    for (const [voterId, targetId] of Object.entries(state.dayVotes)) {
      if (state.roles[voterId]?.isAlive && state.roles[voterId]?.role !== 'narrator') {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      }
    }

    let highestVoteId = null;
    let maxVotes = 0;
    let isTie = false;

    for (const [tId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        highestVoteId = tId;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
      }
    }

    let lynchedPlayer = null;
    if (highestVoteId && !isTie && maxVotes >= 1) {
      if (state.roles[highestVoteId] && state.roles[highestVoteId].isAlive) {
        state.roles[highestVoteId].isAlive = false;
        lynchedPlayer = {
          id: highestVoteId,
          nickname: state.roles[highestVoteId].nickname,
          role: state.roles[highestVoteId].role
        };
      }
    }

    state.phase = 'lynch_result';
    state.lastLynched = lynchedPlayer;
    state.lastLynchTie = isTie || !lynchedPlayer;
    state.voteCounts = voteCounts;

    // Check win condition
    const winCheck = evaluateMafiaWinner(state.roles);
    if (winCheck) {
      state.phase = 'ended';
      state.winner = winCheck;
      resolveMafiaDebts(room, winCheck);
    }

    broadcastToParty(room.id, {
      type: 'mafia_lynch_result',
      lynchedPlayer,
      isTie: state.lastLynchTie,
      winner: state.winner,
      voteCounts,
      room: sanitizeMafiaRoomForBroadcast(room)
    });

  } else if (state.phase === 'lynch_result') {
    // Start new night
    state.phase = 'night';
    state.roundNumber++;
    state.subPhase = 'mafia';
    state.nightActions = {
      mafiaTargetId: null,
      mafiaVotes: {},
      detectiveCheckedId: null,
      detectiveResult: null,
      doctorProtectedId: null
    };
    state.dayVotes = {};
    state.voteCounts = {};

    broadcastToParty(room.id, {
      type: 'mafia_night_started',
      roundNumber: state.roundNumber,
      room: sanitizeMafiaRoomForBroadcast(room)
    });
  }

  res.json({ ok: true, room: sanitizeMafiaRoomForBroadcast(room), winner: state.winner || null });
});

// Vote during day lynch
app.post('/api/minigames/mafia/:id/vote', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const room = partyRooms.get(req.params.id);
  if (!room || !room.mafiaState) return res.status(404).json({ error: 'Inget aktivt Maffiaspel' });

  const state = room.mafiaState;
  if (state.phase !== 'day' || state.phase === 'ended') {
    return res.status(400).json({ error: 'Röstning kan endast ske under dagen' });
  }

  const myPlayer = state.roles[user.id];
  if (!myPlayer || !myPlayer.isAlive) {
    return res.status(403).json({ error: 'Döda spelare har inte rösträtt' });
  }
  if (myPlayer.role === 'narrator') {
    return res.status(403).json({ error: 'Spelledaren har inte rösträtt' });
  }

  const { targetId } = req.body;
  const target = state.roles[targetId];
  if (!target || !target.isAlive || target.role === 'narrator') {
    return res.status(400).json({ error: 'Ogiltig måltavla för röstning' });
  }

  state.dayVotes[user.id] = targetId;

  const voteCounts = {};
  for (const [voterId, tId] of Object.entries(state.dayVotes)) {
    if (state.roles[voterId]?.isAlive && state.roles[voterId]?.role !== 'narrator') {
      voteCounts[tId] = (voteCounts[tId] || 0) + 1;
    }
  }
  state.voteCounts = voteCounts;

  broadcastToParty(room.id, {
    type: 'mafia_vote_cast',
    voterId: user.id,
    targetId,
    voteCounts,
    totalVotes: Object.keys(state.dayVotes).length,
    aliveCount: Object.values(state.roles).filter(p => p.isAlive && p.role !== 'narrator').length
  });

  res.json({ ok: true, voteCounts });
});

function evaluateMafiaWinner(roles) {
  const alive = Object.values(roles).filter(p => p.isAlive && p.role !== 'narrator');
  const aliveMafia = alive.filter(p => p.role === 'mafia');
  const aliveVillagers = alive.filter(p => p.role !== 'mafia');

  if (aliveMafia.length === 0) {
    return 'villagers'; // All mafia dead
  }
  if (aliveMafia.length >= aliveVillagers.length) {
    return 'mafia'; // Mafia equal or outnumber villagers
  }
  return null;
}

function resolveMafiaDebts(room, winnerSide) {
  if (!room.stakeAmount || room.stakeAmount <= 0) return;

  const roles = room.mafiaState.roles;
  const winners = Object.entries(roles).filter(([id, p]) => {
    if (winnerSide === 'mafia') return p.role === 'mafia';
    return p.role !== 'mafia' && p.role !== 'narrator';
  }).map(([id]) => id);

  const losers = Object.entries(roles).filter(([id, p]) => {
    if (winnerSide === 'mafia') return p.role !== 'mafia' && p.role !== 'narrator';
    return p.role === 'mafia';
  }).map(([id]) => id);

  if (winners.length === 0 || losers.length === 0) return;

  const totalPot = room.stakeAmount * (winners.length + losers.length);
  const winPerPlayer = Math.round((totalPot / winners.length) * 100) / 100;
  const stakePerLoser = room.stakeAmount;

  for (const loserId of losers) {
    for (const winnerId of winners) {
      try {
        const duel = db.createDuel({
          gameType: 'mafia',
          creatorId: winnerId,
          opponentId: loserId,
          stakeAmount: Math.round((stakePerLoser / winners.length) * 100) / 100,
          mode: 'online'
        });
        if (duel) {
          db.submitDuelResult({
            duelId: duel.id,
            creatorScore: 1,
            opponentScore: 0,
            winnerId
          });
        }
      } catch (e) {}
    }
  }
}

// ── AnyBet API (Kompisbettet) ─────────────────────────
app.post('/api/anybets/create', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { title, description, judgeId, stakeAmount, betType, deadline, participantIds, tournamentId, creatorPlays } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Ange vad bettet handlar om' });
  }
  const cleanTitle = title.trim();
  if (cleanTitle.length > 120) {
    return res.status(400).json({ error: 'Rubriken får vara högst 120 tecken' });
  }

  const cleanDescription = description && typeof description === 'string' ? description.trim() : null;
  if (cleanDescription && cleanDescription.length > 500) {
    return res.status(400).json({ error: 'Beskrivningen får vara högst 500 tecken' });
  }

  const validTypes = ['winner_takes_all', 'yes_no'];
  const normalizedType = betType || 'winner_takes_all';
  if (!validTypes.includes(normalizedType)) {
    return res.status(400).json({ error: `Ogiltig vadtyp: ${betType}. Måste vara winner_takes_all eller yes_no` });
  }

  let stake = 0;
  if (stakeAmount !== undefined && stakeAmount !== null) {
    const parsed = typeof stakeAmount === 'number' ? stakeAmount : parseFloat(stakeAmount);
    if (!Number.isFinite(parsed) || isNaN(parsed) || parsed < 0) {
      return res.status(400).json({ error: 'Insatsen måste vara ett giltigt positivt tal' });
    }
    if (parsed > 10000) {
      return res.status(400).json({ error: 'Insatsen får vara högst 10 000 kr' });
    }
    // Whole kronor: Swish only takes kronor, and The Tab settles in whole kronor
    stake = Math.round(parsed);
  }

  if (deadline) {
    let dlTime = /^\d{4}-\d{2}-\d{2}$/.test(deadline)
      ? new Date(`${deadline}T23:59:59.999`).getTime()
      : new Date(deadline).getTime();
    if (isNaN(dlTime)) {
      return res.status(400).json({ error: 'Ogiltigt datumformat för deadline' });
    }
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (dlTime < startOfToday.getTime()) {
      return res.status(400).json({ error: 'Deadline kan inte vara i dåtid' });
    }
  }

  const userFriends = db.getFriends(user.id);
  const friendIdSet = new Set(userFriends.map(f => String(f.id)));

  const selectedJudgeId = judgeId ? String(judgeId) : String(user.id);
  if (selectedJudgeId !== String(user.id) && !friendIdSet.has(selectedJudgeId)) {
    return res.status(400).json({ error: 'Domaren måste vara du själv eller en av dina vänner' });
  }

  if (participantIds !== undefined && !Array.isArray(participantIds)) {
    return res.status(400).json({ error: 'participantIds måste vara en lista' });
  }
  const rawParticipantIds = Array.isArray(participantIds) ? participantIds : [];
  if (rawParticipantIds.length > 50) {
    return res.status(400).json({ error: 'Max 50 deltagare kan bjudas in' });
  }

  const validParticipantIds = [];
  for (const pid of rawParticipantIds) {
    const sId = String(pid);
    if (sId === String(user.id)) continue;
    if (!friendIdSet.has(sId)) {
      return res.status(400).json({ error: 'Du kan bara bjuda in användare som finns i din vänlista' });
    }
    if (!validParticipantIds.includes(sId)) {
      validParticipantIds.push(sId);
    }
  }

  // A bet needs at least two players; the creator may also just organise (or judge)
  const playsSelf = creatorPlays !== false;
  if (validParticipantIds.length + (playsSelf ? 1 : 0) < 2) {
    return res.status(400).json({ error: playsSelf ? 'Bjud in minst en person' : 'Bjud in minst två personer när du inte spelar själv' });
  }

  if (tournamentId) {
    const t = db.getTournamentById ? db.getTournamentById(tournamentId) : null;
    if (!t) {
      return res.status(400).json({ error: 'Turneringen hittades inte' });
    }
    const participantUserIds = db.getTournamentParticipantUserIds ? db.getTournamentParticipantUserIds(tournamentId) : [];
    const isAuthorized = t.creator_id === user.id || t.creatorId === user.id || participantUserIds.includes(user.id);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Du deltar inte i denna turnering' });
    }
  }

  try {
    const bet = db.createAnyBet({
      title: cleanTitle,
      description: cleanDescription,
      creatorId: user.id,
      judgeId: selectedJudgeId,
      stakeAmount: stake,
      betType: normalizedType,
      deadline: deadline || null,
      participantIds: validParticipantIds,
      tournamentId: tournamentId || null,
      creatorPlays: creatorPlays !== false
    });

    for (const pId of validParticipantIds) {
      broadcastToUser(pId, {
        type: 'anybet_invitation',
        bet: {
          id: bet.id,
          title: bet.title,
          creatorNickname: user.nickname,
          stakeAmount: bet.stake_amount
        }
      });
    }

    const creatorName = user.nickname || user.real_name || 'En polare';
    sendPushToUsers(validParticipantIds, {
      title: '🤝 Nytt AnyBet!',
      body: `${creatorName} utmanar dig: "${bet.title}"${bet.stake_amount > 0 ? ` (${bet.stake_amount} kr)` : ''}. Tryck för att svara!`,
      url: `/#anybet/${bet.id}`
    }, 'duels', { bell: false }).catch(() => {}); // shown under "Väntar på dig" while open

    res.json({ ok: true, bet: sanitizeAnyBet(bet, user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Kunde inte skapa bettet' });
  }
});

app.get('/api/anybets', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const bets = db.getAnyBetsForUser(user.id);
    res.json({ bets: bets.map(b => sanitizeAnyBet(b, user.id)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeAnyBet(bet, currentUserId) {
  if (!bet) return null;
  const isCompleted = bet.status === 'completed' && bet.stake_amount > 0;
  const myPart = (bet.participants || []).find(p => p.user_id === currentUserId);
  const isMyPartLoserWTA = isCompleted && bet.bet_type === 'winner_takes_all' && myPart?.status === 'accepted' && currentUserId !== bet.winner_id;
  const isMyPartLoserYesNo = isCompleted && bet.bet_type === 'yes_no' && myPart?.status === 'accepted' && myPart?.choice && (
    (bet.winning_side === 'yes' && myPart.choice === 'no') ||
    (bet.winning_side === 'no' && myPart.choice === 'yes')
  );

  const sanitizedParticipants = (bet.participants || []).map(p => {
    if (p.user_id === currentUserId) return p;
    // Expose winner's swish to WTA losers:
    if (isMyPartLoserWTA && p.user_id === bet.winner_id) {
      return p;
    }
    // Expose winning participants' swish to Ja/Nej losers:
    if (isMyPartLoserYesNo && p.status === 'accepted' && p.choice === bet.winning_side) {
      return p;
    }
    const { swish_number, ...safeP } = p;
    return safeP;
  });

  const settlement = bet.settlement || db.getAnyBetSettlement(bet, currentUserId);
  return { ...bet, participants: sanitizedParticipants, settlement };
}

app.get('/api/anybets/:id', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const bet = db.getAnyBetById(req.params.id, user.id);
    if (!bet) return res.status(404).json({ error: 'Bettet hittades inte' });

    const isParticipant = bet.creator_id === user.id ||
                          bet.judge_id === user.id ||
                          (bet.participants && bet.participants.some(p => p.user_id === user.id));

    if (!isParticipant) {
      return res.status(403).json({ error: 'Behörighet saknas. Du deltar inte i detta AnyBet.' });
    }

    res.json({ bet: sanitizeAnyBet(bet, user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/anybets/:id/join', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { choice } = req.body;
  try {
    const bet = db.updateAnyBetChoice(req.params.id, user.id, choice || 'participant');
    res.json({ ok: true, bet: sanitizeAnyBet(bet, user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/anybets/:id/decline', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const bet = db.declineAnyBet(req.params.id, user.id);
    res.json({ ok: true, bet: sanitizeAnyBet(bet, user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/anybets/:id/cancel', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const bet = db.cancelAnyBet(req.params.id, user.id);
    if (bet && bet.participants) {
      for (const p of bet.participants) {
        if (p.user_id !== user.id) {
          broadcastToUser(p.user_id, {
            type: 'anybet_cancelled',
            bet: { id: bet.id, title: bet.title }
          });
        }
      }
    }
    res.json({ ok: true, bet: sanitizeAnyBet(bet, user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/anybets/:id/settle', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { winnerId, winningSide, proofImageUrl } = req.body;

  if (proofImageUrl && !isValidImageUrl(proofImageUrl)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för bevis' });
  }

  const existingBet = db.getAnyBetById(req.params.id);
  if (!existingBet) return res.status(404).json({ error: 'Bettet hittades inte' });

  if (String(existingBet.judge_id) !== String(user.id)) {
    return res.status(403).json({ error: 'Endast den utsedda domaren kan avgöra bettet' });
  }

  if (existingBet.bet_type === 'winner_takes_all') {
    if (!winnerId) return res.status(400).json({ error: 'Vinnare måste anges' });
    const isWinnerAccepted = (existingBet.participants || []).some(p => p.user_id === winnerId && p.status === 'accepted');
    if (!isWinnerAccepted) {
      return res.status(400).json({ error: 'Vald vinnare måste vara en godkänd deltagare i vadet' });
    }
  } else if (existingBet.bet_type === 'yes_no') {
    if (winningSide !== 'yes' && winningSide !== 'no') {
      return res.status(400).json({ error: 'Vinnande sida måste vara ja eller nej' });
    }
  }

  try {
    const settledBet = db.settleAnyBet({
      betId: req.params.id,
      judgeId: user.id,
      winnerId,
      winningSide,
      proofImageUrl
    });

    if (settledBet && settledBet.participants) {
      for (const p of settledBet.participants) {
        broadcastToUser(p.user_id, {
          type: 'anybet_settled',
          bet: sanitizeAnyBet(settledBet, p.user_id)
        });
      }
    }

    const notifyIds = (settledBet?.participants || [])
      .filter(p => p.status === 'accepted' && p.user_id !== user.id)
      .map(p => p.user_id);
    sendPushToUsers(notifyIds, {
      title: '🏁 AnyBet avgjort!',
      body: `"${settledBet.title}" är avgjort av domaren. Se hur det gick!`,
      url: `/#anybet/${settledBet.id}`
    }, 'duels').catch(() => {});

    res.json({ ok: true, bet: sanitizeAnyBet(settledBet, user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Web Push API Endpoints ───────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });
  const sub = req.body?.subscription || req.body || {};
  const { endpoint, keys } = sub;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Ogiltiga push-uppgifter' });
  }
  const id = generateId();
  db.savePushSubscription(id, user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    db.deletePushSubscriptionByEndpoint(endpoint);
  }
  res.json({ ok: true });
});

app.get('/api/users/notification-prefs', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });
  res.json(db.getUserNotificationPrefs(user.id));
});

app.put('/api/users/notification-prefs', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });
  const updated = db.updateUserNotificationPrefs(user.id, req.body || {});
  res.json(updated);
});

// ── Flash Bets (BlixtBet) API Endpoints ───────────────
app.post('/api/flashbets', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Du måste vara inloggad för att starta ett BlixtBet' });
  if (!user.swish_number) {
    return res.status(400).json({ error: 'Du behöver ange ett Swish-nummer i din profil innan du kan starta ett BlixtBet' });
  }

  const {
    question,
    title,
    durationMinutes,
    durationSeconds,
    stakeAmount,
    stake: rawStake,
    tournamentId,
    targetFriendIds,
    notifyAllFriends
  } = req.body || {};
  const finalQuestion = (question || title || '').trim();
  if (!finalQuestion || finalQuestion.length < 3) {
    return res.status(400).json({ error: 'Ange en fråga (minst 3 tecken)' });
  }

  const rawDuration = Number(durationSeconds) || (Number(durationMinutes) ? Number(durationMinutes) * 60 : null) || 60;
  const duration = Math.max(10, Math.min(86400, Math.round(rawDuration)));
  // Whole kronor, like Swish and The Tab
  const stake = Math.round(Math.max(5, Math.min(5000, Number(stakeAmount || rawStake) || 20)));
  const expiresAt = new Date(Date.now() + duration * 1000).toISOString();

  // Who may see and vote. A BlixtBet is never public: without anyone to ask it is refused.
  // In an event, everyone in the event is asked (also people who are not your friends);
  // outside an event, all your friends or the ones you picked.
  const friendIds = db.getFriends(user.id).map(f => f.id);
  const picked = Array.isArray(targetFriendIds) ? targetFriendIds.map(String) : [];
  let targetUserIds = [];

  if (tournamentId) {
    const tv = validateTournamentContext(user, tournamentId);
    if (!tv.valid) return res.status(400).json({ error: tv.error });
    const eventPeople = new Set(db.getTournamentParticipantUserIds(tv.tournament.id));
    if (tv.tournament.creatorId) eventPeople.add(tv.tournament.creatorId);
    eventPeople.delete(user.id);
    targetUserIds = [...eventPeople];
  } else if (notifyAllFriends || picked.length === 0 && notifyAllFriends !== false) {
    targetUserIds = friendIds;
  } else {
    const friendSet = new Set(friendIds);
    targetUserIds = picked.filter(id => friendSet.has(id));
  }

  if (targetUserIds.length === 0) {
    return res.status(400).json({
      error: tournamentId
        ? 'Ingen annan är med i eventet än – bjud in någon först'
        : 'Välj minst en vän som kan rösta'
    });
  }

  const storedTargets = targetUserIds;

  const id = generateId();
  db.createFlashBet(id, user.id, tournamentId, finalQuestion, duration, expiresAt, stake, storedTargets);

  const created = db.getFlashBet(id, user.id);

  // Broadcast to creator + target audience only
  broadcastFlashBetToTargets(created, {
    type: 'flash_bet_created',
    flashBet: created
  });

  const durationLabel = duration >= 60
    ? `${Math.round(duration / 60)} min`
    : `${duration}s`;

  sendPushToUsers(targetUserIds, {
    title: `⚡ BLIXTBET (${durationLabel} kvar!)`,
    body: `${user.real_name || user.nickname}: "${finalQuestion}"`,
    url: `/#flashbet/${id}`
  }, 'flashbets', { bell: false }).catch(() => {}); // shown under "Väntar på dig" while open

  res.json(created);
});

app.get('/api/flashbets/active', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  const tournamentId = req.query.tournamentId || null;
  res.json(db.getActiveFlashBets(user.id, tournamentId));
});

app.get('/api/flashbets/:id', (req, res) => {
  const user = getUserFromToken(req);
  const fb = db.getFlashBet(req.params.id, user ? user.id : null);
  if (!fb) return res.status(404).json({ error: 'BlixtBet hittades inte' });
  if (fb.targetUserIds && fb.targetUserIds.length > 0) {
    if (!user || (fb.creatorId !== user.id && !fb.targetUserIds.includes(user.id))) {
      return res.status(403).json({ error: 'Du har inte tillgång till detta BlixtBet' });
    }
  }
  res.json(fb);
});

app.post('/api/flashbets/:id/bet', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Du måste vara inloggad för att rösta' });
  if (!user.swish_number) {
    return res.status(400).json({ error: 'Du behöver ange ett Swish-nummer i din profil innan du kan rösta' });
  }

  const { choice } = req.body || {};
  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).json({ error: 'Välj JA eller NEJ' });
  }

  const fb = db.getFlashBet(req.params.id);
  if (!fb) return res.status(404).json({ error: 'BlixtBet hittades inte' });

  // Kontrollera att användaren tillhör målgruppen
  if (fb.targetUserIds && fb.targetUserIds.length > 0 &&
      fb.creatorId !== user.id && !fb.targetUserIds.includes(user.id)) {
    return res.status(403).json({ error: 'Du har inte tillgång till detta BlixtBet' });
  }

  try {
    const entryId = generateId();
    const updated = db.placeFlashBetEntry(entryId, fb.id, user.id, choice, fb.stakeAmount);

    broadcastFlashBetToTargets(updated, {
      type: 'flash_bet_updated',
      flashBet: updated
    });

    res.json(updated);
  } catch (err) {
    const isForbidden = err.message === 'Du är inte inbjuden till detta BlixtBet';
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/flashbets/:id/settle', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });

  const winnerChoice = req.body?.winningChoice || req.body?.winner;
  if (winnerChoice !== 'yes' && winnerChoice !== 'no') {
    return res.status(400).json({ error: 'Välj om JA eller NEJ vann' });
  }

  try {
    const settled = db.settleFlashBet(req.params.id, winnerChoice, user.id);

    broadcastFlashBetToTargets(settled, {
      type: 'flash_bet_settled',
      flashBet: settled
    });

    const participantUserIds = settled.entries.map(e => e.userId).filter(uid => uid !== user.id);
    sendPushToUsers(participantUserIds, {
      title: `🏁 BlixtBet avgjort!`,
      body: `"${settled.question}" vanns av ${winnerChoice === 'yes' ? '👍 JA' : '👎 NEJ'}!`,
      url: settled.tournamentId ? `/#tournament/${settled.tournamentId}` : `/#flashbet/${settled.id}`
    }, 'flashbets').catch(() => {});

    res.json(settled);
  } catch (err) {
    const isForbidden = err.message.includes('skaparen');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

app.delete('/api/flashbets/:id', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Du måste vara inloggad för att ta bort ett BlixtBet' });

  try {
    const result = db.deleteFlashBet(req.params.id, user.id);

    // The one friend who had already bet gets to know the vote no longer counts
    const removedBettors = (result.removedEntryUserIds || []).filter(uid => uid !== user.id);
    if (removedBettors.length > 0) {
      sendPushToUsers(removedBettors, {
        title: '🗑️ BlixtBet borttaget',
        body: `${user.nickname || user.real_name || 'Skaparen'} tog bort "${result.question}". Ditt bet räknas inte – inga pengar ska swishas.`,
        url: '/#arcade'
      }, 'flashbets').catch(() => {});
    }

    const wsPayload = {
      type: 'flash_bet_deleted',
      flashBetId: req.params.id,
      tournamentId: result.tournamentId
    };

    // Broadcast to creator + targets
    broadcastToUser(user.id, wsPayload);
    const targets = result.targetUserIds || [];
    for (const tid of targets) {
      if (tid !== user.id) broadcastToUser(tid, wsPayload);
    }

    res.json({ success: true, message: 'BlixtBet borttaget' });
  } catch (err) {
    const isForbidden = err.message.includes('skaparen');
    res.status(isForbidden ? 403 : 400).json({ error: err.message });
  }
});

// ── Instant FlashLive (Spontan-Live & BlixtBet) Endpoints ──
app.post('/api/flashlive/start', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Du måste vara inloggad för att sända live' });

  // Verify LiveKit Cloud configuration before starting
  const lkConfig = getLiveKitConfig();
  if (!lkConfig.configured) {
    return res.status(503).json({ error: 'LiveKit Cloud är inte konfigurerat. Vänligen ange LIVEKIT_URL, LIVEKIT_API_KEY och LIVEKIT_API_SECRET i .env eller inställningar.' });
  }

  // Prevent multiple concurrent active streams from the same host
  for (const s of activeFlashLiveStreams.values()) {
    if (String(s.hostId) === String(user.id) && s.status === 'active') {
      return res.status(400).json({ error: 'Du har redan en aktiv livesändning igång. Avsluta den innan du startar en ny.' });
    }
  }

  const {
    question,
    stakeAmount,
    durationSeconds,
    targetFriendIds,
    notifyAllFriends,
    myChoice,
    streamWithoutBet,
    streamTitle
  } = req.body || {};

  const isBetting = !streamWithoutBet;
  if (isBetting && !user.swish_number) {
    return res.status(400).json({ error: 'Du behöver ange ett Swish-nummer i din profil innan du kan starta ett Live Bet' });
  }

  // Determine recipients strictly (Finding 1)
  let targetUserIds = [];
  const userFriends = db.getFriends(user.id);
  if (notifyAllFriends) {
    targetUserIds = userFriends.map(f => f.id);
  } else if (Array.isArray(targetFriendIds) && targetFriendIds.length > 0) {
    const friendIdSet = new Set(userFriends.map(f => f.id));
    targetUserIds = targetFriendIds.filter(id => friendIdSet.has(id));
    if (targetUserIds.length === 0) {
      return res.status(400).json({ error: 'Inga giltiga vänner valda för sändningen' });
    }
  } else {
    return res.status(400).json({ error: 'Välj minst en vän eller välj Alla mina vänner' });
  }

  const finalQuestion = (question || streamTitle || (isBetting ? 'Sätter han putten?' : 'Spontansändning')).trim();
  const duration = Math.max(10, Math.min(600, Number(durationSeconds) || 60));
  const stake = Math.max(5, Math.min(5000, Number(stakeAmount) || 20));
  const expiresAt = new Date(Date.now() + duration * 1000).toISOString();

  const liveId = 'live_' + crypto.randomBytes(4).toString('hex');
  let flashBetId = null;
  let createdFlashBet = null;

  if (isBetting) {
    flashBetId = generateId();
    // Create underlying BlixtBet with targetUserIds so bet participation is restricted to the stream audience
    db.createFlashBet(flashBetId, user.id, null, finalQuestion, duration, expiresAt, stake, targetUserIds);
    createdFlashBet = db.getFlashBet(flashBetId, user.id);
  }

  const liveSession = {
    id: liveId,
    hostId: user.id,
    hostName: user.real_name || user.nickname || 'En polare',
    hostAvatar: user.avatar_emoji || '🏌️‍♂️',
    question: finalQuestion,
    hasBet: isBetting,
    stakeAmount: isBetting ? stake : 0,
    durationSeconds: isBetting ? duration : 0,
    expiresAt: isBetting ? expiresAt : null,
    targetUserIds,
    flashBetId,
    createdAt: new Date().toISOString(),
    lastHeartbeat: Date.now(),
    status: 'active'
  };
  liveSession.endsAt = new Date(liveEndsAtMs(liveSession)).toISOString();

  activeFlashLiveStreams.set(liveId, liveSession);
  try {
    db.createFlashLiveStream(liveSession);
  } catch (e) {
    console.warn('Could not save flash live stream to SQLite:', e);
  }

  // Generate LiveKit Publisher Token for Host
  const lk = await generateLiveKitToken({
    roomName: liveId,
    identity: user.id,
    name: user.nickname || user.real_name,
    metadata: { avatar: user.avatar_emoji || '🏌️‍♂️' },
    isPublisher: true
  });

  if (!lk.token) {
    activeFlashLiveStreams.delete(liveId);
    try { db.updateFlashLiveStreamStatus(liveId, 'ended'); } catch (e) {}
    return res.status(503).json({ error: lk.error || 'Kunde inte generera LiveKit-token' });
  }

  // Broadcast to target friends via WebSocket
  const liveNotificationPayload = {
    type: 'flashlive_started',
    live: liveSession,
    flashBet: createdFlashBet
  };

  for (const fId of targetUserIds) {
    broadcastToUser(fId, liveNotificationPayload);
  }
  // Also notify creator for confirmation
  broadcastToUser(user.id, liveNotificationPayload);

  // Web Push to target friends directly linking to the live stream
  const pushTitle = isBetting ? `🔴 ${liveSession.hostName} SÄNDER LIVE (BET)` : `🔴 ${liveSession.hostName} SÄNDER LIVE!`;
  const pushBody = isBetting
    ? `⚡ BlixtBet (${duration}s): "${finalQuestion}" – Titta & Betta nu!`
    : `🏌️ "${finalQuestion}" – Titta in och heja nu!`;

  sendPushToUsers(targetUserIds, {
    title: pushTitle,
    body: pushBody,
    url: `/?live=${liveId}`
  }, 'flashbets').catch(() => {});

  res.json({
    live: liveSession,
    flashBet: createdFlashBet,
    livekitToken: lk.token,
    livekitUrl: lk.url,
    livekitError: lk.error
  });
});

app.get('/api/flashlive/active', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.json([]);

  const active = [];
  const now = Date.now();
  for (const [id, session] of activeFlashLiveStreams.entries()) {
    // Check heartbeat timeout: if no heartbeat from publisher for 35s, mark ended
    if (session.lastHeartbeat && (now - session.lastHeartbeat > 35000)) {
      endFlashLiveStream(id, session, 'heartbeat_timeout');
      continue;
    }

    if (now >= liveEndsAtMs(session)) {
      endFlashLiveStream(id, session, 'max_duration');
      continue;
    }
    // Check if user is host or in target audience
    if (session.hostId === user.id || (session.targetUserIds && session.targetUserIds.includes(user.id))) {
      active.push(session);
    }
  }

  res.json(active);
});

app.get('/api/flashlive/:id', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const session = activeFlashLiveStreams.get(req.params.id);
  if (!session || session.status === 'ended') {
    return res.status(404).json({ error: 'Livesändningen avslutad eller hittades inte' });
  }

  const now = Date.now();
  if (session.lastHeartbeat && (now - session.lastHeartbeat > 35000)) {
    endFlashLiveStream(req.params.id, session, 'heartbeat_timeout');
    return res.status(404).json({ error: 'Livesändningen avslutades pga tappad anslutning' });
  }

  if (now >= liveEndsAtMs(session)) {
    endFlashLiveStream(req.params.id, session, 'max_duration');
    return res.status(404).json({ error: 'Livesändningen har nått maxtiden på 15 minuter' });
  }

  // Verify that user is host or target audience
  const isAuthorized = session.hostId === user.id || (session.targetUserIds && session.targetUserIds.includes(user.id));
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Åtkomst nekad. Du har inte behörighet att se denna livesändning.' });
  }

  const isHost = session.hostId === user.id;
  const lk = await generateLiveKitToken({
    roomName: session.id,
    identity: user.id,
    name: user.nickname || user.real_name,
    metadata: { avatar: user.avatar_emoji || '🏌️‍♂️' },
    isPublisher: isHost
  });

  const flashBet = session.flashBetId ? db.getFlashBet(session.flashBetId, user.id) : null;
  res.json({
    live: session,
    flashBet,
    livekitToken: lk.token,
    livekitUrl: lk.url,
    livekitError: lk.error
  });
});

app.post('/api/flashlive/:id/heartbeat', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });

  const session = activeFlashLiveStreams.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Livesändningen hittades inte', ended: true });
  if (session.hostId !== user.id) return res.status(403).json({ error: 'Bara sändaren kan skicka heartbeat' });

  session.lastHeartbeat = Date.now();
  res.json({ ok: true, endsAt: new Date(liveEndsAtMs(session)).toISOString() });
});

app.post('/api/flashlive/:id/settle', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });

  const session = activeFlashLiveStreams.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Livesändningen hittades inte' });
  if (session.hostId !== user.id) return res.status(403).json({ error: 'Endast sändaren kan avgöra vadet' });

  const winnerChoice = req.body?.winningChoice || req.body?.winner;
  if (winnerChoice !== 'yes' && winnerChoice !== 'no') {
    return res.status(400).json({ error: 'Välj om JA eller NEJ vann' });
  }

  try {
    const settled = db.settleFlashBet(session.flashBetId, winnerChoice, user.id);

    const settlePayload = {
      type: 'flashlive_settled',
      liveId: session.id,
      flashBet: settled,
      winningChoice: winnerChoice
    };

    broadcastToLive(session.id, settlePayload);
    for (const fId of session.targetUserIds) {
      broadcastToUser(fId, settlePayload);
    }
    broadcastToUser(user.id, settlePayload);

    const participantUserIds = settled.entries.map(e => e.userId).filter(uid => uid !== user.id);
    sendPushToUsers(participantUserIds, {
      title: `🏁 Live-vadet avgjort!`,
      body: `"${settled.question}" vanns av ${winnerChoice === 'yes' ? '👍 JA' : '👎 NEJ'}! Swisha vinnarna!`,
      url: `/#arcade`
    }, 'flashbets').catch(() => {});

    res.json({ live: session, flashBet: settled });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Attach a new real BlixtBet to an active live stream
app.post('/api/flashlive/:id/bet', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });
  if (!user.swish_number) {
    return res.status(400).json({ error: 'Du behöver ange ett Swish-nummer i din profil innan du kan starta ett Live Bet' });
  }

  const session = activeFlashLiveStreams.get(req.params.id);
  if (!session || session.status === 'ended') return res.status(404).json({ error: 'Livesändningen hittades inte eller är avslutad' });
  if (session.hostId !== user.id) return res.status(403).json({ error: 'Endast sändaren kan starta ett vad' });

  if (session.flashBetId) {
    const existing = db.getFlashBet(session.flashBetId);
    if (existing && (existing.status === 'open' || existing.status === 'locked')) {
      return res.status(400).json({ error: 'Det finns redan ett pågående vad i denna sändning' });
    }
  }

  const { question, stakeAmount, durationSeconds } = req.body || {};
  const finalQuestion = (question || 'Sätter han putten?').trim();
  const duration = Math.max(10, Math.min(600, Number(durationSeconds) || 60));
  const stake = Math.max(5, Math.min(5000, Number(stakeAmount) || 20));
  const expiresAt = new Date(Date.now() + duration * 1000).toISOString();

  // The voting plus some time to settle must fit before the stream stops automatically
  const secondsLeft = Math.floor((liveEndsAtMs(session) - Date.now()) / 1000);
  if (duration + 60 > secondsLeft) {
    return res.status(400).json({ error: `Sändningen stoppas automatiskt om ${Math.max(0, Math.ceil(secondsLeft / 60))} min. Det räcker inte för ett nytt vad – starta en ny sändning.` });
  }

  const flashBetId = generateId();
  // Pass session.targetUserIds so bet participation is restricted to the stream audience
  db.createFlashBet(flashBetId, user.id, null, finalQuestion, duration, expiresAt, stake, session.targetUserIds);
  const createdFlashBet = db.getFlashBet(flashBetId, user.id);

  session.flashBetId = flashBetId;
  session.hasBet = true;
  session.question = finalQuestion;
  session.stakeAmount = stake;
  session.durationSeconds = duration;
  session.expiresAt = expiresAt;

  try {
    db.updateFlashLiveStreamBet(session.id, flashBetId, stake, duration, expiresAt, finalQuestion);
  } catch (e) {}

  const betPayload = {
    type: 'flashlive_bet_started',
    liveId: session.id,
    flashBet: createdFlashBet
  };

  broadcastToLive(session.id, betPayload);
  for (const fId of session.targetUserIds) {
    broadcastToUser(fId, betPayload);
  }
  broadcastToUser(user.id, betPayload);

  res.json({ live: session, flashBet: createdFlashBet });
});

app.post('/api/flashlive/:id/stop', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Ej inloggad' });

  let session = activeFlashLiveStreams.get(req.params.id);
  if (!session) {
    const dbSession = db.getFlashLiveStream(req.params.id);
    if (!dbSession) return res.status(404).json({ error: 'Livesändningen hittades inte' });
    session = {
      ...dbSession,
      targetUserIds: dbSession.targetUserIds || []
    };
  }

  const isHost = String(session.hostId) === String(user.id);
  const isAdmin = !!user.is_admin;
  if (!isHost && !isAdmin) {
    return res.status(403).json({ error: 'Endast sändaren kan avsluta sändningen' });
  }

  const result = endFlashLiveStream(req.params.id, session, isAdmin && !isHost ? 'admin_stopped' : 'host_stopped');
  res.json({ ok: true, cancelledBet: false, pendingBetId: result.pendingBetId || null });
});

// ── Tab Expenses (Dela utlägg / The Tab) Routes ──────
const MAX_TAB_EXPENSE = 50000;

app.post('/api/tab/expenses', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const { title, notes, totalAmount, participantIds, receiptImage, customShares } = req.body || {};

  const parsedTotal = parseFloat(totalAmount);
  if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
    return res.status(400).json({ error: 'Giltigt totalbelopp krävs' });
  }
  if (parsedTotal > MAX_TAB_EXPENSE) {
    return res.status(400).json({ error: `En nota får vara högst ${MAX_TAB_EXPENSE.toLocaleString('sv-SE')} kr` });
  }

  if (receiptImage && !isValidImageUrl(receiptImage)) {
    return res.status(400).json({ error: 'Ogiltig bild-URL för kvitto' });
  }

  const rawParticipants = Array.isArray(participantIds) ? participantIds.map(String) : [];
  const userFriends = db.getFriends(user.id);
  const friendIdSet = new Set(userFriends.map(f => String(f.id)));
  for (const pid of rawParticipants) {
    if (pid !== user.id && !friendIdSet.has(pid)) {
      return res.status(403).json({ error: 'Alla deltagare på en nota måste finnas i din vänlista' });
    }
  }

  try {
    const allParticipantSet = new Set(rawParticipants);
    allParticipantSet.add(String(user.id));
    const allParticipants = Array.from(allParticipantSet);
    if (allParticipants.length < 2) {
      return res.status(400).json({ error: 'Minst 2 personer krävs för att dela ett utlägg' });
    }

    const rawTournamentId = req.body?.tournamentId ? String(req.body.tournamentId).trim() : null;
    let validatedTournamentId = null;
    if (rawTournamentId) {
      const tournament = db.getFullTournament(rawTournamentId);
      if (!tournament) {
        return res.status(404).json({ error: 'Turneringen hittades inte' });
      }
      if (tournament.status === 'settled') {
        return res.status(400).json({ error: 'Turneringen är avslutad. Återöppna turneringen för att lägga till utlägg.' });
      }
      if (!db.canUserAccessTournament(tournament, user.id)) {
        return res.status(403).json({ error: 'Du har inte tillgång till denna turnering' });
      }
      const participantUserIds = db.getTournamentParticipantUserIds(tournament.id);
      const isCallerParticipant = tournament.creatorId === user.id || participantUserIds.includes(user.id);
      if (!isCallerParticipant) {
        return res.status(403).json({ error: 'Endast deltagare eller skapare kan lägga till utlägg i turneringen' });
      }
      for (const pid of allParticipants) {
        if (pid !== tournament.creatorId && !participantUserIds.includes(pid)) {
          return res.status(400).json({ error: 'Alla deltagare på ett turneringsutlägg måste delta i turneringen' });
        }
      }
      validatedTournamentId = tournament.id;
    }

    const expense = db.createTabExpense({
      payerId: user.id,
      title,
      notes,
      totalAmount,
      mode: 'even_steven',
      participantIds: allParticipants,
      loserId: null,
      receiptImage,
      customShares,
      tournamentId: validatedTournamentId
    });

    const payerName = user.real_name || user.nickname || 'En vän';
    const cleanTitle = expense.title;

    // Send individualized push notification to participants (category: 'duels')
    const otherParticipants = (expense.participants || [])
      .filter(p => p.user_id !== user.id);

    for (const p of otherParticipants) {
      const myShare = Math.round(p.amount);
      sendPushToUsers([p.user_id], {
        title: `🧾 Ny nota delad (${myShare} kr)`,
        body: `${payerName} har delat "${cleanTitle}". Din del är ${myShare} kr. Kvitto finns i Swishlistan.`,
        url: '/#swishlist'
      }, 'duels').catch(() => {});
    }

    res.json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tab/expenses/my', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const expenses = db.getTabExpensesForUser(user.id);
  res.json(expenses);
});

app.get('/api/tab/expenses/:id', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const expense = db.getTabExpenseById(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Kvitto / nota hittades inte' });

  const isParticipant = expense.payer_id === user.id ||
                        expense.loser_id === user.id ||
                        (expense.participants && expense.participants.some(p => p.user_id === user.id));

  if (!isParticipant) {
    return res.status(403).json({ error: 'Behörighet saknas. Du deltar inte i denna nota.' });
  }

  res.json(expense);
});

// Payer deletes the whole expense; a participant disputes (removes) their own share
app.delete('/api/tab/expenses/:id', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const result = db.removeTabExpenseForUser(req.params.id, user.id);
    const actorName = user.real_name || user.nickname || 'En vän';
    if (result.removed === 'expense') {
      for (const uid of result.participantIds || []) {
        if (uid !== user.id) broadcastToUser(uid, { type: 'tab_expense_removed', expenseId: req.params.id });
      }
    } else {
      broadcastToUser(result.expense.payer_id, { type: 'tab_expense_disputed', expenseId: req.params.id, userId: user.id });
      sendPushToUsers([result.expense.payer_id], {
        title: '⚠️ Nota bestriden',
        body: `${actorName} har bestridit sin del av "${result.expense.title}".`,
        url: '/#swishlist'
      }, 'duels').catch(() => {});
    }
    res.json({ ok: true, removed: result.removed });
  } catch (err) {
    const status = err.message.includes('hittades inte') ? 404 : (err.message.includes('deltar inte') ? 403 : 400);
    res.status(status).json({ error: err.message });
  }
});

// ── Löven Game (Björklöven Matchtips 4-3-2p) Routes ──

/**
 * Masks other players' predictions before match start.
 * Must be called on every response that returns a Löven game object.
 */
function sanitizeLovenGame(game, requestingUser = null) {
  if (!game) return game;
  const matchTime = new Date(game.match_date).getTime();
  const isLockedOrStarted = game.status === 'locked' || game.status === 'settled'
                            || game.status === 'cancelled' || Date.now() >= matchTime;
  const sanitizedEntries = (game.entries || []).map(e => {
    const isSelf = requestingUser && e.user_id === requestingUser.id;
    if (isLockedOrStarted || isSelf) return e;
    return {
      ...e,
      pred_loven_goals: '🔒',
      pred_opponent_goals: '🔒',
      pred_last_scorer: '🔒 Dold fram till matchstart',
      pred_shots_on_goal: '🔒'
    };
  });
  return { ...game, isLockedOrStarted, entries: sanitizedEntries };
}

app.post('/api/loven-games', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const {
    opponentTeam,
    isHome = true,
    matchDate,
    stakeAmount = 20,
    tournamentId = null,
    targetFriendIds = [],
    initialPrediction = null
  } = req.body;

  if (!opponentTeam || !opponentTeam.trim()) {
    return res.status(400).json({ error: 'Vänligen ange motståndarlag' });
  }
  if (!matchDate) {
    return res.status(400).json({ error: 'Vänligen ange matchdatum och tid' });
  }

  // Validate tournament context if provided
  if (tournamentId) {
    const tv = validateTournamentContext(user, tournamentId);
    if (!tv.valid) return res.status(400).json({ error: tv.error });
  }

  const numericStake = Math.max(0, Math.min(10000, Number(stakeAmount) || 0));
  if (numericStake > 0 && !user.swish_number) {
    return res.status(400).json({ error: 'Du måste ange ditt Swish-nummer i profilen innan du skapar spel med insats.' });
  }

  try {
    const game = db.createLovenGame({
      creatorId: user.id,
      opponentTeam: opponentTeam.trim(),
      isHome: isHome ? 1 : 0,
      matchDate,
      stakeAmount: numericStake,
      tournamentId
    });

    if (initialPrediction && initialPrediction.predLastScorer) {
      try {
        db.submitLovenEntry(game.id, user.id, initialPrediction);
      } catch (e) {
        console.warn('Could not submit creator initial prediction:', e);
      }
    }

    // Broadcast notification to friends if provided
    const lovenPayload = {
      type: 'loven_game_created',
      gameId: game.id,
      opponentTeam: game.opponent_team,
      creatorName: user.real_name || user.nickname
    };
    const lovenTargets = (Array.isArray(targetFriendIds) && targetFriendIds.length > 0)
      ? targetFriendIds
      : db.getFriends(user.id).map(f => f.id);
    for (const fId of lovenTargets) {
      broadcastToUser(fId, lovenPayload);
    }

    const fullGame = db.getLovenGame(game.id);
    res.json({ ok: true, game: sanitizeLovenGame(fullGame, user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/loven-games', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  try {
    const games = db.getLovenGames();
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/loven-games/:id', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });
  try {
    const game = db.getLovenGame(req.params.id);
    if (!game) return res.status(404).json({ error: 'Matchen hittades inte' });
    res.json(sanitizeLovenGame(game, user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loven-games/:id/join', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const targetGame = db.getLovenGame(req.params.id);
  if (!targetGame) return res.status(404).json({ error: 'Matchen hittades inte' });

  if (targetGame.stake_amount > 0 && !user.swish_number) {
    return res.status(400).json({ error: 'Du måste ange ditt Swish-nummer i profilen innan du deltar i spel med insats.' });
  }

  const { predLovenGoals, predOpponentGoals, predLastScorer, predShotsOnGoal } = req.body;

  try {
    const updatedGame = db.submitLovenEntry(req.params.id, user.id, {
      predLovenGoals,
      predOpponentGoals,
      predLastScorer,
      predShotsOnGoal
    });

    const gameData = db.getLovenGame(req.params.id);
    if (gameData && gameData.creator_id) {
      broadcastToUser(gameData.creator_id, {
        type: 'loven_game_joined',
        gameId: req.params.id,
        userId: user.id,
        nickname: user.nickname
      });
    }

    res.json({ ok: true, game: sanitizeLovenGame(updatedGame, user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/loven-games/:id/lock', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const updatedGame = db.lockLovenGame(req.params.id, user.id, !!user.is_admin);
    const lockPayload = { type: 'loven_game_locked', gameId: req.params.id };
    broadcastToUser(updatedGame.creator_id, lockPayload);
    for (const e of (updatedGame.entries || [])) {
      if (e.user_id !== updatedGame.creator_id) broadcastToUser(e.user_id, lockPayload);
    }
    res.json({ ok: true, game: sanitizeLovenGame(updatedGame, user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/loven-games/:id/settle', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const {
    resultLovenGoals,
    resultOpponentGoals,
    resultLastScorer,
    resultShotsOnGoal
  } = req.body;

  // Strict type validation before hitting the database
  const isValidResultInt = (v, max) =>
    v !== undefined && v !== null && Number.isFinite(Number(v)) && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max;

  if (!isValidResultInt(resultLovenGoals, 30)) {
    return res.status(400).json({ error: 'Lövens mål måste vara ett heltal mellan 0 och 30' });
  }
  if (!isValidResultInt(resultOpponentGoals, 30)) {
    return res.status(400).json({ error: 'Motståndarens mål måste vara ett heltal mellan 0 och 30' });
  }
  if (!isValidResultInt(resultShotsOnGoal, 150)) {
    return res.status(400).json({ error: 'Skott på mål måste vara ett heltal mellan 0 och 150' });
  }
  if (!resultLastScorer || !String(resultLastScorer).trim()) {
    return res.status(400).json({ error: 'Sista målskytt saknas' });
  }

  try {
    const settledGame = db.settleLovenGame(req.params.id, {
      resultLovenGoals,
      resultOpponentGoals,
      resultLastScorer,
      resultShotsOnGoal
    }, user.id, !!user.is_admin);

    const settlePayload = {
      type: 'loven_game_settled',
      gameId: req.params.id,
      game: settledGame
    };
    broadcastToUser(settledGame.creator_id, settlePayload);
    for (const e of (settledGame.entries || [])) {
      if (e.user_id !== settledGame.creator_id) broadcastToUser(e.user_id, settlePayload);
    }

    // Notify participants via push
    const participantIds = (settledGame.entries || []).map(e => e.user_id);
    if (participantIds.length > 0) {
      sendPushToUsers(participantIds, {
        title: '🟢 Löven Game rättat!',
        body: `Matchen mot ${settledGame.opponent_team} är avgjord! Kolla THE TAB för resultat och Swish-avräkning.`,
        url: '/#loven'
      }, 'duels').catch(() => {});
    }

    res.json({ ok: true, game: settledGame });
  } catch (err) {
    const status = (err.message.includes('Endast skaparen') || err.message.includes('Behörighet saknas')) ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/loven-games/:id/cancel', (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  try {
    const cancelledGame = db.cancelLovenGame(req.params.id, user.id, !!user.is_admin);
    const cancelPayload = { type: 'loven_game_cancelled', gameId: req.params.id };
    broadcastToUser(cancelledGame.creator_id || user.id, cancelPayload);
    for (const e of (cancelledGame.entries || [])) {
      if (e.user_id !== user.id) broadcastToUser(e.user_id, cancelPayload);
    }
    res.json({ ok: true, game: cancelledGame });
  } catch (err) {
    const status = (err.message.includes('Endast skaparen') || err.message.includes('Behörighet saknas')) ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── Malta AI Support Chat & Diagnostics ─────────────
// What the chat shows before the first question: online or quick answers, and the topics
app.get('/api/support/status', (req, res) => {
  const mode = getSupportMode();
  res.json({ live: mode === 'live', mode, topics: SUPPORT_TOPICS });
});

app.get('/api/support/health', async (req, res) => {
  // Require at least user auth to see health status
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  const apiKey = (process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key') || '').trim();
  if (!apiKey) {
    return res.json({ live: false, reason: 'GEMINI_API_KEY is not configured in env or database' });
  }

  const responseData = {
    live: true,
    model: 'gemini-2.5-flash',
    searchQuota: getSearchQuotaInfo(),
    lastApiDiagnostic: getLastApiDiagnostic()
  };

  // Only perform a live API test probe if explicitly asked via ?test=1 AND admin PIN is provided
  if (req.query.test === '1') {
    if (!requireAdminPin(req, res)) return;
    const allowedModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const probeModel = allowedModels.includes(req.query.model) ? req.query.model : 'gemini-2.5-flash';
    try {
      const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${probeModel}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Ping. Svara med ordet PONG.' }] }]
        })
      });
      const txt = await gRes.text();
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch (e) {}
      responseData.probe = {
        ok: gRes.ok,
        status: gRes.status,
        model: probeModel,
        data: gRes.ok ? (parsed?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()) : parsed || txt
      };
    } catch (e) {
      responseData.probe = { ok: false, error: e.message };
    }
  }

  res.json(responseData);
});

app.post('/api/support/chat', async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const limit = db.checkRateLimit ? db.checkRateLimit('support_chat:' + ip) : { allowed: true };
  if (!limit.allowed) {
    return res.status(429).json({
      error: `Malta Support har rast just nu! Grabben i supporten sippar på en kall espresso i skuggan. Försök igen om ${limit.minutesLeft} minuter! 🌴☕`
    });
  }
  if (db.recordFailedAttempt) {
    db.recordFailedAttempt('support_chat:' + ip, 40, 5);
  }

  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Meddelande krävs' });
  }

  const user = getUserFromToken(req);
  const userName = user ? (user.nickname || user.realName || 'Kompis') : 'Kompis';

  const question = message.trim().slice(0, 500);
  try {
    const { text, mode } = await generateMaltaSupportReply(question, Array.isArray(history) ? history : [], userName);
    res.json({ ok: true, reply: text, mode, suggestions: mode === 'live' ? [] : getSupportSuggestions(question) });
  } catch (err) {
    console.error('Malta Support Chat error:', err);
    res.json({ ok: true, reply: getMaltaFallbackReply(question, userName), mode: 'offline', suggestions: getSupportSuggestions(question) });
  }
});

app.post('/api/support/test-push', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Inloggning krävs' });

  // Test the device that pressed the button when it tells us its endpoint, so another
  // working phone cannot mask a broken one
  const { endpoint } = req.body || {};
  const allSubs = db.getPushSubscriptionsForUsers([user.id]);
  const subs = endpoint ? allSubs.filter(s => s.endpoint === endpoint) : allSubs;
  if (!subs || subs.length === 0) {
    return res.status(400).json({
      error: 'Inga aktiva push-notiser hittades för din enhet. Slå på webbnotiser under Profil först!'
    });
  }

  const pushData = await generateMaltaSupportPush({
    eventType: 'test_push',
    user,
    details: {},
    apiKey: process.env.GEMINI_API_KEY
  });

  // The test ignores category preferences: it checks that delivery to this phone works
  const result = await sendPushToSubscriptions(subs, pushData);
  if (result.sent === 0) {
    const codes = result.failed.map(f => f.statusCode || '?').join(', ');
    return res.status(502).json({
      error: `Notisen kunde inte levereras (svar från push-tjänsten: ${codes}). Stäng av och slå på notiser igen under Profil.`,
      result
    });
  }
  res.json({
    ok: true,
    message: `Testnotis skickad till ${result.sent} enhet${result.sent === 1 ? '' : 'er'}! 🌴☕`,
    result
  });
});

// ── Central Express Error Handler ─────────────────────
app.use((err, req, res, next) => {
  console.error(`💥 [EXPRESS-ERROR] ${req.method} ${req.url}:`, err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Ett internt serverfel uppstod.' });
});

// ── SPA fallback (must be after all API routes) ──────
const indexHtml = path.join(distPath, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.get('{*path}', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

// ── Start ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`🎯 Whooply server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket ready on ws://localhost:${PORT}`);
    console.log(`💾 SQLite database active`);
  });

  // Auto-backup every night at 03:00
  let lastAutoBackupDate = '';
  setInterval(async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === 3 && lastAutoBackupDate !== today) {
      lastAutoBackupDate = today;
      try {
        const result = await db.backupDatabase();
        console.log(`[auto-backup] ✅ ${result.filename} (${result.sizeBytes} bytes)`);
      } catch (err) {
        console.error('[auto-backup] ❌', err.message);
      }
    }
  }, 60_000).unref();
}

export {
  app,
  server,
  assignMafiaRoles,
  sanitizeMafiaRoomForBroadcast,
  evaluateMafiaWinner,
  resolveMafiaDebts,
  partyRooms,
  partyCodeToId,
  activeFlashLiveStreams,
  finalizePartyRound,
  recordUserRtt,
  getLatencyCompensationMs,
  remindHostsToSettle,
  sendDeadlineReminders
};
