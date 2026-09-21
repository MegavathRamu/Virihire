import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, "../../../proto");

const AUTH_URL = process.env.AUTH_SERVICE_URL || "localhost:50051";
const PROFILE_URL = process.env.PROFILE_SERVICE_URL || "localhost:50052";
const JOB_URL = process.env.JOB_SERVICE_URL || "localhost:50053";
const SEARCH_URL = process.env.SEARCH_SERVICE_URL || "localhost:50054";
const CAMPAIGN_URL = process.env.CAMPAIGN_SERVICE_URL || "localhost:50055";
const NOTIFY_URL = process.env.NOTIFY_SERVICE_URL || "localhost:50056";
const VERIFY_URL = process.env.VERIFY_SERVICE_URL || "localhost:50057";
const REFERRAL_URL = process.env.REFERRAL_SERVICE_URL || "localhost:50058";
const ASSESSMENT_URL = process.env.ASSESSMENT_SERVICE_URL || "localhost:50059";

function load(file: string) {
  const def = protoLoader.loadSync(path.join(PROTO_DIR, file), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(def) as any;
}

const authProto = load("auth.proto");
const profileProto = load("profile.proto");
const jobProto = load("job.proto");
const searchProto = load("search.proto");
const campaignProto = load("campaign.proto");
const notifyProto = load("notify.proto");
const verifyProto = load("verify.proto");
const referralProto = load("referral.proto");
const assessmentProto = load("assessment.proto");

const creds = grpc.credentials.createInsecure();

// One gRPC client per downstream service. The gateway is the only REST door;
// everything past here is gRPC.
export const authClient = new authProto.auth.AuthService(AUTH_URL, creds);
export const profileClient = new profileProto.profile.ProfileService(PROFILE_URL, creds);
export const jobClient = new jobProto.job.JobService(JOB_URL, creds);
export const searchClient = new searchProto.search.SearchService(SEARCH_URL, creds);
export const campaignClient = new campaignProto.campaign.CampaignService(CAMPAIGN_URL, creds);
export const notifyClient = new notifyProto.notify.NotificationService(NOTIFY_URL, creds);
// Verify carries document images (several MB) — raise gRPC's 4MB default.
const bigMsgOpts = {
  "grpc.max_receive_message_length": 25 * 1024 * 1024,
  "grpc.max_send_message_length": 25 * 1024 * 1024,
};
export const verifyClient = new verifyProto.verify.VerifyEngine(VERIFY_URL, creds, bigMsgOpts);
export const referralClient = new referralProto.referral.ReferralService(REFERRAL_URL, creds);
export const assessmentClient = new assessmentProto.assessment.AssessmentService(ASSESSMENT_URL, creds);

// Promisified helper so route handlers can `await` a unary gRPC call.
export function call<T = any>(client: any, method: string, req: any): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](req, (err: any, res: T) => (err ? reject(err) : resolve(res)));
  });
}
