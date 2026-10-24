
import mongoose, { Schema } from "mongoose";

const interviewSchema = new Schema(
    {
        job: {
            type: Schema.Types.ObjectId,
            ref: "Job",
            required: true,
            index: true,
        },

        company: {
            type: Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        application: {
            type: Schema.Types.ObjectId,
            ref: "Application",
            required: true,
            index: true,
        },

        candidate: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        recruiter: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        interviewRoomId: {
            type: String,
            trim: true,
            default: undefined,
            set: (value) =>
                typeof value === "string" && value.trim()
                    ? value.trim()
                    : undefined,
        },

        description: {
            type: String,
            trim: true,
            default: "",
            maxlength: [5000, "Description cannot exceed 5000 characters."],
        },

        round: {
            type: Number,
            default: 1,
            min: [1, "Interview round must be at least 1."],
            max: [50, "Interview round cannot exceed 50."],
            validate: {
                validator: Number.isSafeInteger,
                message: "Interview round must be a positive integer.",
            },
        },

        interviewType: {
            type: String,
            enum: ["Online", "Offline", "Phone"],
            required: true,
            trim: true,
        },

        location: {
            type: String,
            trim: true,
            default: "",
            maxlength: [500, "Location cannot exceed 500 characters."],
        },

        scheduledAt: {
            type: Date,
            required: true,
        },

        date: {
            type: Date,
            required: true,
        },

        time: {
            type: String,
            required: true,
            trim: true,
        },

        duration: {
            type: Number,
            default: 60,
            min: [5, "Interview duration must be at least 5 minutes."],
            max: [480, "Interview duration cannot exceed 480 minutes."],
            validate: {
                validator: Number.isSafeInteger,
                message: "Duration must be a whole number of minutes.",
            },
        },

        timezone: {
            type: String,
            trim: true,
            default: "Asia/Kolkata",
            maxlength: [100, "Timezone cannot exceed 100 characters."],
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
                "No Show",
            ],
            default: "Scheduled",
            index: true,
        },

        feedback: {
            rating: {
                type: Number,
                min: [1, "Feedback rating must be between 1 and 5."],
                max: [5, "Feedback rating must be between 1 and 5."],
                validate: {
                    validator: (value) =>
                        value == null || Number.isInteger(value),
                    message: "Feedback rating must be an integer from 1 to 5.",
                },
            },
        },

        notes: {
            type: String,
            trim: true,
            default: "",
            maxlength: [10000, "Notes cannot exceed 10000 characters."],
        },

        recommendation: {
            type: String,
            enum: ["Hire", "Reject", "Hold"],
            default: undefined,
        },

        cancellationReason: {
            type: String,
            trim: true,
            default: "",
            maxlength: [2000, "Cancellation reason cannot exceed 2000 characters."],
        },

        rescheduleReason: {
            type: String,
            trim: true,
            default: "",
            maxlength: [2000, "Reschedule reason cannot exceed 2000 characters."],
        },

        completedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

// Unique room IDs when a room ID is present.
interviewSchema.index(
    { interviewRoomId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            interviewRoomId: { $type: "string" },
        },
    }
);

// Common interview queries.
interviewSchema.index({ candidate: 1, scheduledAt: 1 });
interviewSchema.index({ recruiter: 1, scheduledAt: 1 });
interviewSchema.index({ company: 1, status: 1, scheduledAt: 1 });

// Supports finding interviews by application and round.
// This is NOT a unique constraint.
interviewSchema.index({ application: 1, round: 1 });

export const Interview =
    mongoose.models.Interview ||
    mongoose.model("Interview", interviewSchema);
