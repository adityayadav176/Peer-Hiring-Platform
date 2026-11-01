import mongoose from "mongoose";
import { Message } from "../models/message.model.js";
import { User } from "../models/user.model.js";
import { socketAuth } from "./socket.auth.js";
import { setIo } from "./socket.manager.js";
import { authorizeInterviewRoom } from "../services/interviewRoom.service.js";
import { Conversation } from "../models/converstion.model.js";

const getReferenceId = (value) => {
    if (!value) return null;

    const id = value._id ?? value;

    return id?.toString?.() ?? null;
};

const isValidObjectId = (value) =>
    typeof value === "string" &&
    mongoose.isValidObjectId(value);

const getUserName = (user) =>
    user?.name ||
    user?.fullname ||
    user?.username ||
    "Someone";

const MESSAGE_POPULATE_FIELDS =
    "name fullname username email avatar avatarUrl profileImage profilePicture photo";

export const initializeSocket = (io) => {
    setIo(io);
    io.use(socketAuth);

    // Tracks all active socket connections for each user.
    const onlineUsers = new Map();

    // Prevents overlapping database presence updates for the same user.
    const presenceSyncs = new Map();

    /**
     * Synchronize database presence with the current in-memory socket state.
     *
     * If a user disconnects while an online update is running, this loop
     * detects the changed state and applies the latest state afterward.
     */
    const schedulePresenceSync = (userId) => {
        const existingSync = presenceSyncs.get(userId);

        if (existingSync) {
            return existingSync;
        }

        const syncPromise = (async () => {
            while (true) {
                const shouldBeOnline = onlineUsers.has(userId);

                const update = shouldBeOnline
                    ? { isOnline: true }
                    : {
                        isOnline: false,
                        lastSeen: new Date(),
                    };

                await User.findByIdAndUpdate(userId, update);

                // If presence changed while the DB operation was running,
                // repeat with the latest state.
                if (onlineUsers.has(userId) === shouldBeOnline) {
                    break;
                }
            }
        })()
            .catch((error) => {
                console.error(
                    "[Socket] Presence synchronization failed:",
                    {
                        userId,
                        message: error.message,
                    }
                );
            })
            .finally(() => {
                presenceSyncs.delete(userId);
            });

        presenceSyncs.set(userId, syncPromise);

        return syncPromise;
    };

    io.on("connection", (socket) => {
        /*
         * IMPORTANT:
         * Do not make this connection callback async.
         *
         * Register socket listeners immediately. Never await MongoDB,
         * socket.join(), or another asynchronous operation before the
         * event listeners have been registered.
         */

        const rawUserId = socket.userId ?? socket.user?._id;
        const userId = getReferenceId(rawUserId);

        if (!userId || !isValidObjectId(userId)) {
            console.error("[Socket] Invalid authenticated user:", {
                socketId: socket.id,
            });

            socket.disconnect(true);
            return;
        }

        socket.userId = userId;

        console.log("[Socket] Connected:", {
            socketId: socket.id,
            userId,
            transport: socket.conn.transport.name,
        });

        // ---------------------------------------------------------
        // ONLINE PRESENCE
        // ---------------------------------------------------------

        let isFirstConnection = false;

        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
            isFirstConnection = true;
        }

        onlineUsers.get(userId).add(socket.id);

        socket.emit("online_users", {
            userIds: [...onlineUsers.keys()],
        });

        if (isFirstConnection) {
            // Do not block listener registration on this database update.
            void schedulePresenceSync(userId);

            socket.broadcast.emit("user_online", {
                userId,
            });
        }

        // ---------------------------------------------------------
        // PERSONAL ROOM
        // ---------------------------------------------------------

        // Start joining the personal room without blocking this callback.
        // Operations that depend on this room can await this promise.
        const personalRoomReady = Promise.resolve().then(() =>
            socket.join(userId)
        );

        personalRoomReady.catch((error) => {
            console.error("[Socket] Personal room join failed:", {
                socketId: socket.id,
                userId,
                message: error.message,
            });
        });

        // ---------------------------------------------------------
        // COMMON HELPERS
        // ---------------------------------------------------------

        const emitSocketError = (event, error) => {
            console.error(`[Socket] ${event} error:`, error.message);

            socket.emit("socket_error", {
                event,
                message: error.message || "Operation failed",
            });
        };

        const requireValue = (value, label) => {
            if (
                value === undefined ||
                value === null ||
                value === ""
            ) {
                throw new Error(`${label} is required`);
            }
        };

        const requireBoolean = (value, label) => {
            if (typeof value !== "boolean") {
                throw new Error(`${label} must be a boolean`);
            }
        };

        const requireValidId = (value, label) => {
            if (!isValidObjectId(value)) {
                throw new Error(`A valid ${label} is required`);
            }
        };

        // ---------------------------------------------------------
        // CHAT HELPERS
        // ---------------------------------------------------------

        const isConversationParticipant = (conversation) =>
            conversation.participants?.some(
                (participant) =>
                    getReferenceId(participant) === userId
            ) ?? false;

        const getActiveConversation = async (conversationId) => {
            requireValidId(conversationId, "conversation ID");

            const conversation =
                await Conversation.findById(conversationId);

            if (!conversation) {
                throw new Error("Conversation not found");
            }

            if (conversation.isDeleted) {
                throw new Error("Conversation is deleted");
            }

            if (!isConversationParticipant(conversation)) {
                throw new Error(
                    "You are not a participant of this conversation"
                );
            }

            return conversation;
        };

        const requireConversationRoom = async (conversationId) => {
            const conversation =
                await getActiveConversation(conversationId);

            const roomName = conversation._id.toString();

            if (!socket.rooms.has(roomName)) {
                throw new Error(
                    "Join the conversation before performing this action"
                );
            }

            return {
                conversation,
                roomName,
            };
        };

        // ---------------------------------------------------------
        // INTERVIEW HELPERS
        // ---------------------------------------------------------

        const getInterviewContext = async (interviewId) => {
            requireValidId(interviewId, "interview ID");

            const interview = await authorizeInterviewRoom({
                interviewId,
                userId,
            });

            if (!interview) {
                throw new Error(
                    "Interview not found or access denied"
                );
            }

            const candidateId = getReferenceId(interview.candidate);
            const recruiterId = getReferenceId(interview.recruiter);

            let role;

            if (candidateId === userId) {
                role = "User";
            } else if (recruiterId === userId) {
                role = "recruiter";
            } else {
                throw new Error(
                    "You are not authorized to join this interview"
                );
            }

            const canonicalInterviewId =
                interview._id.toString();

            return {
                interview,
                role,
                userId,
                interviewId: canonicalInterviewId,
                roomName: `interview:${canonicalInterviewId}`,
            };
        };

        const requireInterviewRoom = async (interviewId) => {
            if (!socket.connected) {
                throw new Error("Socket is disconnected");
            }

            const context =
                await getInterviewContext(interviewId);

            if (!socket.rooms.has(context.roomName)) {
                throw new Error(
                    "You have not joined this interview"
                );
            }

            return context;
        };

        const requireCandidate = (role) => {
            if (role !== "User") {
                throw new Error(
                    "Only the candidate can trigger this event"
                );
            }
        };

        // =========================================================
        // INTERVIEW: JOIN ROOM
        // =========================================================

        socket.on("join_interview", async (data = {}, acknowledge) => {
            const requestedInterviewId =
                typeof data === "string"
                    ? data
                    : data?.interviewId;

            console.log("[JOIN] Request received:", {
                socketId: socket.id,
                userId,
                interviewId: requestedInterviewId,
                connected: socket.connected,
            });

            try {
                if (!socket.connected) {
                    throw new Error("Socket is disconnected");
                }

                requireValidId(
                    requestedInterviewId,
                    "interview ID"
                );

                const context = await getInterviewContext(
                    requestedInterviewId
                );

                const {
                    roomName,
                    interviewId,
                    role,
                } = context;

                // Authorization may have taken time. Do not join a room
                // for a socket that disconnected during that operation.
                if (!socket.connected) {
                    throw new Error(
                        "Socket disconnected before joining the interview"
                    );
                }

                await socket.join(roomName);

                // Protect against a disconnect while socket.join() was
                // pending, particularly with asynchronous adapters.
                if (!socket.connected) {
                    await socket.leave(roomName);
                    throw new Error(
                        "Socket disconnected while joining the interview"
                    );
                }

                if (!socket.rooms.has(roomName)) {
                    throw new Error(
                        "Failed to join the interview room"
                    );
                }

                const roomSockets = await io
                    .in(roomName)
                    .fetchSockets();

                const peerPresent = roomSockets.some((peer) => {
                    if (peer.id === socket.id) {
                        return false;
                    }

                    const peerUserId = getReferenceId(
                        peer.userId ?? peer.user?._id
                    );

                    return peerUserId !== userId;
                });

                const payload = {
                    success: true,
                    interviewId,
                    role,
                    peerPresent,
                };

                console.log("[JOIN] Sending confirmation:", {
                    socketId: socket.id,
                    userId,
                    interviewId,
                    roomName,
                    role,
                    peerPresent,
                    roomJoined: socket.rooms.has(roomName),
                });

                // Preserve the existing frontend event.
                socket.emit("interview_joined", payload);

                // Preserve optional Socket.IO acknowledgement support.
                if (typeof acknowledge === "function") {
                    acknowledge(payload);
                }

                // Notify the other participant.
                socket.to(roomName).emit(
                    "interview_user_joined",
                    {
                        interviewId,
                        userId,
                        role,
                    }
                );
            } catch (error) {
                console.error("[JOIN] Failed:", {
                    socketId: socket.id,
                    userId,
                    interviewId: requestedInterviewId,
                    message: error.message,
                    stack: error.stack,
                });

                const errorPayload = {
                    success: false,
                    event: "join_interview",
                    interviewId: requestedInterviewId || null,
                    message:
                        error.message ||
                        "Unable to join the interview",
                };

                if (socket.connected) {
                    socket.emit("interview_error", errorPayload);
                    socket.emit("socket_error", errorPayload);
                }

                if (typeof acknowledge === "function") {
                    acknowledge(errorPayload);
                }
            }
        });

        // =========================================================
        // INTERVIEW: WEBRTC OFFER
        // =========================================================

        socket.on("offer", async (data = {}) => {
            try {
                const { interviewId, offer } = data;

                requireValue(offer, "Offer");

                const context =
                    await requireInterviewRoom(interviewId);

                if (context.role !== "recruiter") {
                    throw new Error(
                        "Only the recruiter can send the initial offer"
                    );
                }

                socket.to(context.roomName).emit("offer", {
                    interviewId: context.interviewId,
                    userId,
                    offer,
                });
            } catch (error) {
                emitSocketError("offer", error);
            }
        });

        // =========================================================
        // INTERVIEW: WEBRTC ANSWER
        // =========================================================

        socket.on("answer", async (data = {}) => {
            try {
                const { interviewId, answer } = data;

                requireValue(answer, "Answer");

                const context =
                    await requireInterviewRoom(interviewId);

                if (context.role !== "User") {
                    throw new Error(
                        "Only the candidate can send the initial answer"
                    );
                }

                socket.to(context.roomName).emit("answer", {
                    interviewId: context.interviewId,
                    userId,
                    answer,
                });
            } catch (error) {
                emitSocketError("answer", error);
            }
        });

        // =========================================================
        // INTERVIEW: ICE CANDIDATES
        // =========================================================

        socket.on("ice_candidate", async (data = {}) => {
            try {
                const { interviewId, candidate } = data;

                requireValue(candidate, "ICE candidate");

                const context =
                    await requireInterviewRoom(interviewId);

                socket.to(context.roomName).emit(
                    "ice_candidate",
                    {
                        interviewId: context.interviewId,
                        userId,
                        candidate,
                    }
                );
            } catch (error) {
                emitSocketError("ice_candidate", error);
            }
        });

        // =========================================================
        // INTERVIEW: CALL SIGNALING
        // =========================================================

        socket.on("interview_calling", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                socket.to(context.roomName).emit(
                    "interview_incoming_call",
                    {
                        interviewId: context.interviewId,
                        callerId: userId,
                        callerRole: context.role,
                    }
                );
            } catch (error) {
                emitSocketError("interview_calling", error);
            }
        });

        socket.on("interview_accepted", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                socket.to(context.roomName).emit(
                    "interview_call_accepted",
                    {
                        interviewId: context.interviewId,
                        acceptedBy: userId,
                        acceptedByRole: context.role,
                    }
                );
            } catch (error) {
                emitSocketError("interview_accepted", error);
            }
        });

        socket.on("interview_rejected", async (data = {}) => {
            try {
                const { interviewId, reason } = data;

                const context =
                    await requireInterviewRoom(interviewId);

                socket.to(context.roomName).emit(
                    "interview_call_rejected",
                    {
                        interviewId: context.interviewId,
                        rejectedBy: userId,
                        rejectedByRole: context.role,
                        reason: reason || "Call rejected",
                    }
                );
            } catch (error) {
                emitSocketError("interview_rejected", error);
            }
        });

        socket.on("call_ended", async (data = {}) => {
            try {
                const { interviewId, reason } = data;

                const context =
                    await requireInterviewRoom(interviewId);

                const payload = {
                    interviewId: context.interviewId,
                    endedBy: userId,
                    endedByRole: context.role,
                    reason: reason || "Call ended",
                    endedAt: new Date(),
                };

                socket.to(context.roomName).emit(
                    "call_ended",
                    payload
                );

                socket.emit("call_ended", payload);
            } catch (error) {
                emitSocketError("call_ended", error);
            }
        });

        // =========================================================
        // INTERVIEW: CAMERA / MICROPHONE
        // =========================================================

        socket.on("camera_toggled", async (data = {}) => {
            try {
                const { interviewId, enabled } = data;

                requireBoolean(enabled, "Camera status");

                const context =
                    await requireInterviewRoom(interviewId);

                socket.to(context.roomName).emit(
                    "remote_camera_toggled",
                    {
                        interviewId: context.interviewId,
                        userId,
                        enabled,
                    }
                );
            } catch (error) {
                emitSocketError("camera_toggled", error);
            }
        });

        socket.on("microphone_toggled", async (data = {}) => {
            try {
                const { interviewId, enabled } = data;

                requireBoolean(enabled, "Microphone status");

                const context =
                    await requireInterviewRoom(interviewId);

                socket.to(context.roomName).emit(
                    "remote_microphone_toggled",
                    {
                        interviewId: context.interviewId,
                        userId,
                        enabled,
                    }
                );
            } catch (error) {
                emitSocketError("microphone_toggled", error);
            }
        });

        // =========================================================
        // INTERVIEW: SCREEN SHARING
        // =========================================================

        socket.on("screen_share_started", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                socket.to(context.roomName).emit(
                    "remote_screen_share_started",
                    {
                        interviewId: context.interviewId,
                        userId,
                    }
                );
            } catch (error) {
                emitSocketError("screen_share_started", error);
            }
        });

        socket.on("screen_share_stopped", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                socket.to(context.roomName).emit(
                    "remote_screen_share_stopped",
                    {
                        interviewId: context.interviewId,
                        userId,
                    }
                );
            } catch (error) {
                emitSocketError("screen_share_stopped", error);
            }
        });

        // =========================================================
        // INTERVIEW: CANDIDATE TAB MONITORING
        // =========================================================

        socket.on("candidate_tab_changed", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                requireCandidate(context.role);

                socket.to(context.roomName).emit(
                    "candidate_tab_changed",
                    {
                        interviewId: context.interviewId,
                        candidateId: userId,
                        changedAt: new Date(),
                    }
                );
            } catch (error) {
                emitSocketError("candidate_tab_changed", error);
            }
        });

        socket.on("candidate_tab_returned", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                requireCandidate(context.role);

                socket.to(context.roomName).emit(
                    "candidate_tab_returned",
                    {
                        interviewId: context.interviewId,
                        candidateId: userId,
                        returnedAt: new Date(),
                    }
                );
            } catch (error) {
                emitSocketError("candidate_tab_returned", error);
            }
        });

        // =========================================================
        // INTERVIEW: LEAVE ROOM
        // =========================================================

        socket.on("leave_interview", async (data = {}) => {
            try {
                const context =
                    await requireInterviewRoom(data.interviewId);

                await socket.leave(context.roomName);

                socket.to(context.roomName).emit(
                    "interview_user_left",
                    {
                        interviewId: context.interviewId,
                        userId,
                        role: context.role,
                    }
                );

                socket.emit("interview_left", {
                    success: true,
                    interviewId: context.interviewId,
                });
            } catch (error) {
                emitSocketError("leave_interview", error);
            }
        });

        // =========================================================
        // CHAT: JOIN CONVERSATION
        // =========================================================

        socket.on("join_conversation", async (data = {}) => {
            try {
                const conversationId =
                    typeof data === "string"
                        ? data
                        : data?.conversationId;

                const conversation =
                    await getActiveConversation(conversationId);

                const roomName = conversation._id.toString();

                if (!socket.connected) {
                    throw new Error("Socket is disconnected");
                }

                await socket.join(roomName);

                if (!socket.connected) {
                    await socket.leave(roomName);

                    throw new Error(
                        "Socket disconnected while joining conversation"
                    );
                }

                if (!socket.rooms.has(roomName)) {
                    throw new Error(
                        "Failed to join the conversation room"
                    );
                }

                socket.emit("conversation_joined", {
                    success: true,
                    conversationId: roomName,
                });

                console.log("[Chat] User joined conversation:", {
                    userId,
                    conversationId: roomName,
                    socketId: socket.id,
                });
            } catch (error) {
                emitSocketError("join_conversation", error);
            }
        });

        // =========================================================
        // CHAT: LEAVE CONVERSATION
        // =========================================================

        socket.on("leave_conversation", async (payload = {}) => {
            try {
                const conversationId =
                    typeof payload === "string"
                        ? payload
                        : payload?.conversationId;

                const conversation =
                    await getActiveConversation(conversationId);

                const roomName = conversation._id.toString();

                if (socket.rooms.has(roomName)) {
                    await socket.leave(roomName);
                }

                console.log("[Chat] User left conversation:", {
                    userId,
                    conversationId: roomName,
                    socketId: socket.id,
                });
            } catch (error) {
                emitSocketError("leave_conversation", error);
            }
        });

        // =========================================================
        // CHAT: SEND TEXT MESSAGE
        // =========================================================

        socket.on("send_message", async (data = {}) => {
            try {
                const {
                    conversationId,
                    content,
                    messageType = "text",
                } = data;

                if (
                    typeof content !== "string" ||
                    !content.trim()
                ) {
                    throw new Error("Message content is required");
                }

                const { conversation, roomName } =
                    await requireConversationRoom(conversationId);

                if (messageType !== "text") {
                    throw new Error(
                        "Use the appropriate event for this message type"
                    );
                }

                const message = await Message.create({
                    conversation: conversation._id,
                    sender: socket.user._id,
                    content: content.trim(),
                    messageType: "text",
                });

                conversation.lastMessage = message._id;
                conversation.lastMessageAt = new Date();

                await conversation.save();

                const populatedMessage = await Message.findById(
                    message._id
                ).populate(
                    "sender",
                    MESSAGE_POPULATE_FIELDS
                );

                io.to(roomName).emit("new_message", {
                    success: true,
                    message: populatedMessage,
                });
            } catch (error) {
                socket.emit("message_error", {
                    success: false,
                    message:
                        error.message || "Failed to send message",
                });
            }
        });

        // =========================================================
        // CHAT: SEND FILE MESSAGE
        // =========================================================

        socket.on("send_file_message", async (data = {}) => {
            try {
                const {
                    conversationId,
                    attachment,
                } = data;

                if (
                    !attachment ||
                    typeof attachment.url !== "string" ||
                    !attachment.url.trim()
                ) {
                    throw new Error("File attachment is required");
                }

                const { conversation, roomName } =
                    await requireConversationRoom(conversationId);

                const mimeType = attachment.mimeType || "";

                let messageType = "file";

                if (mimeType.startsWith("image/")) {
                    messageType = "image";
                } else if (mimeType.startsWith("video/")) {
                    messageType = "video";
                } else if (mimeType.startsWith("audio/")) {
                    messageType = "audio";
                } else if (
                    mimeType === "application/pdf" ||
                    mimeType.includes("word") ||
                    mimeType.includes("document")
                ) {
                    messageType = "document";
                }

                const message = await Message.create({
                    conversation: conversation._id,
                    sender: socket.user._id,
                    content: "",
                    messageType,
                    attachments: [
                        {
                            url: attachment.url,
                            publicId: attachment.publicId || null,
                            fileName: attachment.fileName || null,
                            originalName:
                                attachment.originalName || null,
                            mimeType: attachment.mimeType || null,
                            extension: attachment.extension || null,
                            size: Number(attachment.size) || 0,
                        },
                    ],
                });

                conversation.lastMessage = message._id;
                conversation.lastMessageAt = new Date();

                await conversation.save();

                const populatedMessage = await Message.findById(
                    message._id
                ).populate(
                    "sender",
                    MESSAGE_POPULATE_FIELDS
                );

                io.to(roomName).emit("new_message", {
                    success: true,
                    message: populatedMessage,
                });
            } catch (error) {
                socket.emit("message_error", {
                    success: false,
                    message:
                        error.message || "Failed to send file",
                });
            }
        });

        // =========================================================
        // CHAT: DELIVERY AND READ RECEIPTS
        // =========================================================

        const updateMessageReceipt = async (
            messageId,
            receiptType
        ) => {
            requireValidId(messageId, "message ID");

            const message = await Message.findById(messageId);

            if (!message) {
                throw new Error("Message not found");
            }

            const conversation = await getActiveConversation(
                getReferenceId(message.conversation)
            );

            // A sender should not mark their own message as delivered/read.
            if (getReferenceId(message.sender) === userId) {
                return;
            }

            const field =
                receiptType === "read"
                    ? "readBy"
                    : "deliveredTo";

            const timestamp = new Date();

            const receipt = {
                user: socket.user._id,
                ...(receiptType === "read"
                    ? { readAt: timestamp }
                    : { deliveredAt: timestamp }),
            };

            /*
             * Atomic update prevents two simultaneous receipt events
             * from adding duplicate entries for the same user.
             */
            const updatedMessage =
                await Message.findOneAndUpdate(
                    {
                        _id: messageId,
                        [field]: {
                            $not: {
                                $elemMatch: {
                                    user: socket.user._id,
                                },
                            },
                        },
                    },
                    {
                        $push: {
                            [field]: receipt,
                        },
                    },
                    {
                        new: true,
                    }
                );

            // Another concurrent event may already have recorded it.
            if (!updatedMessage) {
                return;
            }

            // Ensure the personal room is ready before sending the receipt.
            await personalRoomReady;

            if (!socket.connected) {
                return;
            }

            const eventName =
                receiptType === "read"
                    ? "message_read"
                    : "message_delivered";

            io.to(getReferenceId(message.sender)).emit(
                eventName,
                {
                    messageId: message._id.toString(),
                    conversationId: conversation._id.toString(),
                    userId,
                    ...(receiptType === "read"
                        ? { readAt: timestamp }
                        : { deliveredAt: timestamp }),
                }
            );
        };

        socket.on("message_delivered", async (data = {}) => {
            try {
                await updateMessageReceipt(
                    data.messageId,
                    "delivered"
                );
            } catch (error) {
                socket.emit("message_error", {
                    success: false,
                    message: error.message,
                });
            }
        });

        socket.on("message_read", async (data = {}) => {
            try {
                await updateMessageReceipt(
                    data.messageId,
                    "read"
                );
            } catch (error) {
                socket.emit("message_error", {
                    success: false,
                    message: error.message,
                });
            }
        });

        // =========================================================
        // CHAT: TYPING INDICATORS
        // =========================================================

        const handleTyping = async (data = {}, isTyping) => {
            try {
                const { conversationId } = data;

                const { conversation, roomName } =
                    await requireConversationRoom(conversationId);

                socket.to(roomName).emit("user_typing", {
                    conversationId: conversation._id.toString(),
                    userId,
                    userName: getUserName(socket.user),
                    isTyping,
                });
            } catch (error) {
                emitSocketError(
                    isTyping ? "typing_start" : "typing_stop",
                    error
                );
            }
        };

        socket.on("typing_start", (data) => {
            void handleTyping(data, true);
        });

        socket.on("typing_stop", (data) => {
            void handleTyping(data, false);
        });

        // =========================================================
        // CHAT: EDIT MESSAGE
        // =========================================================

        socket.on("edit_message", async (data = {}) => {
            try {
                const { messageId, content } = data;

                requireValidId(messageId, "message ID");

                if (
                    typeof content !== "string" ||
                    !content.trim()
                ) {
                    throw new Error("Message content is required");
                }

                const message = await Message.findById(messageId);

                if (!message) {
                    throw new Error("Message not found");
                }

                if (getReferenceId(message.sender) !== userId) {
                    throw new Error(
                        "You can only edit your own messages"
                    );
                }

                if (message.isDeleted) {
                    throw new Error(
                        "Deleted messages cannot be edited"
                    );
                }

                const { conversation, roomName } =
                    await requireConversationRoom(
                        getReferenceId(message.conversation)
                    );

                message.content = content.trim();
                message.isEdited = true;
                message.editedAt = new Date();

                await message.save();

                io.to(roomName).emit("message_edited", {
                    success: true,
                    messageId: message._id.toString(),
                    conversationId: conversation._id.toString(),
                    content: message.content,
                    isEdited: message.isEdited,
                    editedAt: message.editedAt,
                });
            } catch (error) {
                socket.emit("message_error", {
                    success: false,
                    message:
                        error.message || "Failed to edit message",
                });
            }
        });

        // =========================================================
        // CHAT: DELETE MESSAGE
        // =========================================================

        socket.on("delete_message", async (data = {}) => {
            try {
                const { messageId } = data;

                requireValidId(messageId, "message ID");

                const message = await Message.findById(messageId);

                if (!message) {
                    throw new Error("Message not found");
                }

                if (getReferenceId(message.sender) !== userId) {
                    throw new Error(
                        "You can only delete your own messages"
                    );
                }

                const { conversation, roomName } =
                    await requireConversationRoom(
                        getReferenceId(message.conversation)
                    );

                await Message.findByIdAndDelete(messageId);

                io.to(roomName).emit("message_deleted", {
                    messageId: message._id.toString(),
                    conversationId: conversation._id.toString(),
                });
            } catch (error) {
                socket.emit("message_error", {
                    success: false,
                    message:
                        error.message || "Failed to delete message",
                });
            }
        });

        // =========================================================
        // INTERVIEW: DISCONNECTING NOTIFICATION
        // =========================================================

        socket.on("disconnecting", (reason) => {
            for (const roomName of socket.rooms) {
                if (!roomName.startsWith("interview:")) {
                    continue;
                }

                const interviewId =
                    roomName.slice("interview:".length);

                socket.to(roomName).emit(
                    "interview_user_left",
                    {
                        interviewId,
                        userId,
                        disconnected: true,
                        reason,
                    }
                );
            }
        });

        // =========================================================
        // DISCONNECT / OFFLINE PRESENCE
        // =========================================================

        socket.on("disconnect", (reason) => {
            console.log("[Socket] Disconnected:", {
                socketId: socket.id,
                userId,
                reason,
            });

            const userSockets = onlineUsers.get(userId);

            if (!userSockets) {
                return;
            }

            userSockets.delete(socket.id);

            // Another tab/device is still connected.
            if (userSockets.size > 0) {
                console.log(
                    `[Socket] ${userId} still has ${userSockets.size} active socket(s)`
                );

                return;
            }

            onlineUsers.delete(userId);

            const lastSeen = new Date();
            void schedulePresenceSync(userId).then(() => {
                // The user may have reconnected while the DB update ran.
                if (onlineUsers.has(userId)) {
                    return;
                }

                socket.broadcast.emit("user_offline", {
                    userId,
                    lastSeen,
                });
            });
        });
    });
};