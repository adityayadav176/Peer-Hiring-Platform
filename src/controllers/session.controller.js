
import { Session } from "../models/session.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
};

const clearAuthCookies = (res) =>
  res
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions);

const getAllSessions = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized Access Denied");
  }

  const sessions = await Session.find({
    userId,
    isActive: true,
  })
    .select("-refreshToken -userAgent -__v")
    .sort({ lastActiveAt: -1 })
    .lean();

  const formattedSessions = sessions.map((session) => ({
    sessionId: session._id,
    deviceName: session.device,
    browser: session.browser,
    browserVersion: session.browserVersion,
    os: session.os,
    osVersion: session.osVersion,
    deviceType: session.deviceType,
    ipAddress: session.ipAddress,
    lastActiveAt: session.lastActiveAt,
    createdAt: session.createdAt,
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      formattedSessions,
      sessions.length
        ? "Sessions Fetched Successfully"
        : "No Active Sessions Found"
    )
  );
});

const logoutAllDevices = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user?._id) {
    throw new ApiError(401, "Unauthorized Access Denied");
  }

  // Invalidate every session, including sessions on other devices.
  await Session.deleteMany({ userId: user._id });

  // Increment only if your access-token middleware checks tokenVersion.
  user.tokenVersion = (user.tokenVersion || 0) + 1;

  await user.save({ validateBeforeSave: false });

  return clearAuthCookies(res)
    .status(200)
    .json(
      new ApiResponse(200, {}, "Logged out from all devices")
    );
});

const logoutSpecificDevice = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user?._id;

  if (!sessionId || !userId) {
    throw new ApiError(401, "Unauthorized Access Denied");
  }

  const session = await Session.findOneAndDelete({
    _id: sessionId,
    userId,
  });

  if (!session) {
    throw new ApiError(404, "Session Not Found");
  }

  // Clear cookies only if the revoked session is the current session.
  // This assumes authentication middleware attaches the current session ID.
  const isCurrentSession =
    String(req.sessionId || req.session?._id || "") ===
    String(sessionId);

  const response = isCurrentSession ? clearAuthCookies(res) : res;

  return response.status(200).json(
    new ApiResponse(200, {}, "Device Logged Out Successfully")
  );
});

export {
  getAllSessions,
  logoutAllDevices,
  logoutSpecificDevice,
};
