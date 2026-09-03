import { Application } from "../models/application.model.js";
import { Company } from "../models/company.model.js";
import { Interview } from "../models/interview.model.js";
import { Job } from "../models/job.model.js";
import { User } from "../models/user.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";


const getAdminDashboardStats = asyncHandler(async (req, res) => {

    const [
        totalUsers,
        totalCandidates,
        totalRecruiters,
        totalCompanies,
        verifiedCompany,
        totalJobs,
        activeJobs,
        totalApplications,
        totalInterviews
    ] = await Promise.all([

        // Users
        User.countDocuments(),

        User.countDocuments({
            role: "User"
        }),

        User.countDocuments({
            role: "recruiter"
        }),

        // Companies
        Company.countDocuments(),

        Company.countDocuments({
            isVerified: true
        }),

        // Jobs
        Job.countDocuments(),

        Job.countDocuments({
            status: "OPEN"
        }),

        // Applications
        Application.countDocuments(),

        // Interviews
        Interview.countDocuments()
    ]);


    // ==============================
    // APPLICATION STATISTICS
    // ==============================

    const applicationStats = await Application.aggregate([
        {
            $group: {
                _id: "$status",
                count: {
                    $sum: 1
                }
            }
        }
    ]);


    const applications = {};

    applicationStats.forEach(item => {
        applications[item._id] = item.count;
    });

    const interviewStats = await Interview.aggregate([
        {
            $group: {
                _id: "$status",
                count: {
                    $sum: 1
                }
            }
        }
    ]);


    const interviews = {};

    interviewStats.forEach(item => {
        interviews[item._id] = item.count;
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                users: {
                    total: totalUsers,
                    candidates: totalCandidates,
                    recruiters: totalRecruiters
                },

                companies: {
                    total: totalCompanies,
                    verified: verifiedCompany
                },

                jobs: {
                    total: totalJobs,
                    active: activeJobs
                },

                applications: {
                    total: totalApplications,
                    ...applications
                },

                interviews: {
                    total: totalInterviews,
                    ...interviews
                }
            },
            "Admin dashboard statistics fetched successfully"
        )
    );
});

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


export {
    getAdminDashboardStats,
    getAllUsers
};