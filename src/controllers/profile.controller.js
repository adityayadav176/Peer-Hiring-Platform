import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { User } from "../models/user.model.js";
import { UserProfile } from "../models/profile.model.js";

const calculateProfileCompletion = (profile) => {

    let score = 0;
    const missingFields = [];

    if (profile.bio) {
        score += 10;
    } else {
        missingFields.push("Bio");
    }

    if (profile.headline) {
        score += 10;
    } else {
        missingFields.push("Headline");
    }

    if (profile.skills?.length > 0) {
        score += 20;
    } else {
        missingFields.push("Skills");
    }

    if (profile.projects?.length > 0) {
        score += 20;
    } else {
        missingFields.push("Projects");
    }

    if (profile.experience?.length > 0) {
        score += 15;
    } else {
        missingFields.push("Experience");
    }

    if (profile.education?.length > 0) {
        score += 15;
    } else {
        missingFields.push("Education");
    }

    if (profile.resumeId) {
        score += 10;
    } else {
        missingFields.push("Resume");
    }

    return {
        score,
        missingFields
    };
};

const createProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized Acess Denied");
    }

    const existingProfile = await UserProfile.findOne({
        userId
    })

    if (existingProfile) {
        throw new ApiError(409, "Profile Already Exists");
    }

    const { bio, headline, skills, projects, experience, education, socialLinks, resumeId, location, preferences } = req.body;

    const profileData = {
        userId,
        bio,
        headline,
        skills,
        projects,
        experience,
        education,
        socialLinks,
        resumeId,
        location,
        preferences
    };

    const profile = await UserProfile.create(
        profileData
    );


    const completion = calculateProfileCompletion(profile);

    profile.profileCompletion = completion.score;

    await profile.save();

    return res.status(201).json(
        new ApiResponse(
            201,
            {
                profile,
                messingFields: completion.missingFields
            }, "Profile created Successfully")
    )
})

const updateProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!userId) {
        throw new ApiError(400, "Unauthorized Access Denied");
    }

    const profile = await UserProfile.findOne({ userId });

    if (!profile) {
        throw new ApiError(404, "Profile Not Found");
    }

    const {
        bio,
        headline,
        skills,
        projects,
        experience,
        education,
        socialLinks,
        resumeId,
        location,
        preferences
    } = req.body;

    if (bio !== undefined) profile.bio = bio;
    if (headline !== undefined) profile.headline = headline;
    if (skills !== undefined) profile.skills = skills;
    if (projects !== undefined) profile.projects = projects;
    if (experience !== undefined) profile.experience = experience;
    if (education !== undefined) profile.education = education;
    if (socialLinks !== undefined) profile.socialLinks = socialLinks;
    if (resumeId !== undefined) profile.resumeId = resumeId;
    if (location !== undefined) profile.location = location;
    if (preferences !== undefined) profile.preferences = preferences;

    const completion = calculateProfileCompletion(profile);

    profile.profileCompletion = completion.score;

    await profile.save();

    return res.status(200)
        .json(
            new ApiResponse(
                200,
                {
                    profile,
                    profileCompletion: completion.score,
                    messingFields: completion.missingFields

                }, "Profile Updated Successfully")
        )
})

const getMyProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const profile = await UserProfile.findOne({ userId }).populate("resumeId");

    if (!profile) {
        throw new ApiError(404, "Profile not Found");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, profile, "Profile Fetched Successfully")
        )
})

const getProfileByUserId = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        throw new ApiError(400, "Unauthorized Access Denied");
    }

    const profile = await UserProfile.findOne({ userId }).populate("resumeId");

    if (!profile) {
        throw new ApiError(404, "Profile Not Found");
    }

    return res.status(200).json(
        new ApiResponse(200, profile, "Profile Fetched Successfully")
    )
})

const searchUserProfile = asyncHandler(async (req, res) => {
    const { keyword } = req.query;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const skip = (page - 1) * limit;

    if (!keyword?.trim()) {
        throw new ApiError(400, "Search keyword is required");
    }

    const filter = {
        $text: {
            $search: keyword
        }
    };

    const [profiles, totalProfiles] = await Promise.all([
        UserProfile.find(
            filter,
            {
                score: { $meta: "textScore" }
            }
        )
            .sort({
                score: { $meta: "textScore" }
            })
            .skip(skip)
            .limit(limit)
            .populate("resumeId", "title"),

        UserProfile.countDocuments(filter)
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                profiles,
                pagination: {
                    totalProfiles,
                    totalPages: Math.ceil(totalProfiles / limit),
                    currentPage: page,
                    limit,
                    hasNextPage: page < Math.ceil(totalProfiles / limit),
                    hasPrevPage: page > 1
                }
            },
            "Profiles fetched successfully"
        )
    );
});

const getProfileCompletion = asyncHandler(async (req, res) => {
    const profile = await UserProfile.findOne({
        userId: req.user._id
    })

    if (!profile) {
        throw new ApiError(404, "Profile Not Found");
    }

    const completion = calculateProfileCompletion(profile);

    profile.profileCompletion = completion.score;
    await profile.save();

    return res.status(200).json(
        new ApiResponse(200, completion, "Profile completion fetched successfully")
    )
})

export {
    createProfile,
    updateProfile,
    getMyProfile,
    getProfileByUserId,
    searchUserProfile,
    getProfileCompletion
}
