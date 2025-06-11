const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = {};

const logger = (data) => {
  console.log(data);
};

io.on("connection", (socket) => {
  logger("✅ A user connected");

  socket.on("join-room", (roomId) => {
    if (!rooms[roomId]) {
      logger("🚨 Room not found");
      return;
    }
    socket.join(roomId);
    logger(`🔗 User joined room: ${roomId}`);

    if (rooms[roomId]) {
      const { tracks, ...rest } = rooms[roomId];
      socket.emit("room-tracks", tracks);
      socket.emit("join-room-response", {
        type: "SUCCESS",
        message: "User joined successfully",
        ...rest,
      });
    } else {
      socket.emit("join-room-response", {
        type: "ERROR",
        message: "Room not found",
      });
    }
  });

  socket.on("create-room", (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      logger(`🔗 Created new room: ${roomId}`);
      rooms[roomId] = {
        roomId: roomId,
        createdAt: new Date().toISOString(),
        currentPlaying: 0,
        allowMemberToPlay: true,
        ownerId: socket.id,
        tracks: [],
      };
    } else {
      rooms[roomId].ownerId = socket.id;
    }
    const { tracks, ...rest } = rooms[roomId];
    socket.emit("room-tracks", tracks);
    socket.emit("join-room-response", {
      type: "SUCCESS",
      ...rest,
    });
  });

  socket.on("add-track", ({ roomId, tracks }) => {
    if (!rooms[roomId]) {
      logger("🚨 Room not found");
      return;
    }
    rooms[roomId].tracks.push(...tracks);
    io.to(roomId).emit("room-tracks", rooms[roomId].tracks);
  });

  socket.on("update-tracks", ({ roomId, tracks }) => {
    if (!rooms[roomId]) {
      logger("🚨 Room not found");
      return;
    }
    rooms[roomId].tracks = tracks;
    io.to(roomId).emit("room-tracks", rooms[roomId].tracks);
  });

  socket.on("disconnect", () => {
    logger("❌ A user disconnected");
  });

  socket.on("update-current-playing", ({ roomId, index, triggerOwner }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].currentPlaying = index;
    io.to(roomId).emit("current-playing-change", { index });
  });
});

server.listen(PORT, () => {
  logger(`🚀 Socket server running on http://localhost:${PORT}`);
});
