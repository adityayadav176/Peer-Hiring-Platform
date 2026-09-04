import Redis from "ioredis";

console.log(process.env.REDIS_URL);

const redisConnection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
})

redisConnection.on("connect", () => {
    console.log("Redis Connnected");
})

redisConnection.on("error", (error) => {
    console.log("Redis Connection Error: ", error);
})

export default redisConnection;