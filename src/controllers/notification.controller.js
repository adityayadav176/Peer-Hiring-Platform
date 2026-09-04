import { ApiResponse } from "../utils/ApiResponse.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"

import { getMyNotifications, getUnreadNotificationCount, markAllNotificationsAsRead, markNotificationAsRead, deleteNotification } from "../services/notification.service.js";

const getMyNotificationsController = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const {page, limit} = req.query;

    const result = await getMyNotifications({
        userId,
        page,
        limit
    });

    return res.status(200)
    .json(
        new ApiResponse(200, result, "Notifcation Fetched successfully")
    )
})

const getUnreadNotificationCountController = asyncHandler(async(req, res) => {
  const userId = req.user._id;
  
  const count = getUnreadNotificationCount(userId);

  return res.status(200)
  .json(
    new ApiResponse(200, count, "Unread notification fetched successfully")
  )
})

const markNotificationAsReadController = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const {notificationId} = req.params;

    const notification = await markNotificationAsRead({
        notificationId,
        userId
    });

    if(!notification) {
        throw new ApiError(400, "Notification not found or already read");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, notification, "Notification marked as read")
    )
})

const markAllNotificationsAsReadController = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const result = await markAllNotificationsAsRead(userId);

    return res.status(200)
    .json(
        new ApiResponse(200, result, "All Notification marked as read")
    )
})

const deleteNotificationController = asyncHandler(async (req, res) => {
    const userId = req.user_id;
    const {notificationId} = req.params;

    const notification = await deleteNotification({
        notificationId,
        userId
    });

    if(!notification) {
        throw new ApiError(404, "Notification not found");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, {}, "Notification Deleted Successfully")
    );
})

export {
    getMyNotificationsController,
    getUnreadNotificationCountController,
    markNotificationAsReadController,
    markAllNotificationsAsReadController,
    deleteNotificationController
}