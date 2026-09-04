import crypto from "crypto";

export const generateInterviewRoomId = () => {
    return `interview_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}