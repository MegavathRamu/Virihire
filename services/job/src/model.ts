import mongoose from "mongoose";

// jobdb — jobs collection.
// Job { _id, recruiterId, title, company, description, skills[], location, createdAt }
const jobSchema = new mongoose.Schema(
  {
    recruiterId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    description: { type: String, default: "" },
    skills: { type: [String], default: [] },
    location: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Text index powers keyword search in ListJobs.
jobSchema.index({ title: "text", description: "text", company: "text", skills: "text" });

export const Job = mongoose.model("Job", jobSchema);
