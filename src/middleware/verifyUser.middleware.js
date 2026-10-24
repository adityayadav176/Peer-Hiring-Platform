import { Session } from "../models/session.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";

export const verifyUser = asyncHandler(
    async (req, _, next) => {
     console.log("Parsed cookies:", Object.keys(req.cookies || {}));
console.log(
  "Access token exists:",
  Boolean(req.cookies?.accessToken)
);
console.log(
  "Authorization header exists:",
  Boolean(req.header("Authorization"))
);

console.log("[AUTH DEBUG]", {
  method: req.method,
  url: req.originalUrl,
  cookieTokenExists: Boolean(req.cookies?.accessToken),
  authorizationHeaderExists: Boolean(req.header("Authorization")),
});

        const token =
            req.cookies?.accessToken ||
            req
                .header("Authorization")
                ?.replace("Bearer ", "");

        if (!token) {
            throw new ApiError(
                401,
                "Unauthorized Access Denied"
            );
        }

        const decodedToken = jwt.verify(
            token,
            process.env.ACCESS_TOKEN_SECRET
        );

        const user = await User.findById(
            decodedToken._id
        ).select(
            "-password -refreshToken"
        );

        if (!user) {
            throw new ApiError(
                401,
                "User Not Found"
            );
        }

        // Token Version Check
        if (
            decodedToken.tokenVersion !==
            user.tokenVersion
        ) {
            throw new ApiError(
                401,
                "Session Expired. Login Again."
            );
        }

        // Session Check
        const session = await Session.findOne({
            _id: decodedToken.sessionId,
            userId: user._id,
            isActive: true,
        });

        if (!session) {
            throw new ApiError(
                401,
                "Session Expired. Login Again."
            );
        }

        req.user = user;

        req.session = session;

        req.sessionId = session._id;

        next();
    }
);