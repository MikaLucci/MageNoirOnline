// server.js
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

const {
  PORT = 3000,
  REDIS_URL = 'redis://127.0.0.1:6379',
  STATE_TTL_SECONDS = 48 * 3600,
  ALLOW_ORIGIN = '*',
} = process.env;

const app = express();
app.get('/healthz', (_req, res) => res.send('ok'));
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: ALLOW_ORIGIN, methods: ['GET','POST'] },
  transports: ['websocket'],
  maxHttpBufferSize: 1e6,
});

const pub = createClient({ url: REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));

const keyState = (room)=>`game:${room}:state`;

io.on('connection', (socket) => {
  socket.on('room:join', async ({ room } = {}) => {
    room = String(room||'').toUpperCase();
    if(!/^[A-Z0-9]{3,10}$/.test(room)) return;
    socket.join(room);
    socket.data.room = room;

    const json = await pub.get(keyState(room));
    if(json) socket.emit('state:remote', { room, state: JSON.parse(json) });
  });

  socket.on('state:update', async ({ room, state } = {}) => {
    if(!room || socket.data.room !== room) return;
    await pub.set(keyState(room), JSON.stringify(state), { EX: STATE_TTL_SECONDS });
    socket.to(room).emit('state:remote', { room, state });
  });
});

httpServer.listen(PORT, () => console.log('listening on :' + PORT));
