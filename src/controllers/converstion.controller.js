import mongoose from "mongoose";

import { Conversation } from "../models/converstion.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";


// Create or get existing conversation
const createOrGetConversation = asyncHandler(async (req, res) => {
    const { participantId, conversationType, groupName, participants } = req.body;

    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!["direct", "group"].includes(conversationType)) {
        throw new ApiError(400, "Invalid ConverstationType");
    }

    if (conversationType === "direct") {
        if (!participantId) {
            throw new ApiError(400, "ParticipantsID is Required");
        }

        if (!participantId || !mongoose.isValidObjectId(participantId)) {
            throw new ApiError(400, "Invalid ParticipantsId");
        }

        if (userId.toString() === participantId.toString()) {
            throw new ApiError(400, "You Can not Create Conversation With yourself")
        }

        const existingCoverstation = await Conversation.findOne({
            conversationType: "direct",

            participants: {
                $all: [userId, participantId],
                $size: 2,
            },

            isDeleted: false,
        }).populate("participants", "name email avatar")
            .populate("lastMessage");

        if (existingCoverstation) {
            return res.status(200)
                .json(
                    new ApiResponse(200, existingCoverstation, "Conversation Already Exists")
                )
        }

        // Create conversation

        const conversation = await Conversation.create({
            participants: [userId, participantId],

            conversationType: "direct",

            createdBy: userId
        });

        const populatedConversation = await Conversation.findById(conversation._id)
            .populate("participants", "name email avatar")
            .populate("lastMessage");

        return res.status(201).json(
            new ApiResponse(201, populatedConversation, "Conversation created successfully")
        );
    }

    if (conversationType === "group") {
        if (!participants || !Array.isArray(participants)) {
            throw new ApiError(400, "Participants must be an array");
        }

        if (participants.length < 1) {
            throw new ApiError(400, "At least one participant is required")
        }

        if (!groupName || !groupName.trim()) {
            throw new ApiError(400, "Group name Not exists");
        }

        const invalidParticipant = participants.find((id) => !mongoose.isValidObjectId(id));

        if (invalidParticipant) {
            throw new ApiError(400, "One Or more participants IDs are invalid");
        }

        const allParticipants = [userId.toString(),
        ...participants.map((id) => id.toString())
        ];

        const uniqueParticipants = [
            ...new Set(allParticipants)
        ]

        // create group conversation 

        const conversation = await Conversation.create({
            participants: uniqueParticipants,

            conversationType: "group",

            groupName: groupName.trim(),

            groupAdmin: [userId],

            createdBy: userId
        });

        const populatedConversation = await Conversation.findById(conversation._id)
            .populate("participants", "name email avatar")
            .populate("groupAdmin", "name email avatar")
            .populate("lastMessage");

        return res.status(201)
            .json(
                new ApiResponse(201, populatedConversation, "Group Converstion created successfully")
            );
    }
});

const getMyConversations = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access denied")
    }

    const conversation = await Conversation.find({
        participants: userId,

        isDeleted: false
    }).sort({
        createdAt: -1,
    }).populate("participants", "name email avatar");

    if (!conversation || conversation.length === 0) {
        throw new ApiError(404, "Conversation Not Found");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, conversation, "converstation fethed Successfully")
        )
})

const getConversationById = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const { conversationId } = req.params;

    if (!conversationId || !mongoose.isValidObjectId(conversationId)) {
        throw new ApiError(400, "Invalid conversationId");
    }

    const conversation = await Conversation.findOne({
        _id: conversationId,
        isDeleted: false,
        participants: userId
    })
        .populate("participants", "name email avatar");

    if (!conversation) {
        throw new ApiError(404, "conversation not found");
    }

    return res.status(200).json(
        new ApiResponse(200, conversation, "Conversation Fetched Successfully")
    )
})

const permanentlyDeleteConversation = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized access denied");
    }

    const { conversationId } = req.params;

    if (!conversationId || !mongoose.isValidObjectId(conversationId)) {
        throw new ApiError(400, "Invalid conversation id")
    }

    const conversation = await Conversation.findOneAndDelete({
        _id: conversationId,
        isDeleted: true,
        participants: userId
    });

    if (!conversation) {
        throw new ApiError(404, "Conversation not found or you are not authorized");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, {}, "conversation Deleted Successfully")
        )
})

const deleteConversation = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access Denied")
    }

    const { conversationId } = req.params;

    if (!conversationId || !mongoose.isValidObjectId(conversationId)) {
        throw new ApiError(400, "Invalid conversationId");
    }

    const conversation = await Conversation.findOneAndUpdate(
        {
            _id: conversationId,
            participants: userId,
            isDeleted: false
        },
        {
            $set: {
                isDeleted: true
            }
        },
        {
            new: true
        }
    );

    if (!conversation) {
        throw new ApiError(404, "Conversation not found or deleted ")
    }

    return res.status(200)
        .json(
            new ApiResponse(200, "Conversation moved to recycle bin sussessfully")
        )
})

const restoreConversation = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Access denied");
    }

    const { conversationId } = req.params;

    if (!conversationId || !mongoose.isValidObjectId(conversationId)) {
        throw new ApiError(400, "Invalid conversationId")
    }

    const conversation = await Conversation.findOneAndUpdate(
        {
            _id: conversationId,
            participants: userId,
            isDeleted: true
        },
        {
            $set: {
                isDeleted: false,
            }
        },
        {
            new: true
        }
    );

    if(!conversation) {
        throw new ApiError(404, "Conversation not found or restored")
    }

    return res.status(200)
    .json(
        new ApiResponse(200, conversation, "Conversation restored successfully")
    )
})


export {
    createOrGetConversation,
    getMyConversations,
    getConversationById,
    permanentlyDeleteConversation,
    deleteConversation,
    restoreConversation
};