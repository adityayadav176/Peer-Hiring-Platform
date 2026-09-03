import jwt from "jsonwebtoken"
import Admin from "../models/admin.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const adminAuth = asyncHandler(async (req, res, next) => {
    const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");

    if(!token) {
        throw new ApiError(401, "Admin authentication required");
    }

    let decodedToken;

    try {
        decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (error) {
        throw new ApiError(
            401, "Invalid or expired access token"
        )
    }

    if(decodedToken.type !== "admin" || !decodedToken.adminId) {
        throw new ApiError(403, "Admin access required");
    }
    
    const admin = await Admin.findById(
        decodedToken.adminId
    ).select("-password");

    if(!admin) {
        throw new ApiError(401, "Admin account not found")
    }

    if(!admin.isActive) {
        throw new ApiError(403, "Admin account is inactive");
    }

    req.admin = admin;
    next();
});

export {
    adminAuth
}