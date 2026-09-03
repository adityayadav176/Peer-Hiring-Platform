import { Report } from "../models/report.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {Job} from "../models/job.model.js"
import mongoose from "mongoose";


const getAllReports = asyncHandler(async (req, res) => {

    const {
        page = 1,
        limit = 10,
        status,
        reason
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);
    const limitNumber = Math.min(Math.max(Number(limit), 1), 100);

    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (status) {
        filter.status = status;
    }

    if (reason) {
        filter.reason = reason;
    }

    const [reports, totalReports] = await Promise.all([
        Report.find(filter)
            .populate("reporter", "name email avatar")
            .populate("reportedUser", "name email avatar role")
            .populate("reportedJob", "title company")
            .populate("resolvedBy", "name email")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNumber),

        Report.countDocuments(filter)
    ]);

    if(!reports) {
        throw new ApiError(404, "Reports not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                reports,
                pagination: {
                    totalReports,
                    currentPage: pageNumber,
                    totalPages: Math.ceil(
                        totalReports / limitNumber
                    ),
                    limit: limitNumber
                }
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

    const report = await Report.findById(reportId)
        .populate("reporter", "name email avatar role")
        .populate("reportedUser", "name email avatar role")
        .populate("reportedJob")
        .populate("resolvedBy", "name email");

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

const resolveReport = asyncHandler(async (req, res) => {

    const { reportId } = req.params;
    const { adminNote = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
        throw new ApiError(400, "Invalid report ID");
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

    report.status = "resolved";
    report.adminNote = adminNote;
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();

    await report.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            report,
            "Report resolved successfully"
        )
    );
});

const rejectReport = asyncHandler(async (req, res) => {

    const { reportId } = req.params;
    const { adminNote = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
        throw new ApiError(400, "Invalid report ID");
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

    report.status = "rejected";
    report.adminNote = adminNote;
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();

    await report.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            report,
            "Report rejected successfully"
        )
    );
});

const createReport = asyncHandler(async (req, res) => {

    const { reportedUser, reportedJob, reason, description } = req.body;

    // At least one target is required
    if (!reportedUser && !reportedJob) {
        throw new ApiError(
            400,
            "You must report a user or a job"
        );
    }

    // Both cannot be reported in one report
    if (reportedUser && reportedJob) {
        throw new ApiError(
            400,
            "You can report either a user or a job"
        );
    }

    if (!reason?.trim()) {
        throw new ApiError(400, "Report reason is required");
    }

    // Validate reported user ID
    if (
        reportedUser &&
        !mongoose.Types.ObjectId.isValid(reportedUser)
    ) {
        throw new ApiError(400, "Invalid reported user ID");
    }

    // Validate reported job ID
    if (
        reportedJob &&
        !mongoose.Types.ObjectId.isValid(reportedJob)
    ) {
        throw new ApiError(400, "Invalid reported job ID");
    }

    // User cannot report himself
    if (
        reportedUser &&
        reportedUser.toString() === req.user._id.toString()
    ) {
        throw new ApiError(
            400,
            "You cannot report yourself"
        );
    }

    // Check reported user exists
    if (reportedUser) {
        const user = await User.findById(reportedUser);

        if (!user) {
            throw new ApiError(
                404,
                "Reported user not found"
            );
        }
    }

    // Check reported job exists
    if (reportedJob) {
        const job = await Job.findById(reportedJob);

        if (!job) {
            throw new ApiError(
                404,
                "Reported job not found"
            );
        }
    }

    // Create report
    const report = await Report.create({
        reporter: req.user._id,
        reportedUser: reportedUser || null,
        reportedJob: reportedJob || null,
        reason: reason.trim(),
        description: description?.trim() || "",
        status: "pending"
    });

    return res
        .status(201)
        .json(
            new ApiResponse(
                201,
                report,
                "Report submitted successfully"
            )
        );
});
export {
    getAllReports,
    getReportById,
    resolveReport,
    rejectReport,
    createReport
}