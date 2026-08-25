import mongoose, { Schema } from "mongoose";

const attachmentSchema = new Schema(
    {
        url: {
            type: String,
            required: true
        },

        publicId: {
            type: String
        },

        fileName: {
            type: String
        },

        originalName: {
            type: String,
            default: null
        },

        mimeType: {
            type: String,
            default: null
        },

        extension: {
            type: String,
            default: null
        },

        size: {
            type: Number,
            default: 0
        },

           width: {
            type: Number,
            default: null,
        },

        height: {
            type: Number,
            default: null,
        },

        // Audio/video duration
        duration: {
            type: Number,
            default: null,
        },

        // Optional thumbnail
        thumbnailUrl: {
            type: String,
            default: null,
        },
    },
    {
        _id: false
    }
);

const readSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        readAt: {
            type: Date,
            default: null
        }
    },
    {
        _id: false
    }
);

const deliveredSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        deliveredAt: {
            type: Date,
            default: null
        }
    },
    {
        _id: false
    }
);

const messageSchema = new Schema(
    {
        conversation: {
            type: Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
            index: true
        },

        sender: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        content: {
            type: String,
            trim: true,
            maxlength: 5000
        },

        messageType: {
            type: String,
            enum: [
                "text",
                "image",
                "video",
                "audio",
                "document",
                "file"
            ],
            default: "text"
        },

        attachments: {
            type: [attachmentSchema],
            default: []
        },

        deliveredTo: {
            type: [deliveredSchema],
            default: []
        },

        readBy: {
            type: [readSchema],
            default: []
        },

        isEdited: {
            type: Boolean,
            default: false
        },

        editedAt: {
            type: Date,
            default: null
        },

        isDeleted: {
            type: Boolean,
            default: false
        },

        deletedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Get messages of a conversation
messageSchema.index({
    conversation: 1,
    createdAt: -1
});

// Get messages sent by a particular user
messageSchema.index({
    sender: 1
});

export const Message = mongoose.model("Message", messageSchema);