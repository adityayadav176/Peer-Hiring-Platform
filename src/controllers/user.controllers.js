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
import JWT from "jsonwebtoken";
import { UAParser } from "ua-parser-js";
import { Session } from "../models/session.model.js";
import { deleteFromCloudinary } from "../utils/cloudinary.js";
import Admin from "../models/admin.model.js";
import jwt from "jsonwebtoken";

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
        phoneNo,
        role
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

    const avatarUpload = await uploadOnCloudinary(avatarLocalPath);
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

        role,

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


const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION = 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite:
    process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
};

const ACCESS_TOKEN_DURATION = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_DURATION = 30 * 24 * 60 * 60 * 1000;

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

const createSafeSession = (session) => ({
  _id: session._id,
  device: session.device,
  browser: session.browser,
  os: session.os,
  ipAddress: session.ipAddress,
  createdAt: session.createdAt,
  lastActiveAt: session.lastActiveAt,
});

const getSafeUser = async (userId) => {
  return User.findById(userId).select(
    [
      "-password",
      "-refreshToken",
      "-forgetPasswordOtp",
      "-forgetPasswordOtpExpiredAt",
      "-passwordResetToken",
      "-passwordResetTokenExpiresAt",
      "-deleteAccountOtp",
      "-deleteAccountOtpExpiredAt",
      "-emailVerificationOTP",
      "-emailVerificationOTPExpiry",
      "-twoFactorSecret",
    ].join(" ")
  );
};

const loginUser = asyncHandler(async (req, res) => {
  const { email, phoneNo, password } = req.body;
  const ipAddress = req.ip;

  // 1. Validate login input
  if ((!email?.trim() && !phoneNo?.trim()) || !password) {
    throw new ApiError(
      400,
      "Email or phone number and password are required"
    );
  }

  if (
    !process.env.ACCESS_TOKEN_SECRET ||
    !process.env.REFRESH_TOKEN_SECRET
  ) {
    throw new ApiError(
      500,
      "Authentication environment variables are missing"
    );
  }

  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedPhone = phoneNo?.trim();

  if (normalizedEmail) {
    const admin = await Admin.findOne({
      email: normalizedEmail,
    }).select("+password");

    if (admin) {
      if (!admin.isActive) {
        throw new ApiError(403, "Admin account is inactive");
      }

      if (!admin.password) {
        throw new ApiError(401, "Invalid email or password");
      }

      const isPasswordCorrect = await bcrypt.compare(
        password,
        admin.password
      );

      if (!isPasswordCorrect) {
        throw new ApiError(401, "Invalid email or password");
      }

      admin.lastLoginAt = new Date();

      await admin.save({
        validateBeforeSave: false,
      });

      const accessToken = jwt.sign(
        {
          adminId: admin._id.toString(),
          type: "admin",
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn:
            process.env.ACCESS_TOKEN_EXPIRY || "7d",
        }
      );

      const refreshToken = jwt.sign(
        {
          adminId: admin._id.toString(),
          type: "admin",
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
          expiresIn:
            process.env.REFRESH_TOKEN_EXPIRY || "30d",
        }
      );

      setAuthCookies(res, accessToken, refreshToken);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            _id: admin._id,
            name: admin.name,
            email: admin.email,
            isActive: admin.isActive,
            lastLoginAt: admin.lastLoginAt,
            accessToken,
            type: "admin",
          },
          "Admin logged in successfully"
        )
      );
    }
  }

  const userConditions = [];

  if (normalizedEmail) {
    userConditions.push({
      email: normalizedEmail,
    });
  }

  if (normalizedPhone) {
    userConditions.push({
      phoneNo: normalizedPhone,
    });
  }

  const user = await User.findOne({
    $or: userConditions,
  }).select("+password");

  // Always check existence before accessing user properties.
  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  // Your schema roles are exactly "User" and "recruiter".
  if (!["User", "recruiter"].includes(user.role)) {
    throw new ApiError(403, "Invalid account role");
  }

  const accountType =
    user.role === "recruiter" ? "recruiter" : "user";

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

  // Reset an expired temporary lock.
  if (user.lockUntil && user.lockUntil <= new Date()) {
    user.lockUntil = null;
    user.failedLoginAttempts = 0;

    await user.save({
      validateBeforeSave: false,
    });
  }

  // 6. Reject passwordless social-login accounts.
  if (!user.password) {
    throw new ApiError(
      400,
      "This account does not have a password. Please use your social login."
    );
  }

  // 7. Verify password.
  const isPasswordCorrect =
    await user.isPasswordCorrect(password);

  if (!isPasswordCorrect) {
    user.failedLoginAttempts =
      (user.failedLoginAttempts || 0) + 1;

    if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockUntil = new Date(
        Date.now() + LOCK_DURATION
      );

      await user.save({
        validateBeforeSave: false,
      });

      throw new ApiError(
        423,
        "Too many failed login attempts. Account locked for 1 hour."
      );
    }

    await user.save({
      validateBeforeSave: false,
    });

    const attemptsLeft =
      MAX_LOGIN_ATTEMPTS - user.failedLoginAttempts;

    throw new ApiError(
      401,
      `Invalid email or password. ${attemptsLeft} attempt(s) remaining.`
    );
  }

  // 8. Two-factor authentication.
  // Do not issue normal session cookies until 2FA succeeds.
  if (user.twoFactorEnabled) {
    const twoFactorToken = jwt.sign(
      {
        userId: user._id.toString(),
        type: accountType,
        purpose: "login-2fa",
        tokenVersion: user.tokenVersion,
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
          type: accountType,
        },
        "Two-factor authentication required"
      )
    );
  }

  // 9. Reset failed-login tracking after successful authentication.
  user.failedLoginAttempts = 0;
  user.lockUntil = null;

  // 10. Create session.
  const deviceInfo = req.deviceInfo || {};
  const userAgent = req.get("user-agent") || "";

  const session = await Session.create({
    userId: user._id,
    device: deviceInfo.device || "Unknown",
    browser: deviceInfo.browser || "Unknown",
    os: deviceInfo.os || "Unknown",
    ipAddress,
    userAgent,
    lastActiveAt: new Date(),
  });

  try {
    // 11. Generate tokens using your User schema methods.
    const accessToken = user.generateAccessToken(
      session._id.toString()
    );

    const refreshToken = user.generateRefreshToken(
      session._id.toString()
    );

    // Store a hash of the refresh token in the session.
    const hashedRefreshToken = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    session.refreshToken = hashedRefreshToken;

    session.refreshTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_DURATION
    );

    await session.save();

    // 12. Update user presence.
    user.isOnline = true;
    user.lastSeen = new Date();
    user.lastSeenAt = new Date();

    await user.save({
      validateBeforeSave: false,
    });

    // 13. Fetch the appropriate safe account document.
    const safeUser = await getSafeUser(user._id);

    if (!safeUser) {
      throw new ApiError(500, "Unable to load account details");
    }

    // 14. Set authentication cookies.
    setAuthCookies(res, accessToken, refreshToken);

    const safeSession = createSafeSession(session);

    // 15. Recruiter response.
    if (user.role === "recruiter") {
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            recruiter: safeUser,
            session: safeSession,
            accessToken,
            type: "recruiter",
          },
          "Recruiter logged in successfully"
        )
      );
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          user: safeUser,
          session: safeSession,
          accessToken,
          type: "user",
        },
        "User logged in successfully"
      )
    );
  } catch (error) {
    await Session.deleteOne({
      _id: session._id,
    });

    throw error;
  }
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
    const {
        password,
        confirmPassword,
        otp,
    } = req.body;

    if (!password || !confirmPassword || !otp) {
        throw new ApiError(
            400,
            "OTP, Password And Confirm Password Are Required"
        );
    }

    if (password !== confirmPassword) {
        throw new ApiError(
            400,
            "Password And Confirm Password Do Not Match"
        );
    }

    // Get reset token from HttpOnly cookie
    const resetToken = req.cookies?.passwordResetToken;

    if (!resetToken) {
        throw new ApiError(
            400,
            "Password Reset Session Expired"
        );
    }

    // Hash the token received from cookie
    const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

    // Find user using hashed reset token
    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetTokenExpiresAt: {
            $gt: Date.now(),
        },
    });

    if (!user) {
        throw new ApiError(
            400,
            "Invalid Or Expired Password Reset Session"
        );
    }

    // Check OTP exists
    if (
        !user.forgetPasswordOtp ||
        !user.forgetPasswordOtpExpiredAt
    ) {
        throw new ApiError(
            400,
            "Request OTP First"
        );
    }

    // Check OTP expiration
    if (
        user.forgetPasswordOtpExpiredAt < Date.now()
    ) {
        throw new ApiError(
            400,
            "OTP Expired"
        );
    }

    // Compare entered OTP with hashed OTP
    const isOtpValid = await bcrypt.compare(
        otp,
        user.forgetPasswordOtp
    );

    if (!isOtpValid) {
        throw new ApiError(
            400,
            "Invalid OTP"
        );
    }

    // Update password
    user.password = password;

    // Remove OTP
    user.forgetPasswordOtp = undefined;
    user.forgetPasswordOtpExpiredAt = undefined;

    // Remove reset token
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresAt = undefined;

    await user.save({
        validateBeforeSave: false,
    });

    res.clearCookie("passwordResetToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
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

    const otp = crypto.randomInt(100000, 1000000).toString();

    const hashedOtp = await bcrypt.hash(otp, 10);

    const resetToken = crypto
        .randomBytes(32)
        .toString("hex");

    const hashedResetToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

    user.passwordResetToken = hashedResetToken;

    user.passwordResetTokenExpiresAt =
        Date.now() + 10 * 60 * 1000;

    user.forgetPasswordOtp = hashedOtp;

    user.forgetPasswordOtpExpiredAt =
        Date.now() + 2 * 60 * 1000;

    await user.save({
        validateBeforeSave: false,
    });

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

                    <p>
                        If you did not request a password reset,
                        please ignore this email.
                    </p>
                </div>
            `,
        });
    } catch (error) {
        user.forgetPasswordOtp = undefined;
        user.forgetPasswordOtpExpiredAt = undefined;
        user.passwordResetToken = undefined;
        user.passwordResetTokenExpiresAt = undefined;

        await user.save({
            validateBeforeSave: false,
        });

        throw new ApiError(
            500,
            "Failed To Send OTP"
        );
    }

    res.cookie("passwordResetToken", resetToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Password Reset OTP Sent Successfully"
        )
    );
});

const updateCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "CoverImage File Required");
    }

    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    const uploadCoverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!uploadCoverImage?.secure_url || !uploadCoverImage?.public_id) {
        throw new ApiError(500, "Failed To Upload Cover Image")
    }

        // delete old avatar
    if (user.coverImage?.public_id) {
        await cloudinary.uploader.destroy(user.coverImage.public_id);
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


    const uploadAvatar = await uploadOnCloudinary(avatarLocalPath);

    if (!uploadAvatar?.secure_url || !uploadAvatar?.public_id) {
        throw new ApiError(500, "Failed To Upload Avatar");
    }
    
    // delete old avatar
    if (user.avatar?.public_id) {
        await cloudinary.uploader.destroy(user.avatar.public_id);
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
    const { credential, role } = req.body;

    const ipAddress = req.ip;

    if (!credential) {
        throw new ApiError(
            400,
            "Google credential is required"
        );
    }

    const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.email) {
        throw new ApiError(
            400,
            "Invalid Google Token"
        );
    }

    const {
        sub: googleId,
        email,
        name,
        picture,
    } = payload;

    const normalizedEmail = email
        .toLowerCase()
        .trim();

    const adminEmail = process.env.ADMIN_EMAIL
        ?.toLowerCase()
        .trim();

    if (
        adminEmail &&
        normalizedEmail === adminEmail
    ) {
        throw new ApiError(
            403,
            "Admin accounts can only login using email and password"
        );
    }

    const normalizedRole =
        role === "recruiter"
            ? "recruiter"
            : "User";

    let user = await User.findOne({
        $or: [
            { googleId },
            { email: normalizedEmail },
        ],
    });

    if (!user) {
        user = await User.create({
            googleId,
            name: name || "Google User",
            email: normalizedEmail,
            role: normalizedRole,
            avatar: {
                url: picture || "",
                public_id: "",
            },
            isVerified: true,
        });
    } else {
        if (!user.googleId) {
            user.googleId = googleId;
        }

        if (!user.avatar?.url && picture) {
            user.avatar = {
                url: picture,
                public_id: "",
            };
        }

        user.isVerified = true;

        await user.save({
            validateBeforeSave: false,
        });
    }

    const deviceInfo = req.deviceInfo || {};

    const userAgent =
        req.headers["user-agent"] || "";

    const session = await Session.create({
        userId: user._id,
        device: deviceInfo.device || "Unknown",
        browser: deviceInfo.browser || "Unknown",
        os: deviceInfo.os || "Unknown",
        ipAddress,
        userAgent,
        lastActiveAt: new Date(),
    });

    const accessToken =
        user.generateAccessToken(session._id);

    const refreshToken =
        user.generateRefreshToken(session._id);

    const hashedRefreshToken = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

    session.refreshToken = hashedRefreshToken;

    session.refreshTokenExpiresAt = new Date(
        Date.now() +
        7 * 24 * 60 * 60 * 1000
    );

    await session.save();

    user.lastSeenAt = new Date();
    user.isOnline = true;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    await user.save({
        validateBeforeSave: false,
    });

    const safeSession = {
        _id: session._id,
        device: session.device,
        browser: session.browser,
        os: session.os,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
    };

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:
            process.env.NODE_ENV === "production"
                ? "none"
                : "lax",
    };

    res.cookie(
        "accessToken",
        accessToken,
        {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000,
        }
    );

    res.cookie(
        "refreshToken",
        refreshToken,
        {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        }
    );

    const safeUser = await User.findById(
        user._id
    ).select(
        "-password " +
        "-refreshToken " +
        "-forgetPasswordOtp " +
        "-passwordResetToken " +
        "-deleteAccountOtp " +
        "-emailVerificationOTP " +
        "-twoFactorSecret"
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: safeUser,
                session: safeSession,
                accessToken,
                type: "user",
            },
            "Google authentication successful"
        )
    );
});

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

    if (!userId || !token) {
        throw new ApiError(
            400,
            "User ID and authentication code are required"
        );
    }

    const user = await User.findById(userId);

    if (!user || !user.twoFactorSecret) {
        throw new ApiError(400, "Invalid request");
    }

    // --------------------------------------------
    // 1. Verify 2FA OTP
    // --------------------------------------------

    const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token.toString().trim(),
        window: 1,
    });

    if (!verified) {
        throw new ApiError(400, "Invalid OTP");
    }

    // --------------------------------------------
    // 2. Device / Session information
    // --------------------------------------------

    const ipAddress = req.ip;

    const deviceInfo = req.deviceInfo || {};

    const userAgent =
        req.headers["user-agent"] || "";

    // --------------------------------------------
    // 3. Create Session
    // --------------------------------------------

    const session = await Session.create({
        userId: user._id,

        device:
            deviceInfo.device || "Unknown",

        browser:
            deviceInfo.browser || "Unknown",

        os:
            deviceInfo.os || "Unknown",

        ipAddress,

        userAgent,

        lastActiveAt: new Date(),
    });

    // --------------------------------------------
    // 4. Generate tokens
    // --------------------------------------------

    const accessToken =
        user.generateAccessToken(session._id);

    const refreshToken =
        user.generateRefreshToken(session._id);

    // --------------------------------------------
    // 5. Hash refresh token
    // --------------------------------------------

    const hashedRefreshToken = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

    session.refreshToken = hashedRefreshToken;

    session.refreshTokenExpiresAt = new Date(
        Date.now() +
            7 * 24 * 60 * 60 * 1000
    );

    await session.save();

    // --------------------------------------------
    // 6. Update user login information
    // --------------------------------------------

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.lastSeenAt = new Date();
    user.isOnline = true;

    await user.save({
        validateBeforeSave: false,
    });

    // --------------------------------------------
    // 7. Safe session
    // --------------------------------------------

    const safeSession = {
        _id: session._id,
        device: session.device,
        browser: session.browser,
        os: session.os,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
    };

    // --------------------------------------------
    // 8. Safe user
    // --------------------------------------------

    const safeUser = await User.findById(
        user._id
    ).select(
        "-password " +
        "-refreshToken " +
        "-forgetPasswordOtp " +
        "-passwordResetToken " +
        "-deleteAccountOtp " +
        "-emailVerificationOTP " +
        "-twoFactorSecret"
    );

    // --------------------------------------------
    // 9. Cookies
    // --------------------------------------------

    const cookieOptions = {
        httpOnly: true,

        secure:
            process.env.NODE_ENV === "production",

        sameSite:
            process.env.NODE_ENV === "production"
                ? "none"
                : "lax",
    };

    res.cookie(
        "accessToken",
        accessToken,
        {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000,
        }
    );

    res.cookie(
        "refreshToken",
        refreshToken,
        {
            ...cookieOptions,
            maxAge:
                7 *
                24 *
                60 *
                60 *
                1000,
        }
    );

    // --------------------------------------------
    // 10. Response
    // --------------------------------------------

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: safeUser,
                session: safeSession,
                accessToken,
                type: "user",
            },
            "2FA login successful"
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