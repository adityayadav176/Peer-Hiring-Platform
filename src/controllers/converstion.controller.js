import mongoose from "mongoose";

import { Conversation } from "../models/converstion.model.js";
import { Application } from "../models/application.model.js";
import { Job } from "../models/job.model.js";
import { Company } from "../models/company.model.js";
import { Message } from "../models/message.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Validate the application and retrieve its associated job and company.
 */
const getJobForApplication = async (application) => {
  const job = await Job.findOne({
    _id: application.jobId,
    companyId: application.companyId,
  }).select("_id companyId recruiterId");

  if (!job) {
    throw new ApiError(
      404,
      "The job associated with this application was not found"
    );
  }

  if (!job.recruiterId) {
    throw new ApiError(
      409,
      "No recruiter is assigned to this job"
    );
  }

  const company = await Company.findById(application.companyId)
    .select("_id isDeleted isBlocked");

  if (!company || company.isDeleted || company.isBlocked) {
    throw new ApiError(403, "This company is unavailable");
  }

  return { job, company };
};

/**
 * Populate the conversation fields used by the frontend.
 */
const populateConversation = (query) => {
  return query
    .populate("participants", "name email avatar role")
    .populate("lastMessage")
    .populate({
      path: "application",
      select: "jobId companyId candidateId",
      populate: {
        path: "jobId",
        select: "title recruiterId",
        populate: {
          path: "recruiterId",
          select: "name email avatar role",
        },
      },
    });
};

const createOrGetApplicationConversation = asyncHandler(
  async (req, res) => {
    const userId = req.user?._id;
    const { applicationId } = req.params;

    if (!userId) {
      throw new ApiError(401, "Unauthorized access");
    }

    if (!mongoose.isValidObjectId(applicationId)) {
      throw new ApiError(400, "Invalid application ID");
    }

    // 1. Find and validate the application.
    const application = await Application.findOne({
      _id: applicationId,
      isDeleted: false,
    }).select("_id candidateId jobId companyId");

    if (!application) {
      throw new ApiError(404, "Application not found");
    }

    const currentUserId = userId.toString();
    const candidateId = application.candidateId.toString();

    // 2. Load the job and validate the recruiter.
    const { job } = await getJobForApplication(application);

    if (!job?.recruiterId) {
      throw new ApiError(
        404,
        "Recruiter for this application was not found"
      );
    }

    const recruiterId = job.recruiterId.toString();

    const isCandidate = currentUserId === candidateId;
    const isRecruiter = currentUserId === recruiterId;

    if (!isCandidate && !isRecruiter) {
      throw new ApiError(
        403,
        "You are not authorized to access this application conversation"
      );
    }

    // 3. Generate a stable key for this candidate-recruiter pair.
    // Sorting ensures both participants generate the same key.
    const participantIds = [
      candidateId,
      recruiterId,
    ].sort();

    const conversationPairKey = participantIds.join("_");

    // Helper to retrieve and return an existing conversation.
    const returnExistingConversation = async (conversation) => {
      if (!conversation) {
        return null;
      }

      if (conversation.isDeleted) {
        throw new ApiError(
          410,
          "This conversation is in the recycle bin. Restore it before using it."
        );
      }

      const populatedConversation = await populateConversation(
        Conversation.findById(conversation._id)
      );

      if (!populatedConversation) {
        throw new ApiError(
          500,
          "Conversation could not be retrieved"
        );
      }

      return res.status(200).json(
        new ApiResponse(
          200,
          populatedConversation,
          "Existing conversation fetched successfully"
        )
      );
    };

    // 4. First look up by the unique candidate-recruiter key.
    let conversation = await Conversation.findOne({
      conversationPairKey,
    });

    if (conversation) {
      return await returnExistingConversation(conversation);
    }

    conversation = await Conversation.findOne({
      conversationType: "direct",
      participants: {
        $all: participantIds,
        $size: 2,
      },
    });

    if (conversation) {
      if (conversation.isDeleted) {
        throw new ApiError(
          410,
          "This conversation is in the recycle bin. Restore it before using it."
        );
      }

      // Attach the key to this existing conversation.
      if (!conversation.conversationPairKey) {
        try {
          conversation.conversationPairKey = conversationPairKey;
          await conversation.save();
        } catch (error) {
          if (error.code !== 11000) {
            throw error;
          }

          // Another request may have assigned this key first.
          conversation = await Conversation.findOne({
            conversationPairKey,
          });

          if (!conversation) {
            throw error;
          }
        }
      }

      return await returnExistingConversation(conversation);
    }

    // 6. Create a new conversation only if the pair has none.
    try {
      conversation = await Conversation.create({
        participants: [
          application.candidateId,
          job.recruiterId,
        ],
        conversationType: "direct",
        conversationPairKey,

        // Keep the first application associated with this chat.
        application: application._id,

        createdBy: userId,
      });
    } catch (error) {
      // A concurrent request may have created the same pair.
      if (error.code !== 11000) {
        throw error;
      }

      conversation = await Conversation.findOne({
        conversationPairKey,
      });

      if (!conversation) {
        throw error;
      }

      return await returnExistingConversation(conversation);
    }

    // 7. Populate and return the newly created conversation.
    const populatedConversation = await populateConversation(
      Conversation.findById(conversation._id)
    );

    if (!populatedConversation) {
      throw new ApiError(
        500,
        "Conversation was created but could not be retrieved"
      );
    }

    return res.status(201).json(
      new ApiResponse(
        201,
        populatedConversation,
        "Conversation created successfully"
      )
    );
  }
);


/**
 * Get all active conversations belonging to the logged-in user.
 */
const getMyConversations = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const conversations = await populateConversation(
    Conversation.find({
      participants: userId,
      isDeleted: false,
    }).sort({
      lastMessageAt: -1,
      updatedAt: -1,
    })
  );

  // An empty inbox is a successful result, not a 404 error.
  return res.status(200).json(
    new ApiResponse(
      200,
      conversations,
      "Conversations fetched successfully"
    )
  );
});

/**
 * Get one conversation, provided the logged-in user is a participant.
 */
const getConversationById = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { conversationId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  const conversation = await populateConversation(
    Conversation.findOne({
      _id: conversationId,
      participants: userId,
      isDeleted: false,
    })
  );

  if (!conversation) {
    throw new ApiError(
      404,
      "Conversation not found or you are not authorized"
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      conversation,
      "Conversation fetched successfully"
    )
  );
});


const deleteConversation = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { conversationId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: conversationId,
      participants: userId,
      isDeleted: false,
    },
    {
      $set: { isDeleted: true },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!conversation) {
    throw new ApiError(
      404,
      "Conversation not found, already deleted, or access denied"
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      conversation,
      "Conversation moved to the recycle bin successfully"
    )
  );
});

const restoreConversation = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { conversationId } = req.params;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!mongoose.isValidObjectId(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: conversationId,
      participants: userId,
      isDeleted: true,
    },
    {
      $set: { isDeleted: false },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!conversation) {
    throw new ApiError(
      404,
      "Deleted conversation not found or access denied"
    );
  }

  const populatedConversation = await populateConversation(
    Conversation.findById(conversation._id)
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      populatedConversation,
      "Conversation restored successfully"
    )
  );
});

const permanentlyDeleteConversation = asyncHandler(
  async (req, res) => {
    const userId = req.user?._id;
    const { conversationId } = req.params;

    if (!userId) {
      throw new ApiError(401, "Unauthorized access");
    }

    if (!mongoose.isValidObjectId(conversationId)) {
      throw new ApiError(400, "Invalid conversation ID");
    }

    const session = await mongoose.startSession();

    try {
      let deletedConversationId = null;
      let deletedMessagesCount = 0;

      await session.withTransaction(async () => {
        // Only a participant can permanently delete a conversation
        // that has already been moved to the recycle bin.
        const conversation = await Conversation.findOneAndDelete(
          {
            _id: conversationId,
            participants: userId,
            isDeleted: true,
          },
          { session }
        );

        if (!conversation) {
          throw new ApiError(
            404,
            "Deleted conversation not found or access denied"
          );
        }

        const result = await Message.deleteMany(
          { conversation: conversation._id },
          { session }
        );

        deletedConversationId = conversation._id;
        deletedMessagesCount = result.deletedCount;
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            conversationId: deletedConversationId,
            deletedMessagesCount,
          },
          "Conversation and its messages permanently deleted"
        )
      );
    } finally {
      await session.endSession();
    }
  }
);

export {
  createOrGetApplicationConversation,
  getMyConversations,
  getConversationById,
  deleteConversation,
  restoreConversation,
  permanentlyDeleteConversation,
};