import * as grpc from "@grpc/grpc-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "./model.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

function issueToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// rpc Signup(SignupReq) returns (AuthRes)
export async function Signup(call: any, cb: any) {
  try {
    const { name, email, password, role } = call.request;

    if (!name || !email || !password) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "name, email and password are required" });
    }
    if (!["candidate", "recruiter", "referrer"].includes(role)) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "role must be 'candidate', 'recruiter' or 'referrer'" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return cb({ code: grpc.status.ALREADY_EXISTS, message: "email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role });

    const userId = user._id.toString();
    const token = issueToken({ userId, email: user.email, role: user.role });

    return cb(null, { userId, token, role: user.role, name: user.name });
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "signup failed" });
  }
}

// rpc Login(LoginReq) returns (AuthRes)
export async function Login(call: any, cb: any) {
  try {
    const { email, password } = call.request;

    if (!email || !password) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return cb({ code: grpc.status.UNAUTHENTICATED, message: "invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return cb({ code: grpc.status.UNAUTHENTICATED, message: "invalid credentials" });
    }

    const userId = user._id.toString();
    const token = issueToken({ userId, email: user.email, role: user.role });

    return cb(null, { userId, token, role: user.role, name: user.name });
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "login failed" });
  }
}

// rpc GetUsers(UserIdsReq) returns (UserList)
// Resolve user ids to name/email. Used by the Campaign Service to email candidates.
export async function GetUsers(call: any, cb: any) {
  try {
    const ids: string[] = (call.request.userIds || []).filter((x: string) => /^[0-9a-fA-F]{24}$/.test(x));
    if (ids.length === 0) return cb(null, { users: [] });
    const users = await User.find({ _id: { $in: ids } });
    return cb(null, {
      users: users.map((u) => ({
        userId: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
      })),
    });
  } catch (err: any) {
    return cb({ code: grpc.status.INTERNAL, message: err?.message || "get users failed" });
  }
}

// rpc Verify(TokenReq) returns (Claims)
// Gateway calls this to validate a JWT on protected routes.
export async function Verify(call: any, cb: any) {
  try {
    const { token } = call.request;
    if (!token) {
      return cb(null, { valid: false, userId: "", email: "", role: "" });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return cb(null, {
      valid: true,
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    });
  } catch {
    // expired / malformed / bad signature — not an error, just invalid.
    return cb(null, { valid: false, userId: "", email: "", role: "" });
  }
}
