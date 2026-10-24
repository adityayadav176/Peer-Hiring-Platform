import { Job } from "../models/job.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import { Company } from "../models/company.model.js";


const createJob = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    salary,
    location,
    skills,
    requirements,
    responsibilities,
    status = "OPEN",
    workSpaceType = "ONSITE",
    employmentType,
    experienceLevel,
    category,
    applicationDeadline,
    openings = 1,
  } = req.body ?? {};

  const recruiterId = req.user?._id;
  const company = req.company;

  // 1. Validate recruiter authentication
  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized. Please log in.");
  }

  if (req.user?.role !== "recruiter") {
    throw new ApiError(403, "Only recruiters can create jobs.");
  }

  // 2. Validate company from middleware
  if (!company?._id || !mongoose.isValidObjectId(company._id)) {
    throw new ApiError(
      400,
      "Valid company information is required. Please verify your company."
    );
  }

  if (company.isBlocked) {
    throw new ApiError(
      403,
      "Your company is blocked. Contact the administrator."
    );
  }

  if (
    company.isVerified !== true &&
    company.verificationStatus !== "verified"
  ) {
    if (company.verificationStatus === "rejected") {
      throw new ApiError(
        403,
        "Your company verification was rejected. Please contact the administrator."
      );
    }

    throw new ApiError(
      403,
      "Your company must be verified by an administrator before creating jobs."
    );
  }

  // 3. Validate required fields
  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof description !== "string" ||
    !description.trim()
  ) {
    throw new ApiError(
      400,
      "Job title and description are required."
    );
  }

  const allowedEmploymentTypes = [
    "FULL_TIME",
    "PART_TIME",
    "INTERNSHIP",
    "CONTRACT",
    "FREELANCE",
  ];

  const allowedExperienceLevels = [
    "FRESHER",
    "JUNIOR",
    "MID",
    "SENIOR",
    "LEAD",
  ];

  const allowedStatuses = [
    "DRAFT",
    "OPEN",
    "PAUSED",
    "CLOSED",
    "EXPIRED",
  ];

  const allowedWorkspaceTypes = [
    "REMOTE",
    "HYBRID",
    "ONSITE",
  ];

  if (!allowedEmploymentTypes.includes(employmentType)) {
    throw new ApiError(400, "Please select a valid employment type.");
  }

  if (!allowedExperienceLevels.includes(experienceLevel)) {
    throw new ApiError(400, "Please select a valid experience level.");
  }

  if (!allowedStatuses.includes(status)) {
    throw new ApiError(400, "Invalid job status.");
  }

  if (!allowedWorkspaceTypes.includes(workSpaceType)) {
    throw new ApiError(400, "Invalid workspace type.");
  }

  // 4. Validate salary
  const salaryMin = Number(salary?.min ?? 0);
  const salaryMax = Number(salary?.max ?? 0);

  if (
    !Number.isFinite(salaryMin) ||
    !Number.isFinite(salaryMax) ||
    salaryMin < 0 ||
    salaryMax < 0
  ) {
    throw new ApiError(400, "Salary must contain valid non-negative amounts.");
  }

  if (salaryMax > 0 && salaryMin > salaryMax) {
    throw new ApiError(
      400,
      "Minimum salary cannot exceed maximum salary."
    );
  }

  const salaryData = {
    min: salaryMin,
    max: salaryMax,
    currency: salary?.currency || "INR",
    isNegotiable: Boolean(salary?.isNegotiable),
  };

  // 5. Validate openings
  const openingCount = Number(openings);

  if (!Number.isInteger(openingCount) || openingCount < 1) {
    throw new ApiError(
      400,
      "Number of openings must be a positive whole number."
    );
  }

  // 6. Validate application deadline
  let deadline;

  if (applicationDeadline) {
    deadline = new Date(applicationDeadline);

    if (Number.isNaN(deadline.getTime())) {
      throw new ApiError(400, "Please provide a valid application deadline.");
    }
  }

  // 7. Normalize array fields
  const normalizeArray = (value) => {
    if (Array.isArray(value)) {
      return value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  };

  const normalizedSkills = normalizeArray(skills).map((skill) =>
    skill.toLowerCase()
  );

  const normalizedRequirements = normalizeArray(requirements);
  const normalizedResponsibilities = normalizeArray(responsibilities);

  // 8. Validate and normalize location
  const locationData = {
    city:
      typeof location?.city === "string"
        ? location.city.trim()
        : "",
    state:
      typeof location?.state === "string"
        ? location.state.trim()
        : "",
    country:
      typeof location?.country === "string"
        ? location.country.trim()
        : "",
  };

  // 9. Create job
  const job = await Job.create({
    title: title.trim(),
    description: description.trim(),

    companyId: company._id,
    recruiterId,

    salary: salaryData,
    location: locationData,

    skills: normalizedSkills,
    requirements: normalizedRequirements,
    responsibilities: normalizedResponsibilities,

    status,
    workSpaceType,
    employmentType,
    experienceLevel,

    category:
      typeof category === "string"
        ? category.trim()
        : "",

    applicationDeadline: deadline,
    openings: openingCount,
  });

  // 10. Return populated job data
  const createdJob = await Job.findById(job._id).populate(
    "companyId",
    "name logo verificationStatus isVerified"
  );

  return res.status(201).json(
    new ApiResponse(
      201,
      createdJob,
      "Job created successfully."
    )
  );
});

const updateJob = asyncHandler(async (req, res) => {
  const { JobId } = req.params;
  const recruiterId = req.user?._id;

  if (!JobId || !mongoose.isValidObjectId(JobId)) {
    throw new ApiError(400, "Invalid job ID.");
  }

  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized access.");
  }

  if (req.user?.role !== "recruiter") {
    throw new ApiError(403, "Only recruiters can update jobs.");
  }

  const existingJob = await Job.findOne({
    _id: JobId,
    recruiterId,
    isDeleted: false,
  });

  if (!existingJob) {
    throw new ApiError(
      404,
      "Job not found or you are not authorized to update it."
    );
  }

  const company = await Company.findOne({
    _id: existingJob.companyId,
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
    isBlocked: false,
  }).select("_id isVerified verificationStatus");

  if (!company) {
    throw new ApiError(
      403,
      "Your company is unavailable or you are not authorized to manage it."
    );
  }

  if (company.isVerified !== true && company.verificationStatus !== "verified") {
    throw new ApiError(
      403,
      company.verificationStatus === "rejected"
        ? "Your company verification was rejected. Contact the administrator."
        : "Your company must be verified before you can update jobs."
    );
  }

  const {
    title,
    description,
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
    openings,
  } = req.body ?? {};

  const updateData = {};

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      throw new ApiError(400, "Job title cannot be empty.");
    }

    updateData.title = title.trim();
  }

  if (description !== undefined) {
    if (typeof description !== "string" || !description.trim()) {
      throw new ApiError(400, "Job description cannot be empty.");
    }

    updateData.description = description.trim();
  }

  if (salary !== undefined) updateData.salary = salary;
  if (location !== undefined) updateData.location = location;
  if (skills !== undefined) updateData.skills = skills;
  if (requirements !== undefined) updateData.requirements = requirements;
  if (responsibilities !== undefined) {
    updateData.responsibilities = responsibilities;
  }

  if (status !== undefined) {
    const allowedStatuses = [
      "DRAFT",
      "OPEN",
      "PAUSED",
      "CLOSED",
      "EXPIRED",
    ];

    if (!allowedStatuses.includes(status)) {
      throw new ApiError(400, "Invalid job status.");
    }

    updateData.status = status;
  }

  if (workSpaceType !== undefined) {
    const allowedTypes = ["REMOTE", "HYBRID", "ONSITE"];

    if (!allowedTypes.includes(workSpaceType)) {
      throw new ApiError(400, "Invalid workspace type.");
    }

    updateData.workSpaceType = workSpaceType;
  }

  if (employmentType !== undefined) {
    const allowedTypes = [
      "FULL_TIME",
      "PART_TIME",
      "INTERNSHIP",
      "CONTRACT",
      "FREELANCE",
    ];

    if (!allowedTypes.includes(employmentType)) {
      throw new ApiError(400, "Invalid employment type.");
    }

    updateData.employmentType = employmentType;
  }

  if (experienceLevel !== undefined) {
    const allowedLevels = [
      "FRESHER",
      "JUNIOR",
      "MID",
      "SENIOR",
      "LEAD",
    ];

    if (!allowedLevels.includes(experienceLevel)) {
      throw new ApiError(400, "Invalid experience level.");
    }

    updateData.experienceLevel = experienceLevel;
  }

  if (category !== undefined) {
    if (typeof category !== "string") {
      throw new ApiError(400, "Category must be a string.");
    }

    updateData.category = category.trim();
  }

  if (applicationDeadline !== undefined) {
    if (applicationDeadline === null || applicationDeadline === "") {
      updateData.applicationDeadline = null;
    } else {
      const deadline = new Date(applicationDeadline);

      if (Number.isNaN(deadline.getTime())) {
        throw new ApiError(400, "Invalid application deadline.");
      }

      if (deadline < new Date()) {
        throw new ApiError(
          400,
          "Application deadline cannot be in the past."
        );
      }

      updateData.applicationDeadline = deadline;
    }
  }

  if (openings !== undefined) {
    const openingCount = Number(openings);

    if (!Number.isInteger(openingCount) || openingCount < 1) {
      throw new ApiError(400, "Openings must be a positive integer.");
    }

    updateData.opening = openingCount;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError(400, "No valid fields provided for update.");
  }

  const updatedJob = await Job.findOneAndUpdate(
    {
      _id: JobId,
      recruiterId,
      isDeleted: false,
    },
    {
      $set: updateData,
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedJob) {
    throw new ApiError(404, "Job not found or could not be updated.");
  }

  return res.status(200).json(
    new ApiResponse(200, updatedJob, "Job updated successfully.")
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

    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    const job = await Job.findOne({
        _id: JobId,
        recruiterId,
        isDeleted: false,
    });

    if (!job) {
        throw new ApiError(
            404,
            "Job not found or you are not authorized to delete it."
        );
    }

    const company = await Company.findOne({
        _id: job.companyId,
        "recruiters.recruiterId": recruiterId,
        isDeleted: false,
        isBlocked: false,
    }).select("_id isVerified verificationStatus");

    if (!company) {
        throw new ApiError(403, "Your company is unavailable or blocked.");
    }

    job.isDeleted = true;
    job.status = "CLOSED";

    await job.save();

    return res.status(200).json(
        new ApiResponse(200, {}, "Job deleted successfully.")
    );
});

const permanentDeleteJob = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    const recruiterId = req.user?._id;

    if (!recruiterId) {
        throw new ApiError(
            401,
            "You are not authorized to perform this task"
        );
    }

    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    const job = await Job.findOneAndDelete({
        _id: JobId,
        recruiterId,
        isDeleted: true,
    });

    if (!job) {
        throw new ApiError(
            404,
            "Deleted job not found or you are not authorized to delete it."
        );
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Job permanently deleted successfully.")
    );
});

const getJobById = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    const recruiterId = req.user?._id;

    if (!recruiterId) {
        throw new ApiError(401, "Unauthorized Access");
    }

    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    const job = await Job.findOne({
        _id: JobId,
        recruiterId,
        isDeleted: false,
    }).populate("companyId", "name logo industry headquarters");

    if (!job) {
        throw new ApiError(
            404,
            "Job not found or you are not authorized to access it."
        );
    }

    return res.status(200).json(
        new ApiResponse(200, job, "Job fetched successfully.")
    );
});

const getUserJobById = asyncHandler(async (req, res) => {
    const { JobId } = req.params;

    if (!mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    const userId = req.user?._id;

    if (userId) {
        await Job.updateOne(
            {
                _id: JobId,
                isDeleted: false,
                isBlocked: false,
                status: "OPEN",
                viewedBy: { $ne: userId },
            },
            {
                $addToSet: { viewedBy: userId },
                $inc: { views: 1 },
            }
        );
    }

    const job = await Job.findOne({
        _id: JobId,
        isDeleted: false,
        isBlocked: false,
        status: "OPEN",
    }).populate("companyId", "name logo industry headquarters");

    if (!job) {
        throw new ApiError(404, "Job not found or no longer available");
    }

    return res.status(200).json(
        new ApiResponse(200, job, "Job fetched successfully")
    );
});



const getAllJobs = asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    if (
        !Number.isInteger(page) ||
        !Number.isInteger(limit) ||
        page < 1 ||
        limit < 1 ||
        limit > 100
    ) {
        throw new ApiError(400, "Invalid page or limit");
    }

    const skip = (page - 1) * limit;

    const {
        search = "",
        keyword = "",
        category,
        workSpaceType,
        employmentType,
        experienceLevel,
        location,
        skills,
        minSalary,
        maxSalary,
        postedWithin,
        sortBy = "relevance",
    } = req.query;

    const filter = {
        isDeleted: false,
        isBlocked: false,
        status: "OPEN",
    };

    const toArray = (value) => {
        if (value == null || value === "") return [];

        return (Array.isArray(value) ? value : [value])
            .flatMap((item) => String(item).split(","))
            .map((item) => item.trim())
            .filter(Boolean);
    };

    const escapeRegex = (value) =>
        String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Search title, description, and skills.
    // Your schema already defines a text index for these fields.
    const searchTerm = String(search || keyword).trim();

    if (searchTerm) {
        filter.$text = { $search: searchTerm };
    }

    // Exact enum/category filters; support multiple selections.
    if (category) {
        filter.category = { $in: toArray(category) };
    }

    const workspaceValues = toArray(workSpaceType);
    if (workspaceValues.length) {
        filter.workSpaceType = { $in: workspaceValues };
    }

    const employmentValues = toArray(employmentType);
    if (employmentValues.length) {
        filter.employmentType = { $in: employmentValues };
    }

    const experienceValues = toArray(experienceLevel);
    if (experienceValues.length) {
        filter.experienceLevel = { $in: experienceValues };
    }

    // Skills are stored as an array of lowercase strings.
    const skillValues = toArray(skills).map((skill) =>
        skill.toLowerCase()
    );

    if (skillValues.length) {
        filter.skills = { $in: skillValues };
    }

    // Match city, state, or country.
    if (String(location || "").trim()) {
        const locationRegex = new RegExp(
            escapeRegex(String(location).trim()),
            "i"
        );

        filter.$or = [
            { "location.city": locationRegex },
            { "location.state": locationRegex },
            { "location.country": locationRegex },
        ];
    }

    // Salary is nested under salary.min and salary.max.
    const min = minSalary !== "" && minSalary != null
        ? Number(minSalary)
        : null;

    const max = maxSalary !== "" && maxSalary != null
        ? Number(maxSalary)
        : null;

    if (
        (min !== null && (!Number.isFinite(min) || min < 0)) ||
        (max !== null && (!Number.isFinite(max) || max < 0)) ||
        (min !== null && max !== null && min > max)
    ) {
        throw new ApiError(400, "Invalid salary range");
    }

    // Find jobs whose salary range overlaps the requested range.
    if (min !== null) {
        filter["salary.max"] = { $gte: min };
    }

    if (max !== null) {
        filter["salary.min"] = {
            ...(filter["salary.min"] || {}),
            $lte: max,
        };
    }

    // Posting date filter.
    const postedDays = {
        "24h": 1,
        "3d": 3,
        "7d": 7,
        "30d": 30,
    };

    if (postedWithin && postedWithin !== "all") {
        const days = postedDays[String(postedWithin)];

        if (!days) {
            throw new ApiError(400, "Invalid postedWithin filter");
        }

        filter.createdAt = {
            $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        };
    }

    // Sorting.
    const sortOptions = {
        relevance: { createdAt: -1 },
        newest: { createdAt: -1 },
        oldest: { createdAt: 1 },
        salaryHigh: { "salary.max": -1, createdAt: -1 },
        salaryLow: { "salary.min": 1, createdAt: -1 },
    };

    const sort = sortOptions[String(sortBy)] || sortOptions.relevance;

    const [jobs, totalJobs] = await Promise.all([
        Job.find(filter)
            .populate("companyId", "name logo headquarters industry")
            .populate("recruiterId", "name avatar")
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),

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
            "Jobs fetched successfully"
        )
    );
});



const changeJobStatus = asyncHandler(async (req, res) => {
    const { JobId } = req.params;
    const { status } = req.body;
    const recruiterId = req.user?._id;

    //Validate Job ID
    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    // Validate authentication
    if (!recruiterId) {
        throw new ApiError(401, "Unauthorized Access");
    }

    // Validate recruiter role
    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    // Validate request body
    if (
        !status ||
        typeof status !== "string" ||
        status !== status.trim()
    ) {
        throw new ApiError(400, "A valid job status is required");
    }

    const allowedStatus = [
        "DRAFT",
        "OPEN",
        "PAUSED",
        "CLOSED",
        "EXPIRED",
    ];

    if (!allowedStatus.includes(status)) {
        throw new ApiError(
            400,
            `Invalid Job Status. Allowed values: ${allowedStatus.join(", ")}`
        );
    }

    // Find job owned by this recruiter
    const job = await Job.findOne({
        _id: JobId,
        recruiterId,
        isDeleted: false,
    });

    if (!job) {
        throw new ApiError(
            404,
            "Job not found or you are not authorized to update it"
        );
    }

    // Check company availability and ownership
    const company = await Company.findOne({
        _id: job.companyId,
        "recruiters.recruiterId": recruiterId,
        isDeleted: false,
        isBlocked: false,
    }).select("_id isVerified verificationStatus");

    if (!company) {
        throw new ApiError(
            403,
            "Your company is unavailable or blocked"
        );
    }

    // Require company verification
    if (company.isVerified !== true && company.verificationStatus !== "verified") {
        throw new ApiError(
            403,
            "Your company must be verified to manage job status"
        );
    }

    // Prevent unnecessary updates
    if (job.status === status) {
        return res.status(200).json(
            new ApiResponse(200, job, "Job already has this status")
        );
    }

    // Define permitted status transitions
    const allowedTransitions = {
        DRAFT: ["OPEN", "CLOSED"],
        OPEN: ["PAUSED", "CLOSED"],
        PAUSED: ["OPEN", "CLOSED"],
        CLOSED: ["OPEN"],
        EXPIRED: [],
    };

    if (!allowedTransitions[job.status]?.includes(status)) {
        throw new ApiError(
            400,
            `Cannot change job status from ${job.status} to ${status}`
        );
    }

    // 10. Validate deadline before opening a job
    if (status === "OPEN" && job.applicationDeadline && new Date(job.applicationDeadline).getTime() <= Date.now()) {
        throw new ApiError(
            400,
            "Cannot open a job whose application deadline has passed"
        );
    }

    // 11. Update status
    job.status = status;
    await job.save();

    // 12. Return response
    return res.status(200).json(
        new ApiResponse(
            200,
            job,
            `Job status changed to ${status} successfully`
        )
    );
});

const getRecruiterJobs = asyncHandler(async (req, res) => {
    const recruiterId = req.user?._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Invalid Recruiter ID");
    }

    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    if (
        !Number.isInteger(page) ||
        !Number.isInteger(limit) ||
        page < 1 ||
        limit < 1 ||
        limit > 100
    ) {
        throw new ApiError(400, "Invalid page or limit");
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
    };

    const allowedStatuses = [
        "DRAFT",
        "OPEN",
        "PAUSED",
        "CLOSED",
        "EXPIRED",
    ];

    if (status) {
        if (!allowedStatuses.includes(status)) {
            throw new ApiError(400, "Invalid job status");
        }

        filter.status = status;
    }

    if (keyword?.trim()) {
        filter.$text = {
            $search: keyword.trim(),
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

    if (location?.trim()) {
        const escapedLocation = location.trim().replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

        filter["location.city"] = {
            $regex: escapedLocation,
            $options: "i",
        };
    }

    const [jobs, totalJobs] = await Promise.all([
        Job.find(filter)
            .populate("companyId", "name logo industry headquarters")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),

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
            "Recruiter jobs fetched successfully"
        )
    );
});


const restoreJob = asyncHandler(async (req, res) => {
    const { JobId } = req.params;
    const recruiterId = req.user?._id;

    if (!JobId || !mongoose.isValidObjectId(JobId)) {
        throw new ApiError(400, "Invalid Job ID");
    }

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Invalid Recruiter ID");
    }

    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    const job = await Job.findOne({
        _id: JobId,
        recruiterId,
        isDeleted: true,
    });

    if (!job) {
        throw new ApiError(
            404,
            "Deleted job not found or you are not authorized to restore it."
        );
    }

    const company = await Company.findOne({
        _id: job.companyId,
        "recruiters.recruiterId": recruiterId,
        isDeleted: false,
        isBlocked: false,
    }).select("_id isVerified verificationStatus");

    if (!company) {
        throw new ApiError(
            403,
            "Your company is unavailable or blocked."
        );
    }

    if (company.isVerified !== true && company.verificationStatus !== "verified") {
        throw new ApiError(
            403,
            "Your company must be verified to restore jobs."
        );
    }

    job.isDeleted = false;

    // Reopen only if the deadline is still valid.
    if (job.applicationDeadline && new Date(job.applicationDeadline).getTime() <= Date.now()) {
        job.status = "EXPIRED";
    } else {
        job.status = "DRAFT";
    }

    await job.save();

    return res.status(200).json(
        new ApiResponse(200, job, "Job restored successfully.")
    );
});

const getDeletedJobs = asyncHandler(async (req, res) => {
    const recruiterId = req.user?._id;

    if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
        throw new ApiError(401, "Invalid Recruiter ID");
    }

    if (req.user.role !== "recruiter") {
        throw new ApiError(403, "Recruiter access required");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    if (
        !Number.isInteger(page) ||
        !Number.isInteger(limit) ||
        page < 1 ||
        limit < 1 ||
        limit > 100
    ) {
        throw new ApiError(400, "Invalid page or limit");
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

    const allowedStatuses = [
        "DRAFT",
        "OPEN",
        "PAUSED",
        "CLOSED",
        "EXPIRED",
    ];

    if (status) {
        if (!allowedStatuses.includes(status)) {
            throw new ApiError(400, "Invalid job status");
        }

        filter.status = status;
    }

    if (keyword?.trim()) {
        filter.$text = {
            $search: keyword.trim(),
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

    if (location?.trim()) {
        const escapedLocation = location.trim().replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

        filter["location.city"] = {
            $regex: escapedLocation,
            $options: "i",
        };
    }

    const [jobs, totalJobs] = await Promise.all([
        Job.find(filter)
            .populate("companyId", "name logo industry headquarters")
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),

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
            "Deleted jobs fetched successfully"
        )
    );
});

export {
    createJob,
    getUserJobById,
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