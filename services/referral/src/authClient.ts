import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, "../../../proto");
const AUTH_URL = process.env.AUTH_SERVICE_URL || "localhost:50051";

const def = protoLoader.loadSync(path.join(PROTO_DIR, "auth.proto"), {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const authProto = grpc.loadPackageDefinition(def) as any;
const authClient = new authProto.auth.AuthService(AUTH_URL, grpc.credentials.createInsecure());

export interface UserInfo { name: string; email: string; }

// Resolve auth user ids -> {name, email}. Used to email candidate + referrer.
export function getUsers(ids: string[]): Promise<Map<string, UserInfo>> {
  return new Promise((resolve) => {
    authClient.GetUsers({ userIds: ids }, (err: any, res: any) => {
      const m = new Map<string, UserInfo>();
      if (!err && res?.users) {
        for (const u of res.users) m.set(u.userId, { name: u.name, email: u.email });
      }
      resolve(m);
    });
  });
}
