import { Router } from "express";

import { adminAuth } from "../middleware/admin.middleware.js";
import { upload } from "../middleware/multer.middleware.js";

import {
  adminLogout,
  blockCompany,
  blockJob,
  blockUser,
  deleteJob,
  deleteUser,
  getAdminDashboardStats,
  getAdminProfile,
  getAllAdminCompanies,
  getAllJobs,
  getAllUsers,
  getCompanyById,
  getJobById,
  getUserById,
  rejectCompany,
  restoreCompany,
  softDeleteCompany,
  unblockCompany,
  unblockUser,
  unlockJob,
  updateAdminAvatar,
  updateUserStatus,
  verifyCompany,
} from "../controllers/admin.controller.js";

const router = Router();

router.get("/dashboard", adminAuth, getAdminDashboardStats);

router.get("/getUsers", adminAuth, getAllUsers);

router.get("/users/:userId", adminAuth, getUserById);

router.patch("/users/:userId/block", adminAuth, blockUser);

router.patch("/users/:userId/unblock", adminAuth, unblockUser);

router.delete("/users/:userId/delete", adminAuth, deleteUser);

router.patch("/users/:userId/status", adminAuth, updateUserStatus);

router.get("/companies", adminAuth, getAllAdminCompanies);

router.get("/companies/:companyId", adminAuth, getCompanyById);

router.patch("/companies/:companyId/verify", adminAuth, verifyCompany);

router.patch("/companies/:companyId/reject", adminAuth, rejectCompany);

router.patch("/companies/:companyId/block", adminAuth, blockCompany);

router.patch("/companies/:companyId/unblock", adminAuth, unblockCompany);

router.patch("/companies/:companyId/delete", adminAuth, softDeleteCompany);

router.patch("/companies/:companyId/restore", adminAuth, restoreCompany);

router.get("/jobs", adminAuth, getAllJobs);

router.get("/jobs/:jobId", adminAuth, getJobById);

router.patch("/jobs/:jobId/block", adminAuth, blockJob);

router.patch("/jobs/:jobId/unlock", adminAuth, unlockJob);

router.delete("/jobs/:jobId", adminAuth, deleteJob);

router.get("/profile", adminAuth, getAdminProfile);

router.patch(
  "/profile/avatar",
  adminAuth,
  upload.single("avatar"),
  updateAdminAvatar
);

router.post("/logout", adminAuth, adminLogout);

export default router;