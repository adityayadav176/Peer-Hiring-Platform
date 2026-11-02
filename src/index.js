
import dotenv from "dotenv";
dotenv.config();
import http from "node:http";
import { Server } from "socket.io";
import { connectToMongo } from "./db/db.js";
import { app } from "./app.js";
import { APP_NAME } from "./constant/constant.js";
import { initializeSocket } from "./socket/socket.server.js";
// import "./config/notification.worker.js";

const PORT = process.env.PORT;
const CLIENT_URL = process.env.CLIENT_URL;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

initializeSocket(io);

io.on("connection", (socket) => {
  console.log("[Socket] Connected:", {
    socketId: socket.id,
    userId: socket.userId,
    transport: socket.conn.transport.name,
  });

  socket.on("disconnect", (reason) => {
    console.log("[Socket] Disconnected:", {
      socketId: socket.id,
      userId: socket.userId,
      reason,
    });
  });

  socket.conn.on("upgrade", (transport) => {
    console.log("[Socket] Transport upgraded:", transport.name);
  });
});

async function startServer() {
  try {
    await connectToMongo();
    console.log("MongoDB Connected");

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`${APP_NAME} running on port ${PORT}`);
      console.log(`Server: http://localhost:${PORT}`);
      console.log(`Allowed frontend origin: ${CLIENT_URL}`);
    });
  } catch (error) {
    console.error("Startup Failed:", error);
    process.exit(1);
  }
}

startServer();
