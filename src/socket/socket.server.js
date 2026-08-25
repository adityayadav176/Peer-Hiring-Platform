import mongoose from "mongoose";

import { Conversation } from "../models/converstion.model.js";
import { Message } from "../models/message.model.js";
import { User } from "../models/user.model.js";

import { socketAuth } from "./socket.auth.js";

export const initializeSocket = (io) => {
    // ==========================================
    // SOCKET AUTHENTICATION
    // ==========================================

    io.use(socketAuth);

    // ==========================================
    // ONLINE USERS
    // userId -> Set(socketIds)
    // ==========================================

    const onlineUsers = new Map();

    // ==========================================
    // CONNECTION
    // ==========================================

    io.on("connection", async (socket) => {
        console.log("====================================");
        console.log("User connected:", socket.id);

        // ==========================================
        // AUTHENTICATED USER
        // ==========================================

        const userId = socket.user._id.toString();

        // IMPORTANT:
        // Used by typing_start / typing_stop
        socket.userId = userId;

        console.log("User ID:", userId);

        // ==========================================
        // JOIN PERSONAL USER ROOM
        // ==========================================

        const userRoom = userId;

        socket.join(userRoom);

        console.log(
            `User joined personal room: ${userRoom}`
        );

        // ==========================================
        // ADD USER TO ONLINE USERS
        // ==========================================

        let isFirstConnection = false;

        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
            isFirstConnection = true;
        }

        onlineUsers.get(userId).add(socket.id);

        console.log(
            "Online users:",
            [...onlineUsers.entries()].map(
                ([id, sockets]) => ({
                    userId: id,
                    sockets: [...sockets],
                })
            )
        );

        // ==========================================
        // UPDATE USER ONLINE STATUS
        // ==========================================

        if (isFirstConnection) {
            try {
                await awaitUserOnline(userId);
            } catch (error) {
                console.error(
                    "Failed to update online status:",
                    error.message
                );
            }
        }

        // ==========================================
        // TELL THIS USER WHO IS ONLINE
        // ==========================================

        socket.emit("online_users", {
            userIds: [...onlineUsers.keys()],
        });

        // ==========================================
        // TELL OTHER USERS THIS USER IS ONLINE
        // ONLY FIRST CONNECTION
        // ==========================================

        if (isFirstConnection) {
            socket.broadcast.emit("user_online", {
                userId,
            });
        }

        // ==========================================
        // JOIN CONVERSATION
        // ==========================================

        socket.on(
            "join_conversation",
            async (conversationId) => {
                try {
                    // ==================================
                    // VALIDATE CONVERSATION ID
                    // ==================================

                    if (!conversationId) {
                        return socket.emit(
                            "socket_error",
                            {
                                event: "join_conversation",
                                message:
                                    "Conversation ID is required",
                            }
                        );
                    }

                    if (
                        !mongoose.Types.ObjectId.isValid(
                            conversationId
                        )
                    ) {
                        return socket.emit(
                            "socket_error",
                            {
                                event: "join_conversation",
                                message:
                                    "Invalid conversation ID",
                            }
                        );
                    }

                    // ==================================
                    // FIND CONVERSATION
                    // ==================================

                    const conversation =
                        await Conversation.findById(
                            conversationId
                        );

                    if (!conversation) {
                        return socket.emit(
                            "socket_error",
                            {
                                event: "join_conversation",
                                message:
                                    "Conversation not found",
                            }
                        );
                    }

                    // ==================================
                    // CHECK DELETED
                    // ==================================

                    if (conversation.isDeleted) {
                        return socket.emit(
                            "socket_error",
                            {
                                event: "join_conversation",
                                message:
                                    "Conversation is deleted",
                            }
                        );
                    }

                    // ==================================
                    // CHECK PARTICIPANT
                    // ==================================

                    const isParticipant =
                        conversation.participants.some(
                            (participantId) =>
                                participantId.toString() ===
                                userId
                        );

                    if (!isParticipant) {
                        return socket.emit(
                            "socket_error",
                            {
                                event: "join_conversation",
                                message:
                                    "You are not a participant of this conversation",
                            }
                        );
                    }

                    // ==================================
                    // JOIN CONVERSATION ROOM
                    // ==================================

                    const conversationRoom =
                        conversationId.toString();

                    socket.join(conversationRoom);

                    console.log(
                        `User ${userId} joined conversation ${conversationRoom}`
                    );

                    // ==================================
                    // CONFIRM JOIN
                    // ==================================

                    socket.emit(
                        "conversation_joined",
                        {
                            success: true,
                            conversationId:
                                conversationRoom,
                        }
                    );
                } catch (error) {
                    console.error(
                        "Join conversation error:",
                        error.message
                    );

                    socket.emit("socket_error", {
                        event: "join_conversation",
                        message:
                            "Unable to join conversation",
                    });
                }
            }
        );

        // ==========================================
        // SEND MESSAGE
        // ==========================================

        socket.on(
            "send_message",
            async (data) => {
                try {
                    const {
                        conversationId,
                        content,
                        messageType = "text",
                    } = data || {};

                    // ==================================
                    // VALIDATE DATA
                    // ==================================

                    if (
                        !conversationId ||
                        !content?.trim()
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "conversationId and content are required",
                            }
                        );
                    }

                    if (
                        !mongoose.Types.ObjectId.isValid(
                            conversationId
                        )
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Invalid conversation ID",
                            }
                        );
                    }

                    // ==================================
                    // FIND CONVERSATION
                    // ==================================

                    const conversation =
                        await Conversation.findById(
                            conversationId
                        );

                    if (!conversation) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Conversation not found",
                            }
                        );
                    }

                    // ==================================
                    // CHECK DELETED
                    // ==================================

                    if (conversation.isDeleted) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Conversation is deleted",
                            }
                        );
                    }

                    // ==================================
                    // CHECK PARTICIPANT
                    // ==================================

                    const isParticipant =
                        conversation.participants.some(
                            (participantId) =>
                                participantId.toString() ===
                                userId
                        );

                    if (!isParticipant) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "You are not a participant of this conversation",
                            }
                        );
                    }

                    // ==================================
                    // CHECK CONVERSATION ROOM
                    // ==================================

                    const conversationRoom =
                        conversationId.toString();

                    if (
                        !socket.rooms.has(
                            conversationRoom
                        )
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "You have not joined this conversation",
                            }
                        );
                    }

                    // ==================================
                    // CREATE MESSAGE
                    // ==================================

                    const message =
                        await Message.create({
                            conversation:
                                conversationId,

                            sender:
                                socket.user._id,

                            content:
                                content.trim(),

                            messageType,
                        });

                    // ==================================
                    // UPDATE CONVERSATION
                    // ==================================

                    conversation.lastMessage =
                        message._id;

                    conversation.lastMessageAt =
                        new Date();

                    await conversation.save();

                    // ==================================
                    // POPULATE SENDER
                    // IMPORTANT FOR AVATAR
                    // ==================================

                    const populatedMessage =
                        await Message.findById(
                            message._id
                        ).populate(
                            "sender",
                            "name username email avatar avatarUrl profileImage profilePicture photo"
                        );

                    // ==================================
                    // SEND MESSAGE TO ROOM
                    // ==================================

                    io.to(conversationRoom).emit(
                        "new_message",
                        {
                            success: true,
                            message:
                                populatedMessage,
                        }
                    );

                    console.log(
                        `Message ${message._id} sent by ${userId}`
                    );
                } catch (error) {
                    console.error(
                        "Send message error:",
                        error.message
                    );

                    socket.emit(
                        "message_error",
                        {
                            success: false,
                            message:
                                "Failed to send message",
                        }
                    );
                }
            }
        );

        // ==========================================
        // MESSAGE DELIVERED
        // ==========================================

        socket.on(
            "message_delivered",
            async (data) => {
                try {
                    const { messageId } =
                        data || {};

                    if (!messageId) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "messageId is required",
                            }
                        );
                    }

                    if (
                        !mongoose.Types.ObjectId.isValid(
                            messageId
                        )
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Invalid message ID",
                            }
                        );
                    }

                    const currentUserId =
                        socket.user._id;

                    // ==================================
                    // FIND MESSAGE
                    // ==================================

                    const message =
                        await Message.findById(
                            messageId
                        );

                    if (!message) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Message not found",
                            }
                        );
                    }

                    // ==================================
                    // FIND CONVERSATION
                    // ==================================

                    const conversation =
                        await Conversation.findById(
                            message.conversation
                        );

                    if (!conversation) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Conversation not found",
                            }
                        );
                    }

                    // ==================================
                    // CHECK PARTICIPANT
                    // ==================================

                    const isParticipant =
                        conversation.participants.some(
                            (participantId) =>
                                participantId.toString() ===
                                currentUserId.toString()
                        );

                    if (!isParticipant) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "You are not a participant of this conversation",
                            }
                        );
                    }

                    // ==================================
                    // DON'T ACK OWN MESSAGE
                    // ==================================

                    if (
                        message.sender.toString() ===
                        currentUserId.toString()
                    ) {
                        return;
                    }

                    // ==================================
                    // CHECK ALREADY DELIVERED
                    // ==================================

                    const alreadyDelivered =
                        message.deliveredTo?.some(
                            (item) =>
                                item.user
                                    ?.toString() ===
                                currentUserId.toString()
                        );

                    // ==================================
                    // SAVE DELIVERY STATUS
                    // ==================================

                    if (!alreadyDelivered) {
                        if (!message.deliveredTo) {
                            message.deliveredTo = [];
                        }

                        const deliveredAt =
                            new Date();

                        message.deliveredTo.push({
                            user: currentUserId,
                            deliveredAt,
                        });

                        await message.save();

                        // ==================================
                        // NOTIFY SENDER
                        // ==================================

                        const senderRoom =
                            message.sender.toString();

                        io.to(senderRoom).emit(
                            "message_delivered",
                            {
                                messageId:
                                    message._id.toString(),

                                userId:
                                    currentUserId.toString(),

                                deliveredAt,
                            }
                        );

                        console.log(
                            `Message ${messageId} delivered to user ${currentUserId}`
                        );
                    }
                } catch (error) {
                    console.error(
                        "message_delivered error:",
                        error.message
                    );

                    socket.emit(
                        "message_error",
                        {
                            success: false,
                            message:
                                "Failed to update delivery status",
                        }
                    );
                }
            }
        );

        // ==========================================
        // MESSAGE READ / SEEN
        // ==========================================

        socket.on(
            "message_read",
            async (data) => {
                try {
                    const { messageId } =
                        data || {};

                    if (!messageId) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "messageId is required",
                            }
                        );
                    }

                    if (
                        !mongoose.Types.ObjectId.isValid(
                            messageId
                        )
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Invalid message ID",
                            }
                        );
                    }

                    const currentUserId =
                        socket.user._id;

                    // ==================================
                    // FIND MESSAGE
                    // ==================================

                    const message =
                        await Message.findById(
                            messageId
                        );

                    if (!message) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Message not found",
                            }
                        );
                    }

                    // ==================================
                    // FIND CONVERSATION
                    // ==================================

                    const conversation =
                        await Conversation.findById(
                            message.conversation
                        );

                    if (!conversation) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Conversation not found",
                            }
                        );
                    }

                    // ==================================
                    // CHECK PARTICIPANT
                    // ==================================

                    const isParticipant =
                        conversation.participants.some(
                            (participantId) =>
                                participantId.toString() ===
                                currentUserId.toString()
                        );

                    if (!isParticipant) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "You are not a participant of this conversation",
                            }
                        );
                    }

                    // ==================================
                    // DON'T READ OWN MESSAGE
                    // ==================================

                    if (
                        message.sender.toString() ===
                        currentUserId.toString()
                    ) {
                        return;
                    }

                    // ==================================
                    // CHECK ALREADY READ
                    // ==================================

                    const alreadyRead =
                        message.readBy?.some(
                            (item) =>
                                item.user
                                    ?.toString() ===
                                currentUserId.toString()
                        );

                    // ==================================
                    // SAVE READ STATUS
                    // ==================================

                    if (!alreadyRead) {
                        if (!message.readBy) {
                            message.readBy = [];
                        }

                        const readAt =
                            new Date();

                        message.readBy.push({
                            user: currentUserId,
                            readAt,
                        });

                        await message.save();

                        // ==================================
                        // NOTIFY SENDER
                        // ==================================

                        const senderRoom =
                            message.sender.toString();

                        io.to(senderRoom).emit(
                            "message_read",
                            {
                                messageId:
                                    message._id.toString(),

                                userId:
                                    currentUserId.toString(),

                                readAt,
                            }
                        );

                        console.log(
                            `Message ${messageId} read by user ${currentUserId}`
                        );
                    }
                } catch (error) {
                    console.error(
                        "message_read error:",
                        error.message
                    );

                    socket.emit(
                        "message_error",
                        {
                            success: false,
                            message:
                                "Failed to update read status",
                        }
                    );
                }
            }
        );

        // ==========================================
        // TYPING START
        // ==========================================

        socket.on(
            "typing_start",
            ({
                conversationId,
                receiverId,
                conversationType,
            }) => {
                if (!conversationId) {
                    return;
                }

                const typingData = {
                    conversationId,
                    userId: socket.userId,
                    userName:
                        socket.user?.name ||
                        "Someone",
                    isTyping: true,
                };

                if (
                    conversationType ===
                    "group"
                ) {
                    socket
                        .to(
                            `conversation:${conversationId}`
                        )
                        .emit(
                            "user_typing",
                            typingData
                        );
                } else if (receiverId) {
                    io.to(receiverId).emit(
                        "user_typing",
                        typingData
                    );
                }
            }
        );

        // ==========================================
        // TYPING STOP
        // ==========================================

        socket.on(
            "typing_stop",
            ({
                conversationId,
                receiverId,
                conversationType,
            }) => {
                if (!conversationId) {
                    return;
                }

                const typingData = {
                    conversationId,
                    userId: socket.userId,
                    userName:
                        socket.user?.name ||
                        "Someone",
                    isTyping: false,
                };

                if (
                    conversationType ===
                    "group"
                ) {
                    socket
                        .to(
                            `conversation:${conversationId}`
                        )
                        .emit(
                            "user_typing",
                            typingData
                        );
                } else if (receiverId) {
                    io.to(receiverId).emit(
                        "user_typing",
                        typingData
                    );
                }
            }
        );

        // ==========================================
        // EDIT MESSAGE
        // ==========================================

        socket.on(
            "edit_message",
            async (data) => {
                try {
                    const {
                        messageId,
                        content,
                    } = data || {};

                    if (!messageId) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Message ID is required",
                            }
                        );
                    }

                    if (
                        !mongoose.Types.ObjectId.isValid(
                            messageId
                        )
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Invalid message ID",
                            }
                        );
                    }

                    if (
                        !content ||
                        !content.trim()
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Message content is required",
                            }
                        );
                    }

                    const currentUserId =
                        socket.user?._id;

                    if (!currentUserId) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Authenticated user ID not found",
                            }
                        );
                    }

                    const message =
                        await Message.findById(
                            messageId
                        );

                    if (!message) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Message not found",
                            }
                        );
                    }

                    // ==================================
                    // ONLY SENDER CAN EDIT
                    // ==================================

                    if (
                        String(message.sender) !==
                        String(currentUserId)
                    ) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "You can only edit your own messages",
                            }
                        );
                    }

                    // ==================================
                    // CHECK DELETED
                    // ==================================

                    if (message.isDeleted) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Deleted message cannot be edited",
                            }
                        );
                    }

                    if (!message.conversation) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Message conversation is missing",
                            }
                        );
                    }

                    const conversation =
                        await Conversation.findById(
                            message.conversation
                        );

                    if (!conversation) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Conversation not found",
                            }
                        );
                    }

                    if (conversation.isDeleted) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "Conversation is deleted",
                            }
                        );
                    }

                    // ==================================
                    // CHECK PARTICIPANT
                    // ==================================

                    const isParticipant =
                        conversation.participants?.some(
                            (participantId) =>
                                participantId &&
                                String(
                                    participantId
                                ) ===
                                    String(
                                        currentUserId
                                    )
                        );

                    if (!isParticipant) {
                        return socket.emit(
                            "message_error",
                            {
                                success: false,
                                message:
                                    "You are not a participant of this conversation",
                            }
                        );
                    }

                    // ==================================
                    // UPDATE MESSAGE
                    // ==================================

                    message.content =
                        content.trim();

                    message.isEdited = true;

                    message.editedAt =
                        new Date();

                    await message.save();

                    // ==================================
                    // CONVERSATION ROOM
                    // ==================================

                    const conversationRoom =
                        String(
                            message.conversation
                        );

                    // ==================================
                    // REAL-TIME UPDATE
                    // ==================================

                    io.to(
                        conversationRoom
                    ).emit(
                        "message_edited",
                        {
                            success: true,

                            messageId:
                                String(
                                    message._id
                                ),

                            conversationId:
                                conversationRoom,

                            content:
                                message.content,

                            isEdited:
                                message.isEdited,

                            editedAt:
                                message.editedAt,
                        }
                    );
                } catch (error) {
                    console.error(
                        "EDIT MESSAGE ERROR:",
                        error.message
                    );

                    socket.emit(
                        "message_error",
                        {
                            success: false,
                            message:
                                error.message,
                        }
                    );
                }
            }
        );

        // ==========================================
        // DELETE MESSAGE
        // ==========================================

        socket.on(
            "delete_message",
            async ({ messageId }) => {
                try {
                    if (!messageId) {
                        socket.emit(
                            "message_error",
                            {
                                message:
                                    "Message ID is required",
                            }
                        );

                        return;
                    }

                    const message =
                        await Message.findById(
                            messageId
                        );

                    if (!message) {
                        socket.emit(
                            "message_error",
                            {
                                message:
                                    "Message not found",
                            }
                        );

                        return;
                    }

                    // ==================================
                    // ONLY SENDER CAN DELETE
                    // ==================================

                    if (
                        message.sender.toString() !==
                        socket.user._id.toString()
                    ) {
                        socket.emit(
                            "message_error",
                            {
                                message:
                                    "You can only delete your own message",
                            }
                        );

                        return;
                    }

                    // ==================================
                    // SOFT DELETE
                    // ==================================

                    message.isDeleted = true;

                    message.deletedAt =
                        new Date();

                    message.content = "";

                    await message.save();

                    // ==================================
                    // REAL-TIME UPDATE
                    // ==================================

                    io.to(
                        message.conversation.toString()
                    ).emit(
                        "message_deleted",
                        {
                            messageId:
                                message._id,

                            conversationId:
                                message.conversation,
                        }
                    );
                } catch (error) {
                    console.error(
                        "delete_message error:",
                        error
                    );

                    socket.emit(
                        "message_error",
                        {
                            message:
                                "Failed to delete message",
                        }
                    );
                }
            }
        );

        // ==========================================
        // DISCONNECT
        // ==========================================

        socket.on(
            "disconnect",
            async (reason) => {
                try {
                    console.log(
                        "User disconnected:",
                        socket.id
                    );

                    console.log(
                        "Reason:",
                        reason
                    );

                    const userSockets =
                        onlineUsers.get(
                            userId
                        );

                    if (!userSockets) {
                        return;
                    }

                    // ==================================
                    // REMOVE CURRENT SOCKET
                    // ==================================

                    userSockets.delete(
                        socket.id
                    );

                    // ==================================
                    // USER STILL HAS ANOTHER SOCKET
                    // ==================================

                    if (
                        userSockets.size > 0
                    ) {
                        console.log(
                            `User ${userId} still has ${userSockets.size} active socket(s)`
                        );

                        return;
                    }

                    // ==================================
                    // USER COMPLETELY OFFLINE
                    // ==================================

                    onlineUsers.delete(
                        userId
                    );

                    const lastSeen =
                        new Date();

                    // ==================================
                    // UPDATE DATABASE
                    // ==================================

                    await User.findByIdAndUpdate(
                        userId,
                        {
                            isOnline: false,
                            lastSeen,
                        },
                        {
                            new: true,
                        }
                    );

                    // ==================================
                    // TELL OTHER USERS
                    // ==================================

                    socket.broadcast.emit(
                        "user_offline",
                        {
                            userId,
                            lastSeen,
                        }
                    );

                    console.log(
                        `User ${userId} is offline at ${lastSeen.toISOString()}`
                    );
                } catch (error) {
                    console.error(
                        "Disconnect error:",
                        error.message
                    );
                }
            }
        );
    });

    // ==========================================
    // UPDATE USER ONLINE
    // ==========================================

    async function awaitUserOnline(userId) {
        const now = new Date();

        await User.findByIdAndUpdate(
            userId,
            {
                isOnline: true,
                lastSeen: now,
            },
            {
                new: true,
            }
        );
    }
};