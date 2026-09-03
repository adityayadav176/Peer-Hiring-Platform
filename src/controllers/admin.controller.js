import { Application } from "../models/application.model.js";
import { Company } from "../models/company.model.js";
import { Interview } from "../models/interview.model.js";
import { Job } from "../models/job.model.js";
import { User } from "../models/user.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

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
        totalApplications,
        totalInterviews
    ] = await Promise.all([

        User.countDocuments(),

        User.countDocuments({role: "User"}),

        User.countDocuments({role: "recruiter"}),

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
                    draft: draftJobs
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

export {
    getAdminDashboardStats,
    getAllUsers,
    verifyCompany,
    rejectCompany,
    blockCompany,
    getCompanyById,
    getAllAdminCompanies
};