
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { transporter } from "../utils/nodemailer.js";
import { PROJECT_NAME } from "../constant/constant.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import bcrypt from "bcrypt";
import cloudinary from "cloudinary";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { Session } from "../models/session.model.js";
import Admin from "../models/admin.model.js";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const ACCESS_TOKEN_DURATION = process.env.ACCESS_TOKEN_EXPIRY;
const REFRESH_TOKEN_DURATION = process.env.REFRESH_TOKEN_EXPIRY;
const TWO_FACTOR_TOKEN_DURATION = process.env.TWO_FACTOR_TOKEN_EXPIRY;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION = 15 * 60 * 1000;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
];

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
};

const setAuthCookies = (res, accessToken, refreshToken) => {
    res.cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: ACCESS_COOKIE_MAX_AGE,
    });

    res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: REFRESH_COOKIE_MAX_AGE,
    });
};

const clearAuthCookies = (res) => {
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
};

const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

const createSafeSession = (session) => ({
    _id: session._id,
    device: session.device,
    browser: session.browser,
    os: session.os,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
});


const getDeviceData = (req, userId) => {
    const deviceInfo = req.deviceInfo || {};

    return {
        userId,
        device: deviceInfo.device || "Unknown device",
        deviceType: deviceInfo.deviceType || "desktop",
        deviceModel: deviceInfo.deviceModel || "",
        deviceVendor: deviceInfo.deviceVendor || "",
        browser: deviceInfo.browser || "Unknown",
        browserVersion: deviceInfo.browserVersion || "",
        os: deviceInfo.os || "Unknown",
        osVersion: deviceInfo.osVersion || "",
        ipAddress: req.ip || req.socket?.remoteAddress || "Unknown",
        userAgent: req.get("user-agent") || "",
        lastActiveAt: new Date(),
    };
};

const createUserSession = async (req, user) => {
    const session = await Session.create(getDeviceData(req, user._id));

    try {
        const accessToken = await user.generateAccessToken(
            session._id.toString()
        );

        const refreshToken = await user.generateRefreshToken(
            session._id.toString()
        );

        session.refreshToken = hashToken(refreshToken);
        const decodedRefreshToken = jwt.decode(refreshToken);

    if (!Number.isSafeInteger(decodedRefreshToken?.exp)) {
        throw new ApiError(500, "Invalid refresh token expiry.");
    }

    session.refreshTokenExpiresAt = new Date(
        decodedRefreshToken.exp * 1000
    );

        await session.save();

        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        user.isOnline = true;
        user.lastSeen = new Date();

        await user.save({ validateBeforeSave: false });

        const safeUser = user;

        if (!safeUser) {
            throw new ApiError(500, "Unable to load account details");
        }

        return {
            session,
            accessToken,
            refreshToken,
            safeUser,
        };
    } catch (error) {
        await Session.deleteOne({ _id: session._id });
        throw error;
    }
};

const recordFailedLogin = async (Model, accountId) => {
    const account = await Model.findOneAndUpdate(
        { _id: accountId },
        {
            $inc: { failedLoginAttempts: 1 },
        },
        {
            new: true,
            projection: { failedLoginAttempts: 1 },
        }
    );

    if (!account) {
        return 0;
    }

    if (account.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        await Model.updateOne(
            { _id: accountId },
            {
                $set: {
                    lockUntil: new Date(Date.now() + LOCK_DURATION),
                },
            }
        );
    }

    return account.failedLoginAttempts;
};

const clearExpiredLoginLock = async (Model, account) => {
    if (account.lockUntil && account.lockUntil <= new Date()) {
        await Model.updateOne(
            { _id: account._id },
            {
                $set: {
                    failedLoginAttempts: 0,
                    lockUntil: null,
                },
            }
        );

        account.failedLoginAttempts = 0;
        account.lockUntil = null;
    }
};

const getLockResponse = (lockUntil) => {
    const remainingMs = new Date(lockUntil).getTime() - Date.now();

    return {
        remainingMinutes: Math.max(1, Math.ceil(remainingMs / 60000)),
    };
};

const updateUserImage = async (req, res, field, label) => {
    const userId = req.user?._id;
    const file = req.file;
    const localPath = file?.path;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (!localPath) {
        throw new ApiError(400, `${label} image file is required.`);
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        throw new ApiError(
            400,
            "Only JPEG, PNG, WebP, and AVIF images are allowed."
        );
    }

    if (!file.size || file.size > MAX_IMAGE_SIZE) {
        throw new ApiError(400, "Image size must not exceed 5 MB.");
    }

    let uploaded;
    let databaseUpdated = false;

    try {
        uploaded = await uploadOnCloudinary(localPath);

        if (!uploaded?.secure_url || !uploaded?.public_id) {
            throw new ApiError(
                502,
                `Failed to upload ${label.toLowerCase()} image.`
            );
        }

        const newImage = {
            url: uploaded.secure_url,
            public_id: uploaded.public_id,
        };

        const previousUser = await User.findOneAndUpdate(
            { _id: userId },
            {
                $set: {
                    [field]: newImage,
                },
            },
            {
                returnDocument: "before",
            }
        )
            .select(field)
            .lean();

        if (!previousUser) {
            throw new ApiError(404, "User not found.");
        }

        databaseUpdated = true;

        const oldPublicId = previousUser[field]?.public_id;

        if (oldPublicId && oldPublicId !== uploaded.public_id) {
            try {
                await cloudinary.v2.uploader.destroy(oldPublicId, {
                    invalidate: true,
                });
            } catch (error) {
                console.error(
                    `Failed to delete previous ${label.toLowerCase()} image:`,
                    error
                );
            }
        }

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    [field]: newImage,
                },
                `${label} updated successfully.`
            )
        );
    } catch (error) {
        if (!databaseUpdated && uploaded?.public_id) {
            try {
                await cloudinary.v2.uploader.destroy(uploaded.public_id, {
                    invalidate: true,
                });
            } catch (cleanupError) {
                console.error(
                    `Failed to clean up newly uploaded ${label.toLowerCase()} image:`,
                    cleanupError
                );
            }
        }

        throw error;
    }
};


const registerUser = asyncHandler(async (req, res) => {
    const { name, email, password, phoneNo, role } = req.body || {};

    if ( typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || !name.trim() || !email.trim() || !password
    ) {
        throw new ApiError(
            400,
            "Name, email, and password are required."
        );
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedName.length > 80) {
        throw new ApiError(
            400,
            "Name must not exceed 80 characters."
        );
    }

    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new ApiError(
            400,
            "Please provide a valid email address."
        );
    }

    const allowedRoles = ["User", "recruiter"];

    if (typeof role !== "string" || !allowedRoles.includes(role)) {
        throw new ApiError(
            400,
            "Role must be either User or recruiter."
        );
    }

    let normalizedPhone;

    if (phoneNo !== undefined && phoneNo !== null) {
        if (typeof phoneNo !== "string") {
            throw new ApiError(
                400,
                "Phone number must be a string."
            );
        }

        normalizedPhone = phoneNo.trim() || undefined;

        if (normalizedPhone && !/^\+?[0-9]{7,15}$/.test(normalizedPhone)) {
            throw new ApiError(
                400,
                "Please provide a valid phone number."
            );
        }
    }

    if (password.length < 8) {
        throw new ApiError(
            400,
            "Password must be at least 8 characters."
        );
    }

    if (Buffer.byteLength(password, "utf8") > 72) {
        throw new ApiError(
            400,
            "Password must not exceed 72 UTF-8 bytes."
        );
    }

    if (password.trim() !== password) {
        throw new ApiError(
            400,
            "Password must not start or end with whitespace."
        );
    }

    try {
        const user = await User.create({
            name: normalizedName,
            email: normalizedEmail,
            password,
            role,
            ...(normalizedPhone
                ? { phoneNo: normalizedPhone }
                : {}),
        });

        const safeUser = {
            _id: user._id,
            name: user.name,
            email: user.email,
            phoneNo: user.phoneNo || undefined,
            role: user.role,
            avatar: user.avatar,
            coverImage: user.coverImage,
            createdAt: user.createdAt,
        };

        return res.status(201).json(
            new ApiResponse(
                201,
                { user: safeUser },
                "Account created successfully. Please log in."
            )
        );
    } catch (error) {
        if (error?.code === 11000) {
            const duplicateField = Object.keys(
                error.keyPattern || {}
            )[0];

            if (duplicateField === "email") {
                throw new ApiError(
                    409,
                    "An account with this email already exists."
                );
            }

            if (duplicateField === "phoneNo") {
                throw new ApiError(
                    409,
                    "An account with this phone number already exists."
                );
            }

            throw new ApiError(
                409,
                "An account with these details already exists."
            );
        }

        throw error;
    }
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, phoneNo, password } = req.body;

    if ( typeof password !== "string" || !password || (!email && !phoneNo)) {
        throw new ApiError(
            400,
            "Email or phone number and password are required."
        );
    }

    if ((email !== undefined && typeof email !== "string") ||(phoneNo !== undefined && typeof phoneNo !== "string")) {
        throw new ApiError(400, "Invalid login credentials.");
    }

    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phoneNo?.trim();

    if (normalizedEmail && normalizedEmail.length > 254 ||normalizedPhone && !/^\+?[0-9]{7,15}$/.test(normalizedPhone)) {
        throw new ApiError(400, "Invalid login credentials.");
    }

    if (!normalizedEmail && !normalizedPhone) {
        throw new ApiError(400, "A valid email or phone number is required.");
    }

    if (!process.env.ACCESS_TOKEN_SECRET ||!process.env.REFRESH_TOKEN_SECRET) {
    throw new ApiError(
        500,
        "Authentication configuration error."
    );
    }

    if (normalizedEmail) {
        const admin = await Admin.findOne({
            email: normalizedEmail,
        }).select(
            "+password +failedLoginAttempts +lockUntil +refreshToken"
        );

        if (admin) {
            await clearExpiredLoginLock(Admin, admin);

            if (admin.lockUntil && admin.lockUntil > new Date()) {
                throw new ApiError(
                    423,
                    `Account temporarily locked. Try again in ${getLockResponse(admin.lockUntil).remainingMinutes} minutes.`
                );
            }

            const isPasswordValid = await admin.isPasswordCorrect(password);

            if (!isPasswordValid) {
                const attempts = await recordFailedLogin(
                    Admin,
                    admin._id
                );

                if (attempts >= MAX_LOGIN_ATTEMPTS) {
                    throw new ApiError(
                        423,
                        `Too many failed login attempts. Account temporarily locked for ${Math.ceil(LOCK_DURATION / 60000)} minutes.`
                    );
                }

                throw new ApiError(401, "Invalid email or password.");
            }

            if (!admin.isActive) {
                throw new ApiError(
                    403,
                    "This admin account is inactive."
                );
            }

            const accessToken = admin.generateAccessToken();
            const refreshToken = admin.generateRefreshToken();

            const decodedRefreshToken = jwt.decode(refreshToken);

            if (!decodedRefreshToken?.exp) {
                throw new ApiError(
                    500,
                    "Unable to generate refresh token."
                );
            }

            admin.failedLoginAttempts = 0;
            admin.lockUntil = null;
            admin.refreshToken = hashToken(refreshToken);
            admin.refreshTokenExpiresAt = new Date(
                decodedRefreshToken.exp * 1000
            );
            admin.lastLoginAt = new Date();

            await admin.save({
                validateBeforeSave: false,
            });

            setAuthCookies(res, accessToken, refreshToken);

            return res.status(200).json(
                new ApiResponse(
                    200,
                    {
                        type: "admin",
                        admin: {
                            _id: admin._id,
                            name: admin.name,
                            email: admin.email,
                            avatar: admin.avatar,
                            isActive: admin.isActive,
                        },
                    },
                    "Admin login successful."
                )
            );
        }
    }

    const userQuery = [];

    if (normalizedEmail) {
        userQuery.push({ email: normalizedEmail });
    }

    if (normalizedPhone) {
        userQuery.push({ phoneNo: normalizedPhone });
    }

    const user = await User.findOne({
        $or: userQuery,
    }).select(
        "+password +tokenVersion +failedLoginAttempts +lockUntil +accountStatus +twoFactorEnabled +twoFactorSecret"
    );

    if (!user) {
        throw new ApiError(
            401,
            "Invalid email/phone number or password."
        );
    }

    if (!["User", "recruiter"].includes(user.role)) {
        throw new ApiError(
            403,
            "This account role is not permitted to log in."
        );
    }

    if (user.accountStatus !== "active") {
        throw new ApiError(
            403,
            "Your account is blocked. Please contact support."
        );
    }

    await clearExpiredLoginLock(User, user);

    if (user.lockUntil && user.lockUntil > new Date()) {
        throw new ApiError(
            423,
            `Account temporarily locked. Try again in ${getLockResponse(user.lockUntil).remainingMinutes} minutes.`
        );
    }

    const isPasswordValid = await user.isPasswordCorrect(password);

    if (!isPasswordValid) {
        const attempts = await recordFailedLogin(User, user._id);

        if (attempts >= MAX_LOGIN_ATTEMPTS) {
            throw new ApiError(
                423,
                `Too many failed login attempts. Account temporarily locked for ${Math.ceil(LOCK_DURATION / 60000)} minutes.`
            );
        }

        throw new ApiError(
            401,
            "Invalid email/phone number or password."
        );
    }

    if (user.twoFactorEnabled) {
        const twoFactorToken = jwt.sign(
            {
                userId: user._id.toString(),
                type: user.role === "recruiter" ? "recruiter" : "User",
                purpose: "login-2fa",
                tokenVersion: user.tokenVersion || 0,
            },
            process.env.ACCESS_TOKEN_SECRET,
            {
                expiresIn: TWO_FACTOR_TOKEN_DURATION || "5m",
                algorithm: "HS256",
            }
        );

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    twoFactorRequired: true,
                    twoFactorToken,
                    userId: user._id,
                    type: user.role === "recruiter" ? "recruiter" : "User",
                },
                "Two-factor authentication required."
            )
        );
    }

    const { session, accessToken, refreshToken, safeUser, } = await createUserSession(req, user);

    if (!safeUser || !session || !accessToken || !refreshToken) {
        throw new ApiError(
            500,
            "Unable to complete login."
        );
    }

    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                type: user.role === "recruiter" ? "recruiter" : "User",
                user: safeUser,
                session: createSafeSession(session),
            },
            "Login successful."
        )
    );
});


const logoutCurrentUser = asyncHandler(async (req, res) => {
    // Support the request properties used by your auth middleware
    const userId = req._user?._id || req.user?._id;

    const sessionId =
        req._sessionId ||
        req._session?._id ||
        req.sessionId;

    if (!userId || !sessionId) {
        throw new ApiError(
            401,
            "Unauthorized. No active session found."
        );
    }

    // Delete only the authenticated user's current session
    const deletedSession = await Session.deleteOne({
        _id: sessionId,
        userId,
    });

    if (deletedSession.deletedCount !== 1) {
        throw new ApiError(
            401,
            "Session not found or already logged out."
        );
    }

    // Check whether the user has other active sessions
    const remainingSessions = await Session.exists({
        userId,
    });

    // Update presence only when no other sessions remain
    if (!remainingSessions) {
        await User.updateOne(
            { _id: userId },
            {
                $set: {
                    isOnline: false,
                    lastSeen: new Date(),
                },
            }
        );
    }

    // Clear cookies using the same options used when setting them
    clearAuthCookies(res);

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "User logged out successfully."
        )
    );
});



const verifyAccount = asyncHandler(async (req, res) => {
    const { otp } = req.body || {};
    const userId = req._user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (typeof otp !== "string" || !/^\d{6}$/.test(otp.trim())) {
        throw new ApiError(400, "Please provide a valid 6-digit OTP.");
    }

    const user = await User.findById(userId).select(
        "+emailVerificationOTP +emailVerificationOTPExpiry"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (user.isVerified) {
        throw new ApiError(409, "Your account is already verified.");
    }

    if ( !user.emailVerificationOTP || !user.emailVerificationOTPExpiry || user.emailVerificationOTPExpiry <= new Date()) {
        throw new ApiError(400, "OTP is invalid or expired. Please request a new OTP.");
    }

    const isValidOTP = await bcrypt.compare(
        otp.trim(),
        user.emailVerificationOTP
    );

    if (!isValidOTP) {
        throw new ApiError(400, "Invalid OTP.");
    }

    const result = await User.updateOne(
        {
            _id: userId,
            isVerified: false,
            emailVerificationOTP: user.emailVerificationOTP,
            emailVerificationOTPExpiry: { $gt: new Date() },
        },
        {
            $set: {
                isVerified: true,
            },
            $unset: {
                emailVerificationOTP: 1,
                emailVerificationOTPExpiry: 1,
            },
        }
    );

    if (result.modifiedCount !== 1) {
        throw new ApiError(
            400,
            "OTP is invalid, expired, or has already been used."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Your email has been verified successfully."
        )
    );
});

const sendVerifyAccountOtp = asyncHandler(async (req, res) => {
    const userId = req._user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (!process.env.SENDER_EMAIL) {
        throw new ApiError(500, "Email service is not configured.");
    }

    const user = await User.findById(userId).select(
        "+emailVerificationOTPExpiry"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (user.isVerified) {
        throw new ApiError(409, "Your account is already verified.");
    }

    const now = new Date();

    if ( user.emailVerificationOTPExpiry && user.emailVerificationOTPExpiry > now) {
        const remainingSeconds = Math.ceil(
            (user.emailVerificationOTPExpiry.getTime() - now.getTime()) / 1000
        );

        throw new ApiError(
            429,
            `Please wait ${remainingSeconds} seconds before requesting another OTP.`
        );
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiry = new Date(Date.now() + 2 * 60 * 1000);

    const updatedUser = await User.findOneAndUpdate(
        {
            _id: userId,
            isVerified: false,
            $or: [
                { emailVerificationOTPExpiry: { $exists: false } },
                { emailVerificationOTPExpiry: null },
                { emailVerificationOTPExpiry: { $lte: now } },
            ],
        },
        {
            $set: {
                emailVerificationOTP: hashedOTP,
                emailVerificationOTPExpiry: expiry,
            },
        },
        {
            new: true,
            projection: { email: 1 },
        }
    );

    if (!updatedUser) {
        const latestUser = await User.findById(userId).select(
            "+emailVerificationOTPExpiry"
        );

        if (!latestUser) {
            throw new ApiError(404, "User not found.");
        }

        if (latestUser.isVerified) {
            throw new ApiError(409, "Your account is already verified.");
        }

        throw new ApiError(
            429,
            "An OTP request is already in progress. Please try again later."
        );
    }

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: updatedUser.email,
            subject: "Email Verification OTP",
            html: `
                <div>
                    <h2>Email Verification</h2>
                    <p>Your verification OTP is:</p>
                    <h1>${otp}</h1>
                    <p>This OTP will expire in 2 minutes.</p>
                    <p>If you did not request this OTP, please ignore this email.</p>
                </div>
            `,
        });
    } catch (error) {
        await User.updateOne(
            {
                _id: userId,
                emailVerificationOTP: hashedOTP,
            },
            {
                $unset: {
                    emailVerificationOTP: 1,
                    emailVerificationOTPExpiry: 1,
                },
            }
        );

        throw new ApiError(
            503,
            "Unable to send verification email. Please try again later."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Verification OTP sent to your email successfully."
        )
    );
});


const sendForgetPasswordOtp = asyncHandler(async (req, res) => {
    const email =
        typeof req.body?.email === "string"
            ? req.body.email.trim().toLowerCase()
            : "";

    if (
        !email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new ApiError(400, "Please provide a valid email address.");
    }

    if (!process.env.SENDER_EMAIL) {
        throw new ApiError(500, "Email service is not configured.");
    }

    const now = new Date();
    const otp = crypto.randomInt(100000, 1000000).toString();
    const resetToken = crypto.randomBytes(32).toString("hex");

    const hashedOTP = await bcrypt.hash(otp, 10);
    const hashedResetToken = hashToken(resetToken);

    const otpExpiry = new Date(now.getTime() + 2 * 60 * 1000);
    const resetTokenExpiry = new Date(now.getTime() + 10 * 60 * 1000);

    const existingUser = await User.findOne({ email }).select("_id email");

if (!existingUser) {
    throw new ApiError(404, "No account found with this email address.");
}

    const user = await User.findOneAndUpdate(
        {
            email,
            $or: [
                { forgetPasswordOtpExpiredAt: { $exists: false } },
                { forgetPasswordOtpExpiredAt: null },
                { forgetPasswordOtpExpiredAt: { $lte: now } },
            ],
        },
        {
            $set: {
                forgetPasswordOtp: hashedOTP,
                forgetPasswordOtpExpiredAt: otpExpiry,
                passwordResetToken: hashedResetToken,
                passwordResetTokenExpiresAt: resetTokenExpiry,
            },
        },
        {
            new: true,
            projection: { email: 1 },
        }
    );

    if (!user) {
        return res.status(200).json(
            new ApiResponse(
                200,
                {},
                "If an account exists with this email, password reset instructions will be sent."
            )
        );
    }

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: user.email,
            subject: "Password Reset OTP",
            html: `
                <div>
                    <h2>Reset Your Password</h2>
                    <p>Your password reset OTP is:</p>
                    <h1>${otp}</h1>
                    <p>This OTP is valid for 2 minutes.</p>
                    <p>If you did not request a password reset, please ignore this email.</p>
                </div>
            `,
        });
    } catch (error) {
        await User.updateOne(
            {
                _id: user._id,
                passwordResetToken: hashedResetToken,
            },
            {
                $unset: {
                    forgetPasswordOtp: 1,
                    forgetPasswordOtpExpiredAt: 1,
                    passwordResetToken: 1,
                    passwordResetTokenExpiresAt: 1,
                },
            }
        );

        throw new ApiError(
            503,
            "Unable to send password reset email. Please try again later."
        );
    }

    res.cookie("passwordResetToken", resetToken, {
        ...cookieOptions,
        maxAge: 10 * 60 * 1000,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "If an account exists with this email, password reset instructions will be sent."
        )
    );
});


const forgetPassword = asyncHandler(async (req, res) => {
    const { password, confirmPassword, otp } = req.body || {};

    if ( typeof password !== "string" || typeof confirmPassword !== "string" || typeof otp !== "string" || !password || !confirmPassword || !otp.trim()) {
        throw new ApiError(
            400,
            "OTP, password, and confirm password are required."
        );
    }

    if (!/^\d{6}$/.test(otp.trim())) {
        throw new ApiError(400, "Please provide a valid 6-digit OTP.");
    }

    if (password !== confirmPassword) {
        throw new ApiError(400, "Passwords do not match.");
    }

    if (password.length < 8 || password.length > 100 || Buffer.byteLength(password, "utf8") > 72) {
        throw new ApiError(
            400,
            "Password must be at least 8 characters and no more than 72 UTF-8 bytes."
        );
    }

    if (password.trim() !== password) {
        throw new ApiError(
            400,
            "Password must not start or end with whitespace."
        );
    }

    const resetToken = req.cookies?.passwordResetToken;

    if (typeof resetToken !== "string" ||!/^[a-f0-9]{64}$/i.test(resetToken)) {
        throw new ApiError(400, "Password reset session is invalid or expired.");
    }

    const now = new Date();
    const hashedResetToken = hashToken(resetToken);

    const user = await User.findOne({
        passwordResetToken: hashedResetToken,
        passwordResetTokenExpiresAt: { $gt: now },
    }).select(
        "+forgetPasswordOtp +forgetPasswordOtpExpiredAt +tokenVersion"
    );

    if (!user) {
        throw new ApiError(
            400,
            "Invalid or expired password reset session."
        );
    }

    if ( !user.forgetPasswordOtp || !user.forgetPasswordOtpExpiredAt || user.forgetPasswordOtpExpiredAt <= now) {
        throw new ApiError(400, "OTP is invalid or expired.");
    }

    const isValidOTP = await bcrypt.compare(
        otp.trim(),
        user.forgetPasswordOtp
    );

    if (!isValidOTP) {
        throw new ApiError(400, "Invalid OTP.");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await User.updateOne(
        {
            _id: user._id,
            passwordResetToken: hashedResetToken,
            passwordResetTokenExpiresAt: { $gt: new Date() },
            forgetPasswordOtp: user.forgetPasswordOtp,
            forgetPasswordOtpExpiredAt: { $gt: new Date() },
        },
        {
            $set: {
                password: hashedPassword,
                isOnline: false,
                lastSeen: new Date(),
            },
            $unset: {
                forgetPasswordOtp: 1,
                forgetPasswordOtpExpiredAt: 1,
                passwordResetToken: 1,
                passwordResetTokenExpiresAt: 1,
            },
            $inc: {
                tokenVersion: 1,
            },
        }
    );

    if (result.modifiedCount !== 1) {
        throw new ApiError(
            400,
            "Password reset session is invalid, expired, or already used."
        );
    }

    await Session.deleteMany({ userId: user._id });

    res.clearCookie("passwordResetToken", cookieOptions);
    clearAuthCookies(res);

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Password updated successfully. Please log in again."
        )
    );
});

const updateCoverImage = asyncHandler(async (req, res) => {
    return updateUserImage(req, res, "coverImage", "Cover image");
});

const updateAvatar = asyncHandler(async (req, res) => {
    return updateUserImage(req, res, "avatar", "Avatar");
});


const sendDeleteAccountOtp = asyncHandler(async (req, res) => {
    const userId = req._user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (!process.env.SENDER_EMAIL) {
        throw new ApiError(500, "Email service is not configured.");
    }

    const now = new Date();
    const otp = crypto.randomInt(100000, 1000000).toString();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const expiry = new Date(now.getTime() + 2 * 60 * 1000);

    const user = await User.findOneAndUpdate(
        {
            _id: userId,
            $or: [
                { deleteAccountOtpExpiredAt: { $exists: false } },
                { deleteAccountOtpExpiredAt: null },
                { deleteAccountOtpExpiredAt: { $lte: now } },
            ],
        },
        {
            $set: {
                deleteAccountOtp: hashedOTP,
                deleteAccountOtpExpiredAt: expiry,
            },
        },
        {
            new: true,
            projection: { email: 1 },
        }
    );

    if (!user) {
        throw new ApiError(
            429,
            "Please wait before requesting another OTP."
        );
    }

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: user.email,
            subject: "Delete Account OTP",
            html: `
                <div>
                    <h2>Account Deletion Verification</h2>
                    <p>Use this OTP to permanently delete your account.</p>
                    <h1>${otp}</h1>
                    <p>This OTP is valid for 2 minutes.</p>
                    <p>If you did not request account deletion, please ignore this email.</p>
                </div>
            `,
        });
    } catch (error) {
        await User.updateOne(
            {
                _id: userId,
                deleteAccountOtp: hashedOTP,
            },
            {
                $unset: {
                    deleteAccountOtp: 1,
                    deleteAccountOtpExpiredAt: 1,
                },
            }
        );

        throw new ApiError(
            503,
            "Unable to send account deletion OTP. Please try again later."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Account deletion OTP sent successfully."
        )
    );
});

const deleteAccount = asyncHandler(async (req, res) => {
    const userId = req._user?._id;
    const { password, otp } = req.body || {};

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if ( typeof password !== "string" || !password || typeof otp !== "string" || !/^\d{6}$/.test(otp.trim())) {
        throw new ApiError(
            400,
            "A valid password and 6-digit OTP are required."
        );
    }

    const user = await User.findById(userId).select(
        "+password +deleteAccountOtp +deleteAccountOtpExpiredAt"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (!user.password) {
        throw new ApiError(
            400,
            "This account has no password. Account deletion requires an alternate verification flow."
        );
    }

    if ( !user.deleteAccountOtp || !user.deleteAccountOtpExpiredAt || user.deleteAccountOtpExpiredAt <= new Date()) {
        throw new ApiError(400, "OTP is invalid or expired.");
    }

    const [otpValid, passwordValid] = await Promise.all([
        bcrypt.compare(otp.trim(), user.deleteAccountOtp),
        user.isPasswordCorrect(password),
    ]);

    if (!otpValid) {
        throw new ApiError(400, "Invalid OTP.");
    }

    if (!passwordValid) {
        throw new ApiError(400, "Invalid password.");
    }

    const deletionResult = await User.deleteOne({
        _id: userId,
        password: user.password,
        deleteAccountOtp: user.deleteAccountOtp,
        deleteAccountOtpExpiredAt: { $gt: new Date() },
    });

    if (deletionResult.deletedCount !== 1) {
        throw new ApiError(
            409,
            "Account deletion could not be completed. Please request a new OTP."
        );
    }

    clearAuthCookies(res);
    res.clearCookie("passwordResetToken", cookieOptions);

    try {
        await Session.deleteMany({ userId });
    } catch (error) {
        console.error("Account session cleanup failed:", error);
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Account deleted successfully."
        )
    );
});

const changeName = asyncHandler(async (req, res) => {
    const userId = req._user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const { name } = req.body || {};

    if (typeof name !== "string" ||!name.trim() ||name.trim().length > 100) {
        throw new ApiError(
            400,
            "Name must contain between 1 and 100 characters."
        );
    }

    const user = await User.findOneAndUpdate(
        { _id: userId },
        {
            $set: {
                name: name.trim(),
            },
        },
        {
            new: true,
            runValidators: true,
        }
    )
        .select("_id name email")
        .lean();

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                _id: user._id,
                name: user.name,
                email: user.email,
            },
            "Name updated successfully."
        )
    );
});

const fetchUser = asyncHandler(async (req, res) => {
    const userId = req._user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (!User.db.base.Types.ObjectId.isValid(userId)) {
        throw new ApiError(401, "Invalid authentication credentials.");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    res.set("Cache-Control", "no-store, private");

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "User fetched successfully."
        )
    );
});

const googleAuth = asyncHandler(async (req, res) => {
    const { credential, role } = req.body || {};

    // Validate request
    if (
        typeof credential !== "string" ||
        !credential.trim()
    ) {
        throw new ApiError(
            400,
            "Google credential is required."
        );
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
        throw new ApiError(
            500,
            "Google authentication is not configured."
        );
    }

    // Verify Google identity
    let ticket;

    try {
        ticket = await client.verifyIdToken({
            idToken: credential.trim(),
            audience: process.env.GOOGLE_CLIENT_ID,
        });
    } catch {
        throw new ApiError(
            401,
            "Invalid or expired Google credential."
        );
    }

    const payload = ticket.getPayload();

    if (
        !payload?.email ||
        !payload?.sub ||
        typeof payload.email !== "string"
    ) {
        throw new ApiError(
            400,
            "Invalid Google token."
        );
    }

    if (payload.email_verified !== true) {
        throw new ApiError(
            403,
            "Google email is not verified."
        );
    }

    const googleId = payload.sub;

    const normalizedEmail = payload.email
        .trim()
        .toLowerCase();

    // Normalize and validate requested role
    let requestedRole = "User";

    if (
        role !== undefined &&
        role !== null &&
        role !== ""
    ) {
        const normalizedInputRole = String(role)
            .trim()
            .toLowerCase();

        if (
            normalizedInputRole !== "user" &&
            normalizedInputRole !== "recruiter"
        ) {
            throw new ApiError(
                400,
                "Invalid account role."
            );
        }

        requestedRole =
            normalizedInputRole === "recruiter"
                ? "recruiter"
                : "User";
    }

    // Protect admin account
    const adminEmail = process.env.ADMIN_EMAIL
        ?.trim()
        .toLowerCase();

    if (
        adminEmail &&
        normalizedEmail === adminEmail
    ) {
        throw new ApiError(
            403,
            "Admin accounts can only log in using email and password."
        );
    }

    // Independently check Google ID and email
    const userSelect =
        "+googleId +tokenVersion +twoFactorSecret +twoFactorEnabled +accountStatus";

    const [googleAccount, emailAccount] =
        await Promise.all([
            User.findOne({ googleId }).select(userSelect),

            User.findOne({
                email: normalizedEmail,
            }).select(userSelect),
        ]);

    //  Prevent Google ID and email from resolving
    // to two different accounts
    if (
        googleAccount &&
        emailAccount &&
        !googleAccount._id.equals(emailAccount._id)
    ) {
        throw new ApiError(
            409,
            "This Google account and email are associated with different accounts. Please contact support."
        );
    }

    let user = emailAccount || googleAccount;

    // Existing account protection
    if (user) {
        // Never allow a Google ID linked to another email
        if (
            googleAccount &&
            googleAccount.email.trim().toLowerCase() !==
                normalizedEmail
        ) {
            throw new ApiError(
                409,
                "This Google account is already linked to another email."
            );
        }

        // Never overwrite an existing Google account link
        if (
            user.googleId &&
            user.googleId !== googleId
        ) {
            throw new ApiError(
                409,
                "This email is already linked to another Google account. Please use your existing login method."
            );
        }

        // Existing account role is authoritative
        if (user.role !== requestedRole) {
            throw new ApiError(
                409,
                `An account with this email already exists as ${
                    user.role === "recruiter"
                        ? "recruiter"
                        : "User"
                }. Please select the correct account type.`
            );
        }

        // Link Google only when no Google ID exists
        if (!user.googleId) {
            user.googleId = googleId;
        }

        // Add Google avatar only when no avatar exists
        if (
            !user.avatar?.url &&
            payload.picture
        ) {
            user.avatar = {
                url: payload.picture,
                public_id: "",
            };
        }

        // Google has verified this email
        user.isVerified = true;

        await user.save({
            validateBeforeSave: false,
        });

        // Reload authentication fields explicitly
        user = await User.findById(user._id).select(
            userSelect
        );
    }

    //  Create a new account only if neither
    // Google ID nor email exists
    else {
        try {
            user = await User.create({
                googleId,

                name: payload.name || "Google User",

                email: normalizedEmail,

                role: requestedRole,

                avatar: {
                    url: payload.picture || "",
                    public_id: "",
                },

                isVerified: true,
            });

            // Reload all authentication fields
            user = await User.findById(user._id).select(
                userSelect
            );

        } catch (error) {
            // Protect against simultaneous Google signup
            // requests and MongoDB unique-index conflicts
            if (error.code === 11000) {
                throw new ApiError(
                    409,
                    "An account with this email or Google account already exists. Please try signing in again."
                );
            }

            throw error;
        }
    }

    //  Verify user exists
    if (!user) {
        throw new ApiError(
            500,
            "Unable to load Google account."
        );
    }

    //  Blocked account protection
    if (user.accountStatus === "blocked") {
        throw new ApiError(
            403,
            "Your account is blocked."
        );
    }

    // Determine consistent API role
    const authType =
        user.role === "recruiter"
            ? "recruiter"
            : "user";

    //  Two-factor authentication
    if (user.twoFactorEnabled) {
        const twoFactorToken = jwt.sign(
            {
                userId: user._id.toString(),

                type: authType,

                purpose: "login-2fa",

                tokenVersion: user.tokenVersion ?? 0,
            },
            process.env.ACCESS_TOKEN_SECRET,
            {
                algorithm: "HS256",
                expiresIn: TWO_FACTOR_TOKEN_DURATION,
            }
        );

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    twoFactorRequired: true,

                    twoFactorToken,

                    userId: user._id,

                    type: authType,
                },
                "Two-factor authentication required."
            )
        );
    }

    // Create session
    const {
        session,
        accessToken,
        refreshToken,
        safeUser,
    } = await createUserSession(req, user);

    //  Set authentication cookies
    setAuthCookies(
        res,
        accessToken,
        refreshToken
    );

    // Return successful authentication response
    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: safeUser,

                session: createSafeSession(session),

                type: authType,
            },
            "Google authentication successful."
        )
    );
});

const enable2FA = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await User.findById(userId).select(
        "+twoFactorSecret +password"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (user.twoFactorEnabled) {
        throw new ApiError(400, "2FA is already enabled.");
    }

    const secret = speakeasy.generateSecret({
        name: user.email,
        issuer: PROJECT_NAME || "Peer.Hiring",
    });

    user.twoFactorSecret = secret.base32;
    user.twoFactorEnabled = false;

    await user.save({ validateBeforeSave: false });

    const otpauthURL = speakeasy.otpauthURL({
        secret: secret.base32,
        label: user.email,
        issuer: PROJECT_NAME || "Peer.Hiring",
        encoding: "base32",
    });

    const qrCodeUrl = await QRCode.toDataURL(otpauthURL);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                qrCodeUrl,
                secret: secret.base32,
            },
            "Scan the QR code in your authenticator app, then verify the code."
        )
    );
});

const verify2FASetup = asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (typeof token !== "string" || !/^\d{6}$/.test(token.trim())) {
        throw new ApiError(400, "A valid six-digit authentication code is required.");
    }

    const user = await User.findById(userId).select("+twoFactorSecret");

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (user.twoFactorEnabled) {
        throw new ApiError(400, "2FA is already enabled.");
    }

    if (!user.twoFactorSecret) {
        throw new ApiError(400, "2FA has not been initialized.");
    }

    const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token.trim(),
        window: 1,
    });

    if (!verified) {
        throw new ApiError(400, "Invalid authentication code.");
    }

    user.twoFactorEnabled = true;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(200, {}, "2FA enabled successfully.")
    );
});

const verify2FALogin = asyncHandler(async (req, res) => {
    const { twoFactorToken, userId, token } = req.body || {};

    if (
        typeof twoFactorToken !== "string" ||
        !twoFactorToken.trim() ||
        typeof token !== "string" ||
        !/^\d{6}$/.test(token.trim())
    ) {
        throw new ApiError(
            400,
            "The temporary authentication token and six-digit code are required."
        );
    }

    let decoded;

    try {
        decoded = jwt.verify(
    twoFactorToken,
    process.env.ACCESS_TOKEN_SECRET,
    { algorithms: ["HS256"] }
);
    } catch {
        throw new ApiError(
            401,
            "The two-factor login token is invalid or expired."
        );
    }

    if (
        decoded.purpose !== "login-2fa" ||
        !decoded.userId ||
        (userId && decoded.userId !== userId.toString())
    ) {
        throw new ApiError(
            401,
            "Invalid two-factor login token."
        );
    }

    const user = await User.findById(decoded.userId).select(
        "+twoFactorSecret +tokenVersion +accountStatus +twoFactorEnabled"
    );

    if (
        !user ||
        !user.twoFactorEnabled ||
        !user.twoFactorSecret
    ) {
        throw new ApiError(
            401,
            "Invalid two-factor login request."
        );
    }

    if (
        (decoded.tokenVersion ?? 0) !==
        (user.tokenVersion ?? 0)
    ) {
        throw new ApiError(
            401,
            "The two-factor login token has been revoked."
        );
    }

    if (user.accountStatus === "blocked") {
        throw new ApiError(
            403,
            "Your account is blocked."
        );
    }

    const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token.trim(),
        window: 1,
    });

    if (!verified) {
        throw new ApiError(
            401,
            "Invalid authentication code."
        );
    }

    const {
        session,
        accessToken,
        refreshToken,
        safeUser,
    } = await createUserSession(req, user);

    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: safeUser,
                session: createSafeSession(session),
                type: user.role === "recruiter" ? "recruiter" : "User",
            },
            "Two-factor login successful."
        )
    );
});

const isValidObjectId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken =
        req.cookies?.refreshToken || req.body?.refreshToken;

    if ( typeof incomingRefreshToken !== "string" || !incomingRefreshToken) {
        throw new ApiError(401, "Refresh token is required.");
    }

    if (
        !process.env.ACCESS_TOKEN_SECRET ||
        !process.env.REFRESH_TOKEN_SECRET
    ) {
        throw new ApiError(500, "Authentication is not configured.");
    }

    let decodedToken;

    try {
        decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET,
            { algorithms: ["HS256"] }
        );
    } catch {
        throw new ApiError(401, "Invalid or expired refresh token.");
    }

    const now = new Date();
    const oldTokenHash = hashToken(incomingRefreshToken);

    const getTokenExpiry = (token) => {
        const payload = jwt.decode(token);

        if (!payload || !Number.isSafeInteger(payload.exp)) {
            throw new ApiError(
                500,
                "Unable to determine refresh token expiry."
            );
        }

        return new Date(payload.exp * 1000);
    };

    // ADMIN REFRESH
    if (
        decodedToken.type === "admin" ||
        decodedToken.adminId !== undefined
    ) {
        if (
            decodedToken.type !== "admin" ||
            !isValidObjectId(decodedToken.adminId) ||
            !Number.isSafeInteger(decodedToken.tokenVersion)
        ) {
            throw new ApiError(401, "Invalid admin refresh token.");
        }

        const admin = await Admin.findById(decodedToken.adminId).select(
            "+refreshToken +refreshTokenExpiresAt"
        );

        if (
            !admin ||
            admin.isActive !== true ||
            admin.tokenVersion !== decodedToken.tokenVersion ||
            !admin.refreshToken ||
            admin.refreshToken !== oldTokenHash ||
            !admin.refreshTokenExpiresAt ||
            admin.refreshTokenExpiresAt <= now
        ) {
            throw new ApiError(
                401,
                "Admin session expired. Please log in again."
            );
        }

        const tokenVersion = admin.tokenVersion;

        const newAccessToken = jwt.sign(
            {
                adminId: admin._id.toString(),
                type: "admin",
                tokenVersion,
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "15m" }
        );

        const newRefreshToken = jwt.sign(
            {
                adminId: admin._id.toString(),
                type: "admin",
                tokenVersion,
            },
            process.env.REFRESH_TOKEN_SECRET,
            { expiresIn: "30d" }
        );

        const newRefreshTokenExpiry = getTokenExpiry(newRefreshToken);

        const updateResult = await Admin.updateOne(
            {
                _id: admin._id,
                isActive: true,
                tokenVersion,
                refreshToken: oldTokenHash,
                refreshTokenExpiresAt: { $gt: now },
            },
            {
                $set: {
                    refreshToken: hashToken(newRefreshToken),
                    refreshTokenExpiresAt: newRefreshTokenExpiry,
                },
            }
        );

        if (updateResult.matchedCount !== 1) {
            throw new ApiError(
                401,
                "Refresh token was already used or revoked."
            );
        }

        setAuthCookies(res, newAccessToken, newRefreshToken);

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    accessToken: newAccessToken,
                    type: "admin",
                },
                "Admin access token refreshed successfully."
            )
        );
    }

    // USER / RECRUITER REFRESH
    if (
        decodedToken.type === "admin" ||
        !isValidObjectId(decodedToken._id) ||
        !isValidObjectId(decodedToken.sessionId) ||
        !Number.isSafeInteger(decodedToken.tokenVersion)
    ) {
        throw new ApiError(401, "Invalid user refresh token.");
    }

    const user = await User.findById(decodedToken._id).select(
        "+tokenVersion +accountStatus"
    );

    if (!user) {
        throw new ApiError(401, "User account not found.");
    }

    if (user.accountStatus !== "active") {
        throw new ApiError(403, "Your account is not active.");
    }

    if (decodedToken.tokenVersion !== user.tokenVersion) {
        throw new ApiError(
            401,
            "Session revoked. Please log in again."
        );
    }

    const sessionFilter = {
        _id: decodedToken.sessionId,
        userId: user._id,
        refreshToken: oldTokenHash,
        refreshTokenExpiresAt: { $gt: now },
        isActive: true,
    };

    const newAccessToken = await user.generateAccessToken(
        decodedToken.sessionId
    );

    const newRefreshToken = await user.generateRefreshToken(
        decodedToken.sessionId
    );

    const newRefreshTokenExpiry = getTokenExpiry(newRefreshToken);

    const updateResult = await Session.updateOne(
        sessionFilter,
        {
            $set: {
                refreshToken: hashToken(newRefreshToken),
                refreshTokenExpiresAt: newRefreshTokenExpiry,
                lastActiveAt: new Date(),
            },
        }
    );

    if (updateResult.matchedCount !== 1) {
        throw new ApiError(
            401,
            "Refresh token was already used or revoked."
        );
    }

    setAuthCookies(res, newAccessToken, newRefreshToken);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                accessToken: newAccessToken,
            },
            "Access token refreshed successfully."
        )
    );
});

export {
    registerUser,
    loginUser,
    sendVerifyAccountOtp,
    verifyAccount,
    sendForgetPasswordOtp,
    forgetPassword,
    changeName,
    deleteAccount,
    logoutCurrentUser,
    sendDeleteAccountOtp,
    updateAvatar,
    updateCoverImage,
    fetchUser,
    googleAuth,
    enable2FA,
    verify2FALogin,
    verify2FASetup,
    refreshAccessToken,
};
