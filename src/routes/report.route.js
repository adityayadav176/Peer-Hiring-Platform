import { Router } from "express";
import { adminAuth } from "../middleware/admin.middleware.js";
import { getAllReports, getReportById, resolveReport } from "../controllers/report.controller.js";

const router = Router();

router.get(
    "/",
    adminAuth,
    getAllReports
);

router.get(
    "/:reportId",
    adminAuth,
    getReportById
)

router.patch(
    "/:reportId/resolve",
    adminAuth,
    resolveReport
)

export default router;