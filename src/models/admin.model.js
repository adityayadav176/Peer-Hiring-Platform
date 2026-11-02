
import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const adminSchema = new Schema(
    {
        singletonKey: {
            type: String,
            unique: true,
            default: "PEER_HIRING_OWNER",
            immutable: true,
            required: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },

        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            unique: true,
            maxlength: 254,
        },

        password: {
            type: String,
            required: true,
            select: false,
            minlength: 8,
            maxlength: 100,
            validate: {
                validator(value) {
                    return Buffer.byteLength(value, "utf8") <= 72;
                },
                message: "Password must not exceed 72 UTF-8 bytes.",
            },
        },

        avatar: {
            url: {
                type: String,
                default: "",
            },
            public_id: {
                type: String,
                default: "",
            },
        },

        tokenVersion: {
            type: Number,
            default: 0,
            min: 0,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        failedLoginAttempts: {
            type: Number,
            default: 0,
            min: 0,
        },

        lockUntil: {
            type: Date,
            default: null,
        },

        lastLoginAt: {
            type: Date,
            default: null,
        },

        refreshToken: {
            type: String,
            default: "",
            select: false,
        },

        refreshTokenExpiresAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

adminSchema.pre("save", async function () {
    if (!this.isModified("password")) {
        return;
    }

    if (Buffer.byteLength(this.password, "utf8") > 72) {
        throw new Error("Password must not exceed 72 UTF-8 bytes.");
    }

    this.password = await bcrypt.hash(this.password, 10);
});

adminSchema.methods.isPasswordCorrect = async function (password) {
    if (typeof password !== "string" || !this.password) {
        return false;
    }

    return bcrypt.compare(password, this.password);
};

adminSchema.methods.generateAccessToken = function () {
    if (!process.env.ACCESS_TOKEN_SECRET) {
        throw new Error("ACCESS_TOKEN_SECRET is missing.");
    }

    return jwt.sign(
        {
            adminId: this._id.toString(),
            type: "admin",
            tokenVersion: this.tokenVersion,
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
            algorithm: "HS256",
        }
    );
};

adminSchema.methods.generateRefreshToken = function () {
    if (!process.env.REFRESH_TOKEN_SECRET) {
        throw new Error("REFRESH_TOKEN_SECRET is missing.");
    }

    return jwt.sign(
        {
            adminId: this._id.toString(),
            type: "admin",
            tokenVersion: this.tokenVersion,
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "30d",
            algorithm: "HS256",
        }
    );
};
const Admin =
    mongoose.models.Admin ||
    mongoose.model("Admin", adminSchema);

export default Admin;
