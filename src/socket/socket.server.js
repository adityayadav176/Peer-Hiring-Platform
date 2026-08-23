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

    /*
        Example:

        {
            "userId1" => Set(["socketId1"]),
            "userId2" => Set(["socketId2", "socketId3"])
        }
    */

    // ==========================================
    // CONNECTION
    // ==========================================

    io.on("connection", (socket) => {
        console.log("====================================");
        console.log("User connected:", socket.id);

        // ==========================================
        // AUTHENTICATED USER
        // ==========================================

        const userId = socket.user._id.toString();

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
                awaitUserOnline(userId);
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
        // ONLY ON FIRST CONNECTION
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
                    // ==================================

                    const populatedMessage =
                        await Message.findById(
                            message._id
                        ).populate(
                            "sender",
                            "name username profileImage"
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

                    // ==================================
                    // VALIDATE
                    // ==================================

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

                    // ==================================
                    // VALIDATE
                    // ==================================

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
        // typing indigator 
        // ==========================================

        socket.on("typing_start", ({ conversationId, receiverId, conversationType }) => {
            if (!conversationId) return;

            const typingData = {
                conversationId,
                userId: socket.userId,
                userName: socket.user?.name || "Someone",
                isTyping: true,
            };

            if (conversationType === "group") {
                socket.to(`conversation:${conversationId}`).emit(
                    "user_typing",
                    typingData
                );
            } else if (receiverId) {
                io.to(receiverId).emit("user_typing", typingData);
            }
        });

        socket.on("typing_stop", ({ conversationId, receiverId, conversationType }) => {
            if (!conversationId) return;

            const typingData = {
                conversationId,
                userId: socket.userId,
                userName: socket.user?.name || "Someone",
                isTyping: false,
            };

            if (conversationType === "group") {
                socket.to(`conversation:${conversationId}`).emit(
                    "user_typing",
                    typingData
                );
            } else if (receiverId) {
                io.to(receiverId).emit("user_typing", typingData);
            }
        });

        // =========================================
        // edit emssage 
        // =========================================

        socket.on("edit_message", async ({ messageId, content }) => {
            try {
                if (!messageId || !content?.trim()) {
                    socket.emit("message_error", {
                        message: "Message ID and content are required",
                    });
                    return;
                }

                const message = await Message.findById(messageId);

                if (!message) {
                    socket.emit("message_error", {
                        message: "Message not found",
                    });
                    return;
                }

                // Only message sender can edit
                if (message.sender.toString() !== socket.userId.toString()) {
                    socket.emit("message_error", {
                        message: "You can only edit your own messages",
                    });
                    return;
                }

                // Don't allow editing deleted messages
                if (message.isDeleted) {
                    socket.emit("message_error", {
                        message: "Deleted message cannot be edited",
                    });
                    return;
                }

                message.content = content.trim();
                message.isEdited = true;
                message.editedAt = new Date();

                await message.save();

                io.to(message.conversation.toString()).emit("message_edited", {
                    messageId: message._id,
                    content: message.content,
                    isEdited: message.isEdited,
                    editedAt: message.editedAt,
                });

            } catch (error) {
                console.error("Edit message socket error:", error);

                socket.emit("message_error", {
                    message: "Failed to edit message",
                });
            }
        });

        // ==========================================
        // delete message
        // ==========================================

        socket.on("delete_message", async ({ messageId }) => {
    try {
        if (!messageId) {
            socket.emit("message_error", {
                message: "Message ID is required",
            });
            return;
        }

        const message = await Message.findById(messageId);

        if (!message) {
            socket.emit("message_error", {
                message: "Message not found",
            });
            return;
        }

        // Only sender can delete their message
        if (message.sender.toString() !== socket.user._id.toString()) {
            socket.emit("message_error", {
                message: "You can only delete your own message",
            });
            return;
        }

        // Soft delete
        message.isDeleted = true;
        message.deletedAt = new Date();
        message.content = "";

        await message.save();

        // Send updated message to everyone in conversation
        io.to(message.conversation.toString()).emit("message_deleted", {
            messageId: message._id,
            conversationId: message.conversation,
        });

    } catch (error) {
        console.error("delete_message error:", error);

        socket.emit("message_error", {
            message: "Failed to delete message",
        });
    }
        });

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
                        onlineUsers.get(userId);

                    if (!userSockets) {
                        return;
                    }

                    // ==================================
                    // REMOVE CURRENT SOCKET
                    // ==================================

                    userSockets.delete(socket.id);

                    // ==================================
                    // USER STILL HAS ANOTHER SOCKET
                    // ==================================

                    if (userSockets.size > 0) {
                        console.log(
                            `User ${userId} still has ${userSockets.size} active socket(s)`
                        );

                        return;
                    }

                    // ==================================
                    // USER COMPLETELY OFFLINE
                    // ==================================

                    onlineUsers.delete(userId);

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