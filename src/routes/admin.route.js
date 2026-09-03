import { Router } from "express";
import { adminAuth } from "../middleware/admin.middleware.js";
import { blockCompany, getAdminDashboardStats, getAllAdminCompanies, getAllUsers, getCompanyById, rejectCompany, verifyCompany } from "../controllers/admin.controller.js";

const router = Router();
router.get(
    "/companies/:companyId",
    adminAuth,
    getCompanyById
);
router.get(
    "/dashboard",
    adminAuth, 
    getAdminDashboardStats
);
router.get(
    "/getUsers",
    adminAuth,
    getAllUsers
);

router.patch(
    "companies/:companyId/verify",
    adminAuth,
    verifyCompany
);
router.patch(
    "companies/:companyId/reject",
    adminAuth,
    rejectCompany
);
router.patch(
    "companies/:companyId/block",
    adminAuth,
    blockCompany
);
router.get(
    "/companies",
    adminAuth,
    getAllAdminCompanies
);
export default router;