const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

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

app.use(cors());

const rooms = {};
const owners = {};

const members = {};

const logger = (data, type = "log") => {
  if (type === "log") {
    console.log(data);
    return;
  }
  console.error(data);
};

const saveRoomState = (roomId) => {
  try {
    const roomDir = path.join(__dirname, "logs/rooms");
    if (!fs.existsSync(roomDir)) {
      fs.mkdirSync(roomDir);
    }
    const filePath = path.join(roomDir, `${roomId}.json`);
    const aa = structuredClone(rooms[roomId]);
    fs.writeFileSync(filePath, JSON.stringify(aa, null, 2));
  } catch (error) {
    logger(error, "error");
  }
};

const fetchStateFromFile = () => {
  const roomDir = path.join(__dirname, "logs/rooms");

  if (!fs.existsSync(roomDir)) {
    fs.mkdirSync(roomDir, { recursive: true });
  }

  const files = fs.readdirSync(roomDir);

  for (const file of files) {
    if (file.endsWith(".json")) {
      const roomId = path.basename(file, ".json");
      const filePath = path.join(roomDir, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        rooms[roomId] = JSON.parse(data);
        logger(`✅ Loaded room: ${roomId}`);
      } catch (err) {
        logger(`❌ Failed to load room ${roomId}:` + err, "error");
      }
    }
  }
};

io.on("connection", (socket) => {
  logger("✅ A user connected");

  socket.on("connect-server", () => {
    socket.emit("connected-server");
  });

  socket.on("join-room", (roomId) => {
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      socket.emit("join-room", {
        type: "ERROR",
        message: "Room not found",
      });
      return;
    }
    if (!rooms[roomId].ownerId) {
      logger(`🚨 Host not active for ${roomId}`);
      socket.emit("join-room", {
        type: "ERROR",
        message: "Host not active for this room",
      });
      return;
    }
    socket.join(roomId);
    members[socket.id] = roomId;

    logger(`🔗 User joined room: ${roomId}`);

    if (rooms[roomId]) {
      const { tracks, ...rest } = rooms[roomId];
      socket.emit("room-tracks", tracks);
      socket.emit("join-room", {
        type: "SUCCESS",
        message: "User joined successfully",
        ...rest,
      });
      io.to(roomId).emit("update-playing-status", rest.isPlaying);
    } else {
      socket.emit("join-room", {
        type: "ERROR",
        message: "Room not found",
      });
    }
  });

  socket.on(
    "create-room",
    ({
      roomId,
      allowMemberToPlay,
      allowMemberToSync,
      allowMemberControlVolume,
    }) => {
      // if (rooms[roomId].ownerId) {
      //   logger(`🚨 Host already active for ${roomId}`);
      //   socket.emit("join-room", {
      //     type: "ERROR",
      //     message: "Host already active for this room",
      //   });
      //   return;
      // }
      socket.join(roomId);

      if (!rooms[roomId]) {
        logger(`🔗 Created new room: ${roomId}`);
        rooms[roomId] = {
          roomId: roomId,
          createdAt: new Date().toISOString(),
          currentPlaying: -1,
          volume: 100,
          isPlaying: false,
          allowMemberToPlay,
          allowMemberToSync,
          allowMemberControlVolume,
          activeMembers: [socket.id],
          alsoPlayInMember: false,
          ownerId: socket.id,
          tracks: [],
        };
        console.log("🚀 - io.on - rooms:", rooms[roomId]);
      } else {
        rooms[roomId] = {
          ...rooms[roomId],
          currentPlaying: -1,
          volume: 100,
          isPlaying: false,
          allowMemberToPlay,
          allowMemberToSync,
          allowMemberControlVolume,
          activeMembers: [socket.id],
          alsoPlayInMember: false,
          ownerId: socket.id,
        };
      }
      owners[socket.id] = roomId;
      members[socket.id] = roomId;
      saveRoomState(roomId);
      const { tracks, ...rest } = rooms[roomId];
      socket.emit("room-tracks", tracks);
      socket.emit("join-room", {
        type: "SUCCESS",
        ...rest,
      });
    }
  );

  socket.on("add-track", ({ tracks }) => {
    const roomId = members[socket.id];
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }
    rooms[roomId].tracks.push(...tracks);
    saveRoomState(roomId);
    io.to(roomId).emit("room-tracks", rooms[roomId].tracks);
  });

  socket.on("update-tracks", ({ tracks }) => {
    const roomId = members[socket.id];
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }
    rooms[roomId].tracks = tracks;
    saveRoomState(roomId);
    io.to(roomId).emit("room-tracks", rooms[roomId].tracks);
  });

  socket.on("update-current-playing", ({ index }) => {
    const roomId = members[socket.id];
    console.log("🚀 - socket.on - index:", index, roomId);
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }

    rooms[roomId].currentPlaying = index;
    saveRoomState(roomId);
    socket.to(roomId).emit("update-current-playing", { index });
  });

  socket.on("update-playing-status", ({ value }) => {
    const roomId = members[socket.id];
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }
    rooms[roomId].isPlaying = value;
    saveRoomState(roomId);
    io.to(roomId).emit("update-playing-status", value);
  });

  socket.on("sync-request", () => {
    const roomId = members[socket.id];
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }
    io.to(rooms[roomId].ownerId).emit("sync-request");
  });

  socket.on("sync-response", (data) => {
    const roomId = members[socket.id];
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }
    io.to(roomId).emit("sync-response", data);
  });

  socket.on("update-volume", (value) => {
    const roomId = members[socket.id];
    if (!rooms[roomId]) {
      logger(`🚨 Room not found ${roomId}`);
      return;
    }
    if (rooms[roomId].volume === value) return;
    rooms[roomId].volume = value;
    io.to(roomId).emit("update-volume", value);
  });

  socket.on("client-active", () => {
    console.log("Client is active (to avoid render shutdown)");
  });

  socket.on("disconnect", () => {
    logger("❌ A user disconnected");
    if (owners[socket.id] && rooms[owners[socket.id]]) {
      rooms[owners[socket.id]].ownerId = "";
      rooms[owners[socket.id]].volume = 100;
      rooms[owners[socket.id]].currentPlaying = 0;
      rooms[owners[socket.id]].activeMembers = [];
      saveRoomState(owners[socket.id]);
      io.to(owners[socket.id]).emit("clear-state");
      delete owners[socket.id];
    }

    if (members[socket.id]) {
      delete members[socket.id];
    }
  });
});

app.get("/ping", (_, res) => res.status(200).send("pong"));

server.listen(PORT, () => {
  logger(`🚀 Socket server running on http://localhost:${PORT}`);
  fetchStateFromFile();
});
