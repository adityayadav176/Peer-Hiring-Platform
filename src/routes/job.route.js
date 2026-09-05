import { Router } from "express";

import {
    changeJobStatus,
    createJob,
    deleteJob,
    getAllJobs,
    getDeletedJobs,
    getJobById,
    getRecruiterJobs,
    permanentDeleteJob,
    restoreJob,
    updateJob
} from "../controllers/job.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { isRecruiter } from "../middleware/recuiter.middleware.js";

const router = Router();

// Create Job
router.post(
    "/",
    verifyUser,
    isRecruiter,
    createJob
);

// Collection Routes
router.get(
    "/",
    verifyUser,
    getAllJobs
);

router.get(
    "/recruiter",
    verifyUser,
    isRecruiter,
    getRecruiterJobs
);

router.get(
    "/deleted",
    verifyUser,
    isRecruiter,
    getDeletedJobs
);

// Single Job Routes
router.get(
    "/:JobId",
    verifyUser,
    getJobById
);

router.patch(
    "/:JobId",
    verifyUser,
    isRecruiter,
    updateJob
);

router.patch(
    "/:JobId/delete",
    verifyUser,
    isRecruiter,
    deleteJob
);

// Job Actions
router.patch(
    "/:JobId/status",
    verifyUser,
    isRecruiter,
    changeJobStatus
);

router.patch(
    "/:JobId/restore",
    verifyUser,
    isRecruiter,
    restoreJob
);

router.delete(
    "/:JobId/permanent",
    verifyUser,
    isRecruiter,
    permanentDeleteJob
);

export default router;