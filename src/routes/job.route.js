
import { Router } from "express";
import {
    changeJobStatus,
    createJob,
    deleteJob,
    getAllJobs,
    getDeletedJobs,
    getJobById,
    getRecruiterJobs,
    getUserJobById,
    permanentDeleteJob,
    restoreJob,
    updateJob,
} from "../controllers/job.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { isRecruiter } from "../middleware/recuiter.middleware.js";
import {verifyRecruiterCompany} from "../middleware/verifyRecruiterCompany.js"
const router = Router();

// Public and user job routes
router.get("/", verifyUser, getAllJobs);
router.get("/user/:JobId", verifyUser, getUserJobById); 

// Recruiter collection routes
router.get(
    "/recruiter",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    getRecruiterJobs
);

router.get(
    "/deleted",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    getDeletedJobs
);

// Create job
router.post(
    "/",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    createJob
);

// Recruiter single-job and update routes
router.get(
    "/recruiter/:JobId",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    getJobById
);

router.patch(
    "/:JobId",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    updateJob
);

// Job actions
router.patch(
    "/:JobId/status",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    changeJobStatus
);

router.patch(
    "/:JobId/delete",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    deleteJob
);

router.patch(
    "/:JobId/restore",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    restoreJob
);

router.delete(
    "/:JobId/permanent",
    verifyUser,
    isRecruiter,
    verifyRecruiterCompany,
    permanentDeleteJob
);

export default router;
