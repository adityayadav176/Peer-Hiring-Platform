import { Router } from "express";
import { adminAuth } from "../middleware/admin.middleware.js";
import { getAllReports } from "../controllers/report.controller.js";

const router = Router();

router.get(
    "/",
    adminAuth,
    getAllReports
);

export default router;