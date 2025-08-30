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
  STATE_TTL_SECONDS = 48 * 3600,
  ALLOW_ORIGIN = '*',
  STATIC_DIR = '' // facultatif: si tu veux cibler un sous-dossier (ex: "public")
} = process.env;

// Dossier statique: par défaut le répertoire où se trouvent server.js + index.html
const STATIC_ROOT = STATIC_DIR
  ? path.resolve(__dirname, STATIC_DIR)
  : path.resolve(__dirname);

const INDEX_FILE = path.join(STATIC_ROOT, 'index.html');

const app = express();
app.disable('x-powered-by');

// Sert les fichiers statiques (index.html, assets…)
app.use(express.static(STATIC_ROOT, { extensions: ['html'] }));

// Health
app.get('/healthz', (_req, res) => res.send('ok'));

// Fallback SPA (sauf socket.io)
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

// Store d'état: Redis si dispo, sinon mémoire
let getState, setState;
if (REDIS_URL) {
  const { createClient } = await import('redis');
  const { createAdapter } = await import('@socket.io/redis-adapter');
  const pub = createClient({ url: REDIS_URL });
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));

  const keyState = (room) => `game:${room}:state`;
  getState = async (room) => {
    const json = await pub.get(keyState(room));
    return json ? JSON.parse(json) : null;
  };
  setState = async (room, state) => {
    await pub.set(keyState(room), JSON.stringify(state), { EX: STATE_TTL_SECONDS });
  };
  console.log('[server] Redis adapter actif');
} else {
  const mem = new Map();
  getState = async (room) => mem.get(room)?.state || null;
  setState = async (room, state) => mem.set(room, { state, ts: Date.now() });
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of mem)
      if (now - v.ts > STATE_TTL_SECONDS * 1000) mem.delete(k);
  }, 60_000);
  console.log('[server] Fallback mémoire (pas de REDIS_URL)');
}

// Sockets
io.on('connection', (socket) => {
  socket.on('room:join', async ({ room } = {}) => {
    room = String(room || '').toUpperCase();
    if (!/^[A-Z0-9]{3,10}$/.test(room)) return;
    await socket.join(room);
    socket.data.room = room;

    const state = await getState(room);
    if (state) socket.emit('state:remote', { room, state });
    io.to(room).emit('room:joined', { room });
  });

  socket.on('state:update', async ({ room, state } = {}) => {
    if (!room || socket.data.room !== room) return;
    await setState(room, state);
    socket.to(room).emit('state:remote', { room, state });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] STATIC_ROOT = ${STATIC_ROOT}`);
  console.log(`[server] INDEX_FILE  = ${INDEX_FILE}`);
});
