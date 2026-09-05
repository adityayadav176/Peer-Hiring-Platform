import { Router } from "express";
import { applyForJob, deleteApplication, getApplicationById, getDeletedApplications, getJobApplications, getMyApplications, updateApplicationStatus, updateRecruiterNotes, withdrawApplication } from "../controllers/application.controller.js";
import { verifyUser } from "../middleware/verifyUser.middleware.js";
const router = Router();

router.post("/:jobId",verifyUser, applyForJob);

router.get("/", verifyUser, getMyApplications);
router.get(
    "/deleted",
    verifyUser,
    getDeletedApplications
);
router.patch(
    "/:applicationId/recruiter-notes",
    verifyUser,
    updateRecruiterNotes
);
router.patch(
    "/:applicationId",
    verifyUser,
    deleteApplication
);
router.patch(
    "/:applicationId/status",
    verifyUser,
    updateApplicationStatus
);
router.get(
    "/:applicationId",
    verifyUser,
    getApplicationById
);
router.patch(
    "/:applicationId/withdraw",
    verifyUser,
    withdrawApplication
);
router.get("/jobs/:jobId", verifyUser, getJobApplications);


export default router;