// Single REST client for the API Gateway. The browser only ever talks to the
// gateway; the gateway fans out to gRPC services.
const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export type Role = "candidate" | "recruiter" | "referrer";

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
  village: string;
  address: string;
  pincode: string;
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

export interface DocImage {
  docType: string;
  imageBase64: string;
}
export interface VerifyReport {
  candidateId: string;
  name: string;
  fatherName: string;
  anchorName: string;
  overallStatus: string; // verified | flagged | incomplete
  docs: VDoc[];
  images: DocImage[];
  generatedAt: string;
}

export interface Referrer {
  referrerId: string;
  name: string;
  company: string;
  role: string;
  years: string;
  description: string;
  photo: string;
}
export interface ReferralRequest {
  id: string;
  candidateId: string;
  candidateName: string;
  referrerId: string;
  referrerCompany: string;
  about: string;
  whyFit: string;
  whyRefer: string;
  targetRole: string;
  status: string; // submitted | accepted | declined
  createdAt: string;
}

export interface TestCase { input: string; expected: string; }
export interface Assessment {
  id: string; recruiterId: string; title: string; question: string;
  language: string; durationMins: number; createdAt: string; testCases: TestCase[];
}
export interface ProctorEvent { type: string; severity: string; at: string; detail: string; }
export interface Submission {
  id: string; assessmentId: string; candidateId: string; candidateName: string;
  code: string; status: string; integrityScore: number; confidence: string;
  events: ProctorEvent[]; startedAt: string; submittedAt: string;
  testsPassed: number; testsTotal: number; integritySummary: string; similarPercent: number;
}
export interface Invitation {
  id: string; assessmentId: string; assessmentTitle: string; candidateEmail: string;
  status: string; invitedAt: string; durationMins: number; language: string;
}
export interface CaseResult { input: string; expected: string; got: string; passed: boolean; error: string; }
export interface RunResult { results: CaseResult[]; passed: number; total: number; }

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

  verifyIdentity: (
    b: { name: string; fatherName: string; village?: string; address?: string; pincode?: string },
    token: string
  ) => request<VerifyState>("POST", "/verify/identity", b, token),
  verifyState: (token: string) => request<VerifyState>("GET", "/verify/state", undefined, token),
  verifyDocument: (b: { docType: string; imageBase64: string }, token: string) =>
    request<VerifyResult>("POST", "/verify/document", b, token),
  myIdvReport: (token: string) => request<VerifyReport>("GET", "/verify/report", undefined, token),
  candidateIdvReport: (candidateId: string, token: string) =>
    request<VerifyReport>("GET", `/candidates/${candidateId}/idv`, undefined, token),

  createCampaign: (
    b: { subject: string; message: string; candidateIds: string[]; company?: string; role?: string },
    token: string
  ) => request<Campaign>("POST", "/campaigns", b, token),
  getCampaign: (id: string, token: string) => request<Campaign>("GET", `/campaigns/${id}`, undefined, token),

  // referrer (employee)
  getReferrer: (token: string) => request<Referrer>("GET", "/referrer/profile", undefined, token),
  upsertReferrer: (b: Partial<Referrer>, token: string) => request<Referrer>("PUT", "/referrer/profile", b, token),
  referrerRequests: (token: string) =>
    request<{ requests: ReferralRequest[] }>("GET", "/referrer/requests", undefined, token),
  respondReferral: (id: string, accept: boolean, token: string) =>
    request<ReferralRequest>("POST", `/referrer/requests/${id}/respond`, { accept }, token),
  // candidate
  listReferrers: (company: string, token: string) =>
    request<{ referrers: Referrer[] }>("GET", `/referrers?company=${encodeURIComponent(company)}`, undefined, token),
  createReferral: (
    b: { referrerId: string; candidateName: string; about: string; whyFit: string; whyRefer: string; targetRole: string },
    token: string
  ) => request<ReferralRequest>("POST", "/referrals", b, token),
  myReferrals: (token: string) =>
    request<{ requests: ReferralRequest[] }>("GET", "/referrals/mine", undefined, token),

  // assessments — recruiter
  createAssessment: (b: { title: string; question: string; language: string; durationMins: number; testCases: TestCase[] }, token: string) =>
    request<Assessment>("POST", "/assessments", b, token),
  myAssessments: (token: string) => request<{ assessments: Assessment[] }>("GET", "/assessments/mine", undefined, token),
  assessmentSubmissions: (id: string, token: string) =>
    request<{ submissions: Submission[] }>("GET", `/assessments/${id}/submissions`, undefined, token),
  inviteCandidate: (id: string, candidateEmail: string, token: string) =>
    request<Invitation>("POST", `/assessments/${id}/invite`, { candidateEmail }, token),
  // assessments — candidate
  invitedAssessments: (token: string) => request<{ invitations: Invitation[] }>("GET", "/assessments/invited", undefined, token),
  getAssessment: (id: string, token: string) => request<Assessment>("GET", `/assessments/${id}`, undefined, token),
  runCode: (id: string, code: string, token: string) =>
    request<RunResult>("POST", `/assessments/${id}/run`, { code }, token),
  startSubmission: (id: string, candidateName: string, token: string) =>
    request<Submission>("POST", `/assessments/${id}/start`, { candidateName }, token),
  submitAttempt: (id: string, code: string, events: ProctorEvent[], token: string) =>
    request<Submission>("POST", `/submissions/${id}/submit`, { code, events }, token),
};

export { ApiError };
