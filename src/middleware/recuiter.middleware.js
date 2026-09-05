import { ApiError } from "../utils/ApiError.js"

const isRecruiter = async(req, _, next) => {

    if(!req.user) {
        throw new ApiError(401, "Unauthtorized");
    }

    if(req.user.role !== "recruiter") {
        throw new ApiError(403, "Only Recruiter Can Perform This Task");
    }

    next();
}

export {
    isRecruiter
}