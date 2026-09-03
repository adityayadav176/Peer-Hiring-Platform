import { Router } from "express";

import { adminAuth } from "../middleware/admin.middleware.js";

import {
    blockCompany,
    blockUser,
    deleteUser,
    getAdminDashboardStats,
    getAllAdminCompanies,
    getAllUsers,
    getCompanyById,
    getUserById,
    rejectCompany,
    unblockUser,
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

router.get(
    "/users/:userId",
    adminAuth,
    getUserById
)

router.patch(
    "/users/:userId/block",
    adminAuth,
    blockUser
)

router.patch(
    "/users/:userId/unblock",
    adminAuth,
    unblockUser
)

router.delete(
    "/users/:userId/delete",
    adminAuth,
    deleteUser
)
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