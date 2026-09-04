import { Router } from "express";
import {verifyUser} from "../middleware/verifyUser.middleware.js"
import { deleteNotificationController, getMyNotificationsController, getUnreadNotificationCountController, markAllNotificationsAsReadController, markNotificationAsReadController } from "../controllers/notification.controller.js"

const router = Router();

router.get(
    "/",
    verifyUser,
    getMyNotificationsController
)

router.get(
    "/unread-count",
    verifyUser,
    getUnreadNotificationCountController
)

router.patch(
    "/read-all",
    verifyUser,
    markAllNotificationsAsReadController
)

router.patch(
    "/:notificationId/read",
    verifyUser,
    markNotificationAsReadController
)

router.delete(
    "/:notificationId/delete",
    verifyUser,
    deleteNotificationController
)

export default router;