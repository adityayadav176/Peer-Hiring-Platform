
import { Session } from "../models/session.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";

export const verifyUser = asyncHandler(async (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    req.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    throw new ApiError(401, "Unauthorized Access Denied");
  }

  const decodedToken = jwt.verify(
    token,
    process.env.ACCESS_TOKEN_SECRET
  );

  // Reject admin tokens and tokens without required claims.
  if (
    decodedToken.type === "admin" ||
    decodedToken.role === "admin" ||
    !decodedToken._id ||
    !decodedToken.sessionId ||
    decodedToken.tokenVersion === undefined
  ) {
    throw new ApiError(401, "Invalid user access token");
  }

  const user = await User.findById(decodedToken._id);

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  if (user.accountStatus === "blocked") {
    throw new ApiError(403, "Your account has been blocked");
  }

  if (decodedToken.tokenVersion !== user.tokenVersion) {
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  const session = await Session.findOne({
    _id: decodedToken.sessionId,
    userId: user._id,
    isActive: true,
  });

  if (!session) {
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  req.user = user;
  req.session = session;
  req.sessionId = session._id;

  next();
});
