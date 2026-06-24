// Single REST client for the API Gateway. The browser only ever talks to the
// gateway; the gateway fans out to gRPC services.
const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export type Role = "candidate" | "recruiter";

export interface AuthRes {
  userId: string;
  token: string;
  role: Role;
  name: string;
}

export interface Education {
  school: string;
  degree: string;
  year: string;
}
export interface Experience {
  company: string;
  title: string;
  years: string;
}
export interface Profile {
  id: string;
  userId: string;
  phone: string;
  skills: string[];
  education: Education[];
  experience: Experience[];
  hasExperience: boolean;
  resumeUrl: string;
}

export interface Job {
  id: string;
  recruiterId: string;
  title: string;
  company: string;
  description: string;
  skills: string[];
  location: string;
  createdAt: string;
}

export interface Application {
  id: string;
  candidateId: string;
  jobId: string;
  status: string;
  appliedAt: string;
}

export interface Applicant {
  candidateId: string;
  profile: Profile | null;
  status: string;
  appliedAt: string;
}

export interface CandidateMatch {
  candidateId: string;
  score: number;
  summary: string;
  skills: string[];
  name: string;
  email: string;
}

export interface Recipient {
  candidateId: string;
  name: string;
  email: string;
  status: string; // queued | sent | failed
  error: string;
}

export interface Notification {
  candidateId: string;
  name: string;
  phone: string;
  score: number;
  status: string; // sent | failed | skipped
  channel: string;
  error: string;
}

export interface Campaign {
  id: string;
  subject: string;
  message: string;
  status: string; // queued | sending | done
  recipients: Recipient[];
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
}

export interface VDoc {
  docType: string;
  status: string; // pending | verified | mismatch | flagged
  extractedName: string;
  extractedNumber: string;
  attempts: number;
}
export interface VerifyState {
  candidateId: string;
  name: string;
  fatherName: string;
  anchorName: string;
  aadhaarVerified: boolean;
  docs: VDoc[];
  nextStep: string; // identity | aadhaar_front | ... | done
}
export interface VerifyResult {
  docType: string;
  status: string; // verified | mismatch | flagged | error
  extractedName: string;
  extractedNumber: string;
  anchorName: string;
  nameScore: number;
  attemptsLeft: number;
  message: string;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText);
  }
  return data as T;
}

export const api = {
  signup: (b: { name: string; email: string; password: string; role: Role }) =>
    request<AuthRes>("POST", "/auth/signup", b),
  login: (b: { email: string; password: string }) => request<AuthRes>("POST", "/auth/login", b),

  getMyProfile: (token: string) => request<Profile>("GET", "/profile/me", undefined, token),
  saveProfile: (b: Partial<Profile>, token: string) => request<Profile>("PUT", "/profile", b, token),

  listJobs: (q: string) => request<{ jobs: Job[] }>("GET", `/jobs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getJob: (id: string) => request<Job>("GET", `/jobs/${id}`),
  createJob: (b: Partial<Job>, token: string) => request<Job>("POST", "/jobs", b, token),

  apply: (jobId: string, token: string) => request<Application>("POST", `/jobs/${jobId}/apply`, {}, token),
  applicants: (jobId: string, token: string) =>
    request<{ applicants: Applicant[] }>("GET", `/jobs/${jobId}/applicants`, undefined, token),
  jobNotifications: (jobId: string, token: string) =>
    request<{ notifications: Notification[] }>("GET", `/jobs/${jobId}/notifications`, undefined, token),

  searchCandidates: (q: string, token: string) =>
    request<{ matches: CandidateMatch[]; indexed: number }>(
      "GET",
      `/search?q=${encodeURIComponent(q)}`,
      undefined,
      token
    ),
  reindex: (token: string) => request<{ indexed: number }>("POST", "/search/reindex", {}, token),

  verifyIdentity: (b: { name: string; fatherName: string }, token: string) =>
    request<VerifyState>("POST", "/verify/identity", b, token),
  verifyState: (token: string) => request<VerifyState>("GET", "/verify/state", undefined, token),
  verifyDocument: (b: { docType: string; imageBase64: string }, token: string) =>
    request<VerifyResult>("POST", "/verify/document", b, token),

  createCampaign: (b: { subject: string; message: string; candidateIds: string[] }, token: string) =>
    request<Campaign>("POST", "/campaigns", b, token),
  getCampaign: (id: string, token: string) => request<Campaign>("GET", `/campaigns/${id}`, undefined, token),
};

export { ApiError };
