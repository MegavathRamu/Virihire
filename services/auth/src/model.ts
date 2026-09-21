import mongoose from "mongoose";

// authdb — users collection.
// User { _id, name, email, passwordHash, role, createdAt }
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["candidate", "recruiter", "referrer"], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

export const User = mongoose.model("User", userSchema);
