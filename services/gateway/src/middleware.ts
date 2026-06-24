import type { Request, Response, NextFunction } from "express";
import { authClient, call } from "./clients.js";

// Attached to req by requireAuth.
export interface AuthedRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

// Verifies the Bearer JWT by calling AuthService.Verify over gRPC.
// The gateway never decodes JWTs itself — auth owns that.
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  try {
    const claims: any = await call(authClient, "Verify", { token });
    if (!claims.valid) {
      return res.status(401).json({ error: "invalid or expired token" });
    }
    req.user = { userId: claims.userId, email: claims.email, role: claims.role };
    next();
  } catch (err) {
    next(err);
  }
}

// RBAC: gate a route to one or more roles. Use after requireAuth.
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

// Map a gRPC error to an HTTP response.
const GRPC_TO_HTTP: Record<number, number> = {
  3: 400, // INVALID_ARGUMENT
  5: 404, // NOT_FOUND
  6: 409, // ALREADY_EXISTS
  7: 403, // PERMISSION_DENIED
  16: 401, // UNAUTHENTICATED
  12: 501, // UNIMPLEMENTED
};

export function grpcErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = GRPC_TO_HTTP[err?.code] ?? 500;
  res.status(status).json({ error: err?.details || err?.message || "internal error" });
}
