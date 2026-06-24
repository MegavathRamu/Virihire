import * as grpc from "@grpc/grpc-js";
import { Job } from "./model.js";

// Shape a Mongo doc into the proto Job message.
function toJob(doc: any) {
  return {
    id: doc._id.toString(),
    recruiterId: doc.recruiterId,
    title: doc.title,
    company: doc.company,
    description: doc.description || "",
    skills: doc.skills || [],
    location: doc.location || "",
    createdAt: (doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt)).toISOString(),
  };
}

// rpc CreateJob(JobReq) returns (Job)
export async function CreateJob(call: any, cb: any) {
  try {
    const { recruiterId, title, company, description, skills, location } = call.request;
    if (!recruiterId || !title || !company) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "recruiterId, title and company are required" });
    }
    const doc = await Job.create({ recruiterId, title, company, description, skills, location });
    return cb(null, toJob(doc));
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "create job failed" });
  }
}

// rpc ListJobs(SearchReq) returns (JobList) — keyword search; empty keyword lists all.
export async function ListJobs(call: any, cb: any) {
  try {
    const keyword = (call.request.keyword || "").trim();
    let docs;
    if (keyword) {
      // Case-insensitive match across title/company/skills/location.
      const rx = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      docs = await Job.find({
        $or: [{ title: rx }, { company: rx }, { skills: rx }, { location: rx }, { description: rx }],
      })
        .sort({ createdAt: -1 })
        .limit(100);
    } else {
      docs = await Job.find().sort({ createdAt: -1 }).limit(100);
    }
    return cb(null, { jobs: docs.map(toJob) });
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "list jobs failed" });
  }
}

// rpc GetJob(IdReq) returns (Job)
export async function GetJob(call: any, cb: any) {
  try {
    const { jobId } = call.request;
    if (!jobId || !jobId.match(/^[0-9a-fA-F]{24}$/)) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "valid jobId required" });
    }
    const doc = await Job.findById(jobId);
    if (!doc) {
      return cb({ code: grpc.status.NOT_FOUND, message: "job not found" });
    }
    return cb(null, toJob(doc));
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "get job failed" });
  }
}
