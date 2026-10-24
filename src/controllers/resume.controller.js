import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { deleteFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js"
import { Resume } from "../models/resume.model.js"
import mongoose from "mongoose"

const uploadResume = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const file = req.file;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!file?.path) {
        throw new ApiError(400, "Resume PDF File Is Required");
    }

    if (file.mimetype !== "application/pdf") {
        throw new ApiError(400, "Only PDF Files Are Allowed");
    }

    const title = req.body?.title?.trim();
    const subtitle = req.body?.subtitle?.trim() || "";
    const target = req.body?.target?.trim() || "";

    if (!title) {
        throw new ApiError(400, "Resume Title Is Required");
    }

    if (title.length > 120) {
        throw new ApiError(400, "Resume Title Cannot Exceed 120 Characters");
    }

    if (subtitle.length > 180) {
        throw new ApiError(400, "Subtitle Cannot Exceed 180 Characters");
    }

    if (target.length > 100) {
        throw new ApiError(400, "Target Cannot Exceed 100 Characters");
    }

    // Accept skills as a JSON array or comma-separated string.
    let skills = req.body?.skills ?? [];

    if (typeof skills === "string") {
        try {
            skills = JSON.parse(skills);
        } catch {
            skills = skills.split(",");
        }
    }

    if (!Array.isArray(skills)) {
        throw new ApiError(400, "Skills Must Be An Array");
    }

    if (skills.some((skill) => typeof skill !== "string")) {
        throw new ApiError(400, "Every Skill Must Be A String");
    }

    skills = [
        ...new Set(
            skills
                .map((skill) => skill.trim())
                .filter(Boolean)
        ),
    ];

    if (skills.length > 50) {
        throw new ApiError(400, "Maximum 50 Skills Are Allowed");
    }

    let uploadedResume;

    try {
        uploadedResume = await uploadOnCloudinary(file.path);

        if (!uploadedResume?.secure_url || !uploadedResume?.public_id) {
            throw new ApiError(500, "Resume Upload To Cloudinary Failed");
        }

        const existingResume = await Resume.exists({
            user,
            isDeleted: false,
        });

        const resume = await Resume.create({
            user,
            title,
            subtitle,
            target,
            skills,

            resume: {
                url: uploadedResume.secure_url,
                public_id: uploadedResume.public_id,
                originalName: file.originalname,
                sizeBytes: file.size,
            },

            isDefault: !existingResume,
        });

        return res.status(201).json(
            new ApiResponse(
                201,
                resume,
                "Resume Uploaded Successfully"
            )
        );
    } catch (error) {
        // Clean up the Cloudinary file if the database operation fails.
        if (uploadedResume?.public_id) {
            try {
                await deleteFromCloudinary(uploadedResume.public_id);
            } catch (cleanupError) {
                console.error(
                    "Failed to clean up uploaded resume:",
                    cleanupError
                );
            }
        }

        throw error;
    }
});

const getAllUserResumes = asyncHandler(async (req, res) => {
    const user = req.user?._id;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    console.log("getAllUserResumes controller executed");

    const page = Math.max(
        1,
        Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
        50,
        Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const skip = (page - 1) * limit;

    const filter = {
        user,
        isDeleted: false,
    };

    const [resumes, totalResumes] = await Promise.all([
        Resume.find(filter)
            .select(
                "title subtitle target skills resume.url resume.originalName resume.sizeBytes views isDefault version createdAt updatedAt"
            )
            .sort({
                isDefault: -1,
                updatedAt: -1,
            })
            .skip(skip)
            .limit(limit)
            .lean(),

        Resume.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalResumes / limit);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                resumes,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalResumes,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1,
                },
            },
            resumes.length
                ? "Your Resumes Fetched Successfully"
                : "No Resumes Found"
        )
    );
});


const getResumeById = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: false,
    }).lean();

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    return res.status(200).json(
        new ApiResponse(200, resume, "Resume Fetched Successfully")
    );
});

const updateResumeDetails = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const updates = {};
    const body = req.body ?? {};

    if (Object.hasOwn(body, "title")) {
        const title = body.title?.trim();

        if (!title || title.length > 120) {
            throw new ApiError(400, "Title Must Be Between 1 And 120 Characters");
        }

        updates.title = title;
    }

    if (Object.hasOwn(body, "subtitle")) {
        const subtitle = body.subtitle?.trim() ?? "";

        if (subtitle.length > 180) {
            throw new ApiError(400, "Subtitle Cannot Exceed 180 Characters");
        }

        updates.subtitle = subtitle;
    }

    if (Object.hasOwn(body, "target")) {
        const target = body.target?.trim() ?? "";

        if (target.length > 100) {
            throw new ApiError(400, "Target Cannot Exceed 100 Characters");
        }

        updates.target = target;
    }

    if (Object.hasOwn(body, "skills")) {
        if (!Array.isArray(body.skills)) {
            throw new ApiError(400, "Skills Must Be An Array");
        }

        if (body.skills.some((skill) => typeof skill !== "string")) {
            throw new ApiError(400, "Every Skill Must Be A String");
        }

        const skills = [
            ...new Set(
                body.skills
                    .map((skill) => skill.trim())
                    .filter(Boolean)
            ),
        ];

        if (skills.length > 50) {
            throw new ApiError(400, "Maximum 50 Skills Are Allowed");
        }

        updates.skills = skills;
    }

    if (Object.keys(updates).length === 0) {
        throw new ApiError(400, "No Valid Fields Provided To Update");
    }

    const resume = await Resume.findOneAndUpdate(
        {
            _id: resumeId,
            user,
            isDeleted: false,
        },
        { $set: updates },
        {
            new: true,
            runValidators: true,
        }
    );

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    return res.status(200).json(
        new ApiResponse(200, resume, "Resume Details Updated Successfully")
    );
});

const replaceResumeFile = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;
    const file = req.file;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    if (!file?.path) {
        throw new ApiError(400, "Resume PDF File Is Required");
    }

    if (file.mimetype !== "application/pdf") {
        throw new ApiError(400, "Only PDF Files Are Allowed");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: false,
    });

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    let newResume;
    let databaseUpdated = false;

    try {
        newResume = await uploadOnCloudinary(file.path);

        if (!newResume?.secure_url || !newResume?.public_id) {
            throw new ApiError(500, "Resume File Upload Failed");
        }

        const oldPublicId = resume.resume?.public_id;

        resume.resume = {
            url: newResume.secure_url,
            public_id: newResume.public_id,
            originalName: file.originalname,
            sizeBytes: file.size,
        };

        resume.version = (resume.version || 1) + 1;

        await resume.save();
        databaseUpdated = true;

        if (oldPublicId && oldPublicId !== newResume.public_id) {
            try {
                await deleteFromCloudinary(oldPublicId);
            } catch (cleanupError) {
                console.error("Old resume cleanup failed:", cleanupError);
            }
        }

        return res.status(200).json(
            new ApiResponse(200, resume, "Resume File Replaced Successfully")
        );
    } catch (error) {
        if (!databaseUpdated && newResume?.public_id) {
            try {
                await deleteFromCloudinary(newResume.public_id);
            } catch (cleanupError) {
                console.error("New resume cleanup failed:", cleanupError);
            }
        }

        throw error;
    }
});

const setIsDefault = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: false,
    });

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    if (resume.isDefault) {
        return res.status(200).json(
            new ApiResponse(200, resume, "This Resume Is Already Your Default")
        );
    }

    await Resume.updateMany(
        {
            user,
            isDeleted: false,
            isDefault: true,
        },
        {
            $set: { isDefault: false },
        }
    );

    resume.isDefault = true;
    await resume.save();

    return res.status(200).json(
        new ApiResponse(200, resume, "Default Resume Updated Successfully")
    );
});

const deleteResume = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const existingResume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: false,
    });

    if (!existingResume) {
        throw new ApiError(404, "Resume Not Found Or Already Deleted");
    }

    const wasDefault = existingResume.isDefault;

    const deletedResume = await Resume.findOneAndUpdate(
        {
            _id: resumeId,
            user,
            isDeleted: false,
        },
        {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
                isDefault: false,
            },
        },
        {
            new: true,
            runValidators: true,
        }
    );

    if (!deletedResume) {
        throw new ApiError(404, "Resume Not Found Or Already Deleted");
    }

    if (wasDefault) {
        const anotherDefault = await Resume.exists({
            user,
            isDeleted: false,
            isDefault: true,
        });

        if (!anotherDefault) {
            await Resume.findOneAndUpdate(
                {
                    user,
                    isDeleted: false,
                },
                {
                    $set: { isDefault: true },
                },
                {
                    sort: { createdAt: -1 },
                    new: true,
                }
            );
        }
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            deletedResume,
            "Resume Moved To Recycle Bin Successfully"
        )
    );
});

const restoreResume = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: true,
    });

    if (!resume) {
        throw new ApiError(404, "Resume Not Found In Recycle Bin");
    }

    const existingDefault = await Resume.exists({
        user,
        isDeleted: false,
        isDefault: true,
    });

    const restoredResume = await Resume.findOneAndUpdate(
        {
            _id: resumeId,
            user,
            isDeleted: true,
        },
        {
            $set: {
                isDeleted: false,
                deletedAt: null,
                isDefault: !existingDefault,
            },
        },
        {
            new: true,
            runValidators: true,
        }
    );

    if (!restoredResume) {
        throw new ApiError(404, "Resume Not Found Or Already Restored");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            restoredResume,
            restoredResume.isDefault
                ? "Resume Restored And Set As Default"
                : "Resume Restored Successfully"
        )
    );
});

const permanentlyDeleteResume = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: true,
    });

    if (!resume) {
        throw new ApiError(404, "Resume Not Found In Recycle Bin");
    }

    const publicId = resume.resume?.public_id;

    if (!publicId) {
        throw new ApiError(500, "Resume Cloudinary File ID Is Missing");
    }

    await deleteFromCloudinary(publicId);

    const deletedResume = await Resume.findOneAndDelete({
        _id: resumeId,
        user,
        isDeleted: true,
    });

    if (!deletedResume) {
        throw new ApiError(
            500,
            "Resume File Deleted But Database Record Could Not Be Deleted"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            { resumeId: deletedResume._id },
            "Resume Permanently Deleted Successfully"
        )
    );
});

const downloadResume = asyncHandler(async (req, res) => {
    const user = req.user?._id;
    const { resumeId } = req.params;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    if (!mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        user,
        isDeleted: false,
    }).select("title resume");

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    const resumeUrl = resume.resume?.url;

    if (!resumeUrl) {
        throw new ApiError(404, "Resume File Not Found");
    }

    return res.redirect(resumeUrl);
});


export {
    uploadResume,
    getAllUserResumes,
    getResumeById,
    updateResumeDetails,
    replaceResumeFile,
    setIsDefault,
    deleteResume,
    restoreResume,
    permanentlyDeleteResume,
    downloadResume
}