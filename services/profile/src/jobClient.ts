import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

// Profile Service calls Job Service over gRPC when it needs job details.
// It NEVER queries jobdb directly — that's the database-per-service rule.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, "../../../proto");
const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || "localhost:50053";

const def = protoLoader.loadSync(path.join(PROTO_DIR, "job.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const jobProto = grpc.loadPackageDefinition(def) as any;

export const jobClient = new jobProto.job.JobService(
  JOB_SERVICE_URL,
  grpc.credentials.createInsecure()
);

export function getJob(jobId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    jobClient.GetJob({ jobId }, (err: any, res: any) => (err ? reject(err) : resolve(res)));
  });
}
