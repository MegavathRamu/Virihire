import * as grpc from "@grpc/grpc-js";
import { Referrer, ReferralRequest } from "./model.js";
import { getUsers } from "./authClient.js";
import { sendEmail } from "./mailer.js";

// Fire-and-forget: confirm to the candidate + notify the referrer of a new request.
async function notifyNewRequest(doc: any) {
  const users = await getUsers([doc.candidateId, doc.referrerId]);
  const cand = users.get(doc.candidateId);
  const ref = users.get(doc.referrerId);
  const company = doc.referrerCompany || "the company";
  const roleLine = doc.targetRole ? ` for the ${doc.targetRole} role` : "";

  if (cand?.email) {
    await sendEmail(
      cand.email,
      "Referral request submitted ✅",
      `Hi ${doc.candidateName || cand.name || "there"},\n\n` +
        `Your referral request${roleLine} at ${company} has been submitted successfully` +
        `${ref?.name ? ` to ${ref.name}` : ""}.\n\n` +
        `We'll notify you as soon as they respond.\n\nThanks,\nVerihire`
    );
  }
  if (ref?.email) {
    await sendEmail(
      ref.email,
      `New referral request — ${doc.candidateName || "a candidate"}`,
      `Hi ${ref.name || "there"},\n\n` +
        `${doc.candidateName || "A candidate"} (identity-verified on Verihire) has requested a referral` +
        `${roleLine} at ${company}.\n\n` +
        `About: ${doc.about || "-"}\n` +
        `Why a fit: ${doc.whyFit || "-"}\n` +
        `Why refer: ${doc.whyRefer || "-"}\n\n` +
        `Log in to Verihire to accept or decline.\n\n— Verihire`
    );
  }
}

async function notifyDecision(doc: any) {
  const users = await getUsers([doc.candidateId]);
  const cand = users.get(doc.candidateId);
  if (!cand?.email) return;
  const accepted = doc.status === "accepted";
  await sendEmail(
    cand.email,
    accepted ? "🎉 Your referral was accepted" : "Update on your referral request",
    `Hi ${doc.candidateName || cand.name || "there"},\n\n` +
      (accepted
        ? `Good news — your referral request at ${doc.referrerCompany || "the company"} was accepted. ` +
          `The employee will take it forward at their company.`
        : `Your referral request at ${doc.referrerCompany || "the company"} was not taken forward this time. ` +
          `Don't worry — you can request a referral from another employee.`) +
      `\n\n— Verihire`
  );
}

function toReferrer(d: any) {
  return {
    referrerId: d.referrerId,
    name: d.name || "",
    company: d.company || "",
    role: d.role || "",
    years: d.years || "",
    description: d.description || "",
    photo: d.photo || "",
  };
}
function toRequest(d: any) {
  return {
    id: d._id.toString(),
    candidateId: d.candidateId,
    candidateName: d.candidateName || "",
    referrerId: d.referrerId,
    referrerCompany: d.referrerCompany || "",
    about: d.about || "",
    whyFit: d.whyFit || "",
    whyRefer: d.whyRefer || "",
    targetRole: d.targetRole || "",
    status: d.status || "submitted",
    createdAt: (d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt)).toISOString(),
  };
}

export async function UpsertReferrer(call: any, cb: any) {
  try {
    const { referrerId, name, company, role, years, description, photo } = call.request;
    if (!referrerId) return cb({ code: grpc.status.INVALID_ARGUMENT, message: "referrerId required" });
    const doc = await Referrer.findOneAndUpdate(
      { referrerId },
      { referrerId, name, company, role, years, description, photo },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return cb(null, toReferrer(doc));
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "upsert referrer failed" });
  }
}

export async function GetReferrer(call: any, cb: any) {
  try {
    const doc = await Referrer.findOne({ referrerId: call.request.id });
    if (!doc) return cb({ code: grpc.status.NOT_FOUND, message: "referrer not found" });
    return cb(null, toReferrer(doc));
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "get referrer failed" });
  }
}

// Candidate-facing: list referrers at a company. Returns only professional info — no contact.
export async function ListReferrers(call: any, cb: any) {
  try {
    const company = (call.request.company || "").trim();
    const rx = company ? new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
    const docs = await Referrer.find(rx ? { company: rx } : {}).limit(100);
    return cb(null, { referrers: docs.map(toReferrer) });
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "list referrers failed" });
  }
}

export async function CreateRequest(call: any, cb: any) {
  try {
    const { candidateId, candidateName, referrerId, about, whyFit, whyRefer, targetRole } = call.request;
    if (!candidateId || !referrerId)
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "candidateId and referrerId required" });
    const ref = await Referrer.findOne({ referrerId });
    const doc = await ReferralRequest.create({
      candidateId, candidateName, referrerId,
      referrerCompany: ref?.company || "",
      about, whyFit, whyRefer, targetRole, status: "submitted",
    });
    notifyNewRequest(doc).catch((e) => console.warn("[referral] notify failed:", e?.message));
    return cb(null, toRequest(doc));
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "create request failed" });
  }
}

export async function ListRequestsForReferrer(call: any, cb: any) {
  try {
    const docs = await ReferralRequest.find({ referrerId: call.request.id }).sort({ createdAt: -1 });
    return cb(null, { requests: docs.map(toRequest) });
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "list requests failed" });
  }
}

export async function ListRequestsForCandidate(call: any, cb: any) {
  try {
    const docs = await ReferralRequest.find({ candidateId: call.request.id }).sort({ createdAt: -1 });
    return cb(null, { requests: docs.map(toRequest) });
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "list requests failed" });
  }
}

export async function RespondRequest(call: any, cb: any) {
  try {
    const { requestId, referrerId, accept } = call.request;
    const doc = await ReferralRequest.findById(requestId);
    if (!doc) return cb({ code: grpc.status.NOT_FOUND, message: "request not found" });
    if (doc.referrerId !== referrerId)
      return cb({ code: grpc.status.PERMISSION_DENIED, message: "not your request" });
    doc.status = accept ? "accepted" : "declined";
    await doc.save();
    notifyDecision(doc).catch((e) => console.warn("[referral] notify failed:", e?.message));
    return cb(null, toRequest(doc));
  } catch (e: any) {
    return cb({ code: grpc.status.INTERNAL, message: e?.message || "respond failed" });
  }
}
