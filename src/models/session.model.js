
import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Store the SHA-256 hash, never the raw refresh token.
    refreshToken: {
      type: String,
      default: "",
      select: false,
    },

    refreshTokenExpiresAt: {
      type: Date,
      default: null,
    },

    device: {
      type: String,
      default: "Unknown device",
    },

    deviceModel: {
      type: String,
      default: "",
    },

    deviceType: {
      type: String,
      default: "",
    },

    deviceVendor: {
      type: String,
      default: "",
    },

    browser: {
      type: String,
      default: "",
    },

    browserVersion: {
      type: String,
      default: "",
    },

    os: {
      type: String,
      default: "",
    },

    osVersion: {
      type: String,
      default: "",
    },

    ipAddress: {
      type: String,
      default: "",
    },

    userAgent: {
      type: String,
      default: "",
    },

    lastActiveAt: {
      type: Date,
      default: Date.now,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helpful for listing active sessions belonging to a user.
sessionSchema.index({ userId: 1, isActive: 1 });

// Avoid OverwriteModelError during development.
export const Session =
  mongoose.models.Session ||
  mongoose.model("Session", sessionSchema);
