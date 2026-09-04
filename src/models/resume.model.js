import mongoose, { Schema } from "mongoose";

const resumeSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "User",
        index: true
    },

    title: {
        type: String,
        required: true,
        trim: true
    },

    resume: {
        url: {
            type: String,
            required: true,
        },
        public_id: {
            type: String,
            required: true,
        },
    },

    isDefault: {
        type: Boolean,
        default: false
    },

    version: {
        type: Number,
        default: 1
    },

    isDeleted: {
        type: Boolean,
        default: false,
    },

    deletedAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

resumeSchema.index({
    user: 1,
    isDeleted: 1
})

export const Resume = mongoose.model("Resume", resumeSchema);