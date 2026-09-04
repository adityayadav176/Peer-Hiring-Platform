import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema({
    recipient: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    sender: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },

    type: {
        type: String,
        required: true,
        enum: [
            "APPLICATION_SUBMITTED",
            "APPLICATION_ACCEPTED",
            "APPLICATION_REJECTED",

            "INTERVIEW_SCHEDULED",
            "INTERVIEW_RESCHEDULED",
            "INTERVIEW_CANCELLED",

            "NEW_MESSAGE",

            "JOB_POSTED",
            "JOB_UPDATED",
            "JOB_CLOSED",

            "COMPANY_VERIFIED",
            "COMPANY_REJECTED",

            "SYSTEM"
        ],
        index: true,
    },

    title: {
        type: String,
        required: true,
        trim: true,
    },

    message: {
        type: String,
        required: true,
        trim: true,
    },

    data: {
        type: Schema.Types.Mixed,
        default: {},
    },

    isRead: {
        type: Boolean,
        default: false,
        index: true,
    },

    readAt: {
        type: Date,
        default: null,
    },
},{timestamps: true})

notificationSchema.index({recipient: 1, createdAt: -1});

notificationSchema.index({recipient: 1, isRead: 1});

const Notification = mongoose.model("Notification", notificationSchema);
export {
    Notification
}