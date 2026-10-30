
import mongoose, { Schema } from "mongoose";

const conversationSchema = new Schema(
  {
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    conversationType: {
      type: String,
      enum: ["direct", "group"],
      default: "direct",
      required: true,
    },

    // Link a chat to the application that created it.
    // Change "Application" to your actual Mongoose model name.
    application: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      default: null,
    },

    groupName: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    groupAdmins: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    
conversationPairKey: {
  type: String,
  unique: true,
  sparse: true,
},


    lastMessageAt: {
      type: Date,
      default: null,
    },

    isDeleted: {
  type: Boolean,
  default: false,
  index: true,
},

    // Optional per-user archive functionality.
    archivedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Find conversations belonging to a user.
conversationSchema.index({
  participants: 1,
  lastMessageAt: -1,
});

// Quickly retrieve chats associated with an application.
conversationSchema.index({
  application: 1,
});


conversationSchema.index(
  { application: 1 },
  {
    unique: true,
    partialFilterExpression: {
      application: { $type: "objectId" },
    },
  }
);


export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model("Conversation", conversationSchema);
