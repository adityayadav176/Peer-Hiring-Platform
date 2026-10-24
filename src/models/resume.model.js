import mongoose, { Schema } from "mongoose";

const resumeSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    subtitle: {
      type: String,
      trim: true,
      default: "",
      maxlength: 180,
    },

    target: {
      type: String,
      trim: true,
      default: "",
      maxlength: 100,
    },

    skills: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 80,
        },
      ],
      default: [],
      validate: {
        validator(skills) {
          return (
            skills.length <= 50 &&
            skills.every(
              (skill) =>
                typeof skill === "string" && skill.trim().length > 0
            )
          );
        },
        message: "A resume can have up to 50 non-empty skills.",
      },
    },

    resume: {
      url: {
        type: String,
        required: true,
        trim: true,
      },

      public_id: {
        type: String,
        required: true,
        trim: true,
      },

      originalName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 255,
      },

      // Always store the raw file size in bytes.
      sizeBytes: {
        type: Number,
        required: true,
        min: 1,
        validate: {
          validator: Number.isSafeInteger,
          message: "File size must be a valid integer in bytes.",
        },
      },
    },

    views: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "Views must be a non-negative integer.",
      },
    },

    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },

    version: {
      type: Number,
      default: 1,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Version must be a positive integer.",
      },
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

resumeSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDefault: true,
      isDeleted: false,
    },
  }
);

resumeSchema.index({ user: 1, isDeleted: 1, updatedAt: -1 });
resumeSchema.index({ user: 1, isDefault: 1, isDeleted: 1 });

export const Resume =
  mongoose.models.Resume || mongoose.model("Resume", resumeSchema);