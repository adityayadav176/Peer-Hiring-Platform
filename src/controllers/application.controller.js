import { Application } from "../models/application.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import { Job } from "../models/job.model.js";
import { Resume } from "../models/resume.model.js";

const applyForJob = asyncHandler(async (req, res) => {
    const user = req.user?._id;

    if(!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const { jobId } = req.params;

    if(!jobId || !mongoose.isValidObjectId(jobId)) {
        throw new ApiError(400, "Invalid JobId");
    }

     const job = await Job.findById(jobId);

    if(!job) {
        throw new ApiError(404, "Job Not Found");
    }

     if(job.status !== "OPEN" || job.isDeleted) {
        throw new ApiError(400, "Job is not accepting applications");
    }

     if(job.openings <= 0) {
        throw new ApiError(400, "No Openings available");
    }

     if(job.applicationDeadline && new Date(job.applicationDeadline) < new Date()) {
        throw new ApiError(400, "Job Is Expired");
    }

    const alreadyApplied = await Application.findOne({
        candidateId: user,
        jobId: jobId
    })

    if(alreadyApplied) {
        throw new ApiError(400, "You have already applied for this job");
    }

    const resume = await Resume.findOne({user});

    if(!resume) {
        throw new ApiError(400, "Please upload resume before applying")
    }

    const application = await Application.create({
        candidateId: user,
        jobId: job._id,
        companyId: job.companyId,
        resumeId: resume._id
    })

    return res.status(201)
    .json(
        new ApiResponse(201, application, "Apply For This Job Successfully")
    )
})

const getMyApplications = asyncHandler(async (req, res) => {
    const user = req.user._id;

    if(!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const page = Number(req.query?.page || 1);
    const limit = Number(req.query?.limit || 10);
    const skip = (page - 1) * limit;

    const applications = await Application.find({
    candidateId: user,
    isDeleted: false
})
.populate(
    "jobId",
    "title salary companyId"
)
.populate(
    "resumeId"
)
.skip(skip)
.limit(limit);

    const totalApplications = await Application.countDocuments({
        candidateId: user,
        isDeleted: false
    });

    const totalPages = Math.ceil(totalApplications / limit);

    if(applications.length === 0) {
        throw new ApiError(404, "You Currently Don't Have Any Applications");
    }

    return res.status(200)
    .json(
        new ApiResponse(
            200, 
            {
                applications,
                pagination: {
                    currentPage: page,
                    limit,
                    totalApplications,
                    totalPages: Math.ceil(totalApplications / limit)
                }
            },
            "Application Fetched successfully"
        )
    )
})

const getJobApplications = asyncHandler(async (req, res) => {
    const recruiterId = req.user._id;
    
    if(!recruiterId) {
        throw new ApiError(401,"Unauthorized Access Denied");
    }

    const { jobId } = req.params;

    if(!jobId || !mongoose.isValidObjectId(jobId)) {
        throw new ApiError(400,"Invalid Job Id");
    }
    
    // Check Job
    const job = await Job.findById(jobId);

    if(!job) {
        throw new ApiError(404,"Job Not Found");
    }

    // Check recruiter ownership
    if(job.recruiterId.toString() !== recruiterId.toString()) {
        throw new ApiError(403,"You are not allowed to view applicants");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Optional status filter
    const filter = {
        jobId: jobId,
        isDeleted: false
    };

    if(req.query.status) {
        filter.status = req.query.status;
    }

    const applications = await Application.find(filter)
        .populate(
            "candidateId",
            "name email profileImage"
        )
        .populate(
            "resumeId",
            "title resume version"
        )
        .sort({
            createdAt: -1
        })
        .skip(skip)
        .limit(limit);
    const totalApplications = await Application.countDocuments(filter);

    if(applications.length === 0) {
        throw new ApiError(404,"No applications found");
    }

    return res.status(200)
    .json(
        new ApiResponse(
            200,
            {
                applications,
                pagination:{
                    currentPage: page,
                    limit,
                    totalApplications,
                    totalPages: Math.ceil(
                        totalApplications / limit
                    )
                }
            },
            "Job applications fetched successfully"
        )
    );

});

const getApplicationById = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;

    if (!applicationId || !mongoose.isValidObjectId(applicationId)) {
        throw new ApiError(400, "Application ID is required");
    }

    const application = await Application.findById(applicationId)
        .populate("jobId")
        .populate("candidateId", "name email profileImage");

    if (!application) {
        throw new ApiError(404, "Application not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            application,
            "Application fetched successfully"
        )
    );
});

const withdrawApplication = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const userId = req.user._id;

    if (!applicationId) {
        throw new ApiError(400, "Application ID is required");
    }

    const application = await Application.findById(applicationId);

    if (!application) {
        throw new ApiError(404, "Application not found");
    }

    // Check ownership
    if (application.candidateId.toString() !== userId?.toString()) {
        throw new ApiError(403, "You cannot withdraw this application");
    }

    if (application.status === "selected") {
        throw new ApiError(
            400,
            "Selected application cannot be withdrawn"
        );
    }

    application.status = "withdrawn";

    await application.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            application,
            "Application withdrawn successfully"
        )
    );
});

const updateApplicationStatus = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const { status } = req.body;

    if (!applicationId) {
        throw new ApiError(400, "Application ID is required");
    }

    if (!status) {
        throw new ApiError(400, "Status is required");
    }

    const allowedStatus = [
        "screening",
        "shortlisted",
        "interview_scheduled",
        "interview_completed",
        "selected",
        "rejected",
        "withdrawn"
    ];

    if (!allowedStatus.includes(status)) {
        throw new ApiError(400, "Invalid application status");
    }

    const application = await Application.findById(applicationId);

    if (!application) {
        throw new ApiError(404, "Application not found");
    }

    // Prevent updating withdrawn applications
    if (application.status === "withdrawn") {
        throw new ApiError(
            400,
            "Withdrawn application status cannot be changed"
        );
    }

    application.status = status;

    await application.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            application,
            "Application status updated successfully"
        )
    );
});

const deleteApplication = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;

    if (!applicationId || !mongoose.isValidObjectId(applicationId)) {
        throw new ApiError(400, "Application ID is required");
    }

    const application = await Application.findById(applicationId);

    if (!application) {
        throw new ApiError(404, "Application not found");
    }

    application.isDeleted = true;
    application.deletedAt = new Date();

    await application.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Application deleted successfully"
        )
    );
});


const updateRecruiterNotes = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const { recruiterNotes } = req.body;

    if (!applicationId) {
        throw new ApiError(400, "Application ID is required");
    }

    if (recruiterNotes === undefined) {
        throw new ApiError(400, "Recruiter notes are required");
    }

    const application = await Application.findById(applicationId);

    if (!application) {
        throw new ApiError(404, "Application not found");
    }

    application.recruiterNotes = recruiterNotes;

    await application.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            application,
            "Recruiter notes updated successfully"
        )
    );
});

const getDeletedApplications = asyncHandler(async (req, res) => {
    const deletedApplications = await Application.find({
        isDeleted: true,
    })
        .populate("candidateId", "fullName email")
        .populate("jobId", "title");

    return res.status(200).json(
        new ApiResponse(
            200,
            deletedApplications,
            "Deleted applications fetched successfully"
        )
    );
});

export {
    applyForJob,
    getMyApplications,
    getJobApplications,
    getApplicationById,
    withdrawApplication,
    updateApplicationStatus,
    deleteApplication,
    updateRecruiterNotes,
    getDeletedApplications
}