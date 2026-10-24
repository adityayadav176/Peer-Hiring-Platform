import { Router } from "express";
import { changeName, deleteAccount, enable2FA, fetchUser, forgetPassword, googleAuth, loginUser, logoutCurrentUser, refreshAccessToken, registerUser, sendDeleteAccountOtp, sendForgetPasswordOtp, sendVerifyAccountOtp, updateAvatar, updateCoverImage, verify2FALogin, verify2FASetup, verifyAccount } from "../controllers/user.controllers.js"
import { upload } from "../middleware/multer.middleware.js"
import { loginRateLimit } from "../rateLimiting/loginLimiter.js";
import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { deviceInfoMiddleware } from "../middleware/deviceInfoMiddleware.middleware.js";

const router = Router();

// api Routes
router.post(
    "/register",
    upload.fields([
        {
            name: "avatar",
            maxCount: 1,
        },
        {
            name: "coverImage",
            maxCount: 1,
        },
    ]),
    registerUser
);

router.post("/login",deviceInfoMiddleware, loginRateLimit, loginUser);
router.post("/sendEmailVerificationOtp",verifyUser, sendVerifyAccountOtp);
router.post("/VerifyEmail",verifyUser, verifyAccount);
router.post("/SendPasswordResetOtp", sendForgetPasswordOtp);
router.post("/forgetPassword", forgetPassword);
router.patch("/changeName",verifyUser, changeName);
router.post("/logoutCurrentUser",verifyUser, logoutCurrentUser);
router.post("/sendDeleteAccountOtp",verifyUser, sendDeleteAccountOtp);
router.delete("/deleteAccount",verifyUser, deleteAccount);
router.get("/fetchUser",verifyUser, fetchUser);
router.post("/refreshAccessToken", refreshAccessToken);
router.patch("/update-avatar",
    verifyUser,
    upload.single("avatar"),
    updateAvatar
)
router.patch("/update-coverImage",
    verifyUser,
    upload.single("coverImage"),
    updateCoverImage
)

// oauth Routes
router.post("/google", googleAuth);

// 2fa Routes
router.post("/2fa/enable", verifyUser, enable2FA);
router.post("/2fa/verify-setup", verifyUser, verify2FASetup);
router.post("/login/2fa", verify2FALogin);
export default router