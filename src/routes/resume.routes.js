import { Router } from "express";
import { verifyUser } from "../middleware/verifyUser.middleware.js";
import { deleteResume, downloadResume, getAllUserResumes, getResumeById, permanentlyDeleteResume, replaceResumeFile, restoreResume, setIsDefault, updateResumeDetails, uploadResume } from "../controllers/resume.controller.js";
import { upload } from "../middleware/multer.middleware.js";
import {isRecruiter} from "../middleware/recuiter.middleware.js"

const router = Router();

router.post(
    "/", 
    verifyUser,
    upload.single("resume"), 
    uploadResume
)
router.get("/userResume",verifyUser,isRecruiter ,getAllUserResumes);
router.get("/:resumeId",verifyUser, getResumeById);
router.patch("/:resumeId", verifyUser, updateResumeDetails);
router.patch("/update/:resumeId",
    verifyUser,
    upload.single("resume"),
    replaceResumeFile
);
router.patch("/ChangeStatus/:resumeId", verifyUser, setIsDefault);
router.patch("/delete/:resumeId", verifyUser, deleteResume);
router.patch("/restore/:resumeId", verifyUser, restoreResume);
router.delete("/delete/Recycle/:resumeId", verifyUser, permanentlyDeleteResume);
router.get(
    "/:resumeId/download",
    verifyUser,
    downloadResume
);
export default router;