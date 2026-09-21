"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type ReferralRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import Header from "@/components/Header";

export default function ReferrerPage() {
  const router = useRouter();
  const { session, ready, setSession } = useSession();

  useEffect(() => {
    if (ready && !session) router.replace("/");
    if (ready && session && session.role !== "referrer") router.replace("/");
  }, [ready, session, router]);

  if (!ready || !session) return null;
  const token = session.token;

  return (
    <>
      <Header session={session} onLogout={() => { setSession(null); router.replace("/"); }} />
      <div className="container">
        <ReferrerProfile token={token} defaultName={session.name} />
        <ReferralInbox token={token} />
      </div>
    </>
  );
}

function ReferrerProfile({ token, defaultName }: { token: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [years, setYears] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getReferrer(token).then((r) => {
      if (r.name) setName(r.name);
      setCompany(r.company); setRole(r.role); setYears(r.years); setDescription(r.description); setPhoto(r.photo || "");
    }).catch(() => {});
  }, [token]);

  function pickPhoto(file: File) {
    const MAX = 320;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        setPhoto(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      await api.upsertReferrer({ name, company, role, years, description, photo }, token);
      setMsg("✓ Saved — candidates at " + (company || "your company") + " can now request a referral.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>My referrer profile</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Candidates see your photo, company, role and note — never your email or phone.
      </p>

      <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
        <div
          onClick={() => photoRef.current?.click()}
          style={{
            width: 84, height: 84, borderRadius: 12, cursor: "pointer", flex: "none",
            border: "2px dashed var(--border)", overflow: "hidden", display: "flex",
            alignItems: "center", justifyContent: "center", background: "#fafbff",
          }}
        >
          {photo ? (
            <img src={photo} alt="you" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span className="muted" style={{ fontSize: 12, textAlign: "center" }}>Add photo</span>
          )}
        </div>
        <div>
          <button type="button" className="ghost" onClick={() => photoRef.current?.click()}>
            {photo ? "Change photo" : "Upload photo"}
          </button>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickPhoto(f); e.target.value = ""; }}
          />
        </div>
      </div>

      <div className="row">
        <div className="col"><label>Display name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="col"><label>Company</label><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Google" required /></div>
      </div>
      <div className="row">
        <div className="col"><label>Your role</label><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. SDE-2" /></div>
        <div className="col"><label>Years at company</label><input value={years} onChange={(e) => setYears(e.target.value)} /></div>
      </div>
      <label>What you can refer for (note to candidates)</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Teams/roles you can refer, anything candidates should know" />
      {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
      <div style={{ marginTop: 14 }}><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
    </form>
  );
}

function ReferralInbox({ token }: { token: string }) {
  const [reqs, setReqs] = useState<ReferralRequest[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setReqs((await api.referrerRequests(token)).requests); }
    catch { setMsg("Failed to load requests"); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function respond(id: string, accept: boolean) {
    try { await api.respondReferral(id, accept, token); await load(); }
    catch (err) { setMsg(err instanceof ApiError ? err.message : "Failed"); }
  }

  return (
    <>
      <h2>Referral requests</h2>
      {msg && <div className="error">{msg}</div>}
      {reqs.length === 0 && <p className="muted">No referral requests yet.</p>}
      {reqs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b>{r.candidateName || "Candidate"}</b>{" "}
              <span className="badge ok">✓ identity-verified</span>
              {r.targetRole && <span className="muted"> · for {r.targetRole}</span>}
            </div>
            <span className={r.status === "accepted" ? "badge ok" : r.status === "declined" ? "badge" : "badge scan"}
              style={r.status === "declined" ? { background: "#fde8e6", color: "var(--err)" } : {}}>
              {r.status}
            </span>
          </div>
          {r.about && <p style={{ margin: "8px 0 2px" }}><b>About:</b> {r.about}</p>}
          {r.whyFit && <p style={{ margin: "2px 0" }}><b>Why a fit:</b> {r.whyFit}</p>}
          {r.whyRefer && <p style={{ margin: "2px 0" }}><b>Why refer:</b> {r.whyRefer}</p>}
          {r.status === "submitted" && (
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => respond(r.id, true)}>Accept &amp; refer</button>
              <button type="button" className="ghost" onClick={() => respond(r.id, false)}>Decline</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
