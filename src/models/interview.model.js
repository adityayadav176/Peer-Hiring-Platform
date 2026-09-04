import mongoose, { Schema } from "mongoose";

const interviewSchema = new Schema({
    job: {
        type: Schema.Types.ObjectId,
        ref: "Job",
        required: true
    },

    company: {
        type: Schema.Types.ObjectId,
        ref: "Company",
        required: true
    },

    interviewRoomId: {
        type: String,
        unique: true,
        sparse: true,
        default: null
    },

    application: {
        type: Schema.Types.ObjectId,
        ref: "Application",
        required: true
    },

    candidate: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    recruiter: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    round: {
        type: Number,
        default: 1
    },

    interviewType: {
        type: String,
        enum: ["Online", "Offline", "Phone"],
        required: true
    },

    location: String,

    scheduledAt: {
        type: Date,
        required: true
    },

    duration: {
        type: Number,
        default: 60,
    },

    timezone: {
        type: String,
        default: "Asia/Kolkata"
    },

    status: {
        type: String,
        enum: [
            "Scheduled",
            "Accepted",
            "Rejected",
            "Completed",
            "Cancelled",
            "Reschedule Requested",
            "Rescheduled",
            "No Show"
        ],
        default: "Scheduled"
    },

    feedback: {
        rating: {
            type: Number,
            min: 1,
            max: 5
        }
    },

    notes: String,

    recommendation: {
        type: String,
        enum: ["Hire", "Reject", "Hold"]
    },

    cancellationReason: String,

    rescheduleReason: String,

    completedAt: Date
}, { timestamps: true })

export const Interview = mongoose.model("Interview", interviewSchema);