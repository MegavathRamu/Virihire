import express from "express";
import cors from "cors";
import { authClient, profileClient, jobClient, searchClient, campaignClient, notifyClient, verifyClient, call } from "./clients.js";
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
    // Fire the "job.created" event to the Notification Service (fire-and-forget)
    // so posting stays instant. This is the Kafka/Lambda trigger point.
    call(notifyClient, "RecommendForJob", {
      jobId: job.id,
      title: job.title,
      company: job.company,
      skills: job.skills,
      description: job.description,
    }).catch((e) => console.warn("[gateway] notify trigger failed:", e?.message));
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

app.use(grpcErrorHandler);

app.listen(Number(PORT), () => {
  console.log(`[gateway] REST server listening on :${PORT}`);
});
