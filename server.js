const path = require("path");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);

// Socket.IO
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Statique (public)
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Socket.IO basique (rooms + sync état)
io.on("connection", (socket) => {
  socket.on("room:join", ({ room }) => {
    if (!room) return;
    socket.join(room);
    io.to(room).emit("room:joined", { room });
  });

  socket.on("state:update", (payload) => {
    const { room, state } = payload || {};
    if (!room) return;
    socket.to(room).emit("state:remote", { room, state });
  });
});

// Catch-all → index.html (pour SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
