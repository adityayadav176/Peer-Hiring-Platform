import mongoose, { Schema } from "mongoose";

const ApplicationSchema = new Schema(
  {
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    jobId: {
      type: Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    resumeId: {
      type: Schema.Types.ObjectId,
      ref: "Resume",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "applied",
        "screening",
        "shortlisted",
        "interview_scheduled",
        "interview_completed",
        "selected",
        "rejected",
        "withdrawn",
        "closed",
      ],
      default: "applied",
      index: true,
      trim: true,
    },

    recruiterNotes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 5000,
    },

    reviewAt: {
      type: Date,
      default: null
    },

    closedAt: {
      type: Date,
      default: null
    },

    shortlistedAt: {
      type: Date,
      default: null
    },

    messageToRecruiter: {
      type: String,
      trim: true,
      default: "",
      maxlength: 3000,
    },

    atsScore: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },

    atsStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },

    interviewId: {
      type: Schema.Types.ObjectId,
      ref: "Interview",
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Prevent duplicate active applications to the same job.
// A soft-deleted application does not block a new application.
ApplicationSchema.index(
  { candidateId: 1, jobId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

ApplicationSchema.index({ companyId: 1, status: 1, createdAt: -1 });
ApplicationSchema.index({ candidateId: 1, createdAt: -1 });

export const Application =
  mongoose.models.Application ||
  mongoose.model("Application", ApplicationSchema);