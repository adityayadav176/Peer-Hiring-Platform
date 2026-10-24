
import express from "express";

import {
  scheduleInterview,
  getMyInterviews,
  getUpcomingInterviews,
  getTodayInterviews,
  getInterviewsByApplication,
  getInterviewById,
  getRecruiterInterviewStats,
  getRecruiterInterviews,
  getInterviewsByJob,
  getRecruiterInterviewsByCandidate,
  getRecruiterInterviewById,
  rescheduleInterview,
  updateInterviewStatus,
  cancelRecruiterInterview,
} from "../controllers/interview.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { isRecruiter } from "../middleware/recuiter.middleware.js";
import { verifyRecruiterCompany } from "../middleware/verifyRecruiterCompany.js";

const router = express.Router();

// Candidate routes
router.get("/my", verifyUser, getMyInterviews);
router.get("/upcoming", verifyUser, getUpcomingInterviews);
router.get("/today", verifyUser, getTodayInterviews);

router.get(
  "/application/:applicationId",
  verifyUser,
  getInterviewsByApplication
);

// Recruiter routes — specific routes first
router.post(
  "/recruiter",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  scheduleInterview
);

router.get(
  "/recruiter/stats",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getRecruiterInterviewStats
);

router.get(
  "/recruiter/job/:jobId",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getInterviewsByJob
);

router.get(
  "/recruiter/candidate/:candidateId",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getRecruiterInterviewsByCandidate
);

router.get(
  "/recruiter",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getRecruiterInterviews
);

// Recruiter interview-specific routes
router.get(
  "/recruiter/:interviewId",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  getRecruiterInterviewById
);

router.patch(
  "/recruiter/:interviewId/reschedule",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  rescheduleInterview
);

router.patch(
  "/recruiter/:interviewId/status",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  updateInterviewStatus
);

router.patch(
  "/recruiter/:interviewId/cancel",
  verifyUser,
  isRecruiter,
  verifyRecruiterCompany,
  cancelRecruiterInterview
);


router.get("/:interviewId", verifyUser, getInterviewById);

export default router;
