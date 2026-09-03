import { Application } from "../models/application.model.js";
import { Company } from "../models/company.model.js";
import { Interview } from "../models/interview.model.js";
import { Job } from "../models/job.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Session } from "../models/session.model.js";
import { Conversation } from "../models/converstion.model.js"
import mongoose from "mongoose";


const getAllUsers = asyncHandler(async (req, res) => {

    const {
        page = 1,
        limit = 10,
        search = "",
        role,
        status
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);

    const limitNumber = Math.min(
        Math.max(Number(limit), 1),
        100
    );

    const query = {};

    // Search by name or email
    if (search.trim()) {
        query.$or = [
            {
                name: {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                email: {
                    $regex: search.trim(),
                    $options: "i"
                }
            }
        ];
    }

    // Filter by role
    if (role) {
        query.role = role;
    }

    // Filter by status
    if (status) {
        query.status = status;
    }

    const skip = (pageNumber - 1) * limitNumber;

    const [users, totalUsers] = await Promise.all([

        User.find(query)
            .select("-password -refreshToken -otp -otpExpiredAt")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNumber)
            .lean(),

        User.countDocuments(query)

    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                data: {
                    users,
                    pagination: {
                        currentPage: pageNumber,
                        totalPages: Math.ceil(
                            totalUsers / limitNumber
                        ),
                        totalUsers,
                        limit: limitNumber
                    }
                }
            }
        )
    );
});

const getUserById = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId || !mongoose.isValidObjectId(userId)) {
        throw new ApiError(404, "Invalid UserId");
    }

    const user = await User.findById(userId)
        .select(
            "-password " +
            "-refreshToken " +
            "-emailVerificationOTP " +
            "-emailVerificationOTPExpiry " +
            "-forgetPasswordOtp " +
            "-forgetPasswordOtpExpiredAt " +
            "-passwordResetToken " +
            "-passwordResetTokenExpiresAt " +
            "-deleteAccountOtp " +
            "-deleteAccountOtpExpiredAt " +
            "-twoFactorSecret"
        );

    if(!user) {
        throw new ApiError(404, "User Not Found");
    }

    return res.status(200)
    .json(
        new ApiResponse(
            200,
            user,
            "User fetched successfully"
        )
    )
})

const blockUser = asyncHandler(async (req, res) => {
    const {userId} = req.params;
    const {duration} = req.body;

    if(!userId || !mongoose.isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid UserId");
    }

    if(!duration || !Number.isInteger(duration)) {
        throw new ApiError(400, "Duration must be a number");
    }

    const user = await User.findById(userId);

    if(!user) {
        throw new ApiError(404, "User Not Found"); 
    }

    if(user.lockUntil && user.lockUntil > new Date()) {
        throw new ApiError(400, "User already blocked");
    }

    const lockUntil = new Date(Date.now() + duration * 60 * 1000);

    user.lockUntil = lockUntil;

    user.tokenVersion += 1;

    user.isOnline = false;
    user.lastSeen = new Date();
    user.lastSeenAt = new Date();

    await user.save();

    return res.status(200)
    .json(
        new ApiResponse(
            200, 
            {
                userId: user._id,
                lockUntil: user.lockUntil
            },
            "User blocked successfully"
        )
    )
})

const unblockUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    // Validate user ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new ApiError(400, "Invalid user ID");
    }

    // Find user
    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Check if user is currently blocked
    if (!user.lockUntil || user.lockUntil <= new Date()) {
        throw new ApiError(400, "User is not currently blocked");
    }

    // Remove temporary block
    user.lockUntil = null;

    // Invalidate existing tokens
    user.tokenVersion += 1;

    await user.save();

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                {
                    userId: user._id,
                    lockUntil: user.lockUntil
                },
                "User unblocked successfully"
            )
        );
});

const deleteUser = asyncHandler(async (req, res) => {

    const { userId } = req.params;

    // Validate user ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new ApiError(400, "Invalid user ID");
    }

    // Check user exists
    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Delete profile
    await Profile.deleteMany({
        user: userId
    });

    // Delete resumes
    await Resume.deleteMany({
        user: userId
    });

    // Delete applications
    await Application.deleteMany({
        applicant: userId
    });

    // Delete interviews where user is involved
    await Interview.deleteMany({
        $or: [
            { candidate: userId },
            { interviewer: userId }
        ]
    });

    // Delete sessions
    await Session.deleteMany({
        user: userId
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
        status
    } = req.query;


    // ==============================
    // PAGINATION
    // ==============================

    const pageNumber = Math.max(Number(page), 1);

    const limitNumber = Math.min(
        Math.max(Number(limit), 1),
        100
    );

    const skip = (pageNumber - 1) * limitNumber;


    // ==============================
    // FILTER
    // ==============================

    const filter = {};


    // ==============================
    // SEARCH
    // ==============================

    if (search.trim()) {

        filter.$or = [
            {
                name: {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                slug: {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                industry: {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                description: {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                "headquarters.city": {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                "headquarters.state": {
                    $regex: search.trim(),
                    $options: "i"
                }
            },
            {
                "headquarters.country": {
                    $regex: search.trim(),
                    $options: "i"
                }
            }
        ];

    }


    // ==============================
    // STATUS FILTER
    // ==============================

    if (status === "verified") {

        filter.isVerified = true;

    } else if (status === "unverified") {

        filter.isVerified = false;

    } else if (status === "blocked") {

        filter.isDeleted = true;

    } else if (status === "active") {

        filter.isDeleted = false;

    }


    // ==============================
    // GET COMPANIES + COUNT
    // ==============================

    const [
        companies,
        totalCompanies
    ] = await Promise.all([

        Company.find(filter)
            .sort({
                createdAt: -1
            })
            .skip(skip)
            .limit(limitNumber)
            .populate(
                "recruiters.recruiterId",
                "name email phoneNo"
            )
            .lean(),

        Company.countDocuments(filter)

    ]);


    // ==============================
    // RESPONSE
    // ==============================

    return res.status(200).json(

        new ApiResponse(
            200,
            {
                companies,

                pagination: {
                    currentPage: pageNumber,

                    totalPages: Math.ceil(
                        totalCompanies / limitNumber
                    ),

                    totalCompanies,

                    limit: limitNumber,

                    hasNextPage:
                        pageNumber <
                        Math.ceil(
                            totalCompanies / limitNumber
                        ),

                    hasPreviousPage:
                        pageNumber > 1
                }
            },

            "Admin companies fetched successfully"
        )

    );

});

const getCompanyById = asyncHandler(async (req, res) => {

    const { companyId } = req.params;


    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false
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
        isDeleted: false
    });


    if (!company) {

        throw new ApiError(
            404,
            "Company not found"
        );

    }


    if (company.isVerified) {

        throw new ApiError(
            400,
            "Company is already verified"
        );

    }


    company.isVerified = true;

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
        isDeleted: false
    });


    if (!company) {

        throw new ApiError(
            404,
            "Company not found"
        );

    }


    if (!company.isVerified) {

        throw new ApiError(
            400,
            "Company is already unverified"
        );

    }


    company.isVerified = false;

    await company.save();


    return res.status(200).json(

        new ApiResponse(
            200,
            company,
            "Company verification rejected successfully"
        )

    );
});

const blockCompany = asyncHandler(async (req, res) => {

    const { companyId } = req.params;


    const company = await Company.findOne({
        _id: companyId,
        isDeleted: false
    });


    if (!company) {

        throw new ApiError(
            404,
            "Company not found"
        );

    }


    company.isDeleted = true;
    company.deletedAt = new Date();

    await company.save();


    return res.status(200).json(

        new ApiResponse(
            200,
            null,
            "Company blocked successfully"
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
        user.lastSeenAt = new Date();
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

    await job.save({
        validateBeforeSave: false
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                jobId: job._id,
                isBlocked: job.isBlocked
            },
            "Job blocked successfully"
        )
    );
});

const deleteJob = asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
        throw new ApiError(400, "Invalid job ID");
    }

    const job = await Job.findById(jobId);

    if (!job) {
        throw new ApiError(404, "Job not found");
    }

    await Job.findByIdAndDelete(jobId);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                jobId
            },
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
        .populate("companyId");

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

export {
    getAdminDashboardStats,
    getAllUsers,
    verifyCompany,
    rejectCompany,
    blockCompany,
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
    getJobById
};