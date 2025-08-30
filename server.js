// server.js
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---- Config
const {
  PORT = process.env.PORT || 3000,
  REDIS_URL = '',
  STATE_TTL_SECONDS = 48 * 3600,
  ALLOW_ORIGIN = '*',
} = process.env;

const app = express();

// ---- STATIC: sert index.html et tous les assets depuis la racine du dépôt
app.use(express.static(__dirname, { extensions: ['html'] }));

// Health
app.get('/healthz', (_req, res) => res.send('ok'));

// SPA fallback (si tu as un router côté client / liens profonds)
app.get('*', (req, res, next) => {
  // on ne casse pas les requêtes socket.io
  if (req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

const httpServer = http.createServer(app);

// ---- Socket.IO
const io = new Server(httpServer, {
  cors: { origin: ALLOW_ORIGIN, methods: ['GET', 'POST'] },
  transports: ['websocket'],
  maxHttpBufferSize: 1e6,
});

// --- Store d'état: Redis si dispo, sinon mémoire ---
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
  const mem = new Map(); // { room -> { state, ts } }
  getState = async (room) => mem.get(room)?.state || null;
  setState = async (room, state) => mem.set(room, { state, ts: Date.now() });
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of mem)
      if (now - v.ts > STATE_TTL_SECONDS * 1000) mem.delete(k);
  }, 60_000);
  console.log('[server] Fallback mémoire (pas de REDIS_URL)');
}

// --- Sockets ---
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

httpServer.listen(PORT, () =>
  console.log(`[server] listening on :${PORT} | static root = ${__dirname}`)
);
