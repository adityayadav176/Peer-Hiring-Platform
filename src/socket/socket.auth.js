import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { User } from "../models/user.model.js";
import { Session } from "../models/session.model.js";

export const socketAuth = async (socket, next) => {
  try {
    // 1. Ensure JWT configuration exists.
    const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;

    if (!accessTokenSecret) {
      console.error(
        "[Socket Auth] ACCESS_TOKEN_SECRET is not configured."
      );

      return next(new Error("Socket authentication is unavailable."));
    }

    // 2. Read the HTTP-only accessToken cookie.
    const cookieHeader = socket.handshake.headers.cookie || "";

    const token = cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith("accessToken="))
      ?.slice("accessToken=".length);

    if (!token) {
      return next(new Error("Unauthorized: access token missing."));
    }

    // Decode cookie value safely in case it is URL-encoded.
    let accessToken;

    try {
      accessToken = decodeURIComponent(token);
    } catch {
      return next(new Error("Invalid access token cookie."));
    }

    if (!accessToken) {
      return next(new Error("Unauthorized: access token missing."));
    }

    // 3. Verify the access token.
    const decodedToken = jwt.verify(
      accessToken,
      accessTokenSecret
    );

    // 4. Validate the claims issued by User.generateAccessToken().
    if (
      !decodedToken ||
      typeof decodedToken !== "object" ||
      typeof decodedToken._id !== "string" ||
      !mongoose.isValidObjectId(decodedToken._id) ||
      typeof decodedToken.sessionId !== "string" ||
      !mongoose.isValidObjectId(decodedToken.sessionId) ||
      !Number.isInteger(decodedToken.tokenVersion) ||
      decodedToken.tokenVersion < 0
    ) {
      return next(new Error("Invalid user access token."));
    }

    // 5. Load the user.
    const user = await User.findById(decodedToken._id).select(
      "-password -refreshToken -twoFactorSecret"
    );

    if (!user) {
      return next(new Error("User not found."));
    }

    // 6. Reject blocked accounts.
    if (user.accountStatus !== "active") {
      return next(new Error("Your account is not active."));
    }

    // 7. Check whether the token has been invalidated.
    if (decodedToken.tokenVersion !== user.tokenVersion) {
      return next(
        new Error("Session expired. Please log in again.")
      );
    }

    // 8. Validate the active session against your Session schema.
    const session = await Session.findOne({
      _id: decodedToken.sessionId,
      userId: user._id,
      isActive: true,
    }).select("_id userId isActive");

    if (!session) {
      return next(
        new Error("Session expired. Please log in again.")
      );
    }

    // 9. Attach identity consistently for Socket.IO handlers.
    socket.user = user;
    socket.userId = user._id.toString();

    // Preserve these aliases if existing handlers use them.
    socket._session = session;
    socket._sessionId = session._id.toString();

    // Also expose non-underscored aliases for newer handlers.
    socket.session = session;
    socket.sessionId = session._id.toString();

    console.log("[Socket Auth] Authenticated:", {
      socketId: socket.id,
      userId: socket.userId,
      role: user.role,
    });

    return next();
  } catch (error) {
    console.error(
      "[Socket Auth] Authentication failed:",
      error.message
    );

    if (error.name === "TokenExpiredError") {
      return next(
        new Error("Access token expired. Please log in again.")
      );
    }

    if (error.name === "JsonWebTokenError") {
      return next(new Error("Invalid access token."));
    }

    return next(new Error("Socket authentication failed."));
  }
};