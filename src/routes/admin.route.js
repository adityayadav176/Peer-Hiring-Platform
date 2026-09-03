import { Router } from "express";

import { adminAuth } from "../middleware/admin.middleware.js";

import {
    blockCompany,
    getAdminDashboardStats,
    getAllAdminCompanies,
    getAllUsers,
    getCompanyById,
    rejectCompany,
    verifyCompany
} from "../controllers/admin.controller.js";


const router = Router();

// ADMIN DASHBOARD

router.get(
    "/dashboard",
    adminAuth,
    getAdminDashboardStats
);

// ADMIN USERS

router.get(
    "/getUsers",
    adminAuth,
    getAllUsers
);

// ADMIN COMPANIES

// Get all companies
router.get(
    "/companies",
    adminAuth,
    getAllAdminCompanies
);


// Get company by ID
router.get(
    "/companies/:companyId",
    adminAuth,
    getCompanyById
);


// Verify company
router.patch(
    "/companies/:companyId/verify",
    adminAuth,
    verifyCompany
);


// Reject company
router.patch(
    "/companies/:companyId/reject",
    adminAuth,
    rejectCompany
);


// Block company
router.patch(
    "/companies/:companyId/block",
    adminAuth,
    blockCompany
);

export default router;