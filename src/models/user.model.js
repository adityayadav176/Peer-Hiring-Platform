
import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const UserSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            maxlength: 254,
        },

        coverImage: {
            url: { type: String, default: "" },
            public_id: { type: String, default: "" },
        },

        googleId: {
            type: String,
            unique: true,
            sparse: true,
        },

        githubId: {
            type: String,
            unique: true,
            sparse: true,
        },

        facebookId: {
            type: String,
            unique: true,
            sparse: true,
        },

        password: {
            type: String,
            minlength: 8,
            maxlength: 100,
            select: false,
            validate: {
                validator(value) {
                    // Allow passwordless OAuth accounts.
                    // For local accounts, enforce this in signup too.
                    return (
                        value == null ||
                        Buffer.byteLength(value, "utf8") <= 72
                    );
                },
                message: "Password must not exceed 72 UTF-8 bytes for bcrypt.",
            },
        },

        avatar: {
            url: { type: String, default: "" },
            public_id: { type: String, default: "" },
        },

        // Optional: omit this field if no phone number is provided.
        phoneNo: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            default: undefined,
        },

        role: {
            type: String,
            enum: ["User", "recruiter"],
            default: "User",
            required: true,
        },

        isVerified: {
            type: Boolean,
            default: false,
            required: true,
        },

        failedLoginAttempts: {
            type: Number,
            default: 0,
            min: 0,
        },

        emailVerificationOTP: {
            type: String,
            default: "",
            select: false,
        },

        emailVerificationOTPExpiry: {
            type: Date,
            select: false,
        },

        forgetPasswordOtp: {
            type: String,
            default: "",
            select: false,
        },

        forgetPasswordOtpExpiredAt: {
            type: Date,
            select: false,
        },

        passwordResetToken: {
            type: String,
            select: false,
        },

        passwordResetTokenExpiresAt: {
            type: Date,
            select: false,
        },

        deleteAccountOtp: {
            type: String,
            default: "",
            select: false,
        },

        deleteAccountOtpExpiredAt: {
            type: Date,
            select: false,
        },

        lockUntil: {
            type: Date,
            default: null,
        },

        accountStatus: {
            type: String,
            enum: ["active", "blocked"],
            default: "active",
            required: true,
        },

        refreshToken: {
            type: String,
            select: false,
        },

        twoFactorEnabled: {
            type: Boolean,
            default: false,
        },

        twoFactorSecret: {
            type: String,
            select: false,
        },

        tokenVersion: {
            type: Number,
            default: 0,
            min: 0,
        },

        isOnline: {
            type: Boolean,
            default: false,
        },

        lastSeen: {
            type: Date,
            default: null,
        },

        lastSeenAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Hash passwords only when they are created or changed.
UserSchema.pre("save", async function () {
    if (!this.isModified("password") || !this.password) {
        return;
    }

    if (Buffer.byteLength(this.password, "utf8") > 72) {
        throw new Error("Password exceeds bcrypt's 72-byte limit.");
    }

    this.password = await bcrypt.hash(this.password, 10);
});

// Compare the candidate password with the stored hash.
UserSchema.methods.isPasswordCorrect = async function (password) {
    if (!this.password || typeof password !== "string") {
        return false;
    }

    return bcrypt.compare(password, this.password);
};

// Generate a short-lived access token.
UserSchema.methods.generateAccessToken = function (sessionId) {
    if (!process.env.ACCESS_TOKEN_SECRET) {
        throw new Error("ACCESS_TOKEN_SECRET is not configured.");
    }

    if (!sessionId) {
        throw new Error("sessionId is required.");
    }

    return jwt.sign(
        {
            _id: this._id.toString(),
            sessionId,
            tokenVersion: this.tokenVersion,
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
        }
    );
};

// Generate a refresh token.
UserSchema.methods.generateRefreshToken = function (sessionId) {
    if (!process.env.REFRESH_TOKEN_SECRET) {
        throw new Error("REFRESH_TOKEN_SECRET is not configured.");
    }

    if (!sessionId) {
        throw new Error("sessionId is required.");
    }

    return jwt.sign(
        {
            _id: this._id.toString(),
            sessionId,
            tokenVersion: this.tokenVersion,
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "30d",
        }
    );
};

export const User =
    mongoose.models.User ||
    mongoose.model("User", UserSchema);
