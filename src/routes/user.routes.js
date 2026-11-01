
import { Router } from "express";

import {
    changeName,
    deleteAccount,
    enable2FA,
    fetchUser,
    forgetPassword,
    googleAuth,
    loginUser,
    logoutCurrentUser,
    refreshAccessToken,
    registerUser,
    sendDeleteAccountOtp,
    sendForgetPasswordOtp,
    sendVerifyAccountOtp,
    updateAvatar,
    updateCoverImage,
    verify2FALogin,
    verify2FASetup,
    verifyAccount,
} from "../controllers/user.controllers.js";

import { upload } from "../middleware/multer.middleware.js";
import { loginRateLimit } from "../rateLimiting/loginLimiter.js";
import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { deviceInfoMiddleware } from "../middleware/deviceInfoMiddleware.middleware.js";

const router = Router();

// Registration
router.post("/register", registerUser);

// Login and logout
router.post(
    "/login",
    loginRateLimit,
    deviceInfoMiddleware,
    loginUser
);

router.post(
    "/logoutCurrentUser",
    verifyUser,
    logoutCurrentUser
);

// Email verification
router.post(
    "/sendEmailVerificationOtp",
    verifyUser,
    sendVerifyAccountOtp
);

router.post(
    "/VerifyEmail",
    verifyUser,
    verifyAccount
);

// Password reset
router.post(
    "/SendPasswordResetOtp",
    sendForgetPasswordOtp
);

router.post(
    "/forgetPassword",
    forgetPassword
);

// User profile
router.patch(
    "/changeName",
    verifyUser,
    changeName
);

router.get(
    "/fetchUser",
    verifyUser,
    fetchUser
);

router.patch(
    "/update-avatar",
    verifyUser,
    upload.single("avatar"),
    updateAvatar
);

router.patch(
    "/update-coverImage",
    verifyUser,
    upload.single("coverImage"),
    updateCoverImage
);

// Account deletion
router.post(
    "/sendDeleteAccountOtp",
    verifyUser,
    sendDeleteAccountOtp
);

router.delete(
    "/deleteAccount",
    verifyUser,
    deleteAccount
);

// Refresh token
router.post(
    "/refreshAccessToken",
    refreshAccessToken
);

// Google OAuth
router.post(
    "/google",
    googleAuth
);

// Two-factor authentication
router.post(
    "/2fa/enable",
    verifyUser,
    enable2FA
);

router.post(
    "/2fa/verify-setup",
    verifyUser,
    verify2FASetup
);

router.post(
    "/login/2fa",
    verify2FALogin
);

export default router;
