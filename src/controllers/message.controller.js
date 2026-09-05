import { Message } from "../models/message.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import mongoose from "mongoose"
import { Conversation } from "../models/converstion.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"

const getMessages = asyncHandler(async (req, res) => {

    const { conversationId } = req.params;

    const userId = req.user?._id;

    const { before } = req.query;

    let limit = Number(req.query.limit) || 30;

    // Prevent very large requests
    if (limit < 1) {
        limit = 30;
    }

    if (limit > 50) {
        limit = 50;
    }

    // Authentication

    if (!userId) {
        throw new ApiError(
            401,
            "Unauthorized access denied"
        );
    }


    // Validate conversation ID

    if (!conversationId || !mongoose.isValidObjectId(conversationId)) {
        throw new ApiError(400, "Invalid conversation ID");
    }

    // Validate before cursor
    if (before && !mongoose.isValidObjectId(before)) {
        throw new ApiError(400, "Invalid pagination cursor");
    }
    // Find conversation
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
        throw new ApiError(
            404,
            "Conversation not found"
        );
    }
    // Check deleted conversation
    if (conversation.isDeleted) {
        throw new ApiError(404, "Conversation is deleted");
    }
    // Check user is participant
    const isParticipant = conversation.participants.some(
        participant =>
            participant.toString() === userId.toString()
    );

    if (!isParticipant) {
        throw new ApiError(
            403,
            "You are not a participant of this conversation"
        );
    }
    // Build message query
    const query = {
        conversation: conversationId,
        isDeleted: false
    };


    // Cursor pagination
    if (before) {

        const cursorMessage = await Message.findOne({
            _id: before,
            conversation: conversationId
        });

        if (!cursorMessage) {
            throw new ApiError(
                400,
                "Invalid message cursor"
            );
        }

        query.createdAt = {
            $lt: cursorMessage.createdAt
        };
    }
    // Fetch messages
    const messages = await Message.find(query)
        .sort({
            createdAt: -1
        })
        .limit(limit + 1)
        .populate(
            "sender",
            "name email avatar"
        );
    // Check if more messages exist
    const hasMore = messages.length > limit;
    // Remove extra message
    if (hasMore) {
        messages.pop();
    }
    // Reverse for chat UI
    messages.reverse();
    // Next cursor
    const nextCursor =
        hasMore && messages.length > 0
            ? messages[0]._id
            : null;
    return res.status(200).json(
        new ApiResponse(
            200,
            {
                messages,
                pagination: {
                    limit,
                    hasMore,
                    nextCursor
                }
            },
            "Messages fetched successfully"
        )
    );
});

const editMessage = asyncHandler(async (req, res) => {
    const { messageId } = req.params;

    const {content} = req.body;

    if (!messageId || !mongoose.isValidObjectId(messageId)) {
        throw new ApiError(400, "Invalid messageId");
    }

    if(typeof content !== "string" || !content.trim()) {
        throw new ApiError(400, "Message content is required");
    }

    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied");
    }

    const message = await Message.findOneAndUpdate(
        {
            _id: messageId,
            sender: userId,
            isDeleted: false
        },
        {
            $set: {
                isEdited: true,
                content: content.trim(),
                editedAt: new Date
            }
        },
        {
            new: true,
            runValidators: true
        }
    ).populate("sender", "name email avatar");

    if (!message) {
        throw new ApiError(404, "Message not found");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, message, "message edited successfully")
        )
})

const deleteMessage = asyncHandler(async (req, res) => {
    const {messageId} = req.params;

    if(!messageId || !mongoose.isValidObjectId(messageId)) {
        throw new ApiError(400, "Invalid message id")
    } 

    const userId = req.user._id;

    if(!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const message = await Message.findOneAndDelete({
        _id: messageId,
        sender: userId
    });

    if(!message) {
        throw new ApiError(404, "Message not found Or deleted");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, {}, "Message deleted Successfully")
    )
})

const markMessageAsRead = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!messageId || !mongoose.isValidObjectId(messageId)) {
        throw new ApiError(400, "Invalid message id");
    }

    const message = await Message.findById(messageId);

    if (!message) {
        throw new ApiError(404, "Message not found");
    }

    const conversation = await Conversation.findById(message.conversation);

    if (!conversation) {
        throw new ApiError(404, "Conversation not found");
    }

    const isParticipant = conversation.participants.some(
        participant => participant.toString() === userId.toString()
    );

    if (!isParticipant) {
        throw new ApiError(
            403,
            "You are not a participant of this conversation"
        );
    }

    const alreadyRead = message.readBy?.some(
        item => item.user.toString() === userId.toString()
    );

    if (!alreadyRead) {
        message.readBy.push({
            user: userId,
            readAt: new Date()
        });

        await message.save();
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            message,
            "Message marked as read successfully"
        )
    );
});

const markMessageAsDelivered = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!messageId || !mongoose.isValidObjectId(messageId)) {
        throw new ApiError(400, "Invalid message id");
    }

    const message = await Message.findById(messageId);

    if (!message) {
        throw new ApiError(404, "Message not found");
    }

    const conversation = await Conversation.findById(message.conversation);

    if (!conversation) {
        throw new ApiError(404, "Conversation not found");
    }

    const isParticipant = conversation.participants.some(
        participant => participant.toString() === userId.toString()
    );

    if (!isParticipant) {
        throw new ApiError(
            403,
            "You are not a participant of this conversation"
        );
    }

    const alreadyDelivered = message.deliveredTo?.some(
        item => item.user.toString() === userId.toString()
    );

    if (!alreadyDelivered) {
        message.deliveredTo.push({
            user: userId,
            deliveredAt: new Date()
        });

        await message.save();
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            message,
            "Message marked as delivered successfully"
        )
    );
});

const uploadChatFile = asyncHandler(async (req, res) => {
    if(req.file) {
        throw new ApiError(400, "PLease select a file");
    }

    const file = req?.file;

    const cloudinaryResponse = await uploadOnCloudinary(file);

    if(!cloudinaryResponse) {
        throw new ApiError(500, "Failed to upload file to cloudinary");
    }

    const originalName = file.originalName;

    const extension = originalName.includes(".") ? originalName.split(".").pop().tolowerCase() : "";

    const fileData = {
        url: cloudinaryResponse.secure_url,

        public_id: cloudinaryResponse.public_id,

        fileName: cloudinaryResponse.original_filename || originalName,

        originalName,

        mimeType: file.mimeType,

        size: file.size,

        resourceType: cloudinaryResponse.resource_type,

        formet: cloudinaryResponse.formet,
    };

    return res.status(200).json(
        new ApiResponse(200, fileData, "File uploaded successfully")
    )
})


export {
    markMessageAsRead,
    markMessageAsDelivered,
    getMessages,
    editMessage,
    deleteMessage,
    uploadChatFile
};
