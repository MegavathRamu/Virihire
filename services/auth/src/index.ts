import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { connectDB } from "./db.js";
import { Signup, Login, Verify, GetUsers } from "./handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, "../../../proto");
const PORT = process.env.PORT || "50051";

const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, "auth.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef) as any;

const handlers = { Signup, Login, Verify, GetUsers };

async function main() {
  await connectDB();

  const server = new grpc.Server();
  server.addService(proto.auth.AuthService.service, handlers);
  server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error("[auth] failed to bind:", err);
      process.exit(1);
    }
    console.log(`[auth] gRPC server listening on :${port}`);
  });
}

main();
