import { Router } from "express";
import {
  createCompany,
  getMyCompany,
  getCompanyById,
  updateCompany,
  updateCompanyLogo,
} from "../controllers/company.controller.js";

import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { upload } from "../middleware/multer.middleware.js";
import {isRecruiter} from "../middleware/recuiter.middleware.js"

const router = Router();

router.post("/", verifyUser,isRecruiter, upload.single("logo"), createCompany);

router.get("/my-company", verifyUser, isRecruiter, getMyCompany);

router.get("/:companyId", verifyUser, isRecruiter, getCompanyById);

router.patch("/:companyId", verifyUser, isRecruiter, updateCompany);

router.patch(
  "/:companyId/logo",
  verifyUser,
  isRecruiter,
  upload.single("logo"),
  updateCompanyLogo
);

export default router;