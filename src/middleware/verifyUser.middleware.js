import { Session } from "../models/session.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";

const isValidObjectId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export const verifyUser = asyncHandler(async (req, res, next) => {
  const bearerMatch = req
    .get("Authorization")
    ?.match(/^Bearer\s+([^\s]+)$/i);

  const token = req.cookies?.accessToken || bearerMatch?.[1];

  if (!token) {
    throw new ApiError(401, "Authentication required.");
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
    decodedToken.type === "admin" ||
    decodedToken.role === "admin" ||
    !isValidObjectId(decodedToken._id) ||
    !isValidObjectId(decodedToken.sessionId) ||
    !Number.isSafeInteger(decodedToken.tokenVersion) ||
    decodedToken.tokenVersion < 0
  ) {
    throw new ApiError(401, "Invalid user access token.");
  }

  const user = await User.findById(decodedToken._id);

  if (!user) {
    throw new ApiError(401, "User account not found.");
  }

  if (user.accountStatus !== "active") {
    throw new ApiError(403, "Your account is blocked or inactive.");
  }

  if (decodedToken.tokenVersion !== user.tokenVersion) {
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  const session = await Session.findOne({
    _id: decodedToken.sessionId,
    userId: user._id,
    isActive: true,
  }).select("_id userId isActive");

  if (!session) {
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  req.user = user;
  req.session = session;
  req.sessionId = session._id;

  return next();
});