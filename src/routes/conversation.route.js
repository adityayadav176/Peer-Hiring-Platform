import { Router } from "express";
import { createOrGetConversation, deleteConversation, getConversationById, getMyConversations, permanentlyDeleteConversation, restoreConversation } from "../controllers/converstion.controller.js";
import {verifyUser} from "../middleware/verifyUser.middleware.js"

const router = Router();

router.post("/", verifyUser ,createOrGetConversation);
router.get("/me",verifyUser, getMyConversations);
router.get("/:conversationId", verifyUser, getConversationById);
router.delete("/:conversationId/permanent", verifyUser, permanentlyDeleteConversation);
router.patch("/:conversationId/delete", verifyUser, deleteConversation);
router.patch("/conversationId/restore", verifyUser, restoreConversation)

export default router;