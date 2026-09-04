import cookieParser from "cookie-parser";
import express from "express"
import cors from "cors"
import { verifySmtp } from "./utils/nodemailer.js";

const app = express();

app.use(cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5500", "http://localhost:5500", "http://localhost:5174"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/", (req, res) => {
    res.send("Auth MicroService Running");
})

app.get("/smtp", (req, res) => {
    const conn = verifySmtp;
    if (!conn) return;

    res.send("Smtp Connected Successfully")
})

// import route
import UserRouter from "./routes/user.routes.js"
import { errorHandler } from "./middleware/error.middleware.js";
import SessionRouter from "./routes/session.route.js"
import JobRouter from "./routes/job.route.js"
import CompanyRouter from "./routes/company.route.js"
import ResumeRouter from "./routes/resume.routes.js"
import ProfileRouter from "./routes/profile.route.js"
import ApplicatiobRouter from "./routes/application.route.js"
import InterviewRouter from "./routes/interview.route.js"
import AdminRouter from "./routes/admin.route.js"
import ConversationRouter from "./routes/conversation.route.js"
import MessageRouter from "./routes/message.route.js"
import ReportRouter from "./routes/report.route.js"
import NotificationRouter from "./routes/notification.route.js"

// route declartion
app.use("/api/v1/auth", UserRouter);
app.use("/api/v1/session", SessionRouter);
app.use("/api/v1/job", JobRouter);
app.use("/api/v1/company", CompanyRouter);
app.use("/api/v1/resume", ResumeRouter);
app.use("/api/v1/profile", ProfileRouter);
app.use("/api/v1/application", ApplicatiobRouter);
app.use("/api/v1/interview", InterviewRouter);
app.use("/api/v1/admin", AdminRouter);
app.use("/api/v1/conversation", ConversationRouter);
app.use("/api/v1/messages", MessageRouter);
app.use("/api/v1/reports", ReportRouter);
app.use("/api/v1/notification", NotificationRouter);

app.use(errorHandler);

export { app };