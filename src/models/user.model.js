import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const PASSWORD_BCRYPT_ROUNDS = 12;

const normalizeOptionalString = (value) => {
    if (value == null) return undefined;

    const normalized = String(value).trim();

    return normalized.length > 0 ? normalized : undefined;
};

const PRIVATE_FIELDS = new Set([
    "password",
    "phoneNo",
    "googleId",
    "githubId",
    "facebookId",
    "emailVerificationOTP",
    "emailVerificationOTPExpiry",
    "forgetPasswordOtp",
    "forgetPasswordOtpExpiredAt",
    "passwordResetToken",
    "passwordResetTokenExpiresAt",
    "deleteAccountOtp",
    "deleteAccountOtpExpiredAt",
    "refreshToken",
    "twoFactorSecret",
    "twoFactorEnabled",
    "failedLoginAttempts",
    "lockUntil",
    "tokenVersion",
    "accountStatus",
    "__v",
]);

const removePrivateFields = (_doc, ret) => {
    for (const field of PRIVATE_FIELDS) {
        delete ret[field];
    }

    return ret;
};

const UserSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxLength: 100,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            maxLength: 254,
        },

        coverImage: {
            url: {
                type: String,
                default: "",
                trim: true,
            },
            public_id: {
                type: String,
                default: "",
                trim: true,
            },
        },

        googleId: {
            type: String,
            unique: true,
            sparse: true,
            select: false,
            set: normalizeOptionalString,
        },

        githubId: {
            type: String,
            unique: true,
            sparse: true,
            select: false,
            set: normalizeOptionalString,
        },

        facebookId: {
            type: String,
            unique: true,
            sparse: true,
            select: false,
            set: normalizeOptionalString,
        },

        password: {
            type: String,
            minLength: 8,
            maxLength: 100,
            select: false,

            validate: {
                validator(value) {
                    return (
                        value == null ||
                        Buffer.byteLength(value, "utf8") <= 72
                    );
                },
                message:
                    "Password must not exceed 72 UTF-8 bytes for bcrypt.",
            },
        },

        avatar: {
            url: {
                type: String,
                default: "",
                trim: true,
            },
            public_id: {
                type: String,
                default: "",
                trim: true,
            },
        },

        phoneNo: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            select: false,
            default: undefined,
            set: normalizeOptionalString,
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
            select: false,
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
            select: false,
        },

        accountStatus: {
            type: String,
            enum: ["active", "blocked"],
            default: "active",
            required: true,
            select: false,
        },

        
        refreshToken: {
            type: String,
            select: false,
        },

        twoFactorEnabled: {
            type: Boolean,
            default: false,
            select: false,
        },

        twoFactorSecret: {
            type: String,
            select: false,
        },

        tokenVersion: {
            type: Number,
            default: 0,
            min: 0,
            select: false,
        },

        isOnline: {
            type: Boolean,
            default: false,
        },

        lastSeen: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,

        // Prevent accidental exposure when a document is serialized.
        toJSON: {
            transform: removePrivateFields,
        },

        toObject: {
            transform: removePrivateFields,
        },
    }
);

// Hash passwords only when they are created or changed.
UserSchema.pre("save", async function () {
    if (!this.isModified("password") || !this.password) {
        return;
    }

    const passwordBytes = Buffer.byteLength(this.password, "utf8");

    if (passwordBytes > 72) {
        throw new Error(
            "Password exceeds bcrypt's 72-byte limit."
        );
    }

    this.password = await bcrypt.hash(
        this.password,
        PASSWORD_BCRYPT_ROUNDS
    );
});

// Compare a candidate password with the stored password hash.
UserSchema.methods.isPasswordCorrect = async function (password) {
    if (typeof password !== "string" || !this.password) {
        return false;
    }

    return bcrypt.compare(password, this.password);
};

// It is select:false, so authentication queries must explicitly select it.
const getTokenPayload = function (sessionId) {
    if (!this._id) {
        throw new Error("User ID is required to generate a token.");
    }

    if (!mongoose.isValidObjectId(sessionId)) {
        throw new Error("A valid sessionId is required.");
    }

    if (this.tokenVersion === undefined) {
        throw new Error(
            "tokenVersion must be explicitly selected before generating tokens."
        );
    }

    return {
        _id: this._id.toString(),
        sessionId: sessionId.toString(),
        tokenVersion: this.tokenVersion,
    };
};

// Generate a short-lived access token.
UserSchema.methods.generateAccessToken = function (sessionId) {
    const secret = process.env.ACCESS_TOKEN_SECRET;

    if (!secret) {
        throw new Error("ACCESS_TOKEN_SECRET is not configured.");
    }

    const payload = getTokenPayload.call(this, sessionId);

    return jwt.sign(payload, secret, {
        algorithm: "HS256",
        expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    });
};

// Generate a refresh token.
UserSchema.methods.generateRefreshToken = function (sessionId) {
    const secret = process.env.REFRESH_TOKEN_SECRET;

    if (!secret) {
        throw new Error("REFRESH_TOKEN_SECRET is not configured.");
    }

    const payload = getTokenPayload.call(this, sessionId);

    return jwt.sign(payload, secret, {
        algorithm: "HS256",
        expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "30d",
    });
};

export const User =
    mongoose.models.User ||
    mongoose.model("User", UserSchema);