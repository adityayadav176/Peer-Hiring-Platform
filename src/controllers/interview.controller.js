import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Company } from "../models/company.model.js";
import { Job } from "../models/job.model.js";
import { Application } from "../models/application.model.js";
import { Interview } from "../models/interview.model.js";
import { generateInterviewRoomId } from "../utils/interviewRoom.js";

const ACTIVE_INTERVIEW_STATUSES = [
  "Scheduled",
  "Accepted",
  "Rescheduled",
];

const INTERVIEW_STATUSES = [
  "Scheduled",
  "Accepted",
  "Rejected",
  "Completed",
  "Cancelled",
  "Reschedule Requested",
  "Rescheduled",
  "No Show",
];

const INTERVIEW_TYPES = ["Online", "Offline", "Phone"];

const isValidId = (id) => mongoose.isValidObjectId(id);

const getPagination = (query) => {
  const requestedPage = Number(query.page) || 1;
  const requestedLimit = Number(query.limit) || 10;

  const page = Math.max(1, Math.floor(requestedPage));
  const limit = Math.min(50, Math.max(1, Math.floor(requestedLimit)));

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const getInterviewDateParts = (date, timezone) => {
  let formatted;

  try {
    formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(date);
  } catch {
    throw new ApiError(400, "Invalid timezone");
  }

  const parts = Object.fromEntries(
    formatted.map(({ type, value }) => [type, value])
  );

  return {
    date: new Date(
      `${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`
    ),
    time: `${parts.hour}:${parts.minute}`,
  };
};

const validateFutureDate = (value) => {
  if (!value) {
    throw new ApiError(400, "Interview date and time are required");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "Invalid interview date and time");
  }

  if (date <= new Date()) {
    throw new ApiError(
      400,
      "Interview must be scheduled in the future"
    );
  }

  return date;
};

const getActiveCompanyForRecruiter = async (companyId, recruiterId) => {
  const company = await Company.findOne({
    _id: companyId,
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
    isBlocked: false,
  });

  if (!company) {
    throw new ApiError(
      404,
      "Company not found, inactive, or you are not a member of this company"
    );
  }

  if (
    company.isVerified !== true &&
    company.verificationStatus !== "verified"
  ) {
    if (company.verificationStatus === "rejected") {
      throw new ApiError(
        403,
        "Company verification was rejected"
      );
    }

    throw new ApiError(
      403,
      "Company must be verified before scheduling interviews"
    );
  }

  return company;
};

const getActiveJobForCompany = async (jobId, companyId) => {
  const job = await Job.findOne({
    _id: jobId,
    companyId,
    isDeleted: false,
    isBlocked: false,
  });

  if (!job) {
    throw new ApiError(
      404,
      "Job not found, deleted, blocked, or not associated with this company"
    );
  }

  return job;
};

const getInterviewForUpdate = async (interviewId) => {
  if (!interviewId || !isValidId(interviewId)) {
    throw new ApiError(400, "Invalid interview ID");
  }

  const interview = await Interview.findById(interviewId);

  if (!interview) {
    throw new ApiError(404, "Interview not found");
  }

  return interview;
};

const assertInterviewParticipant = (interview, userId) => {
  const id = userId?.toString();

  if (
    interview.candidate.toString() !== id &&
    interview.recruiter.toString() !== id
  ) {
    throw new ApiError(
      403,
      "You are not authorized to access this interview"
    );
  }
};

const scheduleInterview = asyncHandler(async (req, res) => {
  const recruiterId = req.user?._id;

  // 1. Authenticate recruiter
  if (!recruiterId || !isValidId(recruiterId)) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (req.user.role !== "recruiter") {
    throw new ApiError(403, "Only recruiters can schedule interviews");
  }

  // 2. Read only the fields the recruiter is allowed to submit
  const {
    application: applicationId,
    round = 1,
    interviewType,
    location = "",
    scheduledAt,
    duration = 60,
    timezone = "Asia/Kolkata",
    description = "",
  } = req.body;

  if (
    !applicationId ||
    !interviewType ||
    !scheduledAt
  ) {
    throw new ApiError(
      400,
      "Application, interview type, and scheduled date are required"
    );
  }

  if (!isValidId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  // 3. Validate interview type
  if (!INTERVIEW_TYPES.includes(interviewType)) {
    throw new ApiError(400, "Invalid interview type");
  }

  // 4. Validate round
  const interviewRound = Number(round);

  if (
    !Number.isSafeInteger(interviewRound) ||
    interviewRound < 1 ||
    interviewRound > 50
  ) {
    throw new ApiError(
      400,
      "Interview round must be an integer between 1 and 50"
    );
  }

  // 5. Validate duration
  const interviewDuration = Number(duration);

  if (
    !Number.isSafeInteger(interviewDuration) ||
    interviewDuration < 5 ||
    interviewDuration > 480
  ) {
    throw new ApiError(
      400,
      "Interview duration must be between 5 and 480 whole minutes"
    );
  }

  // 6. Validate timezone
  if (
    typeof timezone !== "string" ||
    !timezone.trim()
  ) {
    throw new ApiError(400, "A valid timezone is required");
  }

  const normalizedTimezone = timezone.trim();

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimezone,
    });
  } catch {
    throw new ApiError(400, "Invalid timezone");
  }

  // 7. Validate description
  if (
    typeof description !== "string" ||
    description.length > 5000
  ) {
    throw new ApiError(
      400,
      "Description must not exceed 5000 characters"
    );
  }

  // 8. Validate location
  if (
    interviewType === "Offline" &&
    (typeof location !== "string" || !location.trim())
  ) {
    throw new ApiError(
      400,
      "A physical location is required for an offline interview"
    );
  }

  if (
    interviewType !== "Offline" &&
    typeof location === "string" &&
    location.trim()
  ) {
    throw new ApiError(
      400,
      "A physical location can only be specified for an offline interview"
    );
  }

  // 9. Validate scheduled date
  const interviewDate = validateFutureDate(scheduledAt);

  // 10. Fetch the selected application
  const applicationDoc = await Application.findById(applicationId);

  if (!applicationDoc) {
    throw new ApiError(404, "Application not found");
  }

  // Ensure required references exist
  if (
    !applicationDoc.candidateId ||
    !applicationDoc.jobId ||
    !applicationDoc.companyId
  ) {
    throw new ApiError(
      400,
      "The application is missing required references"
    );
  }

  // Derive IDs from the trusted database document,
  // never from IDs supplied by the frontend.
  const candidateId = applicationDoc.candidateId;
  const jobId = applicationDoc.jobId;
  const companyId = applicationDoc.companyId;

  // 11. Verify company, job and candidate
  const [company, job, candidateDoc] = await Promise.all([
    getActiveCompanyForRecruiter(companyId, recruiterId),
    getActiveJobForCompany(jobId, companyId),
    User.findById(candidateId),
  ]);

  if (!company) {
    throw new ApiError(
      403,
      "You are not authorized to schedule interviews for this company"
    );
  }

  if (!job) {
    throw new ApiError(
      404,
      "Job not found or does not belong to this company"
    );
  }

  if (!candidateDoc) {
    throw new ApiError(404, "Candidate not found");
  }

  if (candidateDoc.role !== "User") {
    throw new ApiError(
      400,
      "The selected candidate is not a candidate account"
    );
  }

  // 12. Ensure the application belongs to the verified job/company
  if (
    applicationDoc.jobId.toString() !== job._id.toString()
  ) {
    throw new ApiError(
      400,
      "The application does not belong to this job"
    );
  }

  if (
    applicationDoc.companyId.toString() !== company._id.toString()
  ) {
    throw new ApiError(
      400,
      "The application does not belong to this company"
    );
  }

  // 13. Validate application status
  if (
    ["rejected", "withdrawn", "closed"].includes(
      applicationDoc.status
    )
  ) {
    throw new ApiError(
      400,
      "An interview cannot be scheduled for this application status"
    );
  }

  // 14. Prevent duplicate active interviews for the same round
  const existingInterview = await Interview.findOne({
    application: applicationDoc._id,
    round: interviewRound,
    status: { $in: ACTIVE_INTERVIEW_STATUSES },
  });

  if (existingInterview) {
    throw new ApiError(
      409,
      "An active interview already exists for this application round"
    );
  }

  // 15. Derive date/time using the requested timezone
  const dateParts = getInterviewDateParts(
    interviewDate,
    normalizedTimezone
  );

  // 16. Create interview using verified database references
  const interview = await Interview.create({
    application: applicationDoc._id,
    job: job._id,
    company: company._id,
    candidate: candidateDoc._id,
    recruiter: recruiterId,

    round: interviewRound,
    interviewType,

    interviewRoomId:
      interviewType === "Online"
        ? generateInterviewRoomId()
        : undefined,

    location:
      interviewType === "Offline"
        ? location.trim()
        : "",

    scheduledAt: interviewDate,
    date: dateParts.date,
    time: dateParts.time,

    duration: interviewDuration,
    timezone: normalizedTimezone,
    description: description.trim(),

    status: "Scheduled",
  });

  // 17. Update application status if your workflow requires it
  if (applicationDoc.status === "shortlisted") {
    applicationDoc.status = "interview_scheduled";
    await applicationDoc.save();
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      interview,
      "Interview scheduled successfully"
    )
  );
});

const getInterviewById = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;

  if (!interviewId || !isValidId(interviewId)) {
    throw new ApiError(400, "Invalid interview ID");
  }

  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  const interview = await Interview.findById(interviewId)
    .populate("candidate", "fullName avatar email")
    .populate("recruiter", "fullName avatar email")
    .populate("application")
    .populate("job", "title companyId location employmentType")
    .populate("company", "name logo headquarters");

  if (!interview) {
    throw new ApiError(404, "Interview not found");
  }

  assertInterviewParticipant(interview, req.user._id);

  return res.status(200).json(
    new ApiResponse(
      200,
      interview,
      "Interview fetched successfully"
    )
  );
});

const getMyInterviews = asyncHandler(async (req, res) => {
  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    $or: [
      { candidate: req.user._id },
      { recruiter: req.user._id },
    ],
  };

  const [interviews, totalInterviews] = await Promise.all([
    Interview.find(filter)
      .populate("candidate", "fullName avatar email")
      .populate("recruiter", "fullName avatar email")
      .populate("application")
      .populate("job", "title companyId location employmentType")
      .populate("company", "name logo headquarters")
      .sort({ scheduledAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Interview.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        interviews,
        pagination: {
          totalInterviews,
          currentPage: page,
          totalPages: Math.ceil(totalInterviews / limit),
          limit,
        },
      },
      "Interviews fetched successfully"
    )
  );
});

const rescheduleInterview = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { scheduledAt, rescheduleReason } = req.body;

  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (req.user.role !== "recruiter") {
    throw new ApiError(
      403,
      "Only recruiters can reschedule interviews"
    );
  }

  if (!scheduledAt) {
    throw new ApiError(
      400,
      "New interview date and time are required"
    );
  }

  if (
    rescheduleReason !== undefined &&
    (typeof rescheduleReason !== "string" ||
      rescheduleReason.length > 2000)
  ) {
    throw new ApiError(
      400,
      "Reschedule reason must not exceed 2000 characters"
    );
  }

  const interview = await getInterviewForUpdate(interviewId);

  if (interview.recruiter.toString() !== req.user._id.toString()) {
    throw new ApiError(
      403,
      "You are not authorized to reschedule this interview"
    );
  }

  if (
    ["Completed", "Cancelled", "Rejected", "No Show"].includes(
      interview.status
    )
  ) {
    throw new ApiError(
      400,
      "This interview can no longer be rescheduled"
    );
  }

  const newDate = validateFutureDate(scheduledAt);
  const dateParts = getInterviewDateParts(
    newDate,
    interview.timezone || "Asia/Kolkata"
  );

  interview.scheduledAt = newDate;
  interview.date = dateParts.date;
  interview.time = dateParts.time;
  interview.status = "Rescheduled";

  if (rescheduleReason !== undefined) {
    interview.rescheduleReason = rescheduleReason.trim();
  }

  await interview.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      interview,
      "Interview rescheduled successfully"
    )
  );
});

const updateInterviewStatus = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { status, cancellationReason } = req.body;

  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (req.user.role !== "recruiter") {
    throw new ApiError(
      403,
      "Only recruiters can update interview status"
    );
  }

  if (!status || !INTERVIEW_STATUSES.includes(status)) {
    throw new ApiError(400, "Invalid interview status");
  }

  if (
    cancellationReason !== undefined &&
    (typeof cancellationReason !== "string" ||
      cancellationReason.length > 2000)
  ) {
    throw new ApiError(
      400,
      "Cancellation reason must not exceed 2000 characters"
    );
  }

  const interview = await getInterviewForUpdate(interviewId);

  if (interview.recruiter.toString() !== req.user._id.toString()) {
    throw new ApiError(
      403,
      "You are not authorized to update this interview"
    );
  }

  const allowedTransitions = {
    Scheduled: [
      "Accepted",
      "Rejected",
      "Cancelled",
      "Reschedule Requested",
      "Rescheduled",
      "Completed",
      "No Show",
    ],
    Accepted: [
      "Cancelled",
      "Reschedule Requested",
      "Rescheduled",
      "Completed",
      "No Show",
    ],
    "Reschedule Requested": [
      "Scheduled",
      "Rescheduled",
      "Cancelled",
    ],
    Rescheduled: [
      "Accepted",
      "Rejected",
      "Cancelled",
      "Reschedule Requested",
      "Completed",
      "No Show",
    ],
    Rejected: [],
    Completed: [],
    Cancelled: [],
    "No Show": [],
  };

  if (
    interview.status !== status &&
    !allowedTransitions[interview.status]?.includes(status)
  ) {
    throw new ApiError(
      400,
      `Cannot change interview status from ${interview.status} to ${status}`
    );
  }

  interview.status = status;

  if (status === "Cancelled" && cancellationReason !== undefined) {
    interview.cancellationReason = cancellationReason.trim();
  }

  if (status === "Completed") {
    interview.completedAt = new Date();
  }

  await interview.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      interview,
      "Interview status updated successfully"
    )
  );
});

const getUpcomingInterviews = asyncHandler(async (req, res) => {
  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    scheduledAt: { $gt: new Date() },
    status: {
      $in: ["Scheduled", "Accepted", "Rescheduled"],
    },
    $or: [
      { recruiter: req.user._id },
      { candidate: req.user._id },
    ],
  };

  const [interviews, totalInterviews] = await Promise.all([
    Interview.find(filter)
      .populate("candidate", "fullName email avatar")
      .populate("recruiter", "fullName email avatar")
      .populate("job", "title companyId location employmentType")
      .populate("company", "name logo headquarters")
      .populate("application")
      .sort({ scheduledAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Interview.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        interviews,
        pagination: {
          totalInterviews,
          currentPage: page,
          totalPages: Math.ceil(totalInterviews / limit),
          limit,
        },
      },
      "Upcoming interviews fetched successfully"
    )
  );
});

const getTodayInterviews = asyncHandler(async (req, res) => {
  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  const timezone = req.query.timezone || "Asia/Kolkata";

  if (typeof timezone !== "string" || !timezone.trim()) {
    throw new ApiError(400, "Invalid timezone");
  }

  let parts;

  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
  } catch {
    throw new ApiError(400, "Invalid timezone");
  }

  const dateParts = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );

  const localDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

  const startOfDay = new Date(`${localDate}T00:00:00.000Z`);
  const endOfDay = new Date(`${localDate}T23:59:59.999Z`);

  const interviews = await Interview.find({
    scheduledAt: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
    $or: [
      { recruiter: req.user._id },
      { candidate: req.user._id },
    ],
  })
    .populate("candidate", "fullName email avatar")
    .populate("recruiter", "fullName email avatar")
    .populate("job", "title companyId location employmentType")
    .populate("company", "name logo headquarters")
    .populate("application")
    .sort({ scheduledAt: 1 });

  return res.status(200).json(
    new ApiResponse(
      200,
      interviews,
      "Today's interviews fetched successfully"
    )
  );
});

const getInterviewsByJob = asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (req.user.role !== "recruiter") {
    throw new ApiError(
      403,
      "Only recruiters can access job interview lists"
    );
  }

  if (!jobId || !isValidId(jobId)) {
    throw new ApiError(400, "Invalid job ID");
  }

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    job: jobId,
    recruiter: req.user._id,
  };

  const [interviews, totalInterviews] = await Promise.all([
    Interview.find(filter)
      .populate("candidate", "fullName email avatar")
      .populate("recruiter", "fullName email avatar")
      .populate("job", "title companyId location employmentType")
      .populate("company", "name logo headquarters")
      .populate("application")
      .sort({ scheduledAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Interview.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        interviews,
        pagination: {
          totalInterviews,
          currentPage: page,
          totalPages: Math.ceil(totalInterviews / limit),
          limit,
        },
      },
      "Job interviews fetched successfully"
    )
  );
});

const getInterviewsByApplication = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;

  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (!applicationId || !isValidId(applicationId)) {
    throw new ApiError(400, "Invalid application ID");
  }

  const interviews = await Interview.find({
    application: applicationId,
    $or: [
      { recruiter: req.user._id },
      { candidate: req.user._id },
    ],
  })
    .populate("candidate", "fullName email avatar")
    .populate("recruiter", "fullName email avatar")
    .populate("job", "title companyId location employmentType")
    .populate("company", "name logo headquarters")
    .populate("application")
    .sort({ scheduledAt: 1 });

  return res.status(200).json(
    new ApiResponse(
      200,
      interviews,
      "Application interviews fetched successfully"
    )
  );
});

const getRecruiterInterviews = asyncHandler(async (req, res) => {
const recruiterId = req.user?._id;

if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
throw new ApiError(401, "Unauthorized access");
}

if (req.user.role !== "recruiter") {
throw new ApiError(403, "Recruiter access required");
}

const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
const limit = Math.min(
50,
Math.max(1, Math.floor(Number(req.query.limit) || 10))
);
const skip = (page - 1) * limit;

const filter = { recruiter: recruiterId };

if (req.query.status) {
if (!INTERVIEW_STATUSES.includes(req.query.status)) {
throw new ApiError(400, "Invalid interview status");
}

filter.status = req.query.status;

}

if (req.query.interviewType) {
if (!INTERVIEW_TYPES.includes(req.query.interviewType)) {
throw new ApiError(400, "Invalid interview type");
}

filter.interviewType = req.query.interviewType;

}

if (req.query.jobId) {
if (!mongoose.isValidObjectId(req.query.jobId)) {
throw new ApiError(400, "Invalid job ID");
}

filter.job = req.query.jobId;

}

if (req.query.candidateId) {
if (!mongoose.isValidObjectId(req.query.candidateId)) {
throw new ApiError(400, "Invalid candidate ID");
}

filter.candidate = req.query.candidateId;

}

if (req.query.applicationId) {
if (!mongoose.isValidObjectId(req.query.applicationId)) {
throw new ApiError(400, "Invalid application ID");
}

filter.application = req.query.applicationId;

}

if (req.query.from || req.query.to) {
filter.scheduledAt = {};

if (req.query.from) {
  const from = new Date(req.query.from);

  if (Number.isNaN(from.getTime())) {
    throw new ApiError(400, "Invalid from date");
  }

  filter.scheduledAt.$gte = from;
}

if (req.query.to) {
  const to = new Date(req.query.to);

  if (Number.isNaN(to.getTime())) {
    throw new ApiError(400, "Invalid to date");
  }

  filter.scheduledAt.$lte = to;
}

if (
  filter.scheduledAt.$gte &&
  filter.scheduledAt.$lte &&
  filter.scheduledAt.$gte > filter.scheduledAt.$lte
) {
  throw new ApiError(400, "From date cannot be after to date");
}

}

const sortOrder = req.query.sort === "oldest" ? 1 : -1;

const [interviews, totalInterviews] = await Promise.all([
Interview.find(filter)
.populate("candidate", "fullName avatar email")
.populate("recruiter", "fullName avatar email")
.populate("job", "title companyId location employmentType")
.populate("company", "name logo headquarters")
.populate("application")
.sort({ scheduledAt: sortOrder, createdAt: -1 })
.skip(skip)
.limit(limit)
.lean(),

Interview.countDocuments(filter),

]);

return res.status(200).json(
new ApiResponse(
200,
{
interviews,
pagination: {
totalInterviews,
currentPage: page,
totalPages: Math.ceil(totalInterviews / limit),
limit,
},
},
"Recruiter interviews fetched successfully"
)
);
});

const getRecruiterInterviewStats = asyncHandler(async (req, res) => {
const recruiterId = req.user?._id;

if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
throw new ApiError(401, "Unauthorized access");
}

if (req.user.role !== "recruiter") {
throw new ApiError(403, "Recruiter access required");
}

const now = new Date();
const startOfToday = new Date(now);
startOfToday.setHours(0, 0, 0, 0);

const startOfTomorrow = new Date(startOfToday);
startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

const baseFilter = { recruiter: recruiterId };

const [
total,
scheduled,
accepted,
completed,
cancelled,
rejected,
rescheduleRequested,
noShow,
upcoming,
today,
] = await Promise.all([
Interview.countDocuments(baseFilter),
Interview.countDocuments({
...baseFilter,
status: "Scheduled",
}),
Interview.countDocuments({
...baseFilter,
status: "Accepted",
}),
Interview.countDocuments({
...baseFilter,
status: "Completed",
}),
Interview.countDocuments({
...baseFilter,
status: "Cancelled",
}),
Interview.countDocuments({
...baseFilter,
status: "Rejected",
}),
Interview.countDocuments({
...baseFilter,
status: "Reschedule Requested",
}),
Interview.countDocuments({
...baseFilter,
status: "No Show",
}),
Interview.countDocuments({
...baseFilter,
scheduledAt: { $gte: now },
status: { $in: ACTIVE_INTERVIEW_STATUSES },
}),
Interview.countDocuments({
...baseFilter,
scheduledAt: {
$gte: startOfToday,
$lt: startOfTomorrow,
},
status: { $in: ACTIVE_INTERVIEW_STATUSES },
}),
]);

return res.status(200).json(
new ApiResponse(
200,
{
total,
scheduled,
accepted,
completed,
cancelled,
rejected,
rescheduleRequested,
noShow,
upcoming,
today,
},
"Recruiter interview statistics fetched successfully"
)
);
});

const getRecruiterInterviewsByCandidate = asyncHandler(
async (req, res) => {
const recruiterId = req.user?._id;
const { candidateId } = req.params;

if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
  throw new ApiError(401, "Unauthorized access");
}

if (req.user.role !== "recruiter") {
  throw new ApiError(403, "Recruiter access required");
}

if (!candidateId || !mongoose.isValidObjectId(candidateId)) {
  throw new ApiError(400, "Invalid candidate ID");
}

const candidate = await User.findById(candidateId).select("_id role");

if (!candidate || candidate.role !== "User") {
  throw new ApiError(404, "Candidate not found");
}

const interviews = await Interview.find({
  recruiter: recruiterId,
  candidate: candidateId,
})
  .populate("candidate", "fullName avatar email")
  .populate("job", "title companyId location employmentType")
  .populate("company", "name logo headquarters")
  .populate("application")
  .sort({ scheduledAt: -1 });

return res.status(200).json(
  new ApiResponse(
    200,
    interviews,
    "Candidate interviews fetched successfully"
  )
);

}
);

const getRecruiterInterviewById = asyncHandler(async (req, res) => {
  const recruiterId = req.user?._id;
  const { interviewId } = req.params;

  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (req.user.role !== "recruiter") {
    throw new ApiError(403, "Recruiter access required");
  }

  if (!interviewId || !mongoose.isValidObjectId(interviewId)) {
    throw new ApiError(400, "Invalid interview ID");
  }

  const interview = await Interview.findOne({
    _id: interviewId,
    recruiter: recruiterId,
  })
    .populate("candidate", "fullName avatar email")
    .populate("recruiter", "fullName avatar email")
    .populate("application")
    .populate("job", "title description companyId location employmentType workSpaceType")
    .populate("company", "name logo banner industry headquarters verificationStatus");

  if (!interview) {
    throw new ApiError(
      404,
      "Interview not found or you are not authorized to access it"
    );
  }

  if (!interview.company) {
    throw new ApiError(404, "Associated company not found");
  }

  if (!interview.job) {
    throw new ApiError(404, "Associated job not found");
  }

  if (!interview.candidate) {
    throw new ApiError(404, "Associated candidate not found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      interview,
      "Recruiter interview fetched successfully"
    )
  );
});

const cancelRecruiterInterview = asyncHandler(async (req, res) => {
  const recruiterId = req.user?._id;
  const { interviewId } = req.params;
  const { cancellationReason } = req.body;

  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (req.user.role !== "recruiter") {
    throw new ApiError(403, "Recruiter access required");
  }

  if (!interviewId || !mongoose.isValidObjectId(interviewId)) {
    throw new ApiError(400, "Invalid interview ID");
  }

  if (
    cancellationReason !== undefined &&
    (typeof cancellationReason !== "string" ||
      cancellationReason.trim().length > 2000)
  ) {
    throw new ApiError(
      400,
      "Cancellation reason must not exceed 2000 characters"
    );
  }

  const interview = await Interview.findOne({
    _id: interviewId,
    recruiter: recruiterId,
  });

  if (!interview) {
    throw new ApiError(
      404,
      "Interview not found or you are not authorized to cancel it"
    );
  }

  if (
    ["Completed", "Cancelled", "Rejected", "No Show"].includes(
      interview.status
    )
  ) {
    throw new ApiError(
      400,
      `Cannot cancel an interview with status ${interview.status}`
    );
  }

  interview.status = "Cancelled";

  if (cancellationReason !== undefined) {
    interview.cancellationReason = cancellationReason.trim();
  }

  await interview.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      interview,
      "Interview cancelled successfully"
    )
  );
});

export {
  scheduleInterview,
  getInterviewById,
  getMyInterviews,
  rescheduleInterview,
  updateInterviewStatus,
  getUpcomingInterviews,
  getTodayInterviews,
  getInterviewsByApplication,
  getInterviewsByJob,
  getRecruiterInterviewStats,
  getRecruiterInterviews,
  getRecruiterInterviewById,
  getRecruiterInterviewsByCandidate,
  cancelRecruiterInterview,
}