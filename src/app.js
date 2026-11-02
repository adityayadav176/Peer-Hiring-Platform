
import cookieParser from "cookie-parser";
import express from "express";
import cors from "cors";

import { verifySmtp } from "./utils/nodemailer.js";
import { errorHandler } from "./middleware/error.middleware.js";

import UserRouter from "./routes/user.routes.js";
import SessionRouter from "./routes/session.route.js";
import JobRouter from "./routes/job.route.js";
import CompanyRouter from "./routes/company.route.js";
import ResumeRouter from "./routes/resume.routes.js";
import ProfileRouter from "./routes/profile.route.js";
import ApplicationRouter from "./routes/application.route.js";
import InterviewRouter from "./routes/interview.route.js";
import AdminRouter from "./routes/admin.route.js";
import ConversationRouter from "./routes/conversation.route.js";
import MessageRouter from "./routes/message.route.js";
import ReportRouter from "./routes/report.route.js";
import NotificationRouter from "./routes/notification.route.js";

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5500",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).send("Auth MicroService Running");
});

app.get("/smtp", async (req, res, next) => {
  try {
    const connected = await verifySmtp();

    if (!connected) {
      return res.status(503).send("SMTP connection unavailable");
    }

    return res.status(200).send("SMTP Connected Successfully");
  } catch (error) {
    next(error);
  }
});

// Route mounting
app.use("/api/v1/auth", UserRouter);
app.use("/api/v1/session", SessionRouter);
app.use("/api/v1/job", JobRouter);
app.use("/api/v1/companies", CompanyRouter);
app.use("/api/v1/resume", ResumeRouter);
app.use("/api/v1/profile", ProfileRouter);
app.use("/api/v1/applications", ApplicationRouter);
app.use("/api/v1/interview", InterviewRouter);
app.use("/api/v1/admin", AdminRouter);
app.use("/api/v1/conversation", ConversationRouter);
app.use("/api/v1/messages", MessageRouter);
app.use("/api/v1/reports", ReportRouter);
app.use("/api/v1/notification", NotificationRouter);

// Error handler should come after routes.
app.use(errorHandler);

export { app };
