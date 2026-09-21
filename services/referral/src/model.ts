import mongoose from "mongoose";

// referraldb — referrers (employees who give referrals).
const referrerSchema = new mongoose.Schema(
  {
    referrerId: { type: String, required: true, unique: true, index: true }, // = auth userId
    name: { type: String, default: "" },
    company: { type: String, default: "", index: true },
    role: { type: String, default: "" },
    years: { type: String, default: "" },
    description: { type: String, default: "" },
    photo: { type: String, default: "" },
  },
  { versionKey: false }
);
export const Referrer = mongoose.model("Referrer", referrerSchema);

// referraldb — referral requests.
const requestSchema = new mongoose.Schema(
  {
    candidateId: { type: String, required: true, index: true },
    candidateName: { type: String, default: "" },
    referrerId: { type: String, required: true, index: true },
    referrerCompany: { type: String, default: "" },
    about: { type: String, default: "" },
    whyFit: { type: String, default: "" },
    whyRefer: { type: String, default: "" },
    targetRole: { type: String, default: "" },
    status: { type: String, default: "submitted" }, // submitted | accepted | declined
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
export const ReferralRequest = mongoose.model("ReferralRequest", requestSchema);
