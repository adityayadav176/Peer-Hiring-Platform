
import jwt from "jsonwebtoken";
import Admin from "../models/admin.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const adminAuth = asyncHandler(async (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    req.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    throw new ApiError(401, "Admin authentication required");
  }

  let decodedToken;

  try {
    decodedToken = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET
    );
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }

  if (
    decodedToken.type !== "admin" ||
    !decodedToken.adminId
  ) {
    throw new ApiError(403, "Admin access required");
  }

  const admin = await Admin.findById(decodedToken.adminId);

  if (!admin) {
    throw new ApiError(401, "Admin account not found");
  }

  if (!admin.isActive) {
    throw new ApiError(403, "Admin account is inactive");
  }

  req.admin = admin;

  next();
});
