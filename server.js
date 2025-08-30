// server.js
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// === CONFIG ===
const {
  PORT = process.env.PORT || 3000,
  REDIS_URL = '',
  STATE_TTL_SECONDS = 48 * 3600,       // TTL de l'état (en secondes)
  ALLOW_ORIGIN = '*',
  STATIC_DIR = 'public'                 // sert /public par défaut
} = process.env;

// Dossier statique
const STATIC_ROOT = path.resolve(__dirname, STATIC_DIR);
const INDEX_FILE  = path.join(STATIC_ROOT, 'index.html');

const app = express();
app.disable('x-powered-by');

// Fichiers statiques + health + fallback SPA (sauf socket.io)
app.use(express.static(STATIC_ROOT, { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io/')) return next();
  res.sendFile(INDEX_FILE, (err) => {
    if (err) {
      console.error('[server] index fallback error:', err);
      res.status(404).send('Not Found');
    }
  });
});

const httpServer = http.createServer(app);

// === SOCKET.IO ===
const io = new Server(httpServer, {
  cors: { origin: ALLOW_ORIGIN, methods: ['GET','POST'] },
  transports: ['websocket'],
  maxHttpBufferSize: 1e6,
});

// --- Store d'état : Redis si URL valide, sinon mémoire ---
let getState, setState;

function useMemoryStore() {
  const mem = new Map();
  getState = async (room) => mem.get(room)?.state || null;
  setState = async (room, state) => mem.set(room, { state, ts: Date.now() });
  // Garbage collector des états expirés
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of mem) {
      if (now - v.ts > STATE_TTL_SECONDS * 1000) mem.delete(k);
    }
  }, 60_000);
  console.log('[server] Fallback mémoire (pas de Redis ou URL invalide)');
}

async function tryRedisAdapter(url) {
  // Vérifie protocole redis:// ou rediss://
  if (typeof url !== 'string' || !/^redis(s)?:\/\//i.test(url)) {
    console.warn('[server] REDIS_URL manquante/invalide. Attendu redis:// ou rediss://');
    return false;
  }
  try {
    const { createClient } = await import('redis');
    const { createAdapter } = await import('@socket.io/redis-adapter');

    const isTLS = url.startsWith('rediss://');
    const u = new URL(url);

    // Client Redis avec TLS explicite si rediss://
    const pub = createClient({
      url,
      socket: isTLS ? {
        tls: true,
        servername: u.hostname,      // SNI correct
        // rejectUnauthorized: false, // à n'activer que si votre provider l'exige
      } : undefined,
    });
    const sub = pub.duplicate();

    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));

    const keyState = (room) => `game:${room}:state`;
    getState = async (room) => {
      const json = await pub.get(keyState(room));
      return json ? JSON.parse(json) : null;
    };
    setState = async (room, state) => {
      await pub.set(keyState(room), JSON.stringify(state), { EX: Number(STATE_TTL_SECONDS) || 0 });
    };

    console.log('[server] Redis adapter actif');
    return true;
  } catch (err) {
    console.error('[server] Échec connexion Redis. Fallback mémoire.', err?.message || err);
    return false;
  }
}

// Init du store
if (!(await tryRedisAdapter(REDIS_URL))) {
  useMemoryStore();
}

// --- Sockets ---
io.on('connection', (socket) => {
  socket.on('room:join', async ({ room } = {}) => {
    room = String(room || '').toUpperCase();
    if (!/^[A-Z0-9]{3,10}$/.test(room)) return;
    await socket.join(room);
    socket.data.room = room;

    try {
      const state = await getState(room);
      if (state) socket.emit('state:remote', { room, state });
    } catch (e) {
      console.error('[server] getState error:', e);
    }
    io.to(room).emit('room:joined', { room });
  });

  socket.on('state:update', async ({ room, state } = {}) => {
    if (!room || socket.data.room !== room) return;
    try {
      await setState(room, state);
      socket.to(room).emit('state:remote', { room, state });
    } catch (e) {
      console.error('[server] setState error:', e);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] STATIC_ROOT = ${STATIC_ROOT}`);
  console.log(`[server] INDEX_FILE  = ${INDEX_FILE}`);
});
