import mongoose, { Schema } from "mongoose";

const ReportSchema = new Schema(
    {
        reporter: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        reportedUser: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        reportedJob: {
            type: Schema.Types.ObjectId,
            ref: "Job",
            default: null
        },

        reason: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            trim: true,
            default: ""
        },

        status: {
            type: String,
            enum: ["pending", "resolved", "rejected"],
            default: "pending"
        },

        adminNote: {
            type: String,
            trim: true,
            default: ""
        },

        resolvedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        resolvedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

export const Report = mongoose.model("Report", ReportSchema);