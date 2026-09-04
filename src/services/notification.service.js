import { Notification } from "../models/notification.model.js";
import {User} from "../models/user.model.js"
const createNotification = async ({recipient,sender = null,type,title,message,data = {}}) => {
    const notification = await Notification.create({
        recipient,
        sender,
        type,
        title,
        message,
        data,
    });

    return notification;
};

const createBulkNotifications = async ({recipients,sender = null,type,title,message,data = {}}) => {
    if (!recipients || recipients.length === 0) {
        return [];
    }

    const notifications = recipients.map((recipient) => ({
        recipient,
        sender,
        type,
        title,
        message,
        data,
    }));

    return await Notification.insertMany(notifications);
};

const createNotificationForAllUsers = async ({sender = null,type,title,message,data = {}}) => {
    const users = await User.find({}, "_id");

    if (!users.length) {
        return [];
    }

    const notifications = users.map((user) => ({
        recipient: user._id,
        sender,
        type,
        title,
        message,
        data,
    }));

    return await Notification.insertMany(notifications);
};

const getMyNotifications = async ({userId,page = 1,limit = 20}) => {
    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(
        Math.max(Number(limit) || 20, 1),
        100
    );

    const skip = (pageNumber - 1) * limitNumber;

    const [notifications, total] = await Promise.all([
        Notification.find({
            recipient: userId,
        })
            .populate("sender", "name avatar")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNumber)
            .lean(),

        Notification.countDocuments({
            recipient: userId,
        }),
    ]);

    return {
        notifications,
        pagination: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages: Math.ceil(total / limitNumber),
        },
    };
};

const getUnreadNotificationCount = async (userId) => {
    return await Notification.countDocuments({
        recipient: userId,
        isRead: false,
    });
};

const markNotificationAsRead = async ({notificationId,userId}) => {
    return await Notification.findOneAndUpdate(
        {
            _id: notificationId,
            recipient: userId,
            isRead: false,
        },
        {
            $set: {
                isRead: true,
                readAt: new Date(),
            },
        },
        {
            new: true,
        }
    );
};

const markAllNotificationsAsRead = async (userId) => {
    const result = await Notification.updateMany(
        {
            recipient: userId,
            isRead: false,
        },
        {
            $set: {
                isRead: true,
                readAt: new Date(),
            },
        }
    );

    return result;
};

const deleteNotification = async ({notificationId,userId}) => {
    return await Notification.findOneAndDelete({
        _id: notificationId,
        recipient: userId,
    });
};

export {
    createNotification,
    createBulkNotifications,
    createNotificationForAllUsers,
    getMyNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
};