import {Queue} from "bullmq";

import redisConnection from "./redis.js";

const notificationQueue = new Queue("notification-queue", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,

        backoff: {
            type: "exponential",
            delay: 2000,
        },

        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

export default notificationQueue;