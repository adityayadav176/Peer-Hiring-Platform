import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null
        },

        refreshToken: {
            type: String,
            default: ""
        },

        device: {
            type: String,
        },

        deviceModel: {
            type: String
        },

        deviceType: {
            type: String
        },

        deviceVendor: {
            type: String,
        },

        browser: {
            type: String,
        },

        browserVersion: {
            type: String
        },

        os: {
            type: String,
        },

        osVersion: {
            type: String,
        },

        ipAddress: {
            type: String,
        },

        userAgent: {
            type: String,
        },

        lastActive: {
            type: Date,
            default: Date.now,
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

export const Session = mongoose.model("Session", sessionSchema);    