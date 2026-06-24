import mongoose from "mongoose";

// profiledb — profiles collection.
// Profile { _id, userId, phone, skills[], education[], experience[], hasExperience, resumeUrl }
const educationSchema = new mongoose.Schema(
  { school: String, degree: String, year: String },
  { _id: false }
);
const experienceSchema = new mongoose.Schema(
  { company: String, title: String, years: String },
  { _id: false }
);

const profileSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: "" },
    skills: { type: [String], default: [] },
    education: { type: [educationSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    hasExperience: { type: Boolean, default: false }, // Fresher toggle: false = fresher
    resumeUrl: { type: String, default: "" },
  },
  { versionKey: false }
);

export const Profile = mongoose.model("Profile", profileSchema);

// profiledb — applications collection.
// Application { _id, candidateId, jobId, status, appliedAt }
const applicationSchema = new mongoose.Schema(
  {
    candidateId: { type: String, required: true, index: true },
    jobId: { type: String, required: true, index: true },
    status: { type: String, default: "applied" },
    appliedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
// One application per candidate per job.
applicationSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

export const Application = mongoose.model("Application", applicationSchema);
