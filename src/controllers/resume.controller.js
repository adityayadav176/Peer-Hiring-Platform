import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { deleteFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js"
import { Resume } from "../models/resume.model.js"
import mongoose from "mongoose"

const uploadResume = asyncHandler(async (req, res) => {
    const resumeLocalFilePath = req.file?.path;

    if (!resumeLocalFilePath) {
        throw new ApiError(400, "Resume File Required");
    }

    if (req.file?.mimetype !== "application/pdf") {
        throw new ApiError(400, "Only PDF files are required");
    }

    const user = req.user?._id;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const { title } = req.body;

    if (!title?.trim()) {
        throw new ApiError(400, "Title Is Required");
    }

    const resume = await uploadOnCloudinary(resumeLocalFilePath);

    if (!resume.secure_url || !resume.public_id) {
        throw new ApiError(500, "Resume Uploading Failed..");
    }

    const count = await Resume.countDocuments({
        user,
        isDeleted: false
    });

    const CV = await Resume.create({
        user,
        title: title.trim(),
        isDefault: count === 0,
        resume: {
            url: resume.secure_url,
            public_id: resume.public_id,
        },
    });

    if (!CV) {
        await deleteFromCloudinary(resume.public_id);
        throw new ApiError(500, "Somthing Went Wrong Uploading Resume");
    }

    return res.status(201).json(
        new ApiResponse(201, CV, "Resume Uploaded Successfully")
    )
})

const getAllUserResumes = asyncHandler(async (req, res) => {
    const user = req.user?._id;

    if (!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const page = Number(req.query.page);
    const limit = Number(req.query.limit || 10);
    const skip = (page - 1) * limit;

    const Resumes = await Resume.find()
        .populate("user", "name email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });

    const totalResumes = await Resume.countDocuments();

    if (!Resumes) {
        throw new ApiError(404, "Resume Not Found");
    }

    return res.status(200)
        .json(
            new ApiResponse(
                200,
                {
                    pagination: {
                        currentPage: page,
                        totalPages: Math.ceil(totalResumes / limit),
                        totalResumes,
                        limit
                    },
                    Resumes
                },
                "Resumes Fetched Successfully"
            )
        );
})

const getResumeById = asyncHandler(async (req, res) => {
    const { resumeId } = req.params;

    if (!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeId");
    }

    const resume = await Resume.findById(resumeId)
        .populate("user", "name email");

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, resume, "Resume Fetched Successfully")
        )
})

const updateResumeDetails = asyncHandler(async (req, res) => {
    const { resumeId } = req.params;

    if (!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeID");
    }

    const { title } = req.body;

    if (!title) {
        throw new ApiError(400, "Title Is Required")
    }

    const resume = await Resume.findByIdAndUpdate(
        resumeId,
        {
            $set: {
                title
            }
        },
        {
            new: true
        }
    )

    if (!resume) {
        throw new ApiError(404, "Resume Not Found Or Updated");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, resume, "Resume Updated Successfully")
        )
})

const replaceResumeFile = asyncHandler(async (req, res) => {
    const { resumeId } = req.params;

    if (!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeId");
    }

    const resumeLocalFilePath = req.file?.path;

    if (!resumeLocalFilePath) {
        throw new ApiError(400, "Resume File Is Required");
    }

    if (req.file.mimetype !== "application/pdf") {
        throw new ApiError(400, "PDF file Is required");
    }

    const resume = await Resume.findById(resumeId);

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    const newResume = await uploadOnCloudinary(resumeLocalFilePath);

    if (!newResume) {
        throw new ApiError(500, "Resume Upload Failed");
    }

    const updatedResume = await Resume.findByIdAndUpdate(
        resumeId,
        {
            $set: {
                url: newResume.secure_url,
                public_id: newResume.public_id
            }
        },
        {
            new: true
        }
    )

    if(resume.public_id) {
        await deleteFromCloudinary(resume.public_id);
    } 

    return res.status(200)
        .json(
            new ApiResponse(200, updatedResume, "Resume File Updated Successfully")
        )
})

const setIsDefault = asyncHandler(async (req, res) => {
    const {resumeId} = req.params;

    if(!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeID");
    }

    const resume = await Resume.findByIdAndUpdate(
        resumeId,
        {
            $set: {
                isDefault: true
            }
        },
        {
            new: true
        }
    )

    if(!resume) {
        throw new ApiError(400, "Resume Not Found Or Updated");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, resume, "Resume Is Now IS Default")
    )
})

const deleteResume = asyncHandler(async (req, res) => {
    const {resumeId} = req.params;

    if(!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeID");
    }

    const resume = await Resume.findByIdAndUpdate(
        resumeId,
        {
            $set: {
                isDeleted: true
            }
        },
        {
            new: true
        }
    )

    if(!resume) {
        throw new ApiError(404, "Resume Not Found Or  Updated");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, resume, "Resume Deleted Successfully")
    )
})

const restoreResume = asyncHandler(async (req, res) => {
    const {resumeId} = req.params;

    if(!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeID");
    }

    const user = req.user._id;

    if(!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const resume = await Resume.findOneAndUpdate(
        {
            _id: resumeId,
            user,
            isDeleted: true
        },
        {
            $set: {
                isDeleted: false,
                deletedAt: null
            }
        },
        {
            new: true
        }
    )

    if(!resume) {
        throw new ApiError(404, "Resume not found or already restored")
    }

    return res.status(200)
    .json(
        new ApiResponse(200, resume, "Resume Restore Successfully")
    )
})

const permanentlyDeleteResume = asyncHandler(async (req, res) => {
    const {resumeId} = req.params;

    if(!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid ResumeID")
    }

    const user = req.user._id;

    if(!user) {
        throw new ApiError(401, "Unauthorized Access Denied");
    }

    const resume = await Resume.findOne(
        {
            _id: resumeId,
            user,
            isDeleted: true
        }
    )

    if(!resume) {
        throw new ApiError(404, "Resume Not Found Or First Put Resume In RecycleBin");
    }

    await deleteFromCloudinary(resume.resume?.public_id);

    await Resume.findByIdAndDelete(resumeId);

    return res.status(200)
    .json(
        new ApiResponse(200, {}, "Resume Permanently Deleted Successfully")
    )
})

const downloadResume = asyncHandler(async (req, res) => {

    const { resumeId } = req.params;

    if (!resumeId || !mongoose.isValidObjectId(resumeId)) {
        throw new ApiError(400, "Invalid Resume ID");
    }

    const resume = await Resume.findOne({
        _id: resumeId,
        isDeleted: false
    });

    if (!resume) {
        throw new ApiError(404, "Resume Not Found");
    }

    if (!resume.resume?.url) {
        throw new ApiError(404, "Resume File Not Found");
    }

    return res.redirect(resume.resume.url);
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