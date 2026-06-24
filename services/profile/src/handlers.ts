import * as grpc from "@grpc/grpc-js";
import { Profile, Application } from "./model.js";
import { getJob } from "./jobClient.js";

function toProfile(doc: any) {
  return {
    id: doc._id.toString(),
    userId: doc.userId,
    phone: doc.phone || "",
    skills: doc.skills || [],
    education: (doc.education || []).map((e: any) => ({
      school: e.school || "",
      degree: e.degree || "",
      year: e.year || "",
    })),
    experience: (doc.experience || []).map((x: any) => ({
      company: x.company || "",
      title: x.title || "",
      years: x.years || "",
    })),
    hasExperience: !!doc.hasExperience,
    resumeUrl: doc.resumeUrl || "",
  };
}

// rpc UpsertProfile(ProfileReq) returns (Profile) — create or update by userId.
export async function UpsertProfile(call: any, cb: any) {
  try {
    const { userId, phone, skills, education, experience, hasExperience, resumeUrl } = call.request;
    if (!userId) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "userId required" });
    }
    const doc = await Profile.findOneAndUpdate(
      { userId },
      { userId, phone, skills, education, experience, hasExperience, resumeUrl },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return cb(null, toProfile(doc));
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "upsert profile failed" });
  }
}

// rpc GetProfile(IdReq) returns (Profile)
export async function GetProfile(call: any, cb: any) {
  try {
    const { userId } = call.request;
    if (!userId) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "userId required" });
    }
    const doc = await Profile.findOne({ userId });
    if (!doc) {
      return cb({ code: grpc.status.NOT_FOUND, message: "profile not found" });
    }
    return cb(null, toProfile(doc));
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "get profile failed" });
  }
}

// rpc ListProfiles(ListProfilesReq) returns (ProfileList)
// Used by the Search Service to build its index. (It pulls profiles over gRPC
// rather than reading profiledb directly.)
export async function ListProfiles(call: any, cb: any) {
  try {
    const limit = Math.max(0, call.request?.limit || 0);
    let q = Profile.find().sort({ _id: -1 });
    if (limit > 0) q = q.limit(limit);
    const docs = await q;
    return cb(null, { profiles: docs.map(toProfile) });
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "list profiles failed" });
  }
}

// rpc ApplyToJob(ApplyReq) returns (Application)
// Validates the job exists by calling JobService.GetJob over gRPC.
export async function ApplyToJob(call: any, cb: any) {
  try {
    const { candidateId, jobId } = call.request;
    if (!candidateId || !jobId) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "candidateId and jobId required" });
    }

    // Cross-service call — confirm the job exists before recording the application.
    try {
      await getJob(jobId);
    } catch (e: any) {
      if (e?.code === grpc.status.NOT_FOUND) {
        return cb({ code: grpc.status.NOT_FOUND, message: "job not found" });
      }
      return cb({ code: grpc.status.INTERNAL, message: "job lookup failed: " + (e?.message || "") });
    }

    try {
      const app = await Application.create({ candidateId, jobId, status: "applied" });
      return cb(null, {
        id: app._id.toString(),
        candidateId: app.candidateId,
        jobId: app.jobId,
        status: app.status,
        appliedAt: app.appliedAt.toISOString(),
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        return cb({ code: grpc.status.ALREADY_EXISTS, message: "already applied to this job" });
      }
      throw e;
    }
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "apply failed" });
  }
}

// rpc GetApplicants(JobIdReq) returns (ApplicantList)
// Returns each applicant's profile for a job.
export async function GetApplicants(call: any, cb: any) {
  try {
    const { jobId } = call.request;
    if (!jobId) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "jobId required" });
    }
    const apps = await Application.find({ jobId }).sort({ appliedAt: -1 });
    const profiles = await Profile.find({ userId: { $in: apps.map((a) => a.candidateId) } });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));

    const applicants = apps.map((a) => ({
      candidateId: a.candidateId,
      profile: byUser.has(a.candidateId) ? toProfile(byUser.get(a.candidateId)) : null,
      status: a.status,
      appliedAt: a.appliedAt.toISOString(),
    }));
    return cb(null, { applicants });
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "get applicants failed" });
  }
}
