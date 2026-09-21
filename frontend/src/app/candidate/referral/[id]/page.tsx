"use client";
import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import Header from "@/components/Header";

export default function ReferralRequestPage() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const { session, ready, setSession } = useSession();

  const referrerId = String(params.id || "");
  const refName = search.get("name") || "the employee";
  const refCompany = search.get("company") || "the company";

  const [targetRole, setTargetRole] = useState("");
  const [about, setAbout] = useState("");
  const [whyFit, setWhyFit] = useState("");
  const [whyRefer, setWhyRefer] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (ready && !session) {
    router.replace("/");
    return null;
  }
  if (!ready || !session) return null;
  const token = session.token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await api.createReferral(
        { referrerId, candidateName: session!.name, about, whyFit, whyRefer, targetRole },
        token
      );
      setDone(true);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header session={session} onLogout={() => { setSession(null); router.replace("/"); }} />
      <div className="container" style={{ maxWidth: 620 }}>
        <button type="button" className="link" onClick={() => router.push("/candidate")}>← Back to referrers</button>

        {done ? (
          <div className="card" style={{ textAlign: "center", marginTop: 12 }}>
            <p className="ok" style={{ fontSize: 16 }}>✅ Referral request submitted successfully</p>
            <p className="muted">
              Your request was sent to <b>{refName}</b> at <b>{refCompany}</b>. You&apos;ll get an email when they respond.
            </p>
            <button type="button" onClick={() => router.push("/candidate")}>Done</button>
          </div>
        ) : (
          <form className="card" onSubmit={submit} style={{ marginTop: 12 }}>
            <h2 style={{ marginTop: 0 }}>Request a referral</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              To <b>{refName}</b> at <b>{refCompany}</b>. Your verified profile is shared; their contact stays private.
            </p>
            <label>Target role</label>
            <input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Backend Engineer" />
            <label>About you</label>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} required />
            <label>Why you&apos;re a fit for this role</label>
            <textarea value={whyFit} onChange={(e) => setWhyFit(e.target.value)} required />
            <label>Why they should refer you</label>
            <textarea value={whyRefer} onChange={(e) => setWhyRefer(e.target.value)} required />
            {msg && <div className="error">{msg}</div>}
            <div style={{ marginTop: 14 }}>
              <button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit referral request"}</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
