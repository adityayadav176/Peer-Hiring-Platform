
import mongoose from "mongoose";

import { Report } from "../models/report.model.js";
import { Job } from "../models/job.model.js";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const REPORT_STATUSES = ["pending", "resolved", "rejected"];

const populateReport = (query) =>
  query
    .populate({
      path: "reporter",
      select: "name email avatar role createdAt",
    })
    .populate({
      path: "reportedUser",
      select: "name email avatar role accountStatus isBlocked createdAt",
    })
    .populate({
      path: "reportedJob",
      select: "title companyId",
      populate: {
        path: "companyId",
        select: "name logo headquarters industry",
      },
    });
const getAdminIdentifier = (req) => {
    const adminId = req.admin?._id;

    if (adminId) {
        return String(adminId);
    }

    return "Admin";
};

const getAllReports = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        status,
        reason,
        search,
        startDate,
        endDate,
        targetType,
        sortBy = "createdAt",
        order = "desc",
    } = req.query;

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(
        Math.max(parseInt(limit, 10) || 10, 1),
        100
    );

    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (status) {
        if (!REPORT_STATUSES.includes(status)) {
            throw new ApiError(
                400,
                `Invalid status. Allowed values: ${REPORT_STATUSES.join(", ")}`
            );
        }

        filter.status = status;
    }

    if (targetType) {
  const normalizedTargetType = targetType.toLowerCase();

  if (!["user", "job"].includes(normalizedTargetType)) {
    throw new ApiError(
      400,
      "Invalid targetType. Allowed values: user, job"
    );
  }

  if (normalizedTargetType === "user") {
    filter.reportedUser = { $exists: true, $ne: null };
  }

  if (normalizedTargetType === "job") {
    filter.reportedJob = { $exists: true, $ne: null };
  }
}

    if (reason?.trim()) {
        filter.reason = {
            $regex: reason.trim(),
            $options: "i",
        };
    }

    if (startDate || endDate) {
        const dateFilter = {};

        if (startDate) {
            const start = new Date(startDate);

            if (Number.isNaN(start.getTime())) {
                throw new ApiError(400, "Invalid startDate");
            }

            dateFilter.$gte = start;
        }

        if (endDate) {
            const end = new Date(endDate);

            if (Number.isNaN(end.getTime())) {
                throw new ApiError(400, "Invalid endDate");
            }

            end.setHours(23, 59, 59, 999);
            dateFilter.$lte = end;
        }

        if (
            dateFilter.$gte &&
            dateFilter.$lte &&
            dateFilter.$gte > dateFilter.$lte
        ) {
            throw new ApiError(
                400,
                "startDate cannot be after endDate"
            );
        }

        filter.createdAt = dateFilter;
    }

    if (search?.trim()) {
        const searchTerm = search.trim();
        const searchRegex = {
            $regex: searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
        };

        const [matchingUsers, matchingJobs] = await Promise.all([
            User.find({
                $or: [
                    { name: searchRegex },
                    { email: searchRegex },
                ],
            }).select("_id"),

            Job.find({
                title: searchRegex,
            }).select("_id"),
        ]);

        const userIds = matchingUsers.map((user) => user._id);
        const jobIds = matchingJobs.map((job) => job._id);

        filter.$or = [
            { reason: searchRegex },
            { description: searchRegex },
            { adminNote: searchRegex },
            { reporter: { $in: userIds } },
            { reportedUser: { $in: userIds } },
            { reportedJob: { $in: jobIds } },
        ];
    }

    const allowedSortFields = [
        "createdAt",
        "updatedAt",
        "status",
        "reason",
        "resolvedAt",
    ];

    const safeSortBy = allowedSortFields.includes(sortBy)
        ? sortBy
        : "createdAt";

    const sortOrder = order === "asc" ? 1 : -1;

    const [reports, totalReports] = await Promise.all([
        populateReport(
            Report.find(filter)
                .sort({ [safeSortBy]: sortOrder, _id: -1 })
                .skip(skip)
                .limit(limitNumber)
        ),

        Report.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalReports / limitNumber);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                reports,
                pagination: {
                    totalReports,
                    currentPage: pageNumber,
                    totalPages,
                    limit: limitNumber,
                    hasNextPage: pageNumber < totalPages,
                    hasPrevPage: pageNumber > 1,
                },
                filters: {
                    status: status || "",
                    reason: reason || "",
                    search: search || "",
                    startDate: startDate || "",
                    endDate: endDate || "",
                    sortBy: safeSortBy,
                    order: order === "asc" ? "asc" : "desc",
                },
            },
            "Reports fetched successfully"
        )
    );
});

const getReportById = asyncHandler(async (req, res) => {
    const { reportId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
        throw new ApiError(400, "Invalid report ID");
    }

    const report = await populateReport(
        Report.findById(reportId)
    );

    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            report,
            "Report fetched successfully"
        )
    );
});

const updateReportStatus = asyncHandler(async (req, res, nextStatus) => {
    const { reportId } = req.params;
    const { adminNote = "" } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
        throw new ApiError(400, "Invalid report ID");
    }

    if (typeof adminNote !== "string") {
        throw new ApiError(400, "Admin note must be a string");
    }

    const report = await Report.findById(reportId);

    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    if (report.status !== "pending") {
        throw new ApiError(
            400,
            `Report is already ${report.status}`
        );
    }

    report.status = nextStatus;
    report.adminNote = adminNote.trim();
    report.resolvedBy = getAdminIdentifier(req);
    report.resolvedAt = new Date();

    await report.save();

    const updatedReport = await populateReport(
        Report.findById(report._id)
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedReport,
            nextStatus === "resolved"
                ? "Report resolved successfully"
                : "Report rejected successfully"
        )
    );
});

const resolveReport = asyncHandler(async (req, res) => {
    return updateReportStatus(req, res, "resolved");
});

const rejectReport = asyncHandler(async (req, res) => {
    return updateReportStatus(req, res, "rejected");
});

const createReport = asyncHandler(async (req, res) => {
  const { reportedUser, reportedJob, reason, description = "" } =
    req.body;

  const reporter = req.user?._id;

  if (!reporter) {
    throw new ApiError(401, "Authentication required.");
  }

  if (!reason?.trim()) {
    throw new ApiError(400, "Reason is required.");
  }

  if ((!reportedUser && !reportedJob) ||
      (reportedUser && reportedJob)) {
    throw new ApiError(
      400,
      "Report exactly one user or one job."
    );
  }

  if (reportedUser && !mongoose.isValidObjectId(reportedUser)) {
    throw new ApiError(400, "Invalid reported user ID.");
  }

  if (reportedJob && !mongoose.isValidObjectId(reportedJob)) {
    throw new ApiError(400, "Invalid reported job ID.");
  }

  const report = await Report.create({
    reporter,
    reportedUser: reportedUser || null,
    reportedJob: reportedJob || null,
    reason: reason.trim(),
    description: description.trim(),
  });

  return res.status(201).json(
    new ApiResponse(201, report, "Report created successfully.")
  );
});

export {
    getAllReports,
    getReportById,
    resolveReport,
    rejectReport,
    createReport,
};
