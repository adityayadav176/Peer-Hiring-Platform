import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { User } from "../models/user.model.js";
import { Session } from "../models/session.model.js";

export const socketAuth = async (socket, next) => {
    try {
        // 1. Validate JWT configuration.
        const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;

        if (!accessTokenSecret) {
            console.error(
                "[Socket Auth] ACCESS_TOKEN_SECRET is not configured."
            );

            return next(
                new Error("Socket authentication is unavailable.")
            );
        }

        // 2. Read accessToken from the HTTP-only cookie.
        const cookieHeader =
            socket.handshake.headers.cookie || "";

        const token = cookieHeader
            .split(";")
            .map((cookie) => cookie.trim())
            .find((cookie) =>
                cookie.startsWith("accessToken=")
            )
            ?.slice("accessToken=".length);

        if (!token) {
            return next(
                new Error("Unauthorized: access token missing.")
            );
        }

        let accessToken;

        try {
            accessToken = decodeURIComponent(token);
        } catch {
            return next(
                new Error("Invalid access token cookie.")
            );
        }

        if (!accessToken) {
            return next(
                new Error("Unauthorized: access token missing.")
            );
        }

        // 3. Verify JWT.
        const decodedToken = jwt.verify(
            accessToken,
            accessTokenSecret,
            {
                algorithms: ["HS256"],
            }
        );

        // 4. Validate claims against User.generateAccessToken().
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
            return next(
                new Error("Invalid user access token.")
            );
        }

        // 5. Load user.
        // IMPORTANT: tokenVersion is select:false in UserSchema.
        const user = await User.findById(decodedToken._id)
    .select("+accountStatus +tokenVersion");

        if (!user) {
            return next(new Error("User not found."));
        }

        // 6. Reject inactive accounts.
        if (user.accountStatus !== "active") {
            return next(
                new Error("Your account is not active.")
            );
        }

        // 7. Validate token version.
        if (
            decodedToken.tokenVersion !== user.tokenVersion
        ) {
            return next(
                new Error("Session expired. Please log in again.")
            );
        }

        // 8. Validate active session.
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

        // 9. Attach authenticated identity.
        socket.user = user;
        socket.userId = user._id.toString();

        socket._session = session;
        socket._sessionId = session._id.toString();

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
            return next(
                new Error("Invalid access token.")
            );
        }

        return next(
            new Error("Socket authentication failed.")
        );
    }
};