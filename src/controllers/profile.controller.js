
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { UserProfile } from "../models/profile.model.js";

const calculateProfileCompletion = (profile = {}) => {
  const missingFields = [];
  let score = 0;

  if (profile.bio?.trim()) score += 10;
  else missingFields.push("Bio");

  if (profile.headline?.trim()) score += 10;
  else missingFields.push("Headline");

  if (profile.skills?.length > 0) score += 20;
  else missingFields.push("Skills");

  if (profile.projects?.length > 0) score += 20;
  else missingFields.push("Projects");

  if (profile.experience?.length > 0) score += 15;
  else missingFields.push("Experience");

  if (profile.education?.length > 0) score += 15;
  else missingFields.push("Education");

  if (profile.resumeId) score += 10;
  else missingFields.push("Resume");

  return { score, missingFields };
};

// Create the logged-in user's profile
const createProfile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const existingProfile = await UserProfile.findOne({ userId });

  if (existingProfile) {
    throw new ApiError(409, "Profile already exists");
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
    preferences,
  } = req.body;

  const profile = await UserProfile.create({
    userId,
    bio,
    headline,
    skills,
    projects,
    experience,
    education,
    socialLinks,
    resumeId: resumeId || undefined,
    location,
    preferences,
  });

  const completion = calculateProfileCompletion(profile);
  profile.profileCompletion = completion.score;
  await profile.save();

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        profile,
        missingFields: completion.missingFields,
        profileCompletion: completion.score,
      },
      "Profile created successfully"
    )
  );
});

// Get the logged-in user's profile.
// A missing profile is a valid empty state, not a server error.
const getMyProfile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const profile = await UserProfile.findOne({ userId })
    .populate("resumeId");

  if (!profile) {
    return res.status(200).json(
      new ApiResponse(
        200,
        null,
        "Profile has not been created yet"
      )
    );
  }

  return res.status(200).json(
    new ApiResponse(200, profile, "Profile fetched successfully")
  );
});

// Update the logged-in user's profile.
const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const profile = await UserProfile.findOne({ userId });

  if (!profile) {
    throw new ApiError(404, "Profile not found. Create it first.");
  }

  const allowedFields = [
    "bio",
    "headline",
    "skills",
    "projects",
    "experience",
    "education",
    "socialLinks",
    "resumeId",
    "location",
    "preferences",
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      profile[field] = req.body[field];
    }
  }

  const completion = calculateProfileCompletion(profile);
  profile.profileCompletion = completion.score;

  await profile.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        profile,
        profileCompletion: completion.score,
        missingFields: completion.missingFields,
      },
      "Profile updated successfully"
    )
  );
});

// Get another user's public profile.
const getProfileByUserId = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, "User ID is required");
  }

  const profile = await UserProfile.findOne({ userId })
    .populate("resumeId", "title");

  if (!profile) {
    throw new ApiError(404, "Profile not found");
  }

  return res.status(200).json(
    new ApiResponse(200, profile, "Profile fetched successfully")
  );
});

// Search profiles using the model's configured text index.
const searchUserProfile = asyncHandler(async (req, res) => {
  const keyword = String(req.query.keyword || "").trim();

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 10, 1),
    100
  );
  const skip = (page - 1) * limit;

  if (!keyword) {
    throw new ApiError(400, "Search keyword is required");
  }

  const filter = { $text: { $search: keyword } };

  const [profiles, totalProfiles] = await Promise.all([
    UserProfile.find(filter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .populate("resumeId", "title"),

    UserProfile.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalProfiles / limit);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        profiles,
        pagination: {
          totalProfiles,
          totalPages,
          currentPage: page,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
      "Profiles fetched successfully"
    )
  );
});

// Profile completion must also work before a profile is created.
const getProfileCompletion = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access");
  }

  const profile = await UserProfile.findOne({ userId });

  if (!profile) {
    const completion = calculateProfileCompletion({});

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          score: 0,
          missingFields: completion.missingFields,
          profileExists: false,
        },
        "Profile has not been created yet"
      )
    );
  }

  const completion = calculateProfileCompletion(profile);
  profile.profileCompletion = completion.score;
  await profile.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...completion,
        profileExists: true,
      },
      "Profile completion fetched successfully"
    )
  );
});



export {
  createProfile,
  updateProfile,
  getMyProfile,
  getProfileByUserId,
  searchUserProfile,
  getProfileCompletion,
};
