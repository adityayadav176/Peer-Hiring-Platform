import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { Session } from "../models/session.model.js";

export const socketAuth = async (socket, next) => {
    try {
        const token =
            socket.handshake.auth?.accessToken;

        if (!token) {
            return next(new Error("Unauthorized access denied"));
        }

        const decodedToken = jwt.verify(
            token,
            process.env.ACCESS_TOKEN_SECRET
        );

        const user = await User.findById(
            decodedToken._id
        ).select("-password -refreshToken");

        if (!user) {
            return next(new Error("User Not Found"));
        }

        if (decodedToken.tokenVersion !== user.tokenVersion) {
            return next(new Error("Session Expired. Login Again"));
        }

        const session = await Session.findById(
            decodedToken.sessionId
        );

        if (!session) {
            return next(new Error("Session Not Found"));
        }

        socket.user = user;
        socket.session = session;
        socket.sessionId = session._id;

        next();

    } catch (error) {
        console.error(
            "Socket authentication failed:",
            error.message
        );

        next(new Error("Socket Authentication Failed"));
    }
};