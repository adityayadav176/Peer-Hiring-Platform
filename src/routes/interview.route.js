import { Router } from "express";

import {
    getInterviewById,
    getInterviewsByApplication,
    getInterviewsByJob,
    getMyInterviews,
    getTodayInterviews,
    getUpcomingInterviews,
    rescheduleInterview,
    scheduleInterview,
    updateInterviewStatus
} from "../controllers/interview.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { isRecruiter } from "../middleware/recuiter.middleware.js";

const router = Router();

router.post(
    "/",
    verifyUser,
    isRecruiter,
    scheduleInterview
);

router.get(
    "/me",
    verifyUser,
    getMyInterviews
);

router.get(
    "/upcoming",
    verifyUser,
    getUpcomingInterviews
);

router.get(
    "/today",
    verifyUser,
    getTodayInterviews
);

router.get(
    "/:interviewId",
    verifyUser,
    getInterviewById
);

router.patch(
    "/:interviewId/reschedule",
    verifyUser,
    isRecruiter,
    rescheduleInterview
);

router.patch(
    "/:interviewId/status",
    verifyUser,
    isRecruiter,
    updateInterviewStatus
);

router.get(
    "/job/:jobId",
    verifyUser,
    isRecruiter,
    getInterviewsByJob
);

router.get(
    "/application/:applicationId",
    verifyUser,
    isRecruiter,
    getInterviewsByApplication
);

export default router;