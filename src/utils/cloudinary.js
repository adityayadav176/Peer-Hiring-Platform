import { v2 as cloudinary } from "cloudinary";
import fs from "fs"
import { ApiError } from "./ApiError.js";
import dotenv from "dotenv"

dotenv.config()

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUDNAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
})

console.log({
  cloud_name: process.env.CLOUDINARY_CLOUDNAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET ? "Loaded" : "Missing"
});



const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) {
      throw new Error("Cloudinary upload: local file path is missing.");
    }

    const result = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "image",
      folder: "peer-hiring/companies",
    });

    if (!result?.secure_url || !result?.public_id) {
      throw new Error("Cloudinary returned an incomplete upload result.");
    }

    return result;
  } catch (error) {
    console.error("Cloudinary upload failed:", error);
    throw error;
  } finally {
    if (localFilePath && fs.existsSync(localFilePath)) {
      fs.unlink(localFilePath, (error) => {
        if (error) {
          console.error("Failed to remove temporary upload:", error);
        }
      });
    }
  }
};

const deleteFromCloudinary = async (public_id) => {
    if (!public_id) return null;

    return await cloudinary.uploader.destroy(public_id);
};


export {
    uploadOnCloudinary,
    deleteFromCloudinary
};