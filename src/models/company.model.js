import mongoose, { Schema } from "mongoose";

const socialLinksSchema = new Schema(
  {
    website: {
      type: String,
      trim: true,
      default: "",
    },
    linkedin: {
      type: String,
      trim: true,
      default: "",
    },
    github: {
      type: String,
      trim: true,
      default: "",
    },
    twitter: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const recruiterSchema = new Schema(
  {
    recruiterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const companySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    companyEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      maxlength: 254,
    },

    companyPhone: {
      type: String,
      trim: true,
      default: "",
      maxlength: 20,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 3000,
    },

    industry: {
      type: String,
      trim: true,
      default: "",
    },

    companySize: {
      type: String,
      enum: [
        "1-10",
        "11-50",
        "51-200",
        "201-500",
        "501-1000",
        "1001-5000",
        "5001-10000",
      ],
    },

    foundedYear: {
      type: Number,
      min: 1800,
      max: new Date().getFullYear(),
    },

    headquarters: {
      country: {
        type: String,
        trim: true,
        default: "",
      },
      state: {
        type: String,
        trim: true,
        default: "",
      },
      city: {
        type: String,
        trim: true,
        default: "",
      },
    },

    logo: {
      url: {
        type: String,
        default: "",
        trim: true,
      },
      publicId: {
        type: String,
        default: "",
        trim: true,
      },
    },

    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    recruiters: {
      type: [recruiterSchema],
      default: [],
    },

    socialLinks: {
      type: socialLinksSchema,
      default: () => ({}),
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isBlocked: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
companySchema.index({
  name: "text",
  description: "text",
});

companySchema.index({
  industry: 1,
});

companySchema.index({
  "headquarters.city": 1,
});

companySchema.index({
  "recruiters.recruiterId": 1,
});

companySchema.index({
  isBlocked: 1,
  isVerified: 1,
  isDeleted: 1,
});

export const Company = mongoose.model("Company", companySchema);
