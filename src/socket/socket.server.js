import { Conversation } from "../models/converstion.model.js";
import { Message } from "../models/message.model.js";
import { socketAuth } from "./socket.auth.js";

export const initializeSocket = (io) => {
    // ==========================================
    // SOCKET AUTHENTICATION
    // ==========================================

    io.use(socketAuth);

    // ==========================================
    // CONNECTION
    // ==========================================

    io.on("connection", (socket) => {
        console.log(
            "User connected:",
            socket.id
        );

        console.log(
            "User ID:",
            socket.user._id
        );

        const userRoom =
            socket.user._id.toString();

        socket.join(userRoom);

        console.log(
            `User joined personal room: ${userRoom}`
        );

        // ==========================================
        // JOIN CONVERSATION
        // ==========================================

        socket.on(
            "join_conversation",
            async (conversationId) => {
                try {
                    if (!conversationId) {
                        return socket.emit(
                            "socket_error",
                            {
                                event:
                                    "join_conversation",

                                message:
                                    "Conversation ID is required",
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
                                event:
                                    "join_conversation",

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
                                participantId
                                    .toString() ===
                                socket.user._id.toString()
                        );

                    if (!isParticipant) {
                        return socket.emit(
                            "socket_error",
                            {
                                event:
                                    "join_conversation",

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

                    socket.join(
                        conversationRoom
                    );

                    console.log(
                        `User ${socket.user._id} joined conversation ${conversationRoom}`
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

                    socket.emit(
                        "socket_error",
                        {
                            event:
                                "join_conversation",

                            message:
                                "Unable to join conversation",
                        }
                    );
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
                    } = data;

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
                    // CHECK PARTICIPANT
                    // ==================================

                    const isParticipant =
                        conversation.participants.some(
                            (participantId) =>
                                participantId
                                    .toString() ===
                                socket.user._id.toString()
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
                    // SEND MESSAGE TO CONVERSATION
                    // ==================================

                    io.to(
                        conversationId.toString()
                    ).emit(
                        "new_message",
                        {
                            success: true,

                            message:
                                populatedMessage,
                        }
                    );

                    console.log(
                        `Message ${message._id} sent by ${socket.user._id}`
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
                        data;

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

                    // ==================================
                    // CURRENT AUTHENTICATED USER
                    // ==================================

                    const userId =
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
                    // CHECK ALREADY DELIVERED
                    // ==================================

                    const alreadyDelivered =
                        message.deliveredTo?.some(
                            (item) =>
                                item.user
                                    ?.toString() ===
                                userId.toString()
                        );

                    // ==================================
                    // SAVE DELIVERY STATUS
                    // ==================================

                    let deliveredAt =
                        new Date();

                    if (!alreadyDelivered) {
                        // Make sure array exists
                        if (
                            !message.deliveredTo
                        ) {
                            message.deliveredTo =
                                [];
                        }

                        message.deliveredTo.push(
                            {
                                user: userId,

                                deliveredAt,
                            }
                        );

                        await message.save();
                    }

                    // ==================================
                    // NOTIFY SENDER
                    // ==================================
                    //
                    // Sender's socket is inside:
                    //
                    // senderId room
                    //
                    // because we did:
                    //
                    // socket.join(socket.user._id.toString())
                    //
                    // ==================================

                    const senderRoom =
                        message.sender.toString();

                    io.to(senderRoom).emit(
                        "message_delivered",
                        {
                            messageId:
                                message._id.toString(),

                            userId:
                                userId.toString(),

                            deliveredAt,
                        }
                    );

                    console.log(
                        `Message ${messageId} delivered to user ${userId}`
                    );

                    console.log(
                        `Delivery status sent to sender room: ${senderRoom}`
                    );
                } catch (error) {
                    console.error(
                        "message_delivered error:",
                        error
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
                        data;

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

                    // ==================================
                    // CURRENT USER
                    // ==================================

                    const userId =
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
                    // CHECK ALREADY READ
                    // ==================================

                    const alreadyRead =
                        message.readBy?.some(
                            (item) =>
                                item.user
                                    ?.toString() ===
                                userId.toString()
                        );

                    // ==================================
                    // SAVE READ STATUS
                    // ==================================

                    let readAt =
                        new Date();

                    if (!alreadyRead) {
                        if (!message.readBy) {
                            message.readBy = [];
                        }

                        message.readBy.push({
                            user: userId,

                            readAt,
                        });

                        await message.save();
                    }

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
                                userId.toString(),

                            readAt,
                        }
                    );

                    console.log(
                        `Message ${messageId} read by user ${userId}`
                    );

                    console.log(
                        `Read status sent to sender room: ${senderRoom}`
                    );
                } catch (error) {
                    console.error(
                        "message_read error:",
                        error
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
        // DISCONNECT
        // ==========================================

        socket.on(
            "disconnect",
            (reason) => {
                console.log(
                    "User disconnected:",
                    socket.id
                );

                console.log(
                    "Reason:",
                    reason
                );
            }
        );
    });
};