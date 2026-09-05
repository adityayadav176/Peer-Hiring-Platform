import { Job } from "../models/job.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

const createJob = asyncHandler(async (req, res) => {
    const {
        title,
        description,
        companyId,
        salary,
        location,
        skills,
        requirements,
        responsibilities,
        status,
        workSpaceType,
        employmentType,
        experienceLevel,
        category,
        applicationDeadline,
        openings
    } = req.body;

    const recruiterId = req.user._id;

    if (!recruiterId) {
        throw new ApiError(401, "Unauthorized");
    }

    if(req.user.role !== "recruiter") {
        throw new ApiError(403, "Only recruiter can create job");
    }

    if (!mongoose.isValidObjectId(companyId)) {
        throw new ApiError(400, "Invalid Company Id");
    }

    if (!title || !description || !companyId || !employmentType || !experienceLevel) {
        throw new ApiError(400, "Required Fields Are Missing");
    }

    const job = await Job.create({
        title,
        description, 
        companyId, 
        recruiterId, 
        salary, 
        location, 
        skills, 
        requirements, 
        responsibilities, 
        workSpaceType, 
        employmentType, 
        experienceLevel, 
        category, 
        applicationDeadline, 
        openings, 
        status
    });

    if (!job) {
        throw new ApiError(400, "Job Creating Failed..")
    }

    return res.status(201)
        .json(
            new ApiResponse(201, job, "Job Created Successfully")
        );
})

const updateJob = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    const recruiterId = req.user?._id;

    if (!recruiterId) {
        throw new ApiError(401, "Unauthorized Access");
    }

    const existingJob = await Job.findOne({
        _id: JobId,
        recruiterId,
        isDeleted: false
    });

    if (!existingJob) {
        throw new ApiError(
            403,
            "You are not allowed to update this job or job not found."
        );
    }

    const {
        title,
        description,
        companyId,
        salary,
        location,
        skills,
        requirements,
        responsibilities,
        status,
        workSpaceType,
        employmentType,
        experienceLevel,
        category,
        applicationDeadline,
        openings
    } = req.body;

    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (companyId !== undefined) updateData.companyId = companyId;
    if (salary !== undefined) updateData.salary = salary;
    if (location !== undefined) updateData.location = location;
    if (skills !== undefined) updateData.skills = skills;
    if (requirements !== undefined) updateData.requirements = requirements;
    if (responsibilities !== undefined) updateData.responsibilities = responsibilities;
    if (status !== undefined) updateData.status = status;
    if (workSpaceType !== undefined) updateData.workSpaceType = workSpaceType;
    if (employmentType !== undefined) updateData.employmentType = employmentType;
    if (experienceLevel !== undefined) updateData.experienceLevel = experienceLevel;
    if (category !== undefined) updateData.category = category;
    if (applicationDeadline !== undefined) {
        if (new Date(applicationDeadline) < new Date()) {
            throw new ApiError(
                400,
                "Application deadline cannot be in the past."
            );
        }

        updateData.applicationDeadline = applicationDeadline;
    }

    if (openings !== undefined) updateData.openings = openings;

    if (Object.keys(updateData).length === 0) {
        throw new ApiError(400, "No fields provided for update.");
    }

    const updatedJob = await Job.findByIdAndUpdate(
        JobId,
        {
            $set: updateData
        },
        {
            new: true,
            runValidators: true
        }
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedJob,
            "Job updated successfully."
        )
    );
});

const deleteJob = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    const recruiterId = req.user?._id;

    if (!recruiterId) {
        throw new ApiError(401, "Unauthorized Access");
    }

    const job = await Job.findOne({
        _id: JobId,
        recruiterId,
        isDeleted: false
    });

    if (!job) {
        throw new ApiError(
            404,
            "Job not found or you are not authorized to delete it."
        );
    }

    job.isDeleted = true;
    job.status = "CLOSED";

    await job.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Job deleted successfully."
        )
    );
});

const permanentDeleteJob = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if(!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid JoId");
    }

    const recruiterId = req.user._id;

    if(!recruiterId) {
        throw new ApiError(401, "You are not authorized to perform this task")
    }

    const job = await Job.findOneAndDelete({
        _id: JobId,
        recruiterId,
        isDeleted: true
    })

    if(!job) {
        throw new ApiError(404, "Job not found or you are not authorized to delete it.")
    }

    return res.status(200)
    .json(
        new ApiResponse(200,{}, "Job Deleted Successfully")
    )
});

const getJobById = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if(!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid JobId");
    }

    const job = await Job.findOneAndUpdate(
        {
            _id: JobId,
            isDeleted: false
        },
        {
            $inc: {views: 1}
        },
        {
            new: true
        }
    );

    if(!job) {
        throw new ApiError(404, "Job Not Found");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, job, "Job fetched successfully")
    )
})

const getAllJobs = asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if(page < 1 || limit < 1) {
        throw new ApiError(400, "Invalid Page Or Limit");
    }

    const {
        keyword,
        category,
        workSpaceType,
        employmentType,
        experienceLevel,
        location,
        status
    } = req.query

    const filter = {
        isDeleted: false
    }

    filter.status = status || "OPEN";

    if(keyword) {
        filter.$text = {
            $search: keyword
        }
    }

    if(category) {
        filter.category = category;
    }

    if(workSpaceType) {
        filter.workSpaceType = workSpaceType;
    }

    if(employmentType) {
        filter.employmentType = employmentType;
    }

    if(experienceLevel) {
        filter.experienceLevel = experienceLevel;
    }

    if(location) {
        filter["location.city"] = {
            $regex: location,
            $options: "i"
        };
    }

    const jobs = await Job.find(filter)
    .sort({createdAt: -1})
    .skip(skip)
    .limit(limit);

    const totalJobs = await Job.countDocuments(filter);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                jobs,
                pagination: {
                    page,
                    limit,
                    totalJobs,
                    hasNextPage: page < Math.ceil(totalJobs / limit),
                    hasPrevPage: page > 1
                }
            },
            "Jobs Fetched Successfully"
        )
    )
})

const changeJobStatus = asyncHandler(async (req, res) => {
    const { JobId } = req.params;
     const { status } = req.body;

    if(!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid JobId")
    }

    const allowedStatus = ["DRAFT", "OPEN", "PAUSED", "DRAFT", "EXPIRED"];

    if(!allowedStatus.includes(status)) {
        throw new ApiError(400, "Invalid Job Status");
    }

    const job = await Job.findByIdAndUpdate(
        JobId,
        {
            $set: {status}
        },
        {
            new: true,
            runValidators: true
        }
    )

    if(!job) {
        throw new ApiError(404, "Job Not Found And Updated");
    }

    return res.status(200)
    .json(
        new ApiResponse(200, job, "Job Updated Successfully")
    )
})

const getRecruiterJobs = asyncHandler(async (req, res) => {
    const recruiterId = req.user._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(400, "Invalid Recruiter ID");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    if (page < 1 || limit < 1) {
        throw new ApiError(400, "Invalid Page Or Limit");
    }

    const skip = (page - 1) * limit;

    const {
        keyword,
        category,
        workSpaceType,
        employmentType,
        experienceLevel,
        location,
        status,
    } = req.query;

    const filter = {
        recruiterId,
        isDeleted: false,
        status: status || "OPEN",
    };

    if (keyword) {
        filter.$text = {
            $search: keyword,
        };
    }

    if (category) {
        filter.category = category;
    }

    if (workSpaceType) {
        filter.workSpaceType = workSpaceType;
    }

    if (employmentType) {
        filter.employmentType = employmentType;
    }

    if (experienceLevel) {
        filter.experienceLevel = experienceLevel;
    }

    if (location) {
        filter["location.city"] = {
            $regex: location,
            $options: "i",
        };
    }

    const [jobs, totalJobs] = await Promise.all([
        Job.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),

        Job.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalJobs / limit);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                jobs,
                pagination: {
                    page,
                    limit,
                    totalJobs,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            },
            "Recruiter Jobs Fetched Successfully"
        )
    );
});

const restoreJob = asyncHandler(async (req, res) => {
    const { JobId } = req.params;
    const recruiterId = req.user._id;

    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(400, "Invalid Recruiter ID");
    }

    const job = await Job.findOneAndUpdate(
        {
            _id: JobId,
            recruiterId,
            isDeleted: true,
        },
        {
            $set: {
                isDeleted: false,
                deletedAt: null,
            },
        },
        {
            new: true,
        }
    );

    if (!job) {
        throw new ApiError(
            404,
            "Deleted job not found or you are not authorized to restore it."
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            job,
            "Job Restored Successfully"
        )
    );
});

const getDeletedJobs = asyncHandler(async (req, res) => {
    const recruiterId = req.user._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(400, "Invalid Recruiter ID");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    if (page < 1 || limit < 1) {
        throw new ApiError(400, "Invalid Page Or Limit");
    }

    const skip = (page - 1) * limit;

    const {
        keyword,
        category,
        workSpaceType,
        employmentType,
        experienceLevel,
        location,
        status,
    } = req.query;

    const filter = {
        recruiterId,
        isDeleted: true,
    };

    if (status) {
        filter.status = status;
    }

    if (keyword) {
        filter.$text = {
            $search: keyword,
        };
    }

    if (category) {
        filter.category = category;
    }

    if (workSpaceType) {
        filter.workSpaceType = workSpaceType;
    }

    if (employmentType) {
        filter.employmentType = employmentType;
    }

    if (experienceLevel) {
        filter.experienceLevel = experienceLevel;
    }

    if (location) {
        filter["location.city"] = {
            $regex: location,
            $options: "i",
        };
    }

    const [jobs, totalJobs] = await Promise.all([
        Job.find(filter)
            .sort({ deletedAt: -1 })
            .skip(skip)
            .limit(limit),

        Job.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalJobs / limit);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                jobs,
                pagination: {
                    page,
                    limit,
                    totalJobs,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            },
            "Deleted Jobs Fetched Successfully"
        )
    );
});


export {
    createJob,
    updateJob,
    permanentDeleteJob,
    deleteJob,
    getJobById,
    getAllJobs,
    changeJobStatus,
    getRecruiterJobs,
    restoreJob,
    getDeletedJobs
}