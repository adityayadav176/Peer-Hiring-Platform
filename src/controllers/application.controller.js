import mongoose from "mongoose";
import { Application } from "../models/application.model.js";
import { Job } from "../models/job.model.js";
import { Resume } from "../models/resume.model.js";
import { Company } from "../models/company.model.js";
import { UserProfile } from "../models/profile.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";

const attachCandidateProfiles = async (applications = []) => {
  const candidateIds = applications
    .map((application) => application.candidateId?._id)
    .filter(Boolean);

  if (candidateIds.length === 0) {
    return applications.map((application) => ({
      ...application,
      candidate: null,
    }));
  }

  const profiles = await UserProfile.find({
    userId: { $in: candidateIds },
  }).lean();

  const profileByUserId = new Map(
    profiles.map((profile) => [
      String(profile.userId),
      profile,
    ])
  );

  return applications.map((application) => {
    const candidate = application.candidateId;

    if (!candidate) {
      return {
        ...application,
        candidate: null,
      };
    }

    const candidateWithProfile = {
      ...candidate,
      profile:
        profileByUserId.get(String(candidate._id)) || null,
    };

    return {
      ...application,
      candidateId: candidateWithProfile,
      candidate: candidateWithProfile,
    };
  });
};

// Apply for a job
const applyForJob = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { jobId } = req.params;
  const { resumeId, messageToRecruiter } = req.body;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(jobId)) {
    throw new ApiError(400, "Invalid job ID");
  }

  if (!mongoose.isValidObjectId(resumeId)) {
    throw new ApiError(400, "Please select a valid resume");
  }

  if (
    messageToRecruiter !== undefined &&
    typeof messageToRecruiter !== "string"
  ) {
    throw new ApiError(400, "Recruiter message must be a string");
  }

  const formattedMessage =
    typeof messageToRecruiter === "string"
      ? messageToRecruiter.trim()
      : "";

  if (formattedMessage.length > 3000) {
    throw new ApiError(
      400,
      "Recruiter message cannot exceed 3000 characters"
    );
  }

  const job = await Job.findById(jobId);

  if (!job || job.isDeleted) {
    throw new ApiError(404, "Job not found");
  }

  if (job.status !== "OPEN") {
    throw new ApiError(400, "Job is not accepting applications");
  }

  if (job.openings <= 0) {
    throw new ApiError(400, "No openings available");
  }

  if (
    job.applicationDeadline &&
    new Date(job.applicationDeadline) < new Date()
  ) {
    throw new ApiError(400, "Job application deadline has passed");
  }

  const company = await Company.findOne({
    _id: job.companyId,
    verificationStatus: "verified",
    isVerified: true,
    isBlocked: false,
    isDeleted: false,
  }).select("_id");

  if (!company) {
    throw new ApiError(
      400,
      "Applications are not available for this company's jobs"
    );
  }

  const resume = await Resume.findOne({
    _id: resumeId,
    user: userId,
    isDeleted: false,
  }).select("_id");

  if (!resume) {
    throw new ApiError(
      404,
      "Resume not found. Please select one of your active resumes."
    );
  }

  const alreadyApplied = await Application.findOne({
    candidateId: userId,
    jobId: job._id,
    isDeleted: false,
  }).select("_id");

  if (alreadyApplied) {
    throw new ApiError(409, "You have already applied for this job");
  }

  try {
    const application = await Application.create({
      candidateId: userId,
      jobId: job._id,
      companyId: company._id,
      resumeId: resume._id,
      messageToRecruiter: formattedMessage,
    });

    await Job.updateOne(
    { _id: job._id },
    { $inc: { applicantsCount: 1 } }
);

    return res.status(201).json(
      new ApiResponse(
        201,
        application,
        "Applied for this job successfully"
      )
    );
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(409, "You have already applied for this job");
    }

    throw error;
  }
});

// Get the logged-in candidate's active applications
const getMyApplications = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const page = Math.max(
    1,
    Number.parseInt(req.query.page, 10) || 1
  );
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
  );
  const skip = (page - 1) * limit;

  const filter = {
    candidateId: userId,
    isDeleted: false,
  };

  const [applications, totalApplications] = await Promise.all([
    Application.find(filter)
      .populate(
        "jobId",
        "title salary companyId location employmentType"
      )
      .populate("resumeId", "resume originalName")
      .populate("companyId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Application.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalApplications / limit);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        applications,
        pagination: {
          currentPage: page,
          limit,
          totalApplications,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1 && totalPages > 0,
        },
      },
      "Applications fetched successfully"
    )
  );
});

// Get applications for a job owned by the recruiter's company
const getJobApplications = asyncHandler(async (req, res) => {
  const recruiterId = req.user?._id;
  const companyId = req.company?._id;
  const { jobId } = req.params;

  if (!recruiterId || !companyId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(jobId)) {
    throw new ApiError(400, "Invalid job ID");
  }

  const job = await Job.findById(jobId).select(
    "_id companyId isDeleted"
  );

  if (!job || job.isDeleted) {
    throw new ApiError(404, "Job not found");
  }

  if (job.companyId?.toString() !== companyId.toString()) {
    throw new ApiError(
      403,
      "You are not allowed to view applicants for this job"
    );
  }

  const page = Math.max(
    1,
    Number.parseInt(req.query.page, 10) || 1
  );
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
  );
  const skip = (page - 1) * limit;

  const allowedStatuses = [
    "applied",
    "screening",
    "shortlisted",
    "interview_scheduled",
    "interview_completed",
    "selected",
    "rejected",
    "withdrawn",
    "closed",
  ];

  const filter = {
    jobId: job._id,
    companyId,
    isDeleted: false,
  };

  if (req.query.status) {
    if (!allowedStatuses.includes(req.query.status)) {
      throw new ApiError(400, "Invalid application status");
    }

    filter.status = req.query.status;
  }

 
const [applications, totalApplications] = await Promise.all([
  Application.find(filter)
    .populate("candidateId", "name email avatar phoneNo")
    .populate("resumeId", "title resume originalName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean(),

  Application.countDocuments(filter),
]);

const applicationsWithProfiles =
  await attachCandidateProfiles(applications);

const totalPages = Math.ceil(totalApplications / limit);

return res.status(200).json(
  new ApiResponse(
    200,
    {
      applications: applicationsWithProfiles,
      pagination: {
        currentPage: page,
        limit,
        totalApplications,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1 && totalPages > 0,
      },
    },
    "Job applications fetched successfully"
  )
);

});

// Get one application for a verified company's recruiter


const getApplicationById = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;

    if (!req.user?._id || !req.company?._id) {
        throw new ApiError(401, "Unauthorized access");
    }

    if (!mongoose.isValidObjectId(applicationId)) {
        throw new ApiError(400, "Invalid application ID");
    }

    const application = await Application.findOne({
        _id: applicationId,
        companyId: req.company._id,
        isDeleted: false,
    })
        .populate({
            path: "candidateId",
            select: "name email avatar coverImage phoneNo role isVerified",
        })
        .populate({ path: "jobId" })
        .populate({
            path: "resumeId",
            select: "title subtitle target skills resume views isDefault version createdAt updatedAt",
        })
        .populate({ path: "interviewId" })
        .lean();

    if (!application) {
        throw new ApiError(404, "Application not found");
    }

    // Increment the candidate's profile views.
    if (application.candidateId?._id) {
        await UserProfile.updateOne(
            { userId: application.candidateId._id },
            { $inc: { profileViews: 1 } }
        );
    }

    const [applicationWithProfile] =
        await attachCandidateProfiles([application]);

    return res.status(200).json(
        new ApiResponse(
            200,
            applicationWithProfile,
            "Application fetched successfully"
        )
    );
});

// Get one application belonging to the logged-in candidate
const getMyApplicationById = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { applicationId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  const application = await Application.findOne({
    _id: applicationId,
    candidateId: userId,
    isDeleted: false,
  })
    .populate("jobId")
    .populate("companyId", "name logo")
    .populate("resumeId", "title originalName")
    .populate("interviewId")
    .select("-recruiterNotes");

  if (!application) {
    throw new ApiError(404, "Application not found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      application,
      "Your application fetched successfully"
    )
  );
});

// Withdraw the candidate's application
const withdrawApplication = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { applicationId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  const application = await Application.findOne({
    _id: applicationId,
    candidateId: userId,
    isDeleted: false,
  });

  if (!application) {
    throw new ApiError(404, "Application not found");
  }

  if (application.status === "withdrawn") {
    throw new ApiError(400, "Application has already been withdrawn");
  }

  if (
    ["selected", "rejected", "closed"].includes(application.status)
  ) {
    throw new ApiError(
      400,
      `Application cannot be withdrawn because its status is "${application.status}"`
    );
  }

  application.status = "withdrawn";

  // Keep closedAt null if it is reserved for employer-closed applications.
  await application.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      application,
      "Application withdrawn successfully"
    )
  );
});

// Update application status for a recruiter's company
const updateApplicationStatus = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { status } = req.body;
  const recruiterId = req.user?._id;
  const companyId = req.company?._id;

  if (!recruiterId || !companyId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  if (typeof status !== "string" || !status.trim()) {
    throw new ApiError(400, "Status is required");
  }

  const allowedStatus = [
    "screening",
    "shortlisted",
    "interview_scheduled",
    "interview_completed",
    "selected",
    "rejected",
  ];

  if (!allowedStatus.includes(status)) {
    throw new ApiError(400, "Invalid application status");
  }

  const application = await Application.findOne({
    _id: applicationId,
    companyId,
    isDeleted: false,
  });

  if (!application) {
    throw new ApiError(404, "Application not found");
  }

  if (
    ["withdrawn", "rejected", "selected", "closed"].includes(
      application.status
    )
  ) {
    throw new ApiError(
      400,
      `Cannot update an application with status "${application.status}"`
    );
  }

  if (status === "shortlisted" && !application.shortlistedAt) {
    application.shortlistedAt = new Date();
  }

  if (["selected", "rejected"].includes(status)) {
    application.closedAt = new Date();
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

// Soft-delete a candidate's application
const deleteApplication = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { applicationId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  const application = await Application.findOne({
    _id: applicationId,
    candidateId: userId,
    isDeleted: false,
  });

  if (!application) {
    throw new ApiError(404, "Application not found");
  }

  application.isDeleted = true;
  application.deletedAt = new Date();

  await application.save();

  return res.status(200).json(
    new ApiResponse(200, null, "Application deleted successfully")
  );
});

// Update private recruiter notes
const updateRecruiterNotes = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { recruiterNotes } = req.body;
  const recruiterId = req.user?._id;
  const companyId = req.company?._id;

  if (!recruiterId || !companyId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  if (typeof recruiterNotes !== "string") {
    throw new ApiError(400, "Recruiter notes must be a string");
  }

  const formattedNotes = recruiterNotes.trim();

  if (formattedNotes.length > 5000) {
    throw new ApiError(
      400,
      "Recruiter notes cannot exceed 5000 characters"
    );
  }

  const application = await Application.findOne({
    _id: applicationId,
    companyId,
    isDeleted: false,
  });

  if (!application) {
    throw new ApiError(404, "Application not found");
  }

  application.recruiterNotes = formattedNotes;

  await application.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        applicationId: application._id,
        recruiterNotes: application.recruiterNotes,
        updatedAt: application.updatedAt,
      },
      "Recruiter notes updated successfully"
    )
  );
});

// Get the logged-in candidate's soft-deleted applications
const getDeletedApplications = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const page = Math.max(
    1,
    Number.parseInt(req.query.page, 10) || 1
  );
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
  );
  const skip = (page - 1) * limit;

  const filter = {
    candidateId: userId,
    isDeleted: true,
  };

  const [deletedApplications, totalApplications] = await Promise.all([
    Application.find(filter)
      .populate("jobId", "title salary location employmentType")
      .populate("companyId", "name logo")
      .populate("resumeId", "title originalName")
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Application.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalApplications / limit);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        applications: deletedApplications,
        pagination: {
          currentPage: page,
          limit,
          totalApplications,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1 && totalPages > 0,
        },
      },
      "Deleted applications fetched successfully"
    )
  );
});

const APPLICATION_STATUSES = [
  "applied",
  "screening",
  "shortlisted",
  "interview_scheduled",
  "interview_completed",
  "selected",
  "rejected",
  "withdrawn",
  "closed",
];

const ATS_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
];

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getRecruiterApplications = asyncHandler(
  async (req, res) => {
    const recruiterId = req.user?._id;

    if (!recruiterId) {
      throw new ApiError(401, "Authentication required");
    }

    if (!mongoose.Types.ObjectId.isValid(recruiterId)) {
      throw new ApiError(401, "Invalid recruiter identity");
    }

    // Restrict applications to the recruiter's company.
    const company = await Company.findOne({
      recruiters: {
        $elemMatch: { recruiterId },
      },
      isDeleted: false,
    })
      .select("_id")
      .lean();

    if (!company) {
      throw new ApiError(404, "No active company found for this recruiter");
    }

    const {
      page = "1",
      limit = "10",
      search = "",
      status,
      atsStatus,
      minAtsScore,
      maxAtsScore,
      jobId,
      candidateId,
      resumeId,
      interview,
      from,
      to,
      sortBy = "newest",
      includeDeleted = "false",
    } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(limit, 10) || 10)
    );
    const skip = (currentPage - 1) * pageSize;

    const filter = {
      companyId: company._id,
    };

    if (includeDeleted !== "true") {
      filter.isDeleted = false;
    }

    // Application status filter.
    if (status) {
      const statuses = (Array.isArray(status) ? status : status.split(","))
        .map((value) => value.trim());

      if (
        !statuses.length ||
        statuses.some((value) => !APPLICATION_STATUSES.includes(value))
      ) {
        throw new ApiError(400, "Invalid application status");
      }

      filter.status = { $in: statuses };
    }

    // ATS processing status filter.
    if (atsStatus) {
      const statuses = (
        Array.isArray(atsStatus) ? atsStatus : atsStatus.split(",")
      ).map((value) => value.trim());

      if (
        !statuses.length ||
        statuses.some((value) => !ATS_STATUSES.includes(value))
      ) {
        throw new ApiError(400, "Invalid ATS status");
      }

      filter.atsStatus = { $in: statuses };
    }

    // ATS score range.
    if (minAtsScore !== undefined || maxAtsScore !== undefined) {
      const min =
        minAtsScore === undefined ? 0 : Number(minAtsScore);

      const max =
        maxAtsScore === undefined ? 100 : Number(maxAtsScore);

      if (
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min < 0 ||
        max > 100 ||
        min > max
      ) {
        throw new ApiError(
          400,
          "ATS score must be between 0 and 100"
        );
      }

      filter.atsScore = { $gte: min, $lte: max };
    }

    // ObjectId filters.
    for (const [field, value] of [
      ["jobId", jobId],
      ["candidateId", candidateId],
      ["resumeId", resumeId],
    ]) {
      if (value) {
        if (!mongoose.Types.ObjectId.isValid(value)) {
          throw new ApiError(400, `Invalid ${field}`);
        }

        filter[field] = new mongoose.Types.ObjectId(value);
      }
    }

    // Interview reference filter.
    if (interview === "yes") {
      filter.interviewId = { $ne: null };
    } else if (interview === "no") {
      filter.interviewId = { $in: [null] };
    } else if (
      interview &&
      interview !== "all"
    ) {
      throw new ApiError(400, "Interview must be yes, no, or all");
    }

    // Applied date range.
    if (from || to) {
      const dateFilter = {};

      if (from) {
        const startDate = new Date(from);

        if (Number.isNaN(startDate.getTime())) {
          throw new ApiError(400, "Invalid from date");
        }

        dateFilter.$gte = startDate;
      }

      if (to) {
        const endDate = new Date(to);

        if (Number.isNaN(endDate.getTime())) {
          throw new ApiError(400, "Invalid to date");
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          endDate.setUTCHours(23, 59, 59, 999);
        }

        dateFilter.$lte = endDate;
      }

      if (
        dateFilter.$gte &&
        dateFilter.$lte &&
        dateFilter.$gte > dateFilter.$lte
      ) {
        throw new ApiError(400, "'from' must be before 'to'");
      }

      filter.createdAt = dateFilter;
    }

    // Search candidate, job, notes, and applicant message.
    const keyword = String(search).trim();

    if (keyword) {
      if (keyword.length > 100) {
        throw new ApiError(400, "Search cannot exceed 100 characters");
      }

      const regex = new RegExp(escapeRegex(keyword), "i");

      const [candidates, jobs] = await Promise.all([
        User.find({
          $or: [{ name: regex }, { email: regex }],
        })
          .select("_id")
          .limit(500)
          .lean(),

        Job.find({ title: regex })
          .select("_id")
          .limit(500)
          .lean(),
      ]);

      const searchConditions = [
        { recruiterNotes: regex },
        { messageToRecruiter: regex },
        {
          candidateId: {
            $in: candidates.map((candidate) => candidate._id),
          },
        },
        {
          jobId: {
            $in: jobs.map((job) => job._id),
          },
        },
      ];

      const existingOr = filter.$or;

      if (existingOr) {
        filter.$and = [
          { $or: existingOr },
          { $or: searchConditions },
        ];

        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    // Sorting.
    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      updated: { updatedAt: -1 },
      score_high: { atsScore: -1, createdAt: -1 },
      score_low: { atsScore: 1, createdAt: -1 },
    };

    if (!sortOptions[sortBy]) {
      throw new ApiError(
        400,
        "Invalid sortBy. Use newest, oldest, updated, score_high, or score_low"
      );
    }

    
const [applications, total] = await Promise.all([
  Application.find(filter)
    .populate({
      path: "candidateId",
      select: "name email avatar phoneNo",
    })
    .populate({
      path: "jobId",
      select: "title",
    })
    .populate({
      path: "resumeId",
      select: "resume title skills subtitle target",
    })
    .populate({
      path: "interviewId",
    })
    .sort(sortOptions[sortBy])
    .skip(skip)
    .limit(pageSize)
    .lean(),

  Application.countDocuments(filter),
]);

const applicationsWithProfiles =
  await attachCandidateProfiles(applications);

return res.status(200).json(
  new ApiResponse(
    200,
    {
      applications: applicationsWithProfiles,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasNextPage: skip + applications.length < total,
        hasPrevPage: currentPage > 1,
      },
    },
    "Recruiter applications fetched successfully"
  )
);

  }
);


export {
  applyForJob,
  getMyApplications,
  getJobApplications,
  getApplicationById,
  getMyApplicationById,
  withdrawApplication,
  updateApplicationStatus,
  deleteApplication,
  updateRecruiterNotes,
  getDeletedApplications,
  getRecruiterApplications,
};
