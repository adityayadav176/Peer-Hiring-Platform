import { Router } from "express";

import {
    createCompany,
    deleteCompany,
    getAllCompanies,
    getCompanyById,
    permanentDeleteCompany,
    restoreCompany,
    updateCompany
} from "../controllers/company.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { isRecruiter } from "../middleware/recuiter.middleware.js";

const router = Router();

// Create Company
router.post(
    "/",
    verifyUser,
    isRecruiter,
    createCompany
);

// Get Company
router.get(
    "/:companyId",
    verifyUser,
    getCompanyById
);

// Get All Companies
router.get(
    "/",
    verifyUser,
    getAllCompanies
);

// Update Company
router.patch(
    "/:companyId",
    verifyUser,
    isRecruiter,
    updateCompany
);

// Soft Delete Company
router.patch(
    "/:companyId/delete",
    verifyUser,
    isRecruiter,
    deleteCompany
);

// Permanent Delete Company
router.delete(
    "/:companyId/permanent",
    verifyUser,
    isRecruiter,
    permanentDeleteCompany
);

// Restore Company
router.patch(
    "/:companyId/restore",
    verifyUser,
    isRecruiter,
    restoreCompany
);

export default router;