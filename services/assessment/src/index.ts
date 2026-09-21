import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { connectDB } from "./db.js";
import {
  CreateAssessment, GetAssessment, ListAssessments, ListOpen,
  StartSubmission, RunCode, SubmitAttempt, ListSubmissions, GetSubmission,
  InviteCandidate, ListInvites, ListInvitesForAssessment,
} from "./handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, "../../../proto");
const PORT = process.env.PORT || "50059";

const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, "assessment.proto"), {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef) as any;

const handlers = {
  CreateAssessment, GetAssessment, ListAssessments, ListOpen,
  StartSubmission, RunCode, SubmitAttempt, ListSubmissions, GetSubmission,
  InviteCandidate, ListInvites, ListInvitesForAssessment,
};

async function main() {
  await connectDB();
  const server = new grpc.Server();
  server.addService(proto.assessment.AssessmentService.service, handlers);
  server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) { console.error("[assessment] failed to bind:", err); process.exit(1); }
    console.log(`[assessment] gRPC server listening on :${port}`);
  });
}

main();
