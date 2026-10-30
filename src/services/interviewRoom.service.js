
import mongoose from "mongoose";
import { Interview } from "../models/interview.model.js";
import { ApiError } from "../utils/ApiError.js";

const getReferenceId = (value) =>
  value?._id?.toString() ?? value?.toString();

const authorizeInterviewRoom = async ({ interviewId, userId }) => {
  if (
    typeof interviewId !== "string" ||
    !mongoose.isValidObjectId(interviewId)
  ) {
    throw new ApiError(400, "A valid interview ID is required");
  }

  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new ApiError(401, "Unauthorized access");
  }

  const interview = await Interview.findById(interviewId);

  if (!interview) {
    throw new ApiError(404, "Interview not found");
  }

  if (interview.interviewType !== "Online") {
    throw new ApiError(
      400,
      "Video calling is available only for online interviews"
    );
  }

  const currentUserId = userId.toString();
  const isCandidate =
    getReferenceId(interview.candidate) === currentUserId;
  const isRecruiter =
    getReferenceId(interview.recruiter) === currentUserId;

  if (!isCandidate && !isRecruiter) {
    throw new ApiError(
      403,
      "You are not authorized to join this interview"
    );
  }

  const unavailableStatuses = [
    "Rejected",
    "Cancelled",
    "Completed",
    "No Show",
  ];

  if (unavailableStatuses.includes(interview.status)) {
    throw new ApiError(
      400,
      `Interview is already ${interview.status}`
    );
  }

  return interview;
};

export { authorizeInterviewRoom };
