import { Router } from "express";

import { adminAuth } from "../middleware/admin.middleware.js";

import {
    blockCompany,
    blockJob,
    blockUser,
    deleteJob,
    deleteUser,
    getAdminDashboardStats,
    getAllAdminCompanies,
    getAllJobs,
    getAllUsers,
    getCompanyById,
    getJobById,
    getUserById,
    rejectCompany,
    unblockUser,
    updateUserStatus,
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

router.patch(
    "/users/:userId/status",
    adminAuth,
    updateUserStatus
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

// ADMIN JOBS

router.get(
    "/jobs", 
    adminAuth, 
    getAllJobs);

router.get(
    "/jobs/:jobId",
     adminAuth,
     getJobById
    );

router.patch(
    "/jobs/:jobId/block",
     adminAuth,
      blockJob
    );

router.delete(
    "/jobs/:jobId", 
    adminAuth,
     deleteJob
    );

export default router;