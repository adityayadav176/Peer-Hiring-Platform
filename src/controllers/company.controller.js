import mongoose from "mongoose";
import slugify from "slugify";
import { Company } from "../models/company.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";


const parseObjectField = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return {};
  }

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new ApiError(
        400,
        `${fieldName} must be a valid JSON object.`
      );
    }
  }

  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value === null
  ) {
    throw new ApiError(
      400,
      `${fieldName} must be an object.`
    );
  }

  return value;
};

const createCompany = asyncHandler(async (req, res) => {
  const recruiterId = req.user?._id;

  if (
    !recruiterId ||
    !mongoose.isValidObjectId(recruiterId)
  ) {
    throw new ApiError(401, "Unauthorized");
  }

  const existingCompany = await Company.findOne({
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
  });

  if (existingCompany) {
    throw new ApiError(
      409,
      "You are already associated with a company."
    );
  }

  const {
  name,
  companyEmail,
  companyPhone,
  description,
  industry,
  companySize,
  foundedYear,
  headquarters,
  socialLinks,
} = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    throw new ApiError(400, "Company name is required.");
  }

  const trimmedName = name.trim();

  if (trimmedName.length > 100) {
    throw new ApiError(
      400,
      "Company name cannot exceed 100 characters."
    );
  }

  const slug = slugify(trimmedName, {
    lower: true,
    strict: true,
    trim: true,
  });

  if (!slug) {
    throw new ApiError(
      400,
      "Company name must contain valid letters or numbers."
    );
  }

  let finalSlug = slug;
  let count = 1;

  while (await Company.exists({ slug: finalSlug })) {
    finalSlug = `${slug}-${count++}`;
  }

  // Multipart form fields arrive as strings.
  // Convert nested fields back into objects.
  const parsedSocialLinks = parseObjectField(
    socialLinks,
    "socialLinks"
  );

  const parsedHeadquarters = parseObjectField(
    headquarters,
    "headquarters"
  );

  // Keep only fields supported by your Company schema.
  const normalizedSocialLinks = {
    website: parsedSocialLinks.website ?? "",
    linkedin: parsedSocialLinks.linkedin ?? "",
    github: parsedSocialLinks.github ?? "",
    twitter: parsedSocialLinks.twitter ?? "",
  };

  const normalizedHeadquarters = {
    country: parsedHeadquarters.country ?? "",
    state: parsedHeadquarters.state ?? "",
    city: parsedHeadquarters.city ?? "",
  };

  let normalizedFoundedYear;

  if (
    foundedYear !== undefined &&
    foundedYear !== null &&
    foundedYear !== ""
  ) {
    normalizedFoundedYear = Number(foundedYear);

    if (
      !Number.isInteger(normalizedFoundedYear) ||
      normalizedFoundedYear < 1800 ||
      normalizedFoundedYear > new Date().getFullYear()
    ) {
      throw new ApiError(
        400,
        "Please provide a valid founded year."
      );
    }
  }

  
let logo = {
  url: "",
  publicId: "",
};

if (req.file) {
  if (!req.file.path) {
    throw new ApiError(400, "Uploaded logo file path is missing.");
  }

  try {
    const uploadedLogo = await uploadOnCloudinary(req.file.path);

    if (!uploadedLogo?.secure_url || !uploadedLogo?.public_id) {
      console.error("Unexpected Cloudinary response:", uploadedLogo);

      throw new ApiError(
        500,
        "Cloudinary returned an invalid logo upload response."
      );
    }

    logo = {
      url: uploadedLogo.secure_url,
      publicId: uploadedLogo.public_id,
    };
  } catch (error) {
    console.error("Company logo upload failed:", error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      500,
      "Company logo upload failed. Check the server logs."
    );
  }
}


  try {
    const company = await Company.create({
  name: trimmedName,
  slug: finalSlug,
  companyEmail:
    typeof companyEmail === "string"
      ? companyEmail.trim().toLowerCase()
      : "",
  companyPhone:
    typeof companyPhone === "string"
      ? companyPhone.trim()
      : "",
  description: description ?? "",
  industry: industry ?? "",
  companySize: companySize || undefined,
  foundedYear: normalizedFoundedYear,
  headquarters: normalizedHeadquarters,
  socialLinks: normalizedSocialLinks,
  logo,
  recruiters: [{ recruiterId }],
});

    return res.status(201).json(
      new ApiResponse(
        201,
        company,
        "Company created successfully."
      )
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(
        409,
        "A company with this slug already exists. Please try again."
      );
    }

    throw error;
  }
});

const getMyCompany = asyncHandler(async (req, res) => {
  const recruiterId = req.user?._id;

  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized");
  }

  const company = await Company.findOne({
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
  });

  if (!company) {
    throw new ApiError(
      404,
      "You have not created or joined a company yet."
    );
  }

  if (company.isBlocked) {
    throw new ApiError(403, "Your company is currently blocked.");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      company,
      "Your company fetched successfully."
    )
  );
});

const getCompanyById = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const recruiterId = req.user?._id;

  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw new ApiError(400, "Invalid company ID.");
  }

  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized");
  }

  const company = await Company.findOne({
    _id: companyId,
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
  });

  if (!company) {
    throw new ApiError(
      404,
      "Company not found or you are not authorized to access it."
    );
  }

  if (company.isBlocked) {
    throw new ApiError(
      403,
      "This company is blocked. Access is restricted."
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      company,
      "Company fetched successfully."
    )
  );
});

const updateCompany = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const recruiterId = req.user?._id;

  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw new ApiError(400, "Invalid company ID.");
  }

  if (!recruiterId || !mongoose.isValidObjectId(recruiterId)) {
    throw new ApiError(401, "Unauthorized");
  }

  const company = await Company.findOne({
    _id: companyId,
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
  });

  if (!company) {
    throw new ApiError(
      404,
      "Company not found or you are not authorized to update it."
    );
  }

  if (company.isBlocked) {
    throw new ApiError(403, "This company is blocked.");
  }

  const {
  name,
  companyEmail,
  companyPhone,
  description,
  industry,
  companySize,
  foundedYear,
  headquarters,
  socialLinks,
} = req.body ?? {};

  const updateData = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      throw new ApiError(400, "Company name cannot be empty.");
    }

    const trimmedName = name.trim();

    if (trimmedName.length > 100) {
      throw new ApiError(
        400,
        "Company name cannot exceed 100 characters."
      );
    }

    const slug = slugify(trimmedName, {
      lower: true,
      strict: true,
      trim: true,
    });

    if (!slug) {
      throw new ApiError(
        400,
        "Company name must contain valid letters or numbers."
      );
    }

    updateData.name = trimmedName;

    let finalSlug = slug;
    let count = 1;

    while (
      await Company.exists({
        slug: finalSlug,
        _id: { $ne: companyId },
      })
    ) {
      finalSlug = `${slug}-${count++}`;
    }

    updateData.slug = finalSlug;
  }

  if (description !== undefined) {
    if (typeof description !== "string") {
      throw new ApiError(400, "Description must be a string.");
    }

    if (description.trim().length > 3000) {
      throw new ApiError(
        400,
        "Description cannot exceed 3000 characters."
      );
    }

    updateData.description = description.trim();
  }

  if (industry !== undefined) {
    if (typeof industry !== "string") {
      throw new ApiError(400, "Industry must be a string.");
    }

    updateData.industry = industry.trim();
  }

  if (companySize !== undefined) {
    const allowedSizes = [
      "1-10",
      "11-50",
      "51-200",
      "201-500",
      "501-1000",
      "1001-5000",
      "5001-10000",
    ];

    if (!allowedSizes.includes(companySize)) {
      throw new ApiError(400, "Invalid company size.");
    }

    updateData.companySize = companySize;
  }

  if (foundedYear !== undefined) {
    const year = Number(foundedYear);
    const currentYear = new Date().getFullYear();

    if (
      foundedYear === "" ||
      !Number.isInteger(year) ||
      year < 1800 ||
      year > currentYear
    ) {
      throw new ApiError(400, "Invalid company founded year.");
    }

    updateData.foundedYear = year;
  }

  if (headquarters !== undefined) {
    if (
      !headquarters ||
      typeof headquarters !== "object" ||
      Array.isArray(headquarters)
    ) {
      throw new ApiError(400, "Headquarters must be an object.");
    }

    const allowedKeys = ["country", "state", "city"];

    for (const key of Object.keys(headquarters)) {
      if (!allowedKeys.includes(key)) {
        throw new ApiError(
          400,
          `Invalid headquarters field: ${key}.`
        );
      }

      if (typeof headquarters[key] !== "string") {
        throw new ApiError(
          400,
          `Headquarters ${key} must be a string.`
        );
      }

      updateData[`headquarters.${key}`] =
        headquarters[key].trim();
    }
  }

  if (socialLinks !== undefined) {
    if (
      !socialLinks ||
      typeof socialLinks !== "object" ||
      Array.isArray(socialLinks)
    ) {
      throw new ApiError(400, "Social links must be an object.");
    }

    const allowedKeys = [
      "website",
      "linkedin",
      "github",
      "twitter",
    ];

    for (const key of Object.keys(socialLinks)) {
      if (!allowedKeys.includes(key)) {
        throw new ApiError(
          400,
          `Invalid social link field: ${key}.`
        );
      }

      if (typeof socialLinks[key] !== "string") {
        throw new ApiError(
          400,
          `Social link ${key} must be a string.`
        );
      }

      updateData[`socialLinks.${key}`] =
        socialLinks[key].trim();
    }
  }

  if (companyEmail !== undefined) {
  if (typeof companyEmail !== "string") {
    throw new ApiError(400, "Company email must be a string.");
  }

  const email = companyEmail.trim().toLowerCase();

  if (
    email.length > 254 ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    throw new ApiError(400, "Please provide a valid company email.");
  }

  updateData.companyEmail = email;
}

if (companyPhone !== undefined) {
  if (typeof companyPhone !== "string") {
    throw new ApiError(400, "Company phone must be a string.");
  }

  const phone = companyPhone.trim();

  if (phone.length > 20 || (phone && !/^[+\d().\-\s]{5,20}$/.test(phone))) {
    throw new ApiError(400, "Please provide a valid company phone number.");
  }

  updateData.companyPhone = phone;
}

  if (Object.keys(updateData).length === 0) {
    throw new ApiError(
      400,
      "No valid fields provided for update."
    );
  }

  try {
    const updatedCompany = await Company.findOneAndUpdate(
      {
        _id: companyId,
        "recruiters.recruiterId": recruiterId,
        isDeleted: false,
        isBlocked: false,
      },
      { $set: updateData },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    );

    if (!updatedCompany) {
      throw new ApiError(
        404,
        "Company not found or no longer available for updating."
      );
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        updatedCompany,
        "Company details updated successfully."
      )
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(
        409,
        "Company slug already exists. Please try another name."
      );
    }

    throw error;
  }
});

const updateCompanyLogo = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const recruiterId = req.user?._id;

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw new ApiError(400, "Invalid company ID.");
  }

  if (!recruiterId) {
    throw new ApiError(401, "Unauthorized request.");
  }

  if (!req.file?.path) {
    throw new ApiError(400, "Company logo is required.");
  }

  const company = await Company.findOne({
    _id: companyId,
    "recruiters.recruiterId": recruiterId,
    isDeleted: false,
  });

  if (!company) {
    throw new ApiError(404, "Company not found.");
  }

  if (company.isBlocked) {
    throw new ApiError(403, "This company is blocked.");
  }

  const uploadedLogo = await uploadOnCloudinary(req.file.path);

  if (!uploadedLogo?.secure_url || !uploadedLogo?.public_id) {
    throw new ApiError(500, "Failed to upload company logo.");
  }

  company.logo = {
    url: uploadedLogo.secure_url,
    publicId: uploadedLogo.public_id,
  };

  await company.save();

  return res.status(200).json(
    new ApiResponse(200, company, "Company logo updated successfully.")
  );
});

export {
  createCompany,
  getMyCompany,
  getCompanyById,
  updateCompany,
  updateCompanyLogo
};