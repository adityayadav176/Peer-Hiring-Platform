import { Router } from "express";

import {
  applyForJob,
  deleteApplication,
  getApplicationById,
  getDeletedApplications,
  getJobApplications,
  getMyApplicationById,
  getMyApplications,
  getRecruiterApplications,
  updateApplicationStatus,
  updateRecruiterNotes,
  withdrawApplication,
} from "../controllers/application.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { isRecruiter } from "../middleware/recuiter.middleware.js";
import { verifyRecruiterCompany } from "../middleware/verifyRecruiterCompany.js";

const router = Router();

// Apply for a job
router.post("/:jobId", verifyUser, applyForJob);

// Get logged-in candidate's active applications
router.get("/", verifyUser, getMyApplications);

// Get logged-in candidate's deleted applications
router.get("/deleted", verifyUser, getDeletedApplications);

// Get a specific application belonging to the candidate
router.get("/my/:applicationId", verifyUser, getMyApplicationById);

// Withdraw an application
router.patch(
  "/:applicationId/withdraw",
  verifyUser,
  withdrawApplication
);

// Soft-delete an application
router.patch("/:applicationId", verifyUser, deleteApplication);

// ========================================
// Recruiter Routes
// ========================================

// Get all applications for the recruiter's company
router.get(
  "/recruiter",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getRecruiterApplications
);

// Get applications for a specific job
router.get(
  "/jobs/:jobId",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getJobApplications
);

// Update application status
router.patch(
  "/:applicationId/status",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  updateApplicationStatus
);

// Update private recruiter notes
router.patch(
  "/:applicationId/recruiter-notes",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  updateRecruiterNotes
);

// Get one application belonging to the recruiter's company
router.get(
  "/:applicationId",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getApplicationById
);

export default router;