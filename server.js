// server.js
const path = require("path");
const express = require("express");
const http = require("http");
const app = express();

// --- Static (sert index.html et assets)
app.use(express.static(path.join(__dirname)));

// (optionnel) ping health
app.get("/healthz", (req, res) => res.send("ok"));

// --- HTTP + WebSocket
const server = http.createServer(app);
const { Server } = require("socket.io");

// Si tu as besoin de CORS (tests en local):
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET","POST"]
  }
});

// Helpers
function safeGameId(raw) {
  return String(raw || "").trim().slice(0, 64);
}

io.on("connection", (socket) => {
  // Un client joint une partie (room)
  socket.on("join", ({ gameId, playerId }) => {
    const room = safeGameId(gameId);
    if (!room) return;
    socket.join(room);
    // Informe les autres clients qu’un nouveau joueur est là (facultatif)
    socket.to(room).emit("presence:join", { playerId, at: Date.now() });
  });

  // Un client envoie une action de jeu => on la relaie à toute la room (sauf l’émetteur)
  socket.on("action", ({ gameId, type, payload }) => {
    const room = safeGameId(gameId);
    if (!room || !type) return;
    // Diffuse à tous les autres du même gameId
    socket.to(room).emit("action", { type, payload, at: Date.now() });
  });

  // Optionnel : synchro d’état complet (ex: après reload)
  socket.on("state:push", ({ gameId, state }) => {
    const room = safeGameId(gameId);
    if (!room) return;
    socket.to(room).emit("state:replace", { state, at: Date.now() });
  });

  socket.on("disconnect", () => {
    // rien de spécial ici
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
