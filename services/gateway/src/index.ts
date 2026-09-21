import express from "express";
import cors from "cors";
import { authClient, profileClient, jobClient, searchClient, campaignClient, notifyClient, verifyClient, referralClient, assessmentClient, call } from "./clients.js";
import { requireAuth, requireRole, grpcErrorHandler, type AuthedRequest } from "./middleware.js";

const PORT = process.env.PORT || "8080";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" })); // document images arrive as base64

// Wrap async route handlers so thrown gRPC errors reach grpcErrorHandler.
const h =
  (fn: (req: AuthedRequest, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    fn(req as AuthedRequest, res).catch(next);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    clients: {
      auth: !!authClient,
      profile: !!profileClient,
      job: !!jobClient,
      search: !!searchClient,
      campaign: !!campaignClient,
      notify: !!notifyClient,
      verify: !!verifyClient,
    },
  });
});

// ---------------- Candidate search (recruiter) ----------------
// NL -> ranked candidates via the Search Service (FAISS).
app.get(
  "/search",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const result: any = await call(searchClient, "SearchCandidates", {
      query: (req.query.q as string) || "",
      topK: Number(req.query.k) || 25,
    });
    // Hydrate matches with candidate name/email from the Auth service.
    const ids = (result.matches || []).map((m: any) => m.candidateId);
    const users: any = ids.length ? await call(authClient, "GetUsers", { userIds: ids }) : { users: [] };
    const byId = new Map((users.users || []).map((u: any) => [u.userId, u]));
    result.matches = (result.matches || []).map((m: any) => {
      const u: any = byId.get(m.candidateId);
      return { ...m, name: u?.name || "Unknown", email: u?.email || "" };
    });
    res.json(result);
  })
);

// Manually rebuild the search index (recruiter/admin).
app.post(
  "/search/reindex",
  requireAuth,
  requireRole("recruiter"),
  h(async (_req, res) => {
    const result = await call(searchClient, "Reindex", {});
    res.json(result);
  })
);

// ---------------- Campaigns (recruiter) ----------------
// Email a set of selected candidates (async).
app.post(
  "/campaigns",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const result = await call(campaignClient, "CreateCampaign", {
      recruiterId: req.user!.userId,
      subject: req.body.subject,
      message: req.body.message,
      candidateIds: req.body.candidateIds || [],
      company: req.body.company || "",
      role: req.body.role || "",
      replyTo: req.user!.email, // replies go to the recruiter's account email
    });
    res.status(201).json(result);
  })
);

// Poll campaign status.
app.get(
  "/campaigns/:id",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const result = await call(campaignClient, "GetCampaign", { id: req.params.id });
    res.json(result);
  })
);

// ---------------- Auth (public) ----------------
app.post(
  "/auth/signup",
  h(async (req, res) => {
    const { name, email, password, role } = req.body;
    const result = await call(authClient, "Signup", { name, email, password, role });
    res.status(201).json(result);
  })
);

app.post(
  "/auth/login",
  h(async (req, res) => {
    const { email, password } = req.body;
    const result = await call(authClient, "Login", { email, password });
    res.json(result);
  })
);

// ---------------- Profile (candidate) ----------------
// Get my own profile.
app.get(
  "/profile/me",
  requireAuth,
  h(async (req, res) => {
    const profile = await call(profileClient, "GetProfile", { userId: req.user!.userId });
    res.json(profile);
  })
);

// Create/update my profile.
app.put(
  "/profile",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const profile = await call(profileClient, "UpsertProfile", {
      userId: req.user!.userId,
      phone: req.body.phone || "",
      skills: req.body.skills || [],
      education: req.body.education || [],
      experience: req.body.experience || [],
      hasExperience: !!req.body.hasExperience,
      resumeUrl: req.body.resumeUrl || "",
    });
    res.json(profile);
  })
);

// ---------------- Document verification (candidate) ----------------
// Our own Verify Engine (OCR + fraud check). Candidate verifies their own docs.
app.post(
  "/verify/identity",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const state = await call(verifyClient, "SetIdentity", {
      candidateId: req.user!.userId,
      name: req.body.name || "",
      fatherName: req.body.fatherName || "",
      village: req.body.village || "",
      address: req.body.address || "",
      pincode: req.body.pincode || "",
    });
    res.json(state);
  })
);

app.post(
  "/verify/document",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const result = await call(verifyClient, "VerifyDocument", {
      candidateId: req.user!.userId,
      docType: req.body.docType,
      imageBase64: req.body.imageBase64 || "",
    });
    res.json(result);
  })
);

app.get(
  "/verify/state",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const state = await call(verifyClient, "GetState", { candidateId: req.user!.userId });
    res.json(state);
  })
);

// Candidate downloads their own IDV report (with document images).
app.get(
  "/verify/report",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const report = await call(verifyClient, "GetReport", { candidateId: req.user!.userId });
    res.json(report);
  })
);

// Recruiter downloads a matched candidate's IDV report.
app.get(
  "/candidates/:id/idv",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const report = await call(verifyClient, "GetReport", { candidateId: req.params.id });
    res.json(report);
  })
);

// ---------------- Jobs ----------------
// Post a job (recruiter only). recruiterId comes from the verified token.
app.post(
  "/jobs",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const job: any = await call(jobClient, "CreateJob", {
      recruiterId: req.user!.userId,
      title: req.body.title,
      company: req.body.company,
      description: req.body.description || "",
      skills: req.body.skills || [],
      location: req.body.location || "",
    });
    // Note: we do NOT trigger the recommendation engine here. It runs on its own
    // schedule (every RECOMMEND_INTERVAL_SECONDS) inside the Notify service and
    // picks up this job on its next pass.
    res.status(201).json(job);
  })
);

// List / keyword-search jobs (public).
app.get(
  "/jobs",
  h(async (req, res) => {
    const list = await call(jobClient, "ListJobs", { keyword: (req.query.q as string) || "" });
    res.json(list);
  })
);

// Get one job (public).
app.get(
  "/jobs/:id",
  h(async (req, res) => {
    const job = await call(jobClient, "GetJob", { jobId: req.params.id });
    res.json(job);
  })
);

// ---------------- Apply / Applicants ----------------
// Candidate applies to a job.
app.post(
  "/jobs/:id/apply",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const application = await call(profileClient, "ApplyToJob", {
      candidateId: req.user!.userId,
      jobId: req.params.id,
    });
    res.status(201).json(application);
  })
);

// Recruiter views candidates auto-notified (SMS) about this job.
app.get(
  "/jobs/:id/notifications",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const result = await call(notifyClient, "GetJobNotifications", { jobId: req.params.id });
    res.json(result);
  })
);

// Recruiter views applicants for a job.
app.get(
  "/jobs/:id/applicants",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const applicants = await call(profileClient, "GetApplicants", { jobId: req.params.id });
    res.json(applicants);
  })
);

// ---------------- Referrals ----------------
// Referrer (employee) — manage own profile + handle requests.
app.put(
  "/referrer/profile",
  requireAuth,
  requireRole("referrer"),
  h(async (req, res) => {
    const r = await call(referralClient, "UpsertReferrer", {
      referrerId: req.user!.userId,
      name: req.body.name || "",
      company: req.body.company || "",
      role: req.body.role || "",
      years: req.body.years || "",
      description: req.body.description || "",
      photo: req.body.photo || "",
    });
    res.json(r);
  })
);
app.get(
  "/referrer/profile",
  requireAuth,
  requireRole("referrer"),
  h(async (req, res) => {
    try {
      res.json(await call(referralClient, "GetReferrer", { id: req.user!.userId }));
    } catch {
      res.json({ referrerId: req.user!.userId, name: "", company: "", role: "", years: "", description: "" });
    }
  })
);
app.get(
  "/referrer/requests",
  requireAuth,
  requireRole("referrer"),
  h(async (req, res) => {
    res.json(await call(referralClient, "ListRequestsForReferrer", { id: req.user!.userId }));
  })
);
app.post(
  "/referrer/requests/:id/respond",
  requireAuth,
  requireRole("referrer"),
  h(async (req, res) => {
    const r = await call(referralClient, "RespondRequest", {
      requestId: req.params.id,
      referrerId: req.user!.userId,
      accept: !!req.body.accept,
    });
    res.json(r);
  })
);

// Candidate — browse referrers by company (no contact shown) + request + track.
app.get(
  "/referrers",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    res.json(await call(referralClient, "ListReferrers", { company: (req.query.company as string) || "" }));
  })
);
app.post(
  "/referrals",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const r = await call(referralClient, "CreateRequest", {
      candidateId: req.user!.userId,
      candidateName: req.body.candidateName || "",
      referrerId: req.body.referrerId,
      about: req.body.about || "",
      whyFit: req.body.whyFit || "",
      whyRefer: req.body.whyRefer || "",
      targetRole: req.body.targetRole || "",
    });
    res.status(201).json(r);
  })
);
app.get(
  "/referrals/mine",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    res.json(await call(referralClient, "ListRequestsForCandidate", { id: req.user!.userId }));
  })
);

// ---------------- Assessments (proctored coding tests) ----------------
// Recruiter — create + review.
app.post(
  "/assessments",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const a = await call(assessmentClient, "CreateAssessment", {
      recruiterId: req.user!.userId,
      title: req.body.title,
      question: req.body.question || "",
      language: req.body.language || "javascript",
      durationMins: Number(req.body.durationMins) || 30,
      testCases: req.body.testCases || [],
    });
    res.status(201).json(a);
  })
);
app.post(
  "/assessments/:id/invite",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => {
    const inv = await call(assessmentClient, "InviteCandidate", {
      assessmentId: req.params.id,
      candidateEmail: req.body.candidateEmail || "",
    });
    res.status(201).json(inv);
  })
);
app.get(
  "/assessments/:id/invites",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => { res.json(await call(assessmentClient, "ListInvitesForAssessment", { id: req.params.id })); })
);
app.get(
  "/assessments/mine",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => { res.json(await call(assessmentClient, "ListAssessments", { recruiterId: req.user!.userId })); })
);
app.get(
  "/assessments/:id/submissions",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => { res.json(await call(assessmentClient, "ListSubmissions", { id: req.params.id })); })
);
app.get(
  "/submissions/:id",
  requireAuth,
  requireRole("recruiter"),
  h(async (req, res) => { res.json(await call(assessmentClient, "GetSubmission", { id: req.params.id })); })
);

// Candidate — invited tests, open one, start, run, submit.
app.get(
  "/assessments/invited",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => { res.json(await call(assessmentClient, "ListInvites", { email: req.user!.email })); })
);
app.get(
  "/assessments/:id",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => { res.json(await call(assessmentClient, "GetAssessment", { id: req.params.id })); })
);
app.post(
  "/assessments/:id/run",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const a: any = await call(assessmentClient, "GetAssessment", { id: req.params.id });
    const result = await call(assessmentClient, "RunCode", { code: req.body.code || "", testCases: a.testCases || [] });
    res.json(result);
  })
);
app.post(
  "/assessments/:id/start",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const s = await call(assessmentClient, "StartSubmission", {
      assessmentId: req.params.id,
      candidateId: req.user!.userId,
      candidateName: req.body.candidateName || "",
    });
    res.status(201).json(s);
  })
);
app.post(
  "/submissions/:id/submit",
  requireAuth,
  requireRole("candidate"),
  h(async (req, res) => {
    const s = await call(assessmentClient, "SubmitAttempt", {
      submissionId: req.params.id,
      code: req.body.code || "",
      events: req.body.events || [],
    });
    res.json(s);
  })
);

app.use(grpcErrorHandler);

app.listen(Number(PORT), () => {
  console.log(`[gateway] REST server listening on :${PORT}`);
});
