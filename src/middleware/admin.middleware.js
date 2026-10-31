import jwt from "jsonwebtoken";
import Admin from "../models/admin.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const isValidObjectId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export const adminAuth = asyncHandler(async (req, res, next) => {
  const bearerMatch = req
    .get("Authorization")
    ?.match(/^Bearer\s+([^\s]+)$/i);

  const token =
    req.cookies?.accessToken || bearerMatch?.[1];

  if (!token) {
    throw new ApiError(401, "Admin authentication required.");
  }

  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!secret) {
    throw new ApiError(500, "Authentication is not configured.");
  }

  let decodedToken;

  try {
    decodedToken = jwt.verify(token, secret, {
      algorithms: ["HS256"],
    });
  } catch {
    throw new ApiError(401, "Invalid or expired access token.");
  }

  if (
    !decodedToken ||
    typeof decodedToken !== "object" ||
    decodedToken.type !== "admin" ||
    !isValidObjectId(decodedToken.adminId) ||
    !Number.isSafeInteger(decodedToken.tokenVersion) ||
    decodedToken.tokenVersion < 0
  ) {
    throw new ApiError(403, "Invalid admin access token.");
  }

  const admin = await Admin.findById(decodedToken.adminId);

  if (!admin) {
    throw new ApiError(401, "Admin account not found.");
  }

  if (admin.isActive !== true) {
    throw new ApiError(403, "Admin account is inactive.");
  }

  // Validate access-token version to support immediate revocation.
  if (decodedToken.tokenVersion !== admin.tokenVersion) {
    throw new ApiError(
      401,
      "Admin session expired. Please log in again."
    );
  }

  req.admin = admin;

  return next();
});