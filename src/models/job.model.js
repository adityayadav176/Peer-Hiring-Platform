import mongoose, { Schema } from "mongoose";

const JobSchema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    companyId: {
        type: Schema.Types.ObjectId,
        ref: "Company",
        required: true,
    },
    recruiterId: {
        type: Schema.Types.ObjectId,
        required: true
    },
    salary: {
        min: {
            type: Number,
            default: 0
        },
        max: {
            type: Number,
            default: 0
        },
        currency: {
            type: String,
            default: "INR"
        },
        isNegotiable: {
            type: Boolean,
            default: false
        }
    },
    location: {
        city: String,
        state: String,
        country: String
    },
    skills: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    requirements: [
        {
            type: String,
            trim: true
        }
    ],

    responsibilities: [
        {
            type: String,
            trim: true
        }
    ],
    status: {
        type: String,
        enum: ["DRAFT", "OPEN", "PAUSED", "CLOSED", "EXPIRED"],
        default: "OPEN"
    },
    views: {
        type: Number,
        default: 0,
        min: 0
    },
    isBlocked : {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    applicantsCount: {
        type: Number,
        default: 0
    },
    workSpaceType: {
        type: String,
        enum: ["REMOTE", "HYBRID", "ONSITE"],
        default: "ONSITE"
    },
    employmentType: {
        type: String,
        enum: ["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT", "FREELANCE"],
        required: true
    },
    experienceLevel: {
        type: String,
        enum: ["FRESHER", "JUNIOR", "MID", "SENIOR", "LEAD"],
        required: true
    },
    category: {
        type: String,
        index: true
    },
    applicationDeadline: {
        type: Date
    },
    openings: {
        type: Number,
        min: 1,
        default: 1
    }
}, { timestamps: true })

JobSchema.index({
    title: "text",
    description: "text",
    skills: "text"
});

JobSchema.index({
    status: 1,
    workSpaceType: 1,
    employmentType: 1
});

JobSchema.index({
    companyId: 1
});

JobSchema.index({
    recruiterId: 1
});

JobSchema.index({
    status: 1
});

export const Job = mongoose.model("Job", JobSchema);