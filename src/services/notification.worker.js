import { Worker } from "bullmq";
import redisConnection from "../config/redis.js";
import { Notification } from "../models/notification.model.js";


const notificationWorker = new Worker(
    "notification-queue",

    async(job) => {
        const {recipient, sender, type, title, message, data} = job.data;

        console.log(`Proccessing notification job : ${job.id}`);

        const notification = await Notification.create({
            recipient,
            sender: sender || null,
            type,
            title,
            message,
            data: data || {},
        })

        console.log(`Notification created: ${notification._id}`);

        return {
            notificationId: notification._id.toString(),
        };
    },

    {
        connection: redisConnection,

        concurrency: 10,
    }
);

notificationWorker.on("completed", (job) => {
    console.log(`Notification job completed : ${job.id}`);
})

notificationWorker.on("failed", (job, error) => {
    console.log(`Notification Failed : ${job?.id}`, error);
})

notificationWorker.on("error", (error) => {
    console.log(`Notification Worker Failed : ${error}`);
})

console.log("Notification Worker Started");

export default notificationWorker;