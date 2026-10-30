
import { Router } from "express";
import {
  createOrGetApplicationConversation,
  deleteConversation,
  getConversationById,
  getMyConversations,
  permanentlyDeleteConversation,
  restoreConversation,
} from "../controllers/converstion.controller.js";
import { verifyUser } from "../middleware/verifyUser.middleware.js";

const router = Router();

router.post(
  "/:applicationId",
  verifyUser,
  createOrGetApplicationConversation
);
router.get("/me", verifyUser, getMyConversations);
router.get("/:conversationId", verifyUser, getConversationById);

router.delete(
  "/:conversationId/permanent",
  verifyUser,
  permanentlyDeleteConversation
);

router.patch("/:conversationId/delete", verifyUser, deleteConversation);
router.patch("/:conversationId/restore", verifyUser, restoreConversation);

export default router;
