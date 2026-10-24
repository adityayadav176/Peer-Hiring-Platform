import { Company } from './../models/company.model.js';
import {ApiError} from "../utils/ApiError.js"
import {asyncHandler} from "../utils/asyncHandler.js"

export const verifyRecruiterCompany = asyncHandler(async(req, res, next) => {
    if(!req.user._id) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if(req.user.role !== "recruiter") {
        throw new ApiError(403, "Access denied. Recruiter account requried");
    }

    const company = await Company.findOne({
        "recruiters.recruiterId": req.user._id,
        isDeleted: false,
        isBlocked: false,
    }).select("_id name verificationStatus isVerified");

    if(!company) {
        throw new ApiError(404, "Company not found. Please Create company first");
    }

    if(company.isVerified !== true && company.verificationStatus !== "verified") {
        if(company.verificationStatus === "rejected") {
            throw new ApiError(403, "Your company verification was rejected. Please contact admin");
        }

        throw new ApiError(403, "Your company is pending admin verification");
    }

    req.company = company;
    next();
})