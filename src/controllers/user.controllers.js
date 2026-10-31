
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

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION = 60 * 60 * 1000;
const ACCESS_TOKEN_DURATION = 15 * 60 * 1000;
const REFRESH_TOKEN_DURATION = 30 * 24 * 60 * 60 * 1000;
const TWO_FACTOR_TOKEN_DURATION = 5 * 60 * 1000;

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
};

const setAuthCookies = (res, accessToken, refreshToken) => {
    res.cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: ACCESS_TOKEN_DURATION,
    });

    res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: REFRESH_TOKEN_DURATION,
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

const getSafeUser = async (userId) =>
    User.findById(userId).select(
        [
            "-password",
            "-refreshToken",
            "-forgetPasswordOtp",
            "-forgetPasswordOtpExpiredAt",
            "-passwordResetToken",
            "-passwordResetTokenExpiresAt",
            "-deleteAccountOtp",
            "-deleteAccountOtpExpiredAt",
            "-tokenVersion",
            "-emailVerificationOTP",
            "-emailVerificationOTPExpiry",
            "-twoFactorSecret",
        ].join(" ")
    );

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
        session.refreshTokenExpiresAt = new Date(
            Date.now() + REFRESH_TOKEN_DURATION
        );

        await session.save();

        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        user.isOnline = true;
        user.lastSeen = new Date();
        user.lastSeen = new Date();

        await user.save({ validateBeforeSave: false });

        const safeUser = await getSafeUser(user._id);

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

const registerUser = asyncHandler(async (req, res) => {
    const { name, email, password, phoneNo } = req.body || {};

    if (
        typeof name !== "string" ||
        !name.trim() ||
        typeof email !== "string" ||
        !email.trim() ||
        typeof password !== "string"
    ) {
        throw new ApiError(400, "Name, email, and password are required.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone =
        typeof phoneNo === "string" ? phoneNo.trim() : "";

    if (password.length < 8) {
        throw new ApiError(400, "Password must be at least 8 characters.");
    }

    if (Buffer.byteLength(password, "utf8") > 72) {
        throw new ApiError(400, "Password must not exceed 72 UTF-8 bytes.");
    }

    if (password.trim() !== password) {
        throw new ApiError(
            400,
            "Password must not start or end with whitespace."
        );
    }

    const conditions = [{ email: normalizedEmail }];

    if (normalizedPhone) {
        conditions.push({ phoneNo: normalizedPhone });
    }

    const existingUser = await User.findOne({ $or: conditions });

    if (existingUser) {
        throw new ApiError(409, "User already exists.");
    }

    const avatarLocalPath = req.files?.avatar?.[0]?.path;
    const coverLocalPath = req.files?.coverImage?.[0]?.path;

    if (!avatarLocalPath || !coverLocalPath) {
        throw new ApiError(400, "Avatar and cover image are required.");
    }

    const [avatarUpload, coverUpload] = await Promise.all([
        uploadOnCloudinary(avatarLocalPath),
        uploadOnCloudinary(coverLocalPath),
    ]);

    if (!avatarUpload?.secure_url || !avatarUpload?.public_id) {
        throw new ApiError(500, "Failed to upload avatar.");
    }

    if (!coverUpload?.secure_url || !coverUpload?.public_id) {
        throw new ApiError(500, "Failed to upload cover image.");
    }

    const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password,
        role: "User",
        ...(normalizedPhone ? { phoneNo: normalizedPhone } : {}),
        avatar: {
            url: avatarUpload.secure_url,
            public_id: avatarUpload.public_id,
        },
        coverImage: {
            url: coverUpload.secure_url,
            public_id: coverUpload.public_id,
        },
    });

    await transporter.sendMail({
        from: process.env.SENDER_EMAIL,
        to: normalizedEmail,
        subject: `Welcome To ${PROJECT_NAME}`,
        html: `
            <div style="font-family: Arial, sans-serif">
                <h2>Hello ${name.trim()}</h2>
                <p>Your account has been created successfully.</p>
                <p>Welcome to <b>${PROJECT_NAME}</b>.</p>
            </div>
        `,
    }).catch((error) => {
        console.error("Email Error:", error.message);
    });

    const createdUser = await getSafeUser(user._id);

    return res.status(201).json(
        new ApiResponse(
            201,
            { user: createdUser },
            "User registered successfully."
        )
    );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, phoneNo, password } = req.body || {};

    if (
        ((!email || typeof email !== "string" || !email.trim()) &&
            (!phoneNo || typeof phoneNo !== "string" || !phoneNo.trim())) ||
        typeof password !== "string" ||
        !password
    ) {
        throw new ApiError(
            400,
            "Email or phone number and password are required."
        );
    }

    if (
        !process.env.ACCESS_TOKEN_SECRET ||
        !process.env.REFRESH_TOKEN_SECRET
    ) {
        throw new ApiError(500, "Authentication environment variables are missing.");
    }

    const normalizedEmail =
        typeof email === "string" && email.trim()
            ? email.trim().toLowerCase()
            : "";

    const normalizedPhone =
        typeof phoneNo === "string" && phoneNo.trim()
            ? phoneNo.trim()
            : "";

    if (normalizedEmail) {
        const admin = await Admin.findOne({
            email: normalizedEmail,
        }).select("+password");

        if (admin) {
  if (admin.isActive !== true) {
    throw new ApiError(403, "Admin account is inactive.");
  }

  if (!admin.password) {
    throw new ApiError(401, "Invalid email or password.");
  }

  const passwordCorrect = await bcrypt.compare(
    password,
    admin.password
  );

  if (!passwordCorrect) {
    throw new ApiError(401, "Invalid email or password.");
  }

  const tokenVersion = admin.tokenVersion || 0;

  const accessToken = jwt.sign(
    {
      adminId: admin._id.toString(),
      type: "admin",
      tokenVersion,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    {
      adminId: admin._id.toString(),
      type: "admin",
      tokenVersion,
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "30d" }
  );

  admin.refreshToken = hashToken(refreshToken);
  admin.refreshTokenExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_DURATION
  );
  admin.lastLoginAt = new Date();

  await admin.save({ validateBeforeSave: false });

  setAuthCookies(res, accessToken, refreshToken);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        admin: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          avatar: admin.avatar,
          isActive: admin.isActive,
          lastLoginAt: admin.lastLoginAt,
        },
        type: "admin",
      },
      "Admin logged in successfully."
    )
  );
}
    }

    const userConditions = [];

    if (normalizedEmail) {
        userConditions.push({ email: normalizedEmail });
    }

    if (normalizedPhone) {
        userConditions.push({ phoneNo: normalizedPhone });
    }

    const user = await User.findOne({
        $or: userConditions,
    }).select("+password +tokenVersion");

    if (!user) {
        throw new ApiError(401, "Invalid email or password.");
    }

    if (!["User", "recruiter"].includes(user.role)) {
        throw new ApiError(403, "Invalid account role.");
    }

    if (user.accountStatus === "blocked") {
        throw new ApiError(
            403,
            "Your account is blocked. Please contact support."
        );
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
        const remainingTime = Math.ceil(
            (user.lockUntil.getTime() - Date.now()) / 60000
        );

        throw new ApiError(
            423,
            `Account temporarily locked. Try again after ${remainingTime} minute(s).`
        );
    }

    if (user.lockUntil && user.lockUntil <= new Date()) {
        user.lockUntil = null;
        user.failedLoginAttempts = 0;
        await user.save({ validateBeforeSave: false });
    }

    if (!user.password) {
        throw new ApiError(
            400,
            "This account does not have a password. Please use your social login."
        );
    }

    const passwordCorrect = await user.isPasswordCorrect(password);

    if (!passwordCorrect) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

        if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
            user.lockUntil = new Date(Date.now() + LOCK_DURATION);
            await user.save({ validateBeforeSave: false });

            throw new ApiError(
                423,
                "Too many failed login attempts. Account locked for 1 hour."
            );
        }

        await user.save({ validateBeforeSave: false });

        throw new ApiError(
            401,
            `Invalid email or password. ${
                MAX_LOGIN_ATTEMPTS - user.failedLoginAttempts
            } attempt(s) remaining.`
        );
    }

    if (user.twoFactorEnabled) {
        const twoFactorToken = jwt.sign(
            {
                userId: user._id.toString(),
                type: user.role === "recruiter" ? "recruiter" : "user",
                purpose: "login-2fa",
                tokenVersion: user.tokenVersion || 0,
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "5m" }
        );

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    twoFactorRequired: true,
                    twoFactorToken,
                    userId: user._id,
                    type: user.role === "recruiter" ? "recruiter" : "user",
                },
                "Two-factor authentication required."
            )
        );
    }

    const { session, accessToken, refreshToken, safeUser } =
        await createUserSession(req, user);

    setAuthCookies(res, accessToken, refreshToken);

    const responseData = {
        session: createSafeSession(session),
        type: user.role === "recruiter" ? "recruiter" : "user",
    };

    if (user.role === "recruiter") {
        responseData.recruiter = safeUser;
    } else {
        responseData.user = safeUser;
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            responseData,
            user.role === "recruiter"
                ? "Recruiter logged in successfully."
                : "User logged in successfully."
        )
    );
});

const logoutCurrentUser = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    const sessionId = req.sessionId;

    if (userId && sessionId) {
        await Session.deleteOne({ _id: sessionId, userId });

        const remainingSessions = await Session.exists({ userId });

        if (!remainingSessions) {
            await User.updateOne(
                { _id: userId },
                {
                    $set: {
                        isOnline: false,
                        lastSeen: new Date(),
                        lastSeen: new Date(),
                    },
                }
            );
        }
    }

    clearAuthCookies(res);

    return res.status(200).json(
        new ApiResponse(200, {}, "User logged out successfully.")
    );
});

const verifyAccount = asyncHandler(async (req, res) => {
    const { otp } = req.body || {};
    const userId = req.user?._id;

    if (typeof otp !== "string" || !otp.trim()) {
        throw new ApiError(400, "OTP is required.");
    }

    if (!userId) {
        throw new ApiError(401, "Unauthorized.");
    }

    const user = await User.findById(userId).select(
        "+emailVerificationOTP +emailVerificationOTPExpiry"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (user.isVerified) {
        throw new ApiError(400, "Account is already verified.");
    }

    if (
        !user.emailVerificationOTP ||
        !user.emailVerificationOTPExpiry ||
        user.emailVerificationOTPExpiry <= new Date()
    ) {
        throw new ApiError(400, "OTP is invalid or expired.");
    }

    const valid = await bcrypt.compare(
        otp.trim(),
        user.emailVerificationOTP
    );

    if (!valid) {
        throw new ApiError(400, "Invalid OTP.");
    }

    user.isVerified = true;
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpiry = undefined;

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(200, {}, "Your email has been verified successfully.")
    );
});

const sendVerifyAccountOtp = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await User.findById(userId).select(
        "+emailVerificationOTP +emailVerificationOTPExpiry"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (user.isVerified) {
        throw new ApiError(400, "User is already verified.");
    }

    if (
        user.emailVerificationOTPExpiry &&
        user.emailVerificationOTPExpiry > new Date()
    ) {
        throw new ApiError(
            429,
            "Please wait before requesting another OTP."
        );
    }

    const otp = crypto.randomInt(100000, 1000000).toString();

    user.emailVerificationOTP = await bcrypt.hash(otp, 10);
    user.emailVerificationOTPExpiry = new Date(Date.now() + 2 * 60 * 1000);

    await user.save({ validateBeforeSave: false });

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: user.email,
            subject: "Email Verification OTP",
            html: `
                <h2>Email Verification</h2>
                <p>Your OTP is:</p>
                <h1>${otp}</h1>
                <p>Valid for 2 minutes.</p>
            `,
        });
    } catch {
        user.emailVerificationOTP = undefined;
        user.emailVerificationOTPExpiry = undefined;
        await user.save({ validateBeforeSave: false });

        throw new ApiError(500, "Failed to send email verification OTP.");
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "OTP sent to email successfully.")
    );
});

const sendForgetPasswordOtp = asyncHandler(async (req, res) => {
    const email =
        typeof req.body?.email === "string"
            ? req.body.email.trim().toLowerCase()
            : "";

    if (!email) {
        throw new ApiError(400, "Email is required.");
    }

    const user = await User.findOne({ email }).select(
        "+forgetPasswordOtp +forgetPasswordOtpExpiredAt +passwordResetToken +passwordResetTokenExpiresAt"
    );

    if (!user) {
        throw new ApiError(404, "Account not found.");
    }

    if (
        user.forgetPasswordOtpExpiredAt &&
        user.forgetPasswordOtpExpiredAt > new Date()
    ) {
        throw new ApiError(
            429,
            "Please wait before requesting another OTP."
        );
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const resetToken = crypto.randomBytes(32).toString("hex");

    user.passwordResetToken = hashToken(resetToken);
    user.passwordResetTokenExpiresAt = new Date(
        Date.now() + 10 * 60 * 1000
    );
    user.forgetPasswordOtp = await bcrypt.hash(otp, 10);
    user.forgetPasswordOtpExpiredAt = new Date(
        Date.now() + 2 * 60 * 1000
    );

    await user.save({ validateBeforeSave: false });

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: email,
            subject: "Password Reset OTP",
            html: `
                <div>
                    <h2>Reset Your Password</h2>
                    <p>Your password reset OTP is:</p>
                    <h1>${otp}</h1>
                    <p>This OTP is valid for 2 minutes.</p>
                    <p>If you did not request a password reset, ignore this email.</p>
                </div>
            `,
        });
    } catch {
        user.forgetPasswordOtp = undefined;
        user.forgetPasswordOtpExpiredAt = undefined;
        user.passwordResetToken = undefined;
        user.passwordResetTokenExpiresAt = undefined;
        await user.save({ validateBeforeSave: false });

        throw new ApiError(500, "Failed to send OTP.");
    }

    res.cookie("passwordResetToken", resetToken, {
        ...cookieOptions,
        maxAge: 10 * 60 * 1000,
    });

    return res.status(200).json(
        new ApiResponse(200, null, "Password reset OTP sent successfully.")
    );
});

const forgetPassword = asyncHandler(async (req, res) => {
    const { password, confirmPassword, otp } = req.body || {};

    if (
        typeof password !== "string" ||
        typeof confirmPassword !== "string" ||
        typeof otp !== "string" ||
        !password ||
        !confirmPassword ||
        !otp.trim()
    ) {
        throw new ApiError(
            400,
            "OTP, password, and confirm password are required."
        );
    }

    if (password !== confirmPassword) {
        throw new ApiError(400, "Passwords do not match.");
    }

    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
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

    if (!resetToken) {
        throw new ApiError(400, "Password reset session expired.");
    }

    const user = await User.findOne({
        passwordResetToken: hashToken(resetToken),
        passwordResetTokenExpiresAt: { $gt: new Date() },
    }).select(
        "+forgetPasswordOtp +forgetPasswordOtpExpiredAt +passwordResetToken +passwordResetTokenExpiresAt"
    );

    if (!user) {
        throw new ApiError(400, "Invalid or expired password reset session.");
    }

    if (
        !user.forgetPasswordOtp ||
        !user.forgetPasswordOtpExpiredAt ||
        user.forgetPasswordOtpExpiredAt <= new Date()
    ) {
        throw new ApiError(400, "OTP is invalid or expired.");
    }

    const valid = await bcrypt.compare(otp.trim(), user.forgetPasswordOtp);

    if (!valid) {
        throw new ApiError(400, "Invalid OTP.");
    }

    user.password = password;
    user.forgetPasswordOtp = undefined;
    user.forgetPasswordOtpExpiredAt = undefined;
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresAt = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;

    await user.save({ validateBeforeSave: false });

    await Session.deleteMany({ userId: user._id });

    res.clearCookie("passwordResetToken", cookieOptions);
    clearAuthCookies(res);

    return res.status(200).json(
        new ApiResponse(200, {}, "Password updated successfully.")
    );
});

const updateCoverImage = asyncHandler(async (req, res) => {
    const localPath = req.file?.path;

    if (!localPath) {
        throw new ApiError(400, "Cover image file is required.");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    const uploaded = await uploadOnCloudinary(localPath);

    if (!uploaded?.secure_url || !uploaded?.public_id) {
        throw new ApiError(500, "Failed to upload cover image.");
    }

    if (user.coverImage?.public_id) {
        await cloudinary.v2.uploader.destroy(user.coverImage.public_id);
    }

    user.coverImage = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
    };

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(
            200,
            { coverImage: user.coverImage },
            "Cover image updated successfully."
        )
    );
});

const updateAvatar = asyncHandler(async (req, res) => {
    const localPath = req.file?.path;

    if (!localPath) {
        throw new ApiError(400, "Avatar file is required.");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    const uploaded = await uploadOnCloudinary(localPath);

    if (!uploaded?.secure_url || !uploaded?.public_id) {
        throw new ApiError(500, "Failed to upload avatar.");
    }

    if (user.avatar?.public_id) {
        await cloudinary.v2.uploader.destroy(user.avatar.public_id);
    }

    user.avatar = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
    };

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(
            200,
            { avatar: user.avatar },
            "Avatar updated successfully."
        )
    );
});

const sendDeleteAccountOtp = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await User.findById(userId).select(
        "+deleteAccountOtp +deleteAccountOtpExpiredAt"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (
        user.deleteAccountOtpExpiredAt &&
        user.deleteAccountOtpExpiredAt > new Date()
    ) {
        throw new ApiError(
            429,
            "Please wait before requesting another OTP."
        );
    }

    const otp = crypto.randomInt(100000, 1000000).toString();

    user.deleteAccountOtp = await bcrypt.hash(otp, 10);
    user.deleteAccountOtpExpiredAt = new Date(
        Date.now() + 2 * 60 * 1000
    );

    await user.save({ validateBeforeSave: false });

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: user.email,
            subject: "Delete Account OTP",
            html: `
                <h2>Account Deletion Verification</h2>
                <p>Use this OTP to permanently delete your account.</p>
                <h1>${otp}</h1>
                <p>Valid for 2 minutes.</p>
            `,
        });
    } catch {
        user.deleteAccountOtp = undefined;
        user.deleteAccountOtpExpiredAt = undefined;
        await user.save({ validateBeforeSave: false });

        throw new ApiError(500, "Failed to send OTP.");
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "OTP sent to your email successfully.")
    );
});

const deleteAccount = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    const { password, otp } = req.body || {};

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    if (typeof password !== "string" || typeof otp !== "string" || !otp.trim()) {
        throw new ApiError(400, "Password and OTP are required.");
    }

    const user = await User.findById(userId).select(
        "+password +deleteAccountOtp +deleteAccountOtpExpiredAt"
    );

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    if (
        !user.deleteAccountOtp ||
        !user.deleteAccountOtpExpiredAt ||
        user.deleteAccountOtpExpiredAt <= new Date()
    ) {
        throw new ApiError(400, "OTP is invalid or expired.");
    }

    const otpValid = await bcrypt.compare(otp.trim(), user.deleteAccountOtp);

    if (!otpValid) {
        throw new ApiError(400, "Invalid OTP.");
    }

    if (!user.password) {
        throw new ApiError(
            400,
            "This account has no password. Account deletion requires an alternate verification flow."
        );
    }

    const passwordValid = await user.isPasswordCorrect(password);

    if (!passwordValid) {
        throw new ApiError(400, "Invalid password.");
    }

    await Session.deleteMany({ userId });
    await User.findByIdAndDelete(userId);

    clearAuthCookies(res);
    res.clearCookie("passwordResetToken", cookieOptions);

    return res.status(200).json(
        new ApiResponse(200, {}, "Account deleted successfully.")
    );
});

const changeName = asyncHandler(async (req, res) => {
    const { name } = req.body || {};

    if (
  typeof name !== "string" ||
  !name.trim() ||
  name.trim().length > 100
) {
  throw new ApiError(
    400,
    "Name must contain between 1 and 100 characters."
  );
}

user.name = name.trim();
await user.save();

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    user.name = name.trim();
    await user.save({ validateBeforeSave: false });

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
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied.");
    }

    const user = await getSafeUser(userId);

    if (!user) {
        throw new ApiError(404, "User not found.");
    }

    return res.status(200).json(
        new ApiResponse(200, user, "User fetched successfully.")
    );
});

const googleAuth = asyncHandler(async (req, res) => {
    const { credential, role } = req.body || {};

    // Validate request
    if (!credential) {
        throw new ApiError(400, "Google credential is required.");
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
        throw new ApiError(
            500,
            "Google authentication is not configured."
        );
    }

    // Verify Google identity
    const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.email || !payload?.sub) {
        throw new ApiError(400, "Invalid Google token.");
    }

    if (payload.email_verified !== true) {
        throw new ApiError(403, "Google email is not verified.");
    }

    const googleId = payload.sub;
    const normalizedEmail = payload.email.toLowerCase().trim();

    // Normalize and validate requested role
    let requestedRole = "User";

    if (role !== undefined && role !== null && role !== "") {
        const normalizedInputRole = String(role).trim().toLowerCase();

        if (
            normalizedInputRole !== "User" &&
            normalizedInputRole !== "recruiter"
        ) {
            throw new ApiError(400, "Invalid account role.");
        }

        requestedRole =
            normalizedInputRole === "recruiter"
                ? "recruiter"
                : "User";
    }

    // Protect admin account
    const adminEmail = process.env.ADMIN_EMAIL
        ?.toLowerCase()
        .trim();

    if (adminEmail && normalizedEmail === adminEmail) {
        throw new ApiError(
            403,
            "Admin accounts can only log in using email and password."
        );
    }

    // Independently check Google ID and email
    const [googleAccount, emailAccount] = await Promise.all([
        User.findOne({ googleId }).select(
            "+tokenVersion +twoFactorSecret"
        ),

        User.findOne({ email: normalizedEmail }).select(
            "+tokenVersion +twoFactorSecret"
        ),
    ]);

    // Prevent Google ID and email from resolving
    // to two different accounts.
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

    // 7. Existing account protection
    if (user) {
        // Never allow a Google ID linked to another email.
        if (
            googleAccount &&
            googleAccount.email.toLowerCase().trim() !== normalizedEmail
        ) {
            throw new ApiError(
                409,
                "This Google account is already linked to another email."
            );
        }

        // Never overwrite an existing Google account link.
        if (
            user.googleId &&
            user.googleId !== googleId
        ) {
            throw new ApiError(
                409,
                "This email is already linked to another Google account. Please use your existing login method."
            );
        }

        // IMPORTANT:
        // Existing account role is authoritative.
        // Never convert User into recruiter or recruiter into User.
        if (user.role !== requestedRole) {
            throw new ApiError(
                409,
                `An account with this email already exists as ${
                    user.role === "recruiter" ? "recruiter" : "User"
                }. Please select the correct account type.`
            );
        }

        // Link Google only when the existing account
        // does not already have a Google ID.
        if (!user.googleId) {
            user.googleId = googleId;
        }

        if (!user.avatar?.url && payload.picture) {
            user.avatar = {
                url: payload.picture,
                public_id: "",
            };
        }

        // Google has verified this email.
        user.isVerified = true;

        await user.save({
            validateBeforeSave: false,
        });
    }

    // Create an account ONLY if neither
    // the Google ID nor email exists.
    else {
        try {
            user = await User.create({
                googleId,
                name: payload.name || "Google User",
                email: normalizedEmail,

                // Role is assigned only during registration.
                role: requestedRole,

                avatar: {
                    url: payload.picture || "",
                    public_id: "",
                },

                isVerified: true,
            });

            user = await User.findById(user._id).select(
                "+tokenVersion +twoFactorSecret"
            );
        } catch (error) {
            // Protect against simultaneous Google signup requests
            // and MongoDB unique-index conflicts.
            if (error.code === 11000) {
                throw new ApiError(
                    409,
                    "An account with this email or Google account already exists. Please try signing in again."
                );
            }

            throw error;
        }
    }

    if (!user) {
        throw new ApiError(
            500,
            "Unable to load Google account."
        );
    }

    // 9. Blocked account protection
    if (user.accountStatus === "blocked") {
        throw new ApiError(
            403,
            "Your account is blocked."
        );
    }

    // 10. Two-factor authentication
    if (user.twoFactorEnabled) {
        const twoFactorToken = jwt.sign(
            {
                userId: user._id.toString(),
                type:
                    user.role === "recruiter"
                        ? "recruiter"
                        : "user",
                purpose: "login-2fa",
                tokenVersion: user.tokenVersion || 0,
            },
            process.env.ACCESS_TOKEN_SECRET,
            {
                expiresIn: "5m",
            }
        );

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    twoFactorRequired: true,
                    twoFactorToken,
                    userId: user._id,
                    type:
                        user.role === "recruiter"
                            ? "recruiter"
                            : "user",
                },
                "Two-factor authentication required."
            )
        );
    }

    // 11. Create session
    const {
        session,
        accessToken,
        refreshToken,
        safeUser,
    } = await createUserSession(req, user);

    setAuthCookies(res, accessToken, refreshToken);

    // 12. Return existing account role
    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: safeUser,
                session: createSafeSession(session),
                type:
                    user.role === "recruiter"
                        ? "recruiter"
                        : "user",
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
            process.env.ACCESS_TOKEN_SECRET
        );
    } catch {
        throw new ApiError(401, "The two-factor login token is invalid or expired.");
    }

    if (
        decoded.purpose !== "login-2fa" ||
        !decoded.userId ||
        (userId && decoded.userId !== userId.toString())
    ) {
        throw new ApiError(401, "Invalid two-factor login token.");
    }

    const user = await User.findById(decoded.userId).select(
        "+twoFactorSecret +tokenVersion"
    );

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new ApiError(401, "Invalid two-factor login request.");
    }

    if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
        throw new ApiError(401, "The two-factor login token has been revoked.");
    }

    if (user.accountStatus === "blocked") {
        throw new ApiError(403, "Your account is blocked.");
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

    const { session, accessToken, refreshToken, safeUser } =
        await createUserSession(req, user);

    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: safeUser,
                session: createSafeSession(session),
                type: user.role === "recruiter" ? "recruiter" : "user",
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

  if (
    typeof incomingRefreshToken !== "string" ||
    !incomingRefreshToken
  ) {
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

    // Compare-and-swap: only one request can replace the old token.
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
          refreshTokenExpiresAt: new Date(
            Date.now() + REFRESH_TOKEN_DURATION
          ),
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
        { accessToken: newAccessToken, type: "admin" },
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

  const user = await User.findById(decodedToken._id);

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

  const sessionExists = await Session.exists(sessionFilter);

  if (!sessionExists) {
    throw new ApiError(
      401,
      "Session expired or revoked. Please log in again."
    );
  }

  const newAccessToken = await user.generateAccessToken(
    decodedToken.sessionId
  );

  const newRefreshToken = await user.generateRefreshToken(
    decodedToken.sessionId
  );

  // Only the request holding the current hash can rotate this session.
  const updateResult = await Session.updateOne(
    sessionFilter,
    {
      $set: {
        refreshToken: hashToken(newRefreshToken),
        refreshTokenExpiresAt: new Date(
          Date.now() + REFRESH_TOKEN_DURATION
        ),
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
      { accessToken: newAccessToken },
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
