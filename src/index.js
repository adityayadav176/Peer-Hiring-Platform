import dotenv from "dotenv";
import { connectToMongo } from "./db/db.js";
import { app } from "./app.js";
import { verifySmtp } from "./utils/nodemailer.js";
import { APP_NAME } from "./constant/constant.js";
import os from "os";
import cluster from "cluster";
import http from "http";
import { Server } from "socket.io"
import { initializeSocket } from "./socket/socket.server.js";
import "./services/notification.worker.js";

dotenv.config();

const numCPUs = os.cpus().length;

const PORT = process.env.PORT || 8001;

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        credentials: true
    },
});

initializeSocket(io);

async function startServer() {
    try {
        await connectToMongo();
        console.log("MongoDB Connected");

        await verifySmtp();
        console.log("SMTP Verified");

        server.listen(PORT, () => {
            console.log(`${APP_NAME} running on port ${PORT}`);
            console.log(`Server is running on http://localhost:${PORT}`)
        })

    } catch (error) {
        console.log("Startup Failed:", error.message);
        process.exit(1);
    }
}

// if (cluster.isPrimary) {
//     console.log(`Master ${process.pid} is running`);

//     for (let i = 0; i < numCPUs; i++) {
//         cluster.fork();
//     }

//     cluster.on("exit", (worker) => {
//         console.log(`Worker ${worker.process.pid} died`);
//         cluster.fork();
//     });

// } else {
//     startServer();
// }

startServer();