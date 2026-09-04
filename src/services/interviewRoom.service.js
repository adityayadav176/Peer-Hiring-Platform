import { Interview } from "../models/interview.model.js";
import { ApiError } from "../utils/ApiError.js";

const authorizeInterviewRoom = async({interviewId, userId}) => {
    const interview = await Interview.findOne({
        interviewRoomId
    })

    if(!interview) {
        throw new ApiError(404, "Interview Room Not Found");
    }

    if(!interview.interviewType === "Online") {
        throw new ApiError(400, "Video Calling Is Available Only For Online Interview");
    }

    const isCandidate = await interview.candidate.toString() === userId.toString();

    const isRecruiter = await interview.recruiter.toString() === userId.toString();

    if(!isCandidate && !isRecruiter) {
        throw new ApiError(403, "You are not authorized to join this interview");
    }

    if(["Rejected", "Cancelled", "Completed", "No Show"].includes(interview.status)) {
         throw new ApiError(400, `Interview Is Already ${interview.status}`)
    }

    return interview;
}

export {
    authorizeInterviewRoom
}