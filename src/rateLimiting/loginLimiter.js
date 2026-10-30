import { ApiError } from "../utils/ApiError.js";

const loginAttempts = new Map();

const MAX_TOKENS = 5;
const REFILL_INTERVAL = 12 * 1000; // 1 token every 12 seconds

export const loginRateLimit = (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let bucket = loginAttempts.get(ip);

    // Initialize bucket for a new IP
    if (!bucket) {
        bucket = {
            tokens: MAX_TOKENS,
            lastRefill: now,
        };

        loginAttempts.set(ip, bucket);
    }

    // Refill tokens while preserving elapsed time
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / REFILL_INTERVAL);

    if (tokensToAdd > 0) {
        bucket.tokens = Math.min(
            MAX_TOKENS,
            bucket.tokens + tokensToAdd
        );

        bucket.lastRefill += tokensToAdd * REFILL_INTERVAL;
    }

    // Reject when the bucket is empty
    if (bucket.tokens <= 0) {
        res.set("Retry-After", String(
            Math.ceil(
                (REFILL_INTERVAL - (now - bucket.lastRefill)) / 1000
            )
        ));

        return next(
            new ApiError(
                429,
                "Too many login attempts. Try again later."
            )
        );
    }

    // Consume one token
    bucket.tokens--;

    return next();
};
