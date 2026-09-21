import * as grpc from "@grpc/grpc-js";
import { Assessment, Submission, Invitation } from "./model.js";
import { scoreEvents, explainEvents } from "./scoring.js";
import { runJs } from "./runner.js";
import { inviteEmail, sendEmail } from "./mailer.js";

function tokenSim(a: string, b: string): number {
  const norm = (s: string) => new Set((s || "").toLowerCase().replace(/\s+/g, " ").match(/[a-z_$][a-z0-9_$]*|[{}();=+\-*/<>]/g) || []);
  const A = norm(a), B = norm(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  return Math.round((inter / new Set([...A, ...B]).size) * 100);
}

const iso = (d: any) => (d instanceof Date ? d : d ? new Date(d) : null);

function toAssessment(d: any) {
  return {
    id: d._id.toString(),
    recruiterId: d.recruiterId,
    title: d.title,
    question: d.question || "",
    language: d.language || "javascript",
    durationMins: d.durationMins || 30,
    createdAt: iso(d.createdAt)?.toISOString() || "",
    testCases: (d.testCases || []).map((t: any) => ({ input: t.input || "", expected: t.expected || "" })),
  };
}
function toSubmission(d: any, similarPercent = 0) {
  return {
    id: d._id.toString(),
    assessmentId: d.assessmentId,
    candidateId: d.candidateId,
    candidateName: d.candidateName || "",
    code: d.code || "",
    status: d.status || "in_progress",
    integrityScore: d.integrityScore ?? 100,
    confidence: d.confidence || "High",
    events: (d.events || []).map((e: any) => ({ type: e.type, severity: e.severity || "", at: e.at || "", detail: e.detail || "" })),
    testsPassed: d.testsPassed ?? 0,
    testsTotal: d.testsTotal ?? 0,
    integritySummary: d.integritySummary || "",
    similarPercent,
    startedAt: iso(d.startedAt)?.toISOString() || "",
    submittedAt: iso(d.submittedAt)?.toISOString() || "",
  };
}

export async function CreateAssessment(call: any, cb: any) {
  try {
    const { recruiterId, title, question, language, durationMins, testCases } = call.request;
    if (!recruiterId || !title) return cb({ code: grpc.status.INVALID_ARGUMENT, message: "recruiterId and title required" });
    const doc = await Assessment.create({
      recruiterId, title, question, language: language || "javascript", durationMins: durationMins || 30,
      testCases: (testCases || []).map((t: any) => ({ input: t.input || "", expected: t.expected || "" })),
    });
    return cb(null, toAssessment(doc));
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function GetAssessment(call: any, cb: any) {
  try {
    const doc = await Assessment.findById(call.request.id);
    if (!doc) return cb({ code: grpc.status.NOT_FOUND, message: "assessment not found" });
    return cb(null, toAssessment(doc));
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function ListAssessments(call: any, cb: any) {
  try {
    const docs = await Assessment.find({ recruiterId: call.request.recruiterId }).sort({ createdAt: -1 });
    return cb(null, { assessments: docs.map(toAssessment) });
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function ListOpen(_call: any, cb: any) {
  try {
    const docs = await Assessment.find().sort({ createdAt: -1 }).limit(100);
    return cb(null, { assessments: docs.map(toAssessment) });
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function StartSubmission(call: any, cb: any) {
  try {
    const { assessmentId, candidateId, candidateName } = call.request;
    if (!assessmentId || !candidateId) return cb({ code: grpc.status.INVALID_ARGUMENT, message: "assessmentId and candidateId required" });
    // Reuse an in-progress attempt if one exists, else create.
    let doc = await Submission.findOne({ assessmentId, candidateId, status: "in_progress" });
    if (!doc) doc = await Submission.create({ assessmentId, candidateId, candidateName, status: "in_progress" });
    return cb(null, toSubmission(doc));
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function RunCode(call: any, cb: any) {
  try {
    const { code, testCases } = call.request;
    const out = await runJs(code || "", (testCases || []).map((t: any) => ({ input: t.input || "", expected: t.expected || "" })));
    return cb(null, out);
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function SubmitAttempt(call: any, cb: any) {
  try {
    const { submissionId, code, events } = call.request;
    const doc = await Submission.findById(submissionId);
    if (!doc) return cb({ code: grpc.status.NOT_FOUND, message: "submission not found" });
    const assessment = await Assessment.findById(doc.assessmentId);
    // run the recruiter's test cases against the submitted code
    const run = await runJs(code || "", (assessment?.testCases || []).map((t: any) => ({ input: t.input || "", expected: t.expected || "" })));
    const { score, confidence } = scoreEvents(events || []);
    doc.code = code || "";
    doc.events = (events || []).map((e: any) => ({ type: e.type, severity: e.severity, at: e.at, detail: e.detail }));
    doc.integrityScore = score;
    doc.confidence = confidence;
    doc.integritySummary = explainEvents(events || []);
    doc.testsPassed = run.passed;
    doc.testsTotal = run.total;
    doc.status = "submitted";
    doc.submittedAt = new Date();
    await doc.save();
    // mark invitation submitted (best-effort)
    Invitation.updateMany({ assessmentId: doc.assessmentId }, { $set: {} }).catch(() => {});
    return cb(null, toSubmission(doc));
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function ListSubmissions(call: any, cb: any) {
  try {
    const docs = await Submission.find({ assessmentId: call.request.id }).sort({ submittedAt: -1, startedAt: -1 });
    // pairwise code similarity → each submission's max similarity with another
    const out = docs.map((d) => {
      let best = 0;
      for (const o of docs) {
        if (o._id.equals(d._id)) continue;
        best = Math.max(best, tokenSim(d.code || "", o.code || ""));
      }
      return toSubmission(d, best);
    });
    return cb(null, { submissions: out });
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function InviteCandidate(call: any, cb: any) {
  try {
    const { assessmentId, candidateEmail } = call.request;
    if (!assessmentId || !candidateEmail) return cb({ code: grpc.status.INVALID_ARGUMENT, message: "assessmentId and candidateEmail required" });
    const a = await Assessment.findById(assessmentId);
    if (!a) return cb({ code: grpc.status.NOT_FOUND, message: "assessment not found" });
    const email = candidateEmail.toLowerCase().trim();
    const inv = await Invitation.findOneAndUpdate(
      { assessmentId, candidateEmail: email },
      { assessmentId, candidateEmail: email, status: "invited" },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const { subject, text, html } = inviteEmail(assessmentId, a.title, a.durationMins || 30);
    sendEmail(email, subject, text, html).catch(() => {});
    return cb(null, {
      id: inv._id.toString(), assessmentId, assessmentTitle: a.title, candidateEmail: email,
      status: inv.status, invitedAt: (inv.invitedAt as Date).toISOString(),
      durationMins: a.durationMins || 30, language: a.language || "javascript",
    });
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

function toInvitation(inv: any, a: any) {
  return {
    id: inv._id.toString(), assessmentId: inv.assessmentId, assessmentTitle: a?.title || "",
    candidateEmail: inv.candidateEmail, status: inv.status,
    invitedAt: (inv.invitedAt instanceof Date ? inv.invitedAt : new Date(inv.invitedAt)).toISOString(),
    durationMins: a?.durationMins || 30, language: a?.language || "javascript",
  };
}

export async function ListInvites(call: any, cb: any) {
  try {
    const email = (call.request.email || "").toLowerCase().trim();
    const invs = await Invitation.find({ candidateEmail: email }).sort({ invitedAt: -1 });
    const result = [];
    for (const inv of invs) {
      const a = await Assessment.findById(inv.assessmentId);
      result.push(toInvitation(inv, a));
    }
    return cb(null, { invitations: result });
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function ListInvitesForAssessment(call: any, cb: any) {
  try {
    const invs = await Invitation.find({ assessmentId: call.request.id }).sort({ invitedAt: -1 });
    const a = await Assessment.findById(call.request.id);
    return cb(null, { invitations: invs.map((inv) => toInvitation(inv, a)) });
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}

export async function GetSubmission(call: any, cb: any) {
  try {
    const doc = await Submission.findById(call.request.id);
    if (!doc) return cb({ code: grpc.status.NOT_FOUND, message: "submission not found" });
    return cb(null, toSubmission(doc));
  } catch (e: any) { return cb({ code: grpc.status.INTERNAL, message: e?.message }); }
}
