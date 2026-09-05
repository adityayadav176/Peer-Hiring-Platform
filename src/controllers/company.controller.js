import mongoose from "mongoose";
import { Company } from "../models/company.model.js";
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import slugify from "slugify";

const createCompany = asyncHandler(async (req, res) => {
    const recruiterId = req.user?._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Unauthorized");
    }

    const {
        name,
        description,
        industry,
        companySize,
        foundedYear,
        headquarters,
        socialLinks,
    } = req.body;

    if (!name.trim()) {
        throw new ApiError(400, "Company name is required");
    }

    let slug = slugify(name, {
        lower: true,
        strict: true,
        trim: true,
    })

    let finalSlug = slug;
    let count = 1;

    while (await Company.exists({ slug: finalSlug })) {
        finalSlug = `${slug}-${count++}`;
    }

    const company = await Company.create({
        name: name.trim(),
        slug: finalSlug,
        description,
        industry,
        companySize,
        foundedYear,
        headquarters,
        socialLinks,

        recruiters: [
            {
                recruiterId,
                role: "OWNER",
            },
        ],
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            company,
            "Company created successfully"
        )
    );
});

const getCompanyById = asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const recruiterId = req.user?._id;

    if (!companyId || !mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid Company ID");
    }

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Unauthorized");
    }

    const company = await Company.findOne({
        _id: companyId,
        "recruiters.recruiterId": recruiterId,
    });

    if (!company) {
        throw new ApiError(
            404,
            "Company not found or you are not authorized to access it."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company fetched successfully."
        )
    );
});

const getAllCompanies = asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    if (page < 1 || limit < 1) {
        throw new ApiError(400, "Invalid page or limit");
    }

    const skip = (page - 1) * limit;

    const {
        keyword,
        industry,
        companySize,
        city,
        verified,
        sortBy = "createdAt",
        order = "desc",
    } = req.query;

    const filter = {
        isDeleted: false,
    };

    if (keyword) {
        filter.$text = {
            $search: keyword,
        };
    }

    if (industry) {
        filter.industry = industry;
    }

    if (companySize) {
        filter.companySize = companySize;
    }

    if (city) {
        filter["headquarters.city"] = {
            $regex: city,
            $options: "i",
        };
    }

    if (verified !== undefined) {
        filter.isVerified = verified === "true";
    }

    const sort = {
        [sortBy]: order === "asc" ? 1 : -1,
    };

    const [companies, totalCompanies] = await Promise.all([
        Company.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit),

        Company.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCompanies / limit);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                companies,
                pagination: {
                    page,
                    limit,
                    totalCompanies,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            },
            "Companies fetched successfully."
        )
    );
});

const updateCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;

    if (!companyId || !mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid CompanyId");
    }

    const { name, description, industry, companySize, foundedYear, headquarters } = req.body;

    const updateDate = {}

    if (name !== undefined) updateDate.name = name;
    if (description !== undefined) updateDate.description = description;
    if (industry !== undefined) updateDate.industry = industry;
    if (companySize !== undefined) updateDate.companySize = companySize;
    if (foundedYear !== undefined) updateDate.foundedYear = foundedYear;
    if (headquarters !== undefined) updateDate.headquarters = headquarters;

    if (Object.keys(updateDate).length === 0) {
        throw new ApiError(400, "No fields provided for update.");
    }

    const company = await Company.findByIdAndUpdate(
        companyId,
        {
            $set: updateDate
        },
        {
            new: true,
            runValidators: true
        }
    )

    if (!company) {
        throw new ApiError(404, "Company Not Found Or Company Detail Not Updated");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, company, "Company Detail Updated Successfully")
        )
})

const deleteCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const recruiterId = req.user._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!companyId || !mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid Company ID");
    }

    const company = await Company.findOneAndUpdate(
        {
            _id: companyId,
            isDeleted: false,
        },
        {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
            }
        },
        {
            new: true,
            runValidators: true
        }
    );

    if (!company) {
        throw new ApiError(
            404,
            "Company not found or you are not authorized to delete it."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company deleted successfully."
        )
    );
});

const permanentDeleteCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const recruiterId = req.user._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!companyId || !mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid Company ID");
    }

    const company = await Company.findOneAndDelete({
        _id: companyId,
        isDeleted: true,
    });

    if (!company) {
        throw new ApiError(
            404,
            "Deleted company not found or you are not authorized to permanently delete it."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Company permanently deleted successfully."
        )
    );
});

const restoreCompany = asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const recruiterId = req.user._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!companyId || !mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid Company ID");
    }

    const company = await Company.findOneAndUpdate(
        {
            _id: companyId,
            isDeleted: true,
        },
        {
            $set: {
                isDeleted: false,
                deletedAt: null,
            }
        },
        {
            new: true,
            runValidators: true,
        }
    );

    if (!company) {
        throw new ApiError(
            404,
            "Deleted company not found or you are not authorized to restore it."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            company,
            "Company restored successfully."
        )
    );
});

export {
    createCompany,
    getCompanyById,
    getAllCompanies,
    updateCompany,
    deleteCompany,
    permanentDeleteCompany,
    restoreCompany
}