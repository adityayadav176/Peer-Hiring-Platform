import mongoose, { Schema } from "mongoose";

const adminSchema = new Schema(
    {
        singletonKey: {
            type: String,
            unique: true,
            default: "PEER_HIRING_OWNER",
            immutable: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            unique: true,
        },

        password: {
            type: String,
            required: true,
            select: false,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        lastLoginAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

const Admin = mongoose.model("Admin", adminSchema);

export default Admin;