import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { verifyUser } from "../middleware/verifyUser.middleware.js"

import { User } from "../models/user.model.js"
import { Company } from "../models/company.model.js"
import { Job } from "../models/job.model.js"
import { Application } from "../models/application.model.js"
import { Interview } from "../models/interview.model.js"
import mongoose from "mongoose"
import { generateInterviewRoomId } from "../utils/interviewRoom.js"

const scheduleInterview = asyncHandler(async (req, res) => {

    const recruiterId = req.user?._id;

    const {
        application,
        company,
        candidate,
        job,
        round,
        interviewType,
        location,
        scheduledAt,
        duration,
        timezone
    } = req.body;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (
        !application ||
        !company ||
        !candidate ||
        !job ||
        !interviewType ||
        !scheduledAt
    ) {
        throw new ApiError(400, "All Fields Are Required");
    }

    if (!mongoose.isValidObjectId(application)) {
        throw new ApiError(400, "Invalid Application ID");
    }

    if (!mongoose.isValidObjectId(company)) {
        throw new ApiError(400, "Invalid Company ID");
    }

    if (!mongoose.isValidObjectId(candidate)) {
        throw new ApiError(400, "Invalid Candidate ID");
    }

    if (!mongoose.isValidObjectId(job)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    if (recruiterId.toString() === candidate.toString()) {
        throw new ApiError(
            403,
            "Recruiter Cannot Schedule an Interview for Himself"
        );
    }

    const applicationDoc = await Application.findById(application);

    if (!applicationDoc) {
        throw new ApiError(404, "Application Not Found");
    }

    const jobDoc = await Job.findById(job);

    if (!jobDoc) {
        throw new ApiError(404, "Job Not Found");
    }

    const companyDoc = await Company.findById(company);

    if (!companyDoc) {
        throw new ApiError(404, "Company Not Found");
    }

    const candidateDoc = await User.findById(candidate);

    if (!candidateDoc) {
        throw new ApiError(404, "Candidate Not Found");
    }

    const recruiterBelongsToCompany = companyDoc.recruiters.some(
        recruiter =>
            recruiter.recruiterId.toString() === recruiterId.toString()
    );

    if (!recruiterBelongsToCompany) {
        throw new ApiError(
            403,
            "You Are Not Authorized to Schedule Interviews for This Company"
        );
    }

    if (
        !jobDoc.companyId ||
        jobDoc.companyId.toString() !== company.toString()
    ) {
        throw new ApiError(
            403,
            "This Job Does Not Belong to This Company"
        );
    }

    if (
        !applicationDoc.job ||
        applicationDoc.job.toString() !== job.toString()
    ) {
        throw new ApiError(
            400,
            "This Application Does Not Belong to This Job"
        );
    }

    if (
        !applicationDoc.candidate ||
        applicationDoc.candidate.toString() !== candidate.toString()
    ) {
        throw new ApiError(
            400,
            "This Application Does Not Belong to This Candidate"
        );
    }

    const allowedInterviewTypes = ["Online", "Offline"];

    if (!allowedInterviewTypes.includes(interviewType)) {
        throw new ApiError(400, "Invalid Interview Type");
    }

    const interviewDate = new Date(scheduledAt);

    if (Number.isNaN(interviewDate.getTime())) {
        throw new ApiError(400, "Invalid Scheduled Date");
    }

    if (interviewDate <= new Date()) {
        throw new ApiError(
            400,
            "Interview Must Be Scheduled in the Future"
        );
    }

    if (
        interviewType === "Offline" &&
        (!location || !location.trim())
    ) {
        throw new ApiError(
            400,
            "Location Required for Offline Interview"
        );
    }

    if (
        interviewType === "Online" &&
        location &&
        location.trim()
    ) {
        throw new ApiError(
            400,
            "Online Interview Cannot Have a Physical Location"
        );
    }

    const interviewRound = round || 1;

    const existingInterview = await Interview.findOne({
        application,
        round: interviewRound,
        status: {
            $in: [
                "Scheduled",
                "Accepted",
                "Rescheduled"
            ]
        }
    });

    if (existingInterview) {
        throw new ApiError(
            409,
            "Interview for This Round Already Exists"
        );
    }

    const interviewRoomId =
        interviewType === "Online"
            ? generateInterviewRoomId()
            : null;

    const interview = await Interview.create({
        application,
        job,
        company,
        candidate,
        recruiter: recruiterId,
        round: interviewRound,
        interviewType,
        interviewRoomId,
        location:
            interviewType === "Offline"
                ? location.trim()
                : undefined,
        scheduledAt: interviewDate,
        duration: duration || 60,
        timezone: timezone || "Asia/Kolkata"
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            interview,
            "Interview Scheduled Successfully"
        )
    );
});

const getInterviewById = asyncHandler(async (req, res) => {
    const { interviewId } = req.params;

    if (!interviewId || !mongoose.isValidObjectId(interviewId)) {
        throw new ApiError(400, "Invalid InterviewID");
    }

    const interview = await Interview.findById(interviewId)
        .populate("candidate", "fullName avatar email")
        .populate("recruiter", "fullName avatar email")
        .populate("application")
        .populate("job", "title companyId");

    if (!interview) {
        throw new ApiError(404, "Interview Not found");
    }

    if (interview.candidate._id.toString() !== req.user._id.toString() && interview.recruiter_id.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Unauthorized Access Denied");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, interview, "Interview Fetched Successfully")
        )
})

const getMyInterviews = asyncHandler(async (req, res) => {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const skip = (page - 1) * limit;

    const filter = {
        $or: [
            { candidate: req.user._id },
            { recruiter: req.user._id }
        ]
    }

    const interviews = await Interview.find(filter)
        .populate("candidate", "fullName avatar email")
        .populate("recruiter", "fullName avatar email")
        .populate("application")
        .populate("job", "title companyId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    if (!interviews) {
        throw new ApiError(404, "Interview Not Found");
    }

    const totalInterview = await Interview.countDocuments(filter);

    return res.status(200)
        .json(
            new ApiResponse(
                200,
                {
                    interviews,
                    pagination: {
                        totalInterview,
                        currentPage: page,
                        totalPage: Math.ceil(totalInterview / limit),
                        limit
                    }
                },
                "Interviews Fetched Successfully")
        )
})

const rescheduleInterview = asyncHandler(async (req, res) => {
    const { interviewId } = req.params;
    const { scheduledAt } = req.body;

    if (!interviewId) {
        throw new ApiError(400, "Interview ID is required");
    }

    if (!scheduledAt) {
        throw new ApiError(400, "New interview date & time is required");
    }

    const interview = await Interview.findById(interviewId);

    if (!interview) {
        throw new ApiError(404, "Interview Not Found");
    }

    if (interview.recruiter.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only recruiter can reschedule interview");
    }

    interview.scheduledAt = new Date(scheduledAt);
    interview.status = "Rescheduled";

    await interview.save()

    return res.status(200).json(
        new ApiResponse(200, interview, "Interview Rescheduled successfully")
    )
})

const updateInterviewStatus = asyncHandler(async (req, res) => {
    const { interviewId } = req.params;
    const { status } = req.body;

    const allowedStatus = [
        "Scheduled",
        "Accepted",
        "Rejected",
        "Completed",
        "Cancelled",
        "Reschedule Requested",
        "Rescheduled",
        "No Show"
    ];

    if (!allowedStatus.includes(status)) {
        throw new ApiError(400, "Invalid interview status");
    }

    const interview = await Interview.findById(interviewId);

    if (!interview) {
        throw new ApiError(404, "interview not found");
    }

    if (interview.recruiter._id.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only recruiter can update interview status");
    }

    interview.status = status;
    await interview.save();

    return res.status(200)
        .json(
            new ApiResponse(200, interview, "Interview status Updated Successfully")
        )
})

const getUpcomingInterviews = asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const filter = {
        scheduledAt: { $gt: new Date() },
        status: { $nin: ["cancelled", "completed"] },
        $or: [
            { recruiter: req.user._id },
            { candidate: req.user._id }
        ]
    };

    const interviews = await Interview.find(filter)
        .populate("candidate", "fullname email avatar")
        .populate("recruiter", "fullname email avatar")
        .populate("job", "title company")
        .populate("application")
        .sort({ scheduledAt: 1 })
        .skip(skip)
        .limit(limit);

    const totalInterviews = await Interview.countDocuments(filter);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                interviews,
                pagination: {
                    totalInterviews,
                    currentPage: page,
                    totalPages: Math.ceil(totalInterviews / limit),
                    limit
                }
            },
            "Upcoming interviews fetched successfully"
        )
    );
});

const getTodayInterviews = asyncHandler(async (req, res) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const interviews = await Interview.find({
        scheduledAt: {
            $gte: startOfDay,
            $lte: endOfDay
        },
        $or: [
            { recruiter: req.user._id },
            { candidate: req.user._id }
        ]
    })
        .populate("candidate", "fullname email avatar")
        .populate("recruiter", "fullname email avatar")
        .populate("job", "title company")
        .populate("application")
        .sort({ scheduledAt: 1 });

    return res.status(200).json(
        new ApiResponse(
            200,
            interviews,
            "Today's interviews fetched successfully"
        )
    );
});

const getInterviewsByJob = asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    if (!jobId) {
        throw new ApiError(400, "Job ID is required");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const filter = {
        job: jobId,
        recruiter: req.user._id
    };

    const interviews = await Interview.find(filter)
        .populate("candidate", "fullname email avatar")
        .populate("job", "title company")
        .populate("application")
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit);

    const totalInterviews = await Interview.countDocuments(filter);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                interviews,
                pagination: {
                    totalInterviews,
                    currentPage: page,
                    totalPages: Math.ceil(totalInterviews / limit),
                    limit
                }
            },
            "Job interviews fetched successfully"
        )
    );
});

const getInterviewsByApplication = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;

    if (!applicationId) {
        throw new ApiError(400, "Application ID is required");
    }

    const interviews = await Interview.find({
        application: applicationId,
        $or: [
            { recruiter: req.user._id },
            { candidate: req.user._id }
        ]
    })
        .populate("candidate", "fullname email avatar")
        .populate("recruiter", "fullname email avatar")
        .populate("job", "title company")
        .populate("application")
        .sort({ scheduledAt: 1 });

    return res.status(200).json(
        new ApiResponse(
            200,
            interviews,
            "Application interviews fetched successfully"
        )
    );
});

export {
    scheduleInterview,
    getInterviewById,
    getMyInterviews,
    rescheduleInterview,
    updateInterviewStatus,
    getUpcomingInterviews,
    getTodayInterviews,
    getInterviewsByApplication,
    getInterviewsByJob
}