import mongoose, { Schema } from "mongoose";

const userProfileSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            unique: true,
            ref: "User",
        },

        profileViews: {
        type: Number,
        default: 0,
    },

        bio: {
            type: String,
            maxlength: 500,
            trim: true,
        },

        headline: {
            type: String,
            trim: true,
        },

        skills: [
            {
                name: {
                    type: String,
                    trim: true,
                },

                level: {
                    type: String,
                    enum: ["beginner", "intermediate", "expert"],
                    default: "intermediate",
                },
            },
        ],

        projects: [
            {
                title: {
                    type: String,
                    required: true,
                    trim: true,
                },

                description: {
                    type: String,
                    trim: true,
                },

                githubUrl: {
                    type: String,
                    trim: true,
                },

                liveUrl: {
                    type: String,
                    trim: true,
                },

                image: {
                    url: String,
                    public_id: String,
                },

                technologies: [
                    {
                        type: String,
                        trim: true,
                    },
                ],

                startDate: Date,
                endDate: Date,
            },
        ],

        experience: [
            {
                company: {
                    type: String,
                    trim: true,
                },

                position: {
                    type: String,
                    trim: true,
                },

                employmentType: {
                    type: String,
                    enum: [
                        "internship",
                        "full-time",
                        "part-time",
                        "contract",
                    ],
                },

                startDate: Date,
                endDate: Date,

                currentlyWorking: {
                    type: Boolean,
                    default: false,
                },

                description: {
                    type: String,
                    trim: true,
                },
            },
        ],

        education: [
            {
                institute: {
                    type: String,
                    trim: true,
                },

                degree: {
                    type: String,
                    trim: true,
                },

                field: {
                    type: String,
                    trim: true,
                },

                startYear: Number,
                endYear: Number,

                grade: {
                    type: String,
                    trim: true,
                },
            },
        ],

        socialLinks: {
            github: {
                type: String,
                trim: true,
            },

            linkedin: {
                type: String,
                trim: true,
            },

            portfolio: {
                type: String,
                trim: true,
            },
        },

        resumeId: {
            type: Schema.Types.ObjectId,
            ref: "Resume",
        },

        profileCompletion: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },

        location: {
            city: {
                type: String,
                trim: true,
            },

            state: {
                type: String,
                trim: true,
            },

            country: {
                type: String,
                trim: true,
                default: "India",
            },
        },

       preferences: {
    lookingForJob: {
        type: Boolean,
        default: true,
    },

    preferredJobType: {
        type: [
            {
                type: String,
                enum: [
                    "full-time",
                    "part-time",
                    "internship",
                    "freelance",
                    "contract",
                ],
            },
        ],
        default: ["full-time"],
    },

    workMode: {
        type: String,
        enum: ["remote", "hybrid", "onsite"],
        default: "remote",
    },

    expectedSalary: {
        min: {
            type: Number,
        },

        max: {
            type: Number,
        },

        currency: {
            type: String,
            default: "INR",
        },
    },
},
    },
    {
        timestamps: true,
    }
);

userProfileSchema.index({
    bio: "text",
    headline: "text",
    "skills.name": "text",
    "projects.technologies": "text",
    "experience.company": "text",
    "experience.position": "text",
    "education.degree": "text",
    "education.field": "text",
    "location.city": "text",
    "location.country": "text",
});

export const UserProfile = mongoose.model("UserProfile", userProfileSchema) || mongoose.models.UserProfile;