import { Session } from "../models/session.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";


const getAllSessions = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const sessions = await Session.find({
        userId: userId,
        isActive: true,
    }).select("-refreshToken -userAgent -__v")
        .sort({
            lastActive: -1,
        })

    if (!sessions.length) {
        return res.status(200)
            .json(
                new ApiResponse(200, [], "No Active Sessions Found")
            )
    }

    const formattedSessions = sessions.map(session => ({
        sessionId: session._id,

        deviceName: session.device,

        browser: session.browser,

        browserVersion: session.browserVersion,

        os: session.os,

        osVersion: session.osVersion,

        deviceType: session.deviceType,

        ipAddress: session.ipAddress,

        lastActive: session.lastActive,

        createdAt: session.createdAt
    }));

    return res.status(200)
        .json(
            new ApiResponse(200, formattedSessions, "Sessions Fetched Successfully")
        )
})

const logoutAllDevices = asyncHandler(async (req, res) => {

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(
            401,
            "Unauthorized Access Denied"
        );
    }

    await Session.deleteMany({
        userId
    });

    req.user.tokenVersion += 1;

    await req.user.save({
        validateBeforeSave: false
    });

    const cookieOption = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
    };

    return res
        .status(200)
        .clearCookie(
            "accessToken",
            cookieOption
        )
        .clearCookie(
            "refreshToken",
            cookieOption
        )
        .json(
            new ApiResponse(
                200,
                {},
                "Logged out from all devices"
            )
        );
});

const logoutSpecificDevice = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user._id;

    if (!sessionId || !userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const session = await Session.findOneAndDelete({
        _id: sessionId,
        userId
    })

    if (!session) {
        throw new ApiError(404, "Session Not Found");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, {}, "Device Logged Out Successfully")
        )
})

export {
    getAllSessions,
    logoutAllDevices,
    logoutSpecificDevice
}