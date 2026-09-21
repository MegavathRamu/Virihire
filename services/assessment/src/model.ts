import mongoose from "mongoose";

const testCaseSchema = new mongoose.Schema(
  { input: String, expected: String },
  { _id: false }
);

const assessmentSchema = new mongoose.Schema(
  {
    recruiterId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    question: { type: String, default: "" },
    language: { type: String, default: "javascript" },
    durationMins: { type: Number, default: 30 },
    testCases: { type: [testCaseSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
export const Assessment = mongoose.model("Assessment", assessmentSchema);

const invitationSchema = new mongoose.Schema(
  {
    assessmentId: { type: String, required: true, index: true },
    candidateEmail: { type: String, required: true, index: true, lowercase: true, trim: true },
    status: { type: String, default: "invited" }, // invited | started | submitted
    invitedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
invitationSchema.index({ assessmentId: 1, candidateEmail: 1 }, { unique: true });
export const Invitation = mongoose.model("Invitation", invitationSchema);

const eventSchema = new mongoose.Schema(
  { type: String, severity: String, at: String, detail: String },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    assessmentId: { type: String, required: true, index: true },
    candidateId: { type: String, required: true, index: true },
    candidateName: { type: String, default: "" },
    code: { type: String, default: "" },
    status: { type: String, default: "in_progress" }, // in_progress | submitted
    integrityScore: { type: Number, default: 100 },
    confidence: { type: String, default: "High" },
    events: { type: [eventSchema], default: [] },
    testsPassed: { type: Number, default: 0 },
    testsTotal: { type: Number, default: 0 },
    integritySummary: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
  },
  { versionKey: false }
);
export const Submission = mongoose.model("Submission", submissionSchema);
