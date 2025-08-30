// server.js
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// === CONFIG ===
const PORT       = process.env.PORT || 3000;
const STATIC_DIR = process.env.STATIC_DIR || 'public'; // ⬅️ index.html est dans /public

const STATIC_ROOT = path.resolve(__dirname, STATIC_DIR);
const INDEX_FILE  = path.join(STATIC_ROOT, 'index.html');

// --- App HTTP
const app = express();
app.disable('x-powered-by');

// Fichiers statiques (public/)
app.use(express.static(STATIC_ROOT, { extensions: ['html'] }));

// Healthcheck
app.get('/healthz', (_req, res) => res.send('ok'));

// Fallback SPA (tout ce qui n'est pas /socket.io/* renvoie index.html)
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

// --- Socket.IO
const io = new Server(httpServer, {
  cors: { origin: (origin, cb) => cb(null, true), methods: ['GET','POST'] },
  transports: ['websocket','polling'],
  pingInterval: 25000,
  pingTimeout: 30000,
});

// État en mémoire (par "room")
const mem = new Map(); // key: room -> { state, ts }
const getState = async (room) => mem.get(room)?.state || null;
const setState = async (room, state) => mem.set(room, { state, ts: Date.now() });

// Sockets
io.on('connection', (socket) => {
  socket.on('room:join', async ({ room } = {}) => {
    room = String(room || '').trim().toUpperCase();
    if (!room) return;
    await socket.join(room);
    socket.data.room = room;

    // renvoie l'état au nouvel arrivant
    const state = await getState(room);
    if (state) socket.emit('state:remote', { room, state });

    // notifie la room
    io.to(room).emit('room:joined', { room });
  });

  socket.on('state:update', async ({ room, state } = {}) => {
    if (!room || socket.data.room !== room) return;
    await setState(room, state);
    // diffuse aux autres clients de la même room
    socket.to(room).emit('state:remote', { room, state });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] STATIC_ROOT = ${STATIC_ROOT}`);
  console.log(`[server] INDEX_FILE  = ${INDEX_FILE}`);
});
