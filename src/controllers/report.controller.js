import { Report } from "../models/report.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";


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




export {
    getAllReports,
    getReportById,
    resolveReport
}