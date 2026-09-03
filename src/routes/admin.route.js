import { Router } from "express";
import { adminAuth } from "../middleware/admin.middleware.js";
import { getAdminDashboardStats, getAllUsers } from "../controllers/admin.controller.js";

const router = Router();

router.get("/dashboard" ,adminAuth, getAdminDashboardStats);
router.get("/getUsers" ,adminAuth, getAllUsers);
export default router;