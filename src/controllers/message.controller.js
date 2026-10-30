
import mongoose from "mongoose";

import { Message } from "../models/message.model.js";
import { Conversation } from "../models/converstion.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";

// --------------------------------------------------
// Shared helpers
// --------------------------------------------------

const validateObjectId = (id, message = "Invalid ID") => {
    if (!id || !mongoose.isValidObjectId(id)) {
        throw new ApiError(400, message);
    }
};

const requireUser = (req) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access");
    }

    return userId;
};

const getActiveParticipantConversation = async (
    conversationId,
    userId
) => {
    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
        isDeleted: false,
    });

    if (!conversation) {
        throw new ApiError(
            404,
            "Conversation not found or access denied"
        );
    }

    return conversation;
};

const getAuthorizedMessage = async (messageId, userId) => {
    const message = await Message.findOne({
        _id: messageId,
        isDeleted: false,
    });

    if (!message) {
        throw new ApiError(404, "Message not found");
    }

    const conversation = await getActiveParticipantConversation(
        message.conversation,
        userId
    );

    return { message, conversation };
};

// --------------------------------------------------
// 1. Get messages with cursor pagination
// GET /conversations/:conversationId/messages
// --------------------------------------------------

const getMessages = asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { conversationId } = req.params;
    const { before } = req.query;

    validateObjectId(
        conversationId,
        "Invalid conversation ID"
    );

    const conversation = await getActiveParticipantConversation(
        conversationId,
        userId
    );

    let limit = Number(req.query.limit);

    if (!Number.isInteger(limit) || limit < 1) {
        limit = 30;
    }

    limit = Math.min(limit, 50);

    const query = {
        conversation: conversation._id,
        isDeleted: false,
    };

    // Cursor-based pagination using both createdAt and _id.
    // This prevents skipping messages with identical timestamps.
    if (before) {
        validateObjectId(before, "Invalid pagination cursor");

        const cursorMessage = await Message.findOne({
            _id: before,
            conversation: conversation._id,
            isDeleted: false,
        }).select("_id createdAt");

        if (!cursorMessage) {
            throw new ApiError(400, "Invalid message cursor");
        }

        query.$or = [
            {
                createdAt: {
                    $lt: cursorMessage.createdAt,
                },
            },
            {
                createdAt: cursorMessage.createdAt,
                _id: {
                    $lt: cursorMessage._id,
                },
            },
        ];
    }

    const fetchedMessages = await Message.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .populate("sender", "name email avatar")
        .lean();

    const hasMore = fetchedMessages.length > limit;

    if (hasMore) {
        fetchedMessages.pop();
    }

    // Messages are returned oldest-first for chat rendering.
    fetchedMessages.reverse();

    // The oldest returned message becomes the next cursor.
    const nextCursor =
        hasMore && fetchedMessages.length > 0
            ? fetchedMessages[0]._id
            : null;

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                messages: fetchedMessages,
                pagination: {
                    limit,
                    hasMore,
                    nextCursor,
                },
            },
            "Messages fetched successfully"
        )
    );
});

// --------------------------------------------------
// 2. Edit a message
// PATCH /messages/:messageId
// --------------------------------------------------

const editMessage = asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { messageId } = req.params;
    const { content } = req.body;

    validateObjectId(messageId, "Invalid message ID");

    if (
        typeof content !== "string" ||
        !content.trim()
    ) {
        throw new ApiError(
            400,
            "Message content is required"
        );
    }

    const trimmedContent = content.trim();

    if (trimmedContent.length > 5000) {
        throw new ApiError(
            400,
            "Message cannot exceed 5000 characters"
        );
    }

    const { message, conversation } =
        await getAuthorizedMessage(messageId, userId);

    // Only the original sender may edit a message.
    if (message.sender.toString() !== userId.toString()) {
        throw new ApiError(
            403,
            "You can only edit your own messages"
        );
    }

    // This endpoint edits text messages only.
    if (message.messageType !== "text") {
        throw new ApiError(
            400,
            "Only text messages can be edited"
        );
    }

    const updatedMessage = await Message.findOneAndUpdate(
        {
            _id: message._id,
            conversation: conversation._id,
            sender: userId,
            isDeleted: false,
        },
        {
            $set: {
                content: trimmedContent,
                isEdited: true,
                editedAt: new Date(),
            },
        },
        {
            new: true,
            runValidators: true,
        }
    ).populate("sender", "name email avatar");

    if (!updatedMessage) {
        throw new ApiError(
            404,
            "Message not found or already deleted"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedMessage,
            "Message edited successfully"
        )
    );
});

// --------------------------------------------------
// 3. Soft-delete a message
// DELETE /messages/:messageId
// --------------------------------------------------

const deleteMessage = asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { messageId } = req.params;

    validateObjectId(messageId, "Invalid message ID");

    const { message, conversation } =
        await getAuthorizedMessage(messageId, userId);

    if (message.sender.toString() !== userId.toString()) {
        throw new ApiError(
            403,
            "You can only delete your own messages"
        );
    }

    const deletedMessage = await Message.findOneAndUpdate(
        {
            _id: message._id,
            conversation: conversation._id,
            sender: userId,
            isDeleted: false,
        },
        {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
            },
        },
        {
            new: true,
        }
    ).select("_id conversation isDeleted deletedAt");

    if (!deletedMessage) {
        throw new ApiError(
            404,
            "Message not found or already deleted"
        );
    }

    // Keep the message document for history/auditing.
    // The frontend should display "This message was deleted"
    // instead of exposing its content or attachments.
    return res.status(200).json(
        new ApiResponse(
            200,
            { messageId: deletedMessage._id },
            "Message deleted successfully"
        )
    );
});

// --------------------------------------------------
// 4. Mark a message as read
// POST /messages/:messageId/read
// --------------------------------------------------

const markMessageAsRead = asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { messageId } = req.params;

    validateObjectId(messageId, "Invalid message ID");

    const { message, conversation } =
        await getAuthorizedMessage(messageId, userId);

    // A sender does not need to mark their own message as read.
    if (message.sender.toString() === userId.toString()) {
        return res.status(200).json(
            new ApiResponse(
                200,
                { messageId, alreadyRead: true },
                "Own message does not require a read receipt"
            )
        );
    }

    // The condition makes repeated requests idempotent.
    await Message.updateOne(
        {
            _id: message._id,
            conversation: conversation._id,
            isDeleted: false,
            "readBy.user": { $ne: userId },
        },
        {
            $push: {
                readBy: {
                    user: userId,
                    readAt: new Date(),
                },
            },
        }
    );

    const updatedMessage = await Message.findOne({
        _id: message._id,
        conversation: conversation._id,
        isDeleted: false,
    }).select("_id readBy");

    if (!updatedMessage) {
        throw new ApiError(404, "Message not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedMessage,
            "Message marked as read successfully"
        )
    );
});

// --------------------------------------------------
// 5. Mark a message as delivered
// POST /messages/:messageId/delivered
// --------------------------------------------------

const markMessageAsDelivered = asyncHandler(
    async (req, res) => {
        const userId = requireUser(req);
        const { messageId } = req.params;

        validateObjectId(messageId, "Invalid message ID");

        const { message, conversation } =
            await getAuthorizedMessage(messageId, userId);

        if (message.sender.toString() === userId.toString()) {
            return res.status(200).json(
                new ApiResponse(
                    200,
                    { messageId, alreadyDelivered: true },
                    "Own message does not require a delivery receipt"
                )
            );
        }

        await Message.updateOne(
            {
                _id: message._id,
                conversation: conversation._id,
                isDeleted: false,
                "deliveredTo.user": { $ne: userId },
            },
            {
                $push: {
                    deliveredTo: {
                        user: userId,
                        deliveredAt: new Date(),
                    },
                },
            }
        );

        const updatedMessage = await Message.findOne({
            _id: message._id,
            conversation: conversation._id,
            isDeleted: false,
        }).select("_id deliveredTo");

        if (!updatedMessage) {
            throw new ApiError(404, "Message not found");
        }

        return res.status(200).json(
            new ApiResponse(
                200,
                updatedMessage,
                "Message marked as delivered successfully"
            )
        );
    }
);

// --------------------------------------------------
// 6. Upload a chat attachment to Cloudinary
// POST /chat/upload
// --------------------------------------------------

const uploadChatFile = asyncHandler(async (req, res) => {
    requireUser(req);

    const file = req.file;

    if (!file) {
        throw new ApiError(
            400,
            "Please select a file"
        );
    }

    // Defense-in-depth check. Also enforce limits and inspect
    // file contents in your upload middleware/storage pipeline.
    const allowedMimeTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "audio/mpeg",
        "audio/mp4",
        "audio/ogg",
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
        throw new ApiError(
            415,
            "This file type is not supported"
        );
    }

    const cloudinaryResponse = await uploadOnCloudinary(file);

    if (
        !cloudinaryResponse?.secure_url ||
        !cloudinaryResponse?.public_id
    ) {
        throw new ApiError(
            500,
            "Failed to upload file to Cloudinary"
        );
    }

    const originalName =
        file.originalname || "attachment";

    const extension = originalName.includes(".")
        ? originalName.split(".").pop().toLowerCase()
        : "";

    // Matches the attachmentSchema in your Message model.
    const attachment = {
        url: cloudinaryResponse.secure_url,
        publicId: cloudinaryResponse.public_id,
        fileName:
            cloudinaryResponse.original_filename ||
            originalName,
        originalName,
        mimeType: file.mimetype,
        extension,
        size: file.size,
        width: cloudinaryResponse.width ?? null,
        height: cloudinaryResponse.height ?? null,
        duration: cloudinaryResponse.duration ?? null,
        thumbnailUrl: null,
    };

    return res.status(200).json(
        new ApiResponse(
            200,
            { attachment },
            "File uploaded successfully"
        )
    );
});

export {
    getMessages,
    editMessage,
    deleteMessage,
    markMessageAsRead,
    markMessageAsDelivered,
    uploadChatFile,
};
