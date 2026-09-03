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
import axios, { AxiosError } from "axios";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import JWT from "jsonwebtoken";
import { UAParser } from "ua-parser-js";
import { Session } from "../models/session.model.js";
import { deleteFromCloudinary } from "../utils/cloudinary.js";
import mongoose from "mongoose";
import Admin from "../models/admin.model.js";

const generateAccessAndRefreshToken = async (userId, sessionId) => {
    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const accessToken = user.generateAccessToken(sessionId);

    const refreshToken = user.generateRefreshToken(sessionId);

    return {
        accessToken,
        refreshToken
    };
};

const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
)

const registerUser = asyncHandler(async (req, res) => {
        const {
            name,
            email,
            password,
            phoneNo
        } = req.body;

        // ==============================
        // VALIDATION
        // ==============================

        if (
            !name?.trim() ||
            !email?.trim() ||
            !password?.trim() ||
            !phoneNo?.trim()
        ) {
            throw new ApiError(
                400,
                "All fields are required."
            );
        }

        const normalizedEmail =
            email.trim().toLowerCase();

        const normalizedPhone =
            phoneNo.trim();

        if (password.length < 8) {
            throw new ApiError(
                400,
                "Password must be at least 8 characters."
            );
        }

        // ==============================
        // CHECK EXISTING USER
        // ==============================

        const existedUser = await User.findOne({
            $or: [
                {
                    email: normalizedEmail
                },
                {
                    phoneNo: normalizedPhone
                }
            ]
        });

        if (existedUser) {
            throw new ApiError(
                409,
                "User already exists."
            );
        }

        // ==============================
        // GET FILES
        // ==============================

        const avatarLocalPath =
            req.files?.avatar?.[0]?.path;

        const coverLocalPath =
            req.files?.coverImage?.[0]?.path;

        if (!avatarLocalPath) {
            throw new ApiError(
                400,
                "Avatar is required."
            );
        }

        if (!coverLocalPath) {
            throw new ApiError(
                400,
                "Cover image is required."
            );
        }

        // ==============================
        // UPLOAD TO CLOUDINARY
        // ==============================

        const avatarUpload =  await uploadOnCloudinary(avatarLocalPath);
      const coverUpload = await uploadOnCloudinary(coverLocalPath);

        if (
            !avatarUpload?.secure_url ||
            !avatarUpload?.public_id
        ) {
            throw new ApiError(
                500,
                "Failed to upload avatar."
            );
        }

        if (
            !coverUpload?.secure_url ||
            !coverUpload?.public_id
        ) {
            throw new ApiError(
                500,
                "Failed to upload cover image."
            );
        }

        // ==============================
        // CREATE USER
        // ==============================

        const user = await User.create({
            name: name.trim(),

            email: normalizedEmail,

            password,

            phoneNo: normalizedPhone,

            avatar: {
                url: avatarUpload.secure_url,

                public_id: avatarUpload.public_id
            },

            coverImage: {
                url: coverUpload.secure_url,

                public_id: coverUpload.public_id
            }
        });

        // ==============================
        // SEND WELCOME EMAIL
        // ==============================

       await transporter
            .sendMail({
                from:
                    process.env.SENDER_EMAIL,

                to: normalizedEmail,

                subject:
                    `Welcome To ${PROJECT_NAME}`,

                html: `
                    <div
                        style="
                            font-family: Arial, sans-serif;
                        "
                    >

                        <h2>
                            Hello ${name}
                        </h2>

                        <p>
                            Your account has been
                            created successfully.
                        </p>

                        <p>
                            Welcome to
                            <b>
                                ${PROJECT_NAME}
                            </b>.
                        </p>

                    </div>
                `
            })
            .catch((error) => {
                console.error(
                    "Email Error:",
                    error.message
                );
            });

        // ==============================
        // FETCH SAFE USER
        // ==============================

        const createdUser =
            await User.findById(user._id)
                .select(
                    "-password -refreshToken"
                );

        // ==============================
        // RESPONSE
        // ==============================

        return res
            .status(201)
            .json(
                new ApiResponse(
                    201,
                    {
                        user: createdUser
                    },
                    "User registered successfully."
                )
            );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, phoneNo, password } = req.body;
    const ipAddress = req.ip;

    if ((!email && !phoneNo) || !password) {
        throw new ApiError(400, "All Fields Are Required");
    }

    const normalizedEmail = email?.toLowerCase().trim();
    console.log("LOGIN EMAIL:", normalizedEmail);
    // =========================================================
    // ADMIN LOGIN
    // =========================================================

    if (normalizedEmail) {
        const admin = await Admin.findOne({
            email: normalizedEmail,
        }).select("+password");

        if (!admin) {
            throw new ApiError(400, "Admin not found");
        }

        if (admin) {
            if (!admin.isActive) {
                throw new ApiError(
                    403,
                    "Admin account is inactive"
                );
            }

            const isPasswordCorrect = await bcrypt.compare(
                password,
                admin.password
            );

            if (!isPasswordCorrect) {
                throw new ApiError(
                    400,
                    "Invalid Credentials"
                );
            }

            // Update last login
            admin.lastLoginAt = new Date();

            await admin.save({
                validateBeforeSave: false,
            });

            // Generate Admin Access Token
            const accessToken = JWT.sign(
                {
                    adminId: admin._id,
                    type: "admin",
                },
                process.env.ACCESS_TOKEN_SECRET,
                {
                    expiresIn: "15m",
                }
            );

            // Generate Admin Refresh Token
            const refreshToken = JWT.sign(
                {
                    adminId: admin._id,
                    type: "admin",
                },
                process.env.REFRESH_TOKEN_SECRET,
                {
                    expiresIn: "7d",
                }
            );

            const loggedInAdmin = {
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                type: "admin",
            };

            const accessCookieOption = {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 15 * 60 * 1000,
            };

            const refreshCookieOption = {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 7 * 24 * 60 * 60 * 1000,
            };

            return res
                .status(200)
                .cookie(
                    "accessToken",
                    accessToken,
                    accessCookieOption
                )
                .cookie(
                    "refreshToken",
                    refreshToken,
                    refreshCookieOption
                )
                .json(
                    new ApiResponse(
                        200,
                        {
                            loggedInAdmin,
                            accessToken,
                            // type: "admin",
                        },
                        "Admin Login Successfully"
                    )
                );
        }
    }

    console.log("ADMIN:", admin);

    // =========================================================
    // USER LOGIN
    // =========================================================

    const user = await User.findOne({
        $or: [
            { email: normalizedEmail },
            { phoneNo },
        ],
    });

    if (!user) {
        throw new ApiError(
            404,
            "User Not Found"
        );
    }

    if (!user.password) {
        throw new ApiError(
            400,
            "This account was created using Google. Please login with Google or set a password."
        );
    }

    const remainingMinutes = user.lockUntil
        ? Math.ceil(
            (user.lockUntil - Date.now()) /
            (1000 * 60)
        )
        : 0;

    if (
        user.lockUntil &&
        user.lockUntil > Date.now()
    ) {
        throw new ApiError(
            403,
            `Account locked. Try again in ${remainingMinutes} minute(s).`
        );
    }

    const isPasswordCorrect =
        await user.isPasswordCorrect(password);

    if (!isPasswordCorrect) {
        user.failedLoginAttempts += 1;

        if (user.failedLoginAttempts >= 5) {
            user.lockUntil =
                Date.now() +
                15 * 60 * 1000;
        }

        await user.save({
            validateBeforeSave: false,
        });

        throw new ApiError(
            400,
            "Invalid Credentials"
        );
    }

    // =========================================================
    // 2FA
    // =========================================================

    if (user.twoFactorEnabled) {
        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    twoFactorRequired: true,
                    userId: user._id,
                    type: "user",
                },
                "2FA required"
            )
        );
    }

    // =========================================================
    // DEVICE INFORMATION
    // =========================================================

    const {
        browser = {},
        os = {},
        device = {},
    } = req.deviceInfo || {};

    // =========================================================
    // CREATE SESSION
    // =========================================================

    const session = await Session.create({
        userId: user._id,
        refreshToken: "",

        deviceModel:
            device.model || "",

        device:
            device.name ||
            `${browser.name || "Unknown Browser"} on ${os.name || "Unknown OS"
            }`,

        deviceType:
            device.type || "desktop",

        deviceVendor:
            device.vendor || "",

        browser:
            browser.name || "Unknown",

        browserVersion:
            browser.version || "",

        os:
            os.name || "Unknown",

        osVersion:
            os.version || "",

        ipAddress,

        userAgent:
            req.headers["user-agent"] || "",
    });

    // =========================================================
    // GENERATE USER TOKENS
    // =========================================================

    const accessToken =
        user.generateAccessToken(
            session._id
        );

    const refreshToken =
        user.generateRefreshToken(
            session._id
        );

    // =========================================================
    // HASH REFRESH TOKEN
    // =========================================================

    const hashedRefreshToken =
        crypto
            .createHash("sha256")
            .update(refreshToken)
            .digest("hex");

    session.refreshToken =
        hashedRefreshToken;

    await session.save({
        validateBeforeSave: false,
    });

    // =========================================================
    // RESET LOGIN ATTEMPTS
    // =========================================================

    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    await user.save({
        validateBeforeSave: false,
    });

    // =========================================================
    // SAFE SESSION
    // =========================================================

    const safeSession = {
        sessionId: session._id,

        deviceName:
            session.device ||
            `${session.browser} on ${session.os}`,

        deviceModel:
            session.deviceModel,

        deviceType:
            session.deviceType,

        deviceVendor:
            session.deviceVendor,

        browser:
            session.browser,

        browserVersion:
            session.browserVersion,

        os:
            session.os,

        osVersion:
            session.osVersion,

        ipAddress:
            session.ipAddress,

        lastActive:
            session.lastActive,

        createdAt:
            session.createdAt,
    };

    // =========================================================
    // LOGIN EMAIL
    // =========================================================

    const deviceName =
        session.device ||
        `${session.browser || "Unknown Browser"} on ${session.os || "Unknown OS"
        }`;

    const time =
        new Date().toISOString();

    await transporter
        .sendMail({
            from:
                process.env.SENDER_EMAIL,

            to:
                user.email,

            subject:
                "New Login Detected on Your Account",

            html: `
                <div style="font-family: Arial, sans-serif; background:#f4f4f4; padding:20px;">
                    <div style="max-width:600px; margin:auto; background:#ffffff; padding:20px; border-radius:10px; border:1px solid #e5e5e5;">

                        <h2 style="color:#111;">
                            🔐 New Login Detected
                        </h2>

                        <p style="font-size:14px; color:#333;">
                            Hi <b>${user.name}</b>, we noticed a new login to your account.
                        </p>

                        <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-top:15px;">

                            <p>
                                <b>Device:</b> ${deviceName}
                            </p>

                            <p>
                                <b>Browser:</b> ${session.browser ||
                "Unknown"
                }
                            </p>

                            <p>
                                <b>Operating System:</b> ${session.os ||
                "Unknown"
                }
                            </p>

                            <p>
                                <b>IP Address:</b> ${session.ipAddress ||
                req.ip
                }
                            </p>

                            <p>
                                <b>Time:</b> ${time}
                            </p>

                        </div>

                        <p style="margin-top:20px; font-size:14px; color:#444;">
                            If this was you, no action is required.
                        </p>

                        <p style="font-size:14px; color:#b00020;">
                            If you don't recognize this activity, please secure your account immediately by changing your password.
                        </p>

                        <hr style="margin:20px 0;" />

                        <p style="font-size:12px; color:#888;">
                            This is an automated security alert.
                        </p>

                    </div>
                </div>
            `,
        })
        .catch((err) =>
            console.error(
                "Email error:",
                err
            )
        );

    // =========================================================
    // COOKIES
    // =========================================================

    const accessCookieOption = {
        httpOnly: true,
        secure:
            process.env.NODE_ENV ===
            "production",
        sameSite: "strict",
        maxAge:
            15 * 60 * 1000,
    };

    const refreshCookieOption = {
        httpOnly: true,
        secure:
            process.env.NODE_ENV ===
            "production",
        sameSite: "strict",
        maxAge:
            7 * 24 * 60 * 60 * 1000,
    };

    // =========================================================
    // SAFE USER
    // =========================================================

    const loggedInUser =
        await User.findById(
            user._id
        ).select(
            "-password -refreshToken -forgetPasswordOtp -passwordResetToken -deleteAccountOtp -emailVerificationOTP"
        );

    // =========================================================
    // RESPONSE
    // =========================================================

    return res
        .status(200)
        .cookie(
            "accessToken",
            accessToken,
            accessCookieOption
        )
        .cookie(
            "refreshToken",
            refreshToken,
            refreshCookieOption
        )
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    session: safeSession,
                    accessToken,
                    type: "user",
                },
                "User Login Or Session Created Successfully"
            )
        );
});

const logoutCurrentUser = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    const sessionId = req.sessionId;

    if (!userId || !sessionId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findOneAndUpdate(
        { _id: userId },
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            returnDocument: "after"
        }
    );

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    const session = await Session.findByIdAndDelete(sessionId);

    if (!session) {
        throw new ApiError(404, "User Not Fount")
    }

    const cookieOption = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
    };

    return res
        .status(200)
        .clearCookie("accessToken", cookieOption)
        .clearCookie("refreshToken", cookieOption)
        .json(
            new ApiResponse(200, {}, "User Logged Out Successfully")
        )
})

const verifyAccount = asyncHandler(async (req, res) => {
    const { otp } = req.body;

    if (!otp) {
        throw new ApiError(400, "Otp required For Verificaition");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not Found");
    }

    if (user.emailVerificationOTPExpiry < Date.now()) {
        throw new ApiError(409, "Otp Already Expired");
    }

    const isOtpValid = bcrypt.compare(otp, user.emailVerificationOTP);

    if (!isOtpValid) {
        throw new ApiError(400, "Invalid Otp");
    }

    user.isVerified = true
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpiry = undefined;

    await user.save({ validateBeforeSave: false });

    return res.status(200)
        .json(
            new ApiResponse(200, {}, "Hurry! Your Email Is Now Verified")
        )
})

const sendVerifyAccountOtp = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied!");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    if (user.isVerified) {
        throw new ApiError(400, "User Already Verifed");
    }

    if (user.emailVerificationOTPExpiry && user.emailVerificationOTPExpiry > Date.now()) {
        throw new ApiError(429, "Please Wait Before requesting Another Otp");
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const hashedOtp = await bcrypt.hash(otp, 10);

    user.emailVerificationOTP = hashedOtp;
    user.emailVerificationOTPExpiry = Date.now() + 2 * 60 * 1000;

    await user.save({ validateBeforeSave: false });

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: user.email,
            subject: "Email Verification Otp",
            html: `
         <h2>Email Verification</h2>
         <p>Your OTP is:</p>
         <h1>${otp}</h1>
         <p>Valid for 2 minutes.</p>
     `
        })

    } catch (error) {
        user.emailVerificationOTP = undefined;
        user.emailVerificationOTPExpiry = undefined;
        await user.save({ validateBeforeSave: false });

        throw new ApiError(500, "Failed To Send OTP For EmailVerification");
    }
    return res.status(200)
        .json(
            new ApiResponse(200, {}, "Otp Send To Email Successfully")
        )
})

const forgetPassword = asyncHandler(async (req, res) => {
    const { password, otp, resetToken } = req.body;
    if (!password || !otp || !resetToken) {
        throw new ApiError(
            400,
            "Reset Token, Password And OTP Are Required"
        );
    }

    const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetTokenExpiresAt: {
            $gt: Date.now()
        }
    });

    if (!user) {
        throw new ApiError(
            400,
            "Invalid Or Expired Reset Token"
        );
    }

    if (!user.forgetPasswordOtp || !user.forgetPasswordOtpExpiredAt) {
        throw new ApiError(
            400,
            "Request OTP First"
        );
    }

    if (user.forgetPasswordOtpExpiredAt < Date.now()) {
        throw new ApiError(
            400,
            "OTP Expired"
        );
    }

    const isOtpValid = await bcrypt.compare(otp, user.forgetPasswordOtp);

    if (!isOtpValid) {
        throw new ApiError(
            400,
            "Invalid OTP"
        );
    }

    user.password = password;

    user.forgetPasswordOtp = undefined;
    user.forgetPasswordOtpExpiredAt = undefined;

    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresAt =
        undefined;

    await user.save({
        validateBeforeSave: false
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Password Updated Successfully"
        )
    );
});

const sendForgetPasswordOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Email Required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "Account Not Found");
    }

    if (
        user.forgetPasswordOtpExpiredAt &&
        user.forgetPasswordOtpExpiredAt > Date.now()
    ) {
        throw new ApiError(
            429,
            "Please Wait Before Requesting Another OTP"
        );
    }

    const otp = Math.floor(
        100000 + Math.random() * 900000
    ).toString();

    const hashedOtp = await bcrypt.hash(otp, 10);

    const resetToken = crypto
        .randomBytes(32)
        .toString("hex");

    user.passwordResetToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

    user.passwordResetTokenExpiresAt =
        Date.now() + 10 * 60 * 1000;

    user.forgetPasswordOtp = hashedOtp;
    user.forgetPasswordOtpExpiredAt =
        Date.now() + 2 * 60 * 1000;

    await user.save({
        validateBeforeSave: false
    });

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: email,
            subject: "Password Reset OTP",
            html: `
            <h2>Reset Your Password</h2>
            <p>Your OTP is:</p>
            <h1>${otp}</h1>
            <p>Valid for 2 minutes.</p>
        `
        });
    } catch (error) {
        user.forgetPasswordOtp = undefined;
        user.forgetPasswordOtpExpiredAt = undefined;
        user.passwordResetToken = undefined;
        user.passwordResetTokenExpiresAt = undefined;

        await user.save({
            validateBeforeSave: false
        });

        throw new ApiError(
            500,
            "Failed To Send OTP"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            { resetToken },
            "Password Reset OTP Sent Successfully"
        )
    );
});

const updateCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Avatar File Required");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    // delete old avatar
    if (user.coverImage?.public_id) {
        await cloudinary.uploader.destroy(user.coverImage.public_id);
    }

    const uploadCoverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!uploadCoverImage?.secure_url || !uploadCoverImage?.public_id) {
        throw new ApiError(500, "Failed To Upload Avatar");
    }

    user.coverImage = {
        url: uploadCoverImage.secure_url,
        public_id: uploadCoverImage.public_id
    };

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                coverImage: user.coverImage
            },
            "CoverImage Updated Successfully"
        )
    );
})

const updateAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar File Required");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    // delete old avatar
    if (user.avatar?.public_id) {
        await cloudinary.uploader.destroy(user.avatar.public_id);
    }

    const uploadAvatar = await uploadOnCloudinary(avatarLocalPath);

    if (!uploadAvatar?.secure_url || !uploadAvatar?.public_id) {
        throw new ApiError(500, "Failed To Upload Avatar");
    }

    user.avatar = {
        url: uploadAvatar.secure_url,
        public_id: uploadAvatar.public_id
    };

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                avatar: user.avatar
            },
            "Avatar Updated Successfully"
        )
    );
});

const sendDeleteAccountOtp = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    if (user.deleteAccountOtpExpiredAt && user.deleteAccountOtpExpiredAt > Date.now()) {
        throw new ApiError(429, "Please wait before requesting another OTP")
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const hashedOtp = await bcrypt.hash(otp, 10);
    user.deleteAccountOtp = hashedOtp;
    user.deleteAccountOtpExpiredAt = Date.now() + 2 * 60 * 1000;
    await user.save({ validateBeforeSave: false });

    try {
        await transporter.sendMail({
            from: process.env.SENDER_EMAIL,
            to: user.email,
            subject: "Delete Account OTP",
            html: `
              <h2>Account Deletion Verification</h2>
              <p>Use the OTP below to permanently delete your account.</p>
              <h1>${otp}</h1>
              <p>Valid for 2 minutes.</p>
          `
        })
    } catch (error) {
        user.deleteAccountOtp = undefined;
        user.deleteAccountOtpExpiredAt = undefined,
            await user.save({ validateBeforeSave: false })
        throw new ApiError(500, "Failed To Send OTP");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, {}, "OTP Send To Your Email Successfully")
        )
})

const deleteAccount = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    const { password, otp } = req.body

    if (!password || !otp) {
        throw new ApiError(400, "Password and OTP are required");
    }

    if (user.deleteAccountOtpExpiredAt < Date.now()) {
        throw new ApiError(400, "Otp Expired")
    }

    const isOtpValid = await bcrypt.compare(otp, user.deleteAccountOtp);

    if (!isOtpValid) {
        throw new ApiError(400, "Invalid Otp");
    }

    const isPasswordCorrect = await user.isPasswordCorrect(password)

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid Password");
    }

    user.deleteAccountOtp = undefined,
        user.deleteAccountOtpExpiredAt = undefined,
        await user.save({ validateBeforeSave: false });

    await User.findByIdAndDelete(userId);

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
    };

    return res.status(200)
        .clearCookie("accessToken", cookieOptions)
        .clearCookie("refreshToken", cookieOptions)
        .json(
            new ApiResponse(200, {}, "Account Deleted Successfully")
        )
})

const changeName = asyncHandler(async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
        throw new ApiError(400, "Name is required");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    user.name = name.trim();

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                _id: user._id,
                name: user.name,
                email: user.email
            },
            "Name updated successfully"
        )
    );
});

const fetchUser = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId).select("-password -refreshToken")

    return res.status(200)
        .json(
            new ApiResponse(200, user, "Fethed User Successfully")
        )
})

const googleAuth = asyncHandler(async (req, res) => {
    const { credential } = req.body;

    if (!credential) {
        throw new ApiError(
            400,
            "Google credential is required"
        );
    }

    const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload?.email) {
        throw new ApiError(400, "Invalid Google Token");
    }

    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({
        $or: [
            { googleId },
            { email }
        ]
    });

    if (!user) {
        user = await User.create({
            googleId,
            name,
            email,
            avatar: {
                url: picture || "",
                public_id: ""
            },
            isVerified: true
        });
    }

    else if (!user.googleId) {
        user.googleId = googleId;

        if (!user.avatar?.url && picture) {
            user.avatar = {
                url: picture,
                public_id: ""
            };
        }

        user.isVerified = true;

        await user.save();
    }

    const { browser = {}, os = {}, device = {} } =
        req.deviceInfo || {};

    // Create Session First
    const session = await Session.create({
        userId: user._id,

        refreshToken: "",

        deviceModel: device.model || "",
        device: device.name ||
            `${browser} on ${os}`,
        deviceType: device.type || "desktop",
        deviceVendor: device.vendor || "",

        browser: browser.name || "Unknown",
        browserVersion: browser.version || "",

        os: os.name || "Unknown",
        osVersion: os.version || "",

        ipAddress: req.ip,

        userAgent:
            req.headers["user-agent"] || ""
    });

    // Generate Tokens Using SessionId
    const accessToken =
        user.generateAccessToken(session._id);

    const refreshToken =
        user.generateRefreshToken(session._id);

    // Hash Refresh Token
    const hashedRefreshToken = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

    // Save Hash In Session
    session.refreshToken = hashedRefreshToken;

    await session.save({
        validateBeforeSave: false
    });

    // Reset Login Attempts
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    await user.save({
        validateBeforeSave: false
    });

    const safeSession = {
        sessionId: session._id,

        deviceName:
            session.device ||
            `${session.browser} on ${session.os}`,

        deviceModel: session.deviceModel,
        deviceType: session.deviceType,
        deviceVendor: session.deviceVendor,

        browser: session.browser,
        browserVersion: session.browserVersion,

        os: session.os,
        osVersion: session.osVersion,

        ipAddress: session.ipAddress,

        lastActive: session.lastActive,
        createdAt: session.createdAt
    };

    const accessCookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 15 * 60 * 1000, // 15 min
    };

    const refreshCookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    const loggedInUser = await User.findById(user._id)
        .select(
            "-password -refreshToken -forgetPasswordOtp -passwordResetToken -deleteAccountOtp -emailVerificationOTP"
        );

    return res.status(200)
        .cookie("accessToken", accessToken, accessCookieOptions)
        .cookie("refreshToken", refreshToken, refreshCookieOptions)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    session: safeSession,
                    accessToken
                },
                "User logged in successfully via Google"
            )
        );
})

const enable2FA = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    // prevent accidental overwrite
    if (user.twoFactorEnabled && user.twoFactorSecret) {
        return res.status(400).json(
            new ApiResponse(
                400,
                {},
                "2FA already enabled"
            )
        );
    }

    // generate secret
    const secret = speakeasy.generateSecret({
        name: user.email,
        issuer: "MyApp"
    });

    // store ONLY base32 secret
    user.twoFactorSecret = secret.base32;
    user.twoFactorEnabled = false;
    await user.save();

    // build proper otpauth URL
    const otpauthURL = speakeasy.otpauthURL({
        secret: secret.base32,
        label: user.email,
        issuer: "MyApp",
        encoding: "base32"
    });

    const qrCodeUrl = await QRCode.toDataURL(otpauthURL);

    return res.status(201).json(
        new ApiResponse(
            201,
            {
                qrCodeUrl,
                secret: secret.base32
            },
            "Scan QR code in Authenticator App"
        )
    );
});

const verify2FASetup = asyncHandler(async (req, res) => {
    const { token } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    if (!user.twoFactorSecret) {
        return res.status(400).json(
            new ApiResponse(400, {}, "2FA not initialized")
        );
    }

    const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token.toString().trim(),
        window: 1
    });

    if (!verified) {
        throw new ApiError(400, "Invalid OTP");
    }

    user.twoFactorEnabled = true;
    await user.save();

    return res.status(200).json(
        new ApiResponse(200, "2FA enabled successfully")
    );
});

const verify2FALogin = asyncHandler(async (req, res) => {
    const { userId, token } = req.body;

    const user = await User.findById(userId);

    if (!user || !user.twoFactorSecret) {
        throw new ApiError(400, "Invalid request");
    }

    const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token.toString().trim(),
        window: 1
    });

    if (!verified) {
        throw new ApiError(400, "Invalid OTP");
    }

    const { accessToken, refreshToken } =
        await generateAccessAndRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    const cookieOption = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    return res.status(200)
        .cookie("accessToken", accessToken, cookieOption)
        .cookie("refreshToken", refreshToken, cookieOption)
        .json(
            new ApiResponse(
                200,
                { accessToken, refreshToken },
                "2FA Verified"
            )
        );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken =
        req.cookies?.refreshToken ||
        req.body?.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    let decodedToken;

    try {
        decodedToken = JWT.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );
    } catch (error) {
        console.log(error);
        throw new ApiError(
            401,
            "Invalid or Expired Refresh Token"
        );
    }

    const user = await User.findById(decodedToken?._id);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    if (incomingRefreshToken !== user.refreshToken) {
        throw new ApiError(
            401,
            "Refresh Token Is Expired Or Already Used"
        );
    }

    const { accessToken, refreshToken } =
        await generateAccessAndRefreshToken(user._id);

    const cookieOption = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, cookieOption)
        .cookie("refreshToken", refreshToken, cookieOption)
        .json(
            new ApiResponse(
                200,
                {
                    accessToken,
                    refreshToken,
                },
                "Access Token Refreshed Successfully"
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
    refreshAccessToken
}