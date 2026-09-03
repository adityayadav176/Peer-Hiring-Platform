import dotenv from "dotenv";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import Admin from "../models/admin.model.js";
import { MONGO_DB_NAME } from "../constant/constant.js";

dotenv.config();

const createAdmin = async () => {
    try {
        await mongoose.connect(`${process.env.MONGO_DB_URI}/${MONGO_DB_NAME}`);

        console.log("MongoDB connected successfully");

        const existingAdmin = await Admin.findOne({
            singletonKey: "PEER_HIRING_OWNER",
        });

        if (existingAdmin) {
            console.log("Admin already exists.");
            await mongoose.disconnect();
            process.exit(0);
        }

        const hashedPassword = await bcrypt.hash(
            process.env.ADMIN_PASSWORD,
            12
        );

        const admin = await Admin.create({
            singletonKey: "PEER_HIRING_OWNER",
            name: process.env.ADMIN_NAME,
            email: process.env.ADMIN_EMAIL,
            password: hashedPassword,
        });

        console.log("Admin created successfully");
        console.log("Admin ID:", admin._id);

        await mongoose.disconnect();
        process.exit(0);

    } catch (error) {
        console.error("Failed to create Admin:", error);

        await mongoose.disconnect();

        process.exit(1);
    }
};

createAdmin();