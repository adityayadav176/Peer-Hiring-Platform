import { Application } from "../models/application.model.js";
import { Company } from "../models/company.model.js";
import { Interview } from "../models/interview.model.js";
import { Job } from "../models/job.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Session } from "../models/session.model.js";
import {UserProfile} from "../models/profile.model.js"
import { Conversation } from "../models/converstion.model.js"
import {Resume} from "../models/resume.model.js"
import mongoose from "mongoose";
import { Message } from "../models/message.model.js";
import Admin from "../models/admin.model.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"

const setAuthCookies = (res, accessToken, refreshToken) => {
    res.cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: ACCESS_TOKEN_DURATION,
    });

    res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: REFRESH_TOKEN_DURATION,
    });
};

const getAllUsers = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    role,
    accountStatus,
    status,
  } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(
    Math.max(Number(limit) || 10, 1),
    100
  );

  const query = {};

  const searchTerm = String(search).trim();

  if (searchTerm) {
    const escapedSearch = searchTerm.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    query.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { email: { $regex: escapedSearch, $options: "i" } },
    ];
  }

  if (role) {
    query.role = role;
  }

  const requestedStatus = accountStatus || status;

  if (requestedStatus && requestedStatus !== "all") {
    query.accountStatus = requestedStatus;
  }

  const skip = (pageNumber - 1) * limitNumber;

  const [users, totalUsers] = await Promise.all([
    User.find(query)
      .select("-password -refreshToken -otp -otpExpiredAt +accountStatus +phoneNo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),

    User.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      data: {
        users,
        pagination: {
          currentPage: pageNumber,
          totalPages: Math.ceil(totalUsers / limitNumber),
          totalUsers,
          limit: limitNumber,
        },
      },
    })
  );
});

const getUserById = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId || !mongoose.isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid UserId");
    }

    const user = await User.findById(userId)
        .select("+accountStatus +phoneNo")
        .lean();

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "User fetched successfully"
        )
    );
});

const blockUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const duration = Number(req.body.duration);

    if (!userId || !mongoose.isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid User ID");
    }

    if (
        !Number.isFinite(duration) ||
        !Number.isInteger(duration) ||
        duration <= 0
    ) {
        throw new ApiError(
            400,
            "Duration must be a positive integer in minutes"
        );
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Reject an account that is already actively blocked.
    if (
        user.accountStatus === "blocked" &&
        user.lockUntil &&
        user.lockUntil > new Date()
    ) {
        throw new ApiError(400, "User is already blocked");
    }

    const now = new Date();
    const lockUntil = new Date(
        now.getTime() + duration * 60 * 1000
    );

    user.lockUntil = lockUntil;
    user.accountStatus = "blocked";

    // Invalidate existing access/refresh tokens.
    user.tokenVersion = (user.tokenVersion || 0) + 1;

    user.isOnline = false;
    user.lastSeen = now;
    user.lastSeen = now;

    await user.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                userId: user._id,
                accountStatus: user.accountStatus,
                lockUntil: user.lockUntil,
            },
            "User blocked successfully"
        )
    );
});

const unblockUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId || !mongoose.isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid User ID");
    }

    const user = await User.findById(userId).populate("accountStatus");

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Allow unblocking an expired temporary block too.
    if (user.accountStatus !== "blocked" && !user.lockUntil) {
        throw new ApiError(400, "User is not currently blocked");
    }

    user.lockUntil = null;
    user.accountStatus = "active";

    // Invalidate existing tokens.
    user.tokenVersion = (user.tokenVersion || 0) + 1;

    await user.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                userId: user._id,
                accountStatus: user.accountStatus,
                lockUntil: user.lockUntil,
            },
            "User unblocked successfully"
        )
    );
});

const deleteUser = asyncHandler(async (req, res) => {

    const { userId } = req.params;

    // Validate user ID
    if (!userId || !mongoose.isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid user ID");
    }

    // Check user exists
    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Delete profile
    await UserProfile.deleteMany({
        userId
    });

    // Delete resumes
    await Resume.deleteMany({
        user: userId
    });

    // Delete applications
    await Application.deleteMany({
        candidateId: userId
    });

    // Delete interviews where user is involved
    await Interview.deleteMany({
        $or: [
            { candidate: userId },
            { recruiter: userId }
        ]
    });

    // Delete sessions
    await Session.deleteMany({
        userId
    });

    // Find conversations involving this user
    const conversations = await Conversation.find({
        participants: userId
    }).select("_id");

    const conversationIds = conversations.map(
        (conversation) => conversation._id
    );

    // Delete messages from those conversations
    if (conversationIds.length > 0) {
        await Message.deleteMany({
            conversation: { $in: conversationIds }
        });

        // Delete conversations
        await Conversation.deleteMany({
            _id: { $in: conversationIds }
        });
    }

    // Finally delete user
    await User.findByIdAndDelete(userId);

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                null,
                "User and all related data deleted successfully"
            )
        );
});

const getAdminDashboardStats = asyncHandler(async (req, res) => {
    const [
        totalUsers,
        totalCandidates,
        totalRecruiters,
        totalCompanies,
        verifiedCompany,
        NoVerifiedCompany,
        totalJobs,
        activeJobs,
        ClosedJobs,
        expiredJobs,
        draftJobs,
        pausedJobs,
        totalApplications,
        totalInterviews
    ] = await Promise.all([

        User.countDocuments(),

        User.countDocuments({ role: "User" }),

        User.countDocuments({ role: "recruiter" }),

        Company.countDocuments(),

        Company.countDocuments({
            isVerified: true
        }),

        Company.countDocuments({
            isVerified: false
        }),

        Job.countDocuments(),

        Job.countDocuments({
            status: "OPEN"
        }),

        Job.countDocuments({
            status: "CLOSED"
        }),

        Job.countDocuments({
            status: "EXPIRED"
        }),

        Job.countDocuments({
            status: "DRAFT"
        }),

        Job.countDocuments({
            status: "PAUSED"
        }),

        Application.countDocuments(),

        Interview.countDocuments()

    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                users: {
                    total: totalUsers,
                    candidate: totalCandidates,
                    recruiter: totalRecruiters
                },

                company: {
                    total: totalCompanies,
                    verified: verifiedCompany,
                    unVerified: NoVerifiedCompany
                },

                job: {
                    total: totalJobs,
                    active: activeJobs,
                    closed: ClosedJobs,
                    expired: expiredJobs,
                    draft: draftJobs,
                    paused: pausedJobs,
                },

                application: {
                    total: totalApplications,
                },

                interview: {
                    total: totalInterviews
                }
            },
            "Admin dashboard statistics fetched successfully"
        )
    );
});

const getAllAdminCompanies = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        search = "",
        status = "all",
        verificationStatus,
        blocked = "all",
        deleted = "all",
        industry = "",
        companySize = "",
        country = "",
        state = "",
        city = "",
        sortBy = "createdAt",
        sortOrder = "desc",
    } = req.query;

    // --------------------------------------------------
    // 1. Pagination
    // --------------------------------------------------
    const currentPage = Math.max(1, Number(page) || 1);

    const pageLimit = Math.min(
        100,
        Math.max(1, Number(limit) || 10)
    );

    const skip = (currentPage - 1) * pageLimit;

    // --------------------------------------------------
    // 2. Sorting
    // --------------------------------------------------
    const allowedSortFields = [
        "createdAt",
        "updatedAt",
        "name",
        "industry",
        "foundedYear",
    ];

    const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "createdAt";

    const sortDirection =
        String(sortOrder).trim().toLowerCase() === "asc" ? 1 : -1;

    // --------------------------------------------------
    // 3. Helpers
    // --------------------------------------------------
    const escapeRegex = (value) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const filter = {};
    const andConditions = [];

    const normalizedStatus = String(status ?? "all")
        .trim()
        .toLowerCase();

    const normalizedBlocked = String(blocked ?? "all")
        .trim()
        .toLowerCase();

    const normalizedDeleted = String(deleted ?? "all")
        .trim()
        .toLowerCase();

    const normalizedVerificationInput = String(
        verificationStatus ?? ""
    )
        .trim()
        .toLowerCase();

    // --------------------------------------------------
    // 4. Search filter
    // --------------------------------------------------
    const searchText = String(search ?? "").trim();

    if (searchText) {
        const searchRegex = new RegExp(escapeRegex(searchText), "i");

        andConditions.push({
            $or: [
                { name: searchRegex },
                { description: searchRegex },
                { industry: searchRegex },
                { slug: searchRegex },
            ],
        });
    }

    // --------------------------------------------------
    // 5. Deleted filter
    // --------------------------------------------------
    const deletedCondition = {
        $or: [
            { isDeleted: true },
            { deletedAt: { $ne: null } },
        ],
    };

    const notDeletedCondition = {
        isDeleted: { $ne: true },
        deletedAt: null,
    };

    if (normalizedDeleted === "true") {
        andConditions.push(deletedCondition);
    } else if (normalizedDeleted === "false") {
        andConditions.push(notDeletedCondition);
    } else if (normalizedDeleted !== "all") {
        throw new ApiError(
            400,
            "Invalid deleted filter. Use true, false, or all."
        );
    }

    // --------------------------------------------------
    // 6. Company account status filter
    // --------------------------------------------------
    const allowedStatuses = [
        "all",
        "pending",
        "verified",
        "rejected",
        "blocked",
        "unblocked",
        "active",
        "deleted",
    ];

    if (!allowedStatuses.includes(normalizedStatus)) {
        throw new ApiError(400, "Invalid company status");
    }

    if (normalizedStatus === "deleted") {
        andConditions.push(deletedCondition);
    }

    if (normalizedStatus === "blocked") {
        andConditions.push(
            { isBlocked: true },
            notDeletedCondition
        );
    }

    if (
        normalizedStatus === "unblocked" ||
        normalizedStatus === "active"
    ) {
        andConditions.push(
            { isBlocked: { $ne: true } },
            notDeletedCondition
        );
    }

    // --------------------------------------------------
    // 7. Verification status filter
    // FIX: "all" must not be treated as an invalid status.
    // --------------------------------------------------
    const allowedVerificationStatuses = [
        "pending",
        "verified",
        "rejected",
    ];

    const selectedVerificationStatus =
        normalizedVerificationInput &&
        normalizedVerificationInput !== "all"
            ? normalizedVerificationInput
            : allowedVerificationStatuses.includes(normalizedStatus)
                ? normalizedStatus
                : undefined;

    if (selectedVerificationStatus) {
        if (
            !allowedVerificationStatuses.includes(
                selectedVerificationStatus
            )
        ) {
            throw new ApiError(
                400,
                "Invalid verification status. Use pending, verified, rejected, or all."
            );
        }

        andConditions.push({
            verificationStatus: selectedVerificationStatus,
        });
    }

    // --------------------------------------------------
    // 8. Blocked filter
    // --------------------------------------------------
    if (normalizedBlocked === "true") {
        andConditions.push({ isBlocked: true });
    } else if (normalizedBlocked === "false") {
        andConditions.push({ isBlocked: { $ne: true } });
    } else if (normalizedBlocked !== "all") {
        throw new ApiError(
            400,
            "Invalid blocked filter. Use true, false, or all."
        );
    }

    // --------------------------------------------------
    // 9. Industry filter
    // --------------------------------------------------
    const normalizedIndustry = String(industry ?? "").trim();

    if (normalizedIndustry) {
        andConditions.push({
            industry: {
                $regex: `^${escapeRegex(normalizedIndustry)}$`,
                $options: "i",
            },
        });
    }

    // --------------------------------------------------
    // 10. Company size filter
    // --------------------------------------------------
    const normalizedCompanySize = String(companySize ?? "").trim();

    if (
        normalizedCompanySize &&
        normalizedCompanySize.toLowerCase() !== "all"
    ) {
        const allowedSizes = [
            "1-10",
            "11-50",
            "51-200",
            "201-500",
            "501-1000",
            "1001-5000",
            "5001-10000",
        ];

        if (!allowedSizes.includes(normalizedCompanySize)) {
            throw new ApiError(400, "Invalid company size");
        }

        andConditions.push({
            companySize: normalizedCompanySize,
        });
    }

    // --------------------------------------------------
    // 11. Headquarters filters
    // --------------------------------------------------
    const locationFilters = [
        ["country", country],
        ["state", state],
        ["city", city],
    ];

    for (const [field, value] of locationFilters) {
        const normalizedValue = String(value ?? "").trim();

        if (normalizedValue) {
            andConditions.push({
                [`headquarters.${field}`]: {
                    $regex: `^${escapeRegex(normalizedValue)}$`,
                    $options: "i",
                },
            });
        }
    }

    // --------------------------------------------------
    // 12. Build MongoDB query
    // --------------------------------------------------
    if (andConditions.length > 0) {
        filter.$and = andConditions;
    }

    // --------------------------------------------------
    // 13. Fetch companies and matching count
    // --------------------------------------------------
    const [companies, totalCompanies] = await Promise.all([
        Company.find(filter)
            .populate("recruiters.recruiterId", "name email phoneNo")
            .sort({
                [sortField]: sortDirection,
                _id: -1,
            })
            .skip(skip)
            .limit(pageLimit)
            .lean(),

        Company.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCompanies / pageLimit);

    // --------------------------------------------------
    // 14. Response
    // --------------------------------------------------
    return res.status(200).json(
        new ApiResponse(
            200,
            {
                companies,
                pagination: {
                    currentPage,
                    limit: pageLimit,
                    totalCompanies,
                    totalPages,
                    hasNextPage: currentPage < totalPages,
                    hasPrevPage: currentPage > 1,
                },
                filters: {
                    search: searchText,
                    status: normalizedStatus,
                    verificationStatus:
                        selectedVerificationStatus || "all",
                    blocked: normalizedBlocked,
                    deleted: normalizedDeleted,
                    industry: normalizedIndustry,
                    companySize: normalizedCompanySize,
                    country: String(country ?? "").trim(),
                    state: String(state ?? "").trim(),
                    city: String(city ?? "").trim(),
                    sortBy: sortField,
                    sortOrder:
                        sortDirection === 1 ? "asc" : "desc",
                },
            },
            "Companies fetched successfully"
        )
    );
});

const getCompanyById = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    if (!mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid company ID");
    }

    const company = await Company.findOne({
        _id: companyId,
    }).populate(
        "recruiters.recruiterId",
        "name email phoneNo"
    );

    if (!company) {
        throw new ApiError(
            404,
            "Company not found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company fetched successfully"
        )
    );
});

const verifyCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false,
    });

    if (!company) {
        throw new ApiError(404, "Company not found");
    }

    if (company.isBlocked) {
        throw new ApiError(
            400,
            "Unblock the company before verifying it"
        );
    }

    if (company.verificationStatus === "verified") {
        throw new ApiError(
            400,
            "Company is already verified"
        );
    }

    company.isVerified = true;
    company.verificationStatus = "verified";

    await company.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company verified successfully"
        )
    );
});

const rejectCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false,
    });

    if (!company) {
        throw new ApiError(404, "Company not found");
    }

    if (company.verificationStatus === "rejected") {
        throw new ApiError(
            400,
            "Company verification is already rejected"
        );
    }

    if (company.verificationStatus === "verified") {
        throw new ApiError(
            400,
            "Company is already verified"
        );
    }

    company.isVerified = false;
    company.verificationStatus = "rejected";

    await company.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company verification request rejected successfully"
        )
    );
});

const blockCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false,
    });

    if (!company) {
        throw new ApiError(
            404,
            "Company not found"
        );
    }

    if (company.isBlocked) {
        throw new ApiError(
            400,
            "Company is already blocked"
        );
    }

    company.isBlocked = true;

    await company.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company blocked successfully"
        )
    );
});

const softDeleteCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    if (!mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid company ID");
    }

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: { $ne: true },
        deletedAt: null,
    });

    if (!company) {
        throw new ApiError(
            404,
            "Company not found or already deleted"
        );
    }

    company.isDeleted = true;
    company.deletedAt = new Date();

    await company.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company soft deleted successfully"
        )
    );
});

const restoreCompany = asyncHandler(async (req, res) => {
    const {companyId} = req.params;

    if(!companyId || !mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid companyId");
    }

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: true,
    });

    if(!company) {
        throw new ApiError(404, "Company not found or not deleted");
    }

    company.isDeleted = false;
    company.deletedAt = null;
    await company.save();

    return res.status(200).json(
        new ApiResponse(200, company, "Company Restore Successfully")
    )
})

const unblockCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false,
    });

    if (!company) {
        throw new ApiError(
            404,
            "Company not found"
        );
    }

    if (!company.isBlocked) {
        throw new ApiError(
            400,
            "Company is not blocked"
        );
    }

    company.isBlocked = false;

    await company.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company unblocked successfully"
        )
    );
});

const updateUserStatus = asyncHandler(async (req, res) => {

    const { userId } = req.params;
    const { status } = req.body;

    // Validate user ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new ApiError(400, "Invalid user ID");
    }

    // Validate status
    if (!["active", "blocked"].includes(status)) {
        throw new ApiError(
            400,
            "Status must be either active or blocked"
        );
    }

    // Find user
    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Check if status is already the same
    if (user.status === status) {
        throw new ApiError(
            400,
            `User is already ${status}`
        );
    }

    // Update status
    user.status = status;

    // If suspending the user, invalidate existing tokens
    if (status === "blocked") {
        user.tokenVersion += 1;
        user.isOnline = false;
        user.lastSeen = new Date();
        user.lastSeen = new Date();
    }

    await user.save();

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                {
                    userId: user._id,
                    status: user.status
                },
                "User status updated successfully"
            )
        );
});

const blockJob = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    throw new ApiError(400, "Invalid job ID");
  }

  const job = await Job.findById(jobId);

  if (!job) {
    throw new ApiError(404, "Job not found");
  }

  if (job.isBlocked) {
    throw new ApiError(400, "Job is already blocked");
  }

  job.isBlocked = true;

  await job.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        jobId: job._id,
        isBlocked: job.isBlocked,
      },
      "Job blocked successfully"
    )
  );
});

const unlockJob = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    throw new ApiError(400, "Invalid job ID");
  }

  const job = await Job.findById(jobId);

  if (!job) {
    throw new ApiError(404, "Job not found");
  }

  if (job.isBlocked !== true) {
    throw new ApiError(400, "Job is not blocked");
  }

  job.isBlocked = false;

  await job.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      job,
      "Job unlocked successfully"
    )
  );
});

const deleteJob = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    throw new ApiError(400, "Invalid job ID");
  }

  const job = await Job.findByIdAndDelete(jobId);

  if (!job) {
    throw new ApiError(404, "Job not found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      { jobId: job._id },
      "Job deleted successfully"
    )
  );
});

const getAllJobs = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        search,
        status,
        isBlocked
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);
    const limitNumber = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const query = {};

    // Search
    if (search?.trim()) {
        query.$or = [
            {
                title: {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                description: {
                    $regex: search.trim(),
                    $options: "i"
                }
            }
        ];
    }

    // Status filter
    if (status) {
        query.status = status;
    }

    // Block filter
    if (isBlocked !== undefined) {
        query.isBlocked = isBlocked === "true";
    }

    const [jobs, totalJobs] = await Promise.all([
        Job.find(query)
            .populate("companyId")
            .populate("recruiterId", "name email")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNumber),

        Job.countDocuments(query)
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                jobs,
                pagination: {
                    currentPage: pageNumber,
                    totalPages: Math.ceil(
                        totalJobs / limitNumber
                    ),
                    totalJobs,
                    limit: limitNumber
                }
            },
            "Jobs fetched successfully"
        )
    );
});

const getJobById = asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
        throw new ApiError(400, "Invalid job ID");
    }

    const job = await Job.findById(jobId)
        .populate("companyId").populate("recruiterId" , "name email");

    if (!job) {
        throw new ApiError(404, "Job not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                job
            },
            "Job fetched successfully"
        )
    );
});

const updateAdminAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar File Required");
    }

    const admin = await Admin.findOne({
        singletonKey: "PEER_HIRING_OWNER",
    });

    if (!admin) {
        throw new ApiError(404, "Admin Not Found");
    }

    if (!admin.isActive) {
        throw new ApiError(403, "Admin Account Is Inactive");
    }

    const uploadAvatar = await uploadOnCloudinary(avatarLocalPath);

    if (!uploadAvatar?.secure_url || !uploadAvatar?.public_id) {
        throw new ApiError(500, "Failed To Upload Admin Avatar");
    }

    // Delete old avatar after the new upload succeeds
    const oldAvatarPublicId = admin.avatar?.public_id;

    admin.avatar = {
        url: uploadAvatar.secure_url,
        public_id: uploadAvatar.public_id,
    };

    await admin.save();

    // Clean up old Cloudinary image
    if (oldAvatarPublicId) {
        try {
            await cloudinary.uploader.destroy(oldAvatarPublicId);
        } catch (error) {
            console.error("Failed to delete old admin avatar:", error);
        }
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                avatar: admin.avatar,
            },
            "Admin Avatar Updated Successfully"
        )
    );
});


const getAdminProfile = asyncHandler(async (req, res) => {
  const admin = req.admin;

  if (!admin) {
    throw new ApiError(401, "Admin authentication required");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        admin: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          avatar: admin.avatar,
          isActive: admin.isActive,
          lastLoginAt: admin.lastLoginAt,
          createdAt: admin.createdAt,
        },
      },
      "Admin Profile Fetched Successfully"
    )
  );
});

const ACCESS_TOKEN_DURATION = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
};

const clearAuthCookies = (res) => {
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);
};

const adminLogout = asyncHandler(async (req, res) => {
  const admin = req.admin;

  if (!admin) {
    throw new ApiError(401, "Admin authentication required.");
  }

  await Admin.updateOne(
    {
      _id: admin._id,
      tokenVersion: admin.tokenVersion,
    },
    {
      $set: {
        refreshToken: "",
        refreshTokenExpiresAt: null,
      },
      $inc: {
        tokenVersion: 1,
      },
    }
  );

  clearAuthCookies(res);

  return res.status(200).json(
    new ApiResponse(200, {}, "Admin logged out successfully.")
  );
});

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const refreshAdminAccessToken = asyncHandler(
  async (req, res) => {
    const incomingRefreshToken =
      req.cookies?.refreshToken;

    if (!incomingRefreshToken) {
      throw new ApiError(
        401,
        "Admin refresh token is missing. Please log in again."
      );
    }

    let decodedToken;

    try {
      decodedToken = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET
      );
    } catch {
      throw new ApiError(
        401,
        "Admin refresh token is invalid or expired. Please log in again."
      );
    }

    // Ensure this is an admin refresh token.
    if (
      decodedToken.type !== "admin" ||
      !decodedToken.adminId
    ) {
      throw new ApiError(
        401,
        "Invalid admin refresh token"
      );
    }

    // Load the admin and explicitly select the hidden hash.
    const admin = await Admin.findById(
      decodedToken.adminId
    ).select("+refreshToken");

    if (!admin || !admin.isActive) {
      throw new ApiError(
        401,
        "Admin account is unavailable. Please log in again."
      );
    }

    const incomingHash =
      hashRefreshToken(incomingRefreshToken);

    const storedHash = admin.refreshToken || "";

    // Compare the stored hash with the presented token's hash.
    const hashesMatch =
      storedHash.length === incomingHash.length &&
      storedHash.length > 0 &&
      crypto.timingSafeEqual(
        Buffer.from(storedHash, "hex"),
        Buffer.from(incomingHash, "hex")
      );

    if (
      !hashesMatch ||
      !admin.refreshTokenExpiresAt ||
      admin.refreshTokenExpiresAt <= new Date()
    ) {
      throw new ApiError(
        401,
        "Admin refresh session is invalid or expired. Please log in again."
      );
    }

    // Rotate both tokens.
    const newAccessToken = jwt.sign(
      {
        adminId: admin._id.toString(),
        type: "admin",
      },
      process.env.ACCESS_TOKEN_SECRET,
      {
        expiresIn:
          process.env.ACCESS_TOKEN_EXPIRY || "15m",
      }
    );

    const newRefreshToken = jwt.sign(
      {
        adminId: admin._id.toString(),
        type: "admin",
      },
      process.env.REFRESH_TOKEN_SECRET,
      {
        expiresIn:
          process.env.REFRESH_TOKEN_EXPIRY || "30d",
      }
    );

    // Store the new hash, never the raw refresh token.
    admin.refreshToken = hashRefreshToken(
      newRefreshToken
    );

    admin.refreshTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_DURATION
    );

    await admin.save({ validateBeforeSave: false });

    setAuthCookies(
      res,
      newAccessToken,
      newRefreshToken
    );

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          admin: {
            _id: admin._id,
            name: admin.name,
            email: admin.email,
            avatar: admin.avatar,
            isActive: admin.isActive,
            lastLoginAt: admin.lastLoginAt,
          },
          type: "admin",
        },
        "Admin session refreshed successfully"
      )
    );
  }
);


export {
    getAdminDashboardStats,
    getAllUsers,
    adminLogout,
    verifyCompany,
    rejectCompany,
    blockCompany,
    refreshAdminAccessToken,
    getCompanyById,
    getAllAdminCompanies,
    getUserById,
    blockUser,
    unblockUser,
    deleteUser,
    updateUserStatus,
    blockJob,
    deleteJob,
    getAllJobs,
    getJobById,
    unlockJob,
    unblockCompany,
    softDeleteCompany,
    updateAdminAvatar,
    getAdminProfile,
    restoreCompany
};