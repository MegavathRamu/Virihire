"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Role } from "@/lib/api";
import { useSession } from "@/lib/session";
import Header from "@/components/Header";

export default function HomePage() {
  const router = useRouter();
  const { session, ready, setSession } = useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("candidate");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already logged in -> go to the right dashboard.
  useEffect(() => {
    if (ready && session) {
      router.replace(
        session.role === "recruiter" ? "/recruiter" : session.role === "referrer" ? "/referrer" : "/candidate"
      );
    }
  }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await api.signup({ name, email, password, role })
          : await api.login({ email, password });
      setSession(res);
      if (res.role === "recruiter") {
        router.replace("/recruiter");
      } else if (res.role === "referrer") {
        router.replace("/referrer");
      } else if (mode === "signup") {
        // New candidate: create profile first, then jobs.
        router.replace("/candidate?tab=profile");
      } else {
        router.replace("/candidate");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header session={null} onLogout={() => {}} />
      <div className="container" style={{ maxWidth: 440 }}>
        <h1 style={{ textAlign: "center" }}>
          Find your next job
        </h1>
        <p className="muted" style={{ textAlign: "center" }}>
          Microservices demo · gateway → auth/profile/job over gRPC
        </p>

        <div className="card">
          <div className="tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Log in
            </button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>
              Sign up
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === "signup" && (
              <>
                <label>Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
                <label>I am a</label>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="candidate">Candidate (looking for jobs)</option>
                  <option value="recruiter">Recruiter (posting jobs)</option>
                  <option value="referrer">Referrer (employee who gives referrals)</option>
                </select>
              </>
            )}
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {error && <div className="error">{error}</div>}
            <div style={{ marginTop: 16 }}>
              <button type="submit" disabled={busy} style={{ width: "100%" }}>
                {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
