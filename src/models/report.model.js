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
    default: "",
    maxlength: 2000,
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
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    default: null,
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