"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Job, type Profile } from "@/lib/api";
import { useSession } from "@/lib/session";
import Header from "@/components/Header";
import VerificationScreen from "@/components/VerificationScreen";

export default function CandidatePage() {
  const router = useRouter();
  const { session, ready, setSession } = useSession();
  const [tab, setTab] = useState<"jobs" | "profile" | "referrals" | "tests">("jobs");
  const [complete, setComplete] = useState(false); // entire profile verified?

  useEffect(() => {
    if (ready && !session) router.replace("/");
    if (ready && session && session.role !== "candidate")
      router.replace(session.role === "recruiter" ? "/recruiter" : "/referrer");
  }, [ready, session, router]);

  // New candidates arrive with ?tab=profile — start on the profile step.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "profile") {
      setTab("profile");
    }
  }, []);

  if (!ready || !session) return null;
  const token = session.token;

  return (
    <>
      <Header session={session} onLogout={() => { setSession(null); router.replace("/"); }} />
      <div className="container">
        <div className="tabs">
          <button
            className={tab === "jobs" && complete ? "active" : ""}
            disabled={!complete}
            title={complete ? "" : "Complete your profile first"}
            onClick={() => complete && setTab("jobs")}
          >
            {complete ? "Search jobs" : "Search jobs 🔒"}
          </button>
          <button
            className={tab === "referrals" && complete ? "active" : ""}
            disabled={!complete}
            title={complete ? "" : "Complete your profile first"}
            onClick={() => complete && setTab("referrals")}
          >
            {complete ? "Get a referral" : "Get a referral 🔒"}
          </button>
          <button
            className={tab === "tests" && complete ? "active" : ""}
            disabled={!complete}
            title={complete ? "" : "Complete your profile first"}
            onClick={() => complete && setTab("tests")}
          >
            {complete ? "Tests" : "Tests 🔒"}
          </button>
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            My profile
          </button>
        </div>
        {tab === "jobs" && complete ? (
          <JobSearch token={token} />
        ) : tab === "referrals" && complete ? (
          <Referrals token={token} candidateName={session.name} />
        ) : tab === "tests" && complete ? (
          <Tests token={token} />
        ) : (
          <ProfileEditor token={token} onComplete={setComplete} onConfirm={() => setTab("jobs")} />
        )}
      </div>
    </>
  );
}

function JobSearch({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null); // expanded job

  const load = useCallback(async (keyword: string) => {
    setLoading(true);
    setMsg("");
    try {
      const res = await api.listJobs(keyword);
      setJobs(res.jobs);
    } catch {
      setMsg("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  async function apply(jobId: string) {
    setMsg("");
    try {
      await api.apply(jobId, token);
      setMsg("✓ Applied successfully");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Apply failed");
    }
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <input
            className="col"
            placeholder="Search by title, skill, company, location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(q)}
          />
          <button onClick={() => load(q)}>Search</button>
        </div>
        {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {!loading && jobs.length === 0 && <p className="muted">No jobs found.</p>}

      {jobs.map((j) => {
        const open = openId === j.id;
        return (
          <div className="card" key={j.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div
                style={{ cursor: "pointer", flex: 1 }}
                onClick={() => setOpenId(open ? null : j.id)}
              >
                <p className="job-title">{j.title}</p>
                <p className="muted">
                  {j.company} · {j.location || "Location N/A"}
                </p>
              </div>
              <button onClick={() => apply(j.id)}>Apply</button>
            </div>

            <div>
              {j.skills.map((s) => (
                <span className="tag" key={s}>
                  {s}
                </span>
              ))}
            </div>

            {open ? (
              <>
                <hr />
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {j.description || <span className="muted">No description provided.</span>}
                </p>
                <p className="muted">
                  Posted {new Date(j.createdAt).toLocaleDateString()} · Job ID {j.id.slice(-6)}
                </p>
              </>
            ) : (
              <button type="button" className="link" onClick={() => setOpenId(j.id)}>
                View details ▾
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function ProfileEditor({
  token,
  onComplete,
  onConfirm,
}: {
  token: string;
  onComplete?: (done: boolean) => void;
  onConfirm?: () => void;
}) {
  const [stage, setStage] = useState<"details" | "verify">("details");
  // background
  const [name, setName] = useState("");
  const [father, setFather] = useState("");
  const [village, setVillage] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [phone, setPhone] = useState("");
  const [skills, setSkills] = useState("");
  // 10th / 12th / degree
  const [b10, setB10] = useState(""); const [y10, setY10] = useState(""); const [p10, setP10] = useState("");
  const [b12, setB12] = useState(""); const [y12, setY12] = useState(""); const [p12, setP12] = useState("");
  const [college, setCollege] = useState(""); const [deg, setDeg] = useState(""); const [ydeg, setYdeg] = useState("");
  // employment
  const [company, setCompany] = useState(""); const [title, setTitle] = useState(""); const [years, setYears] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.verifyState(token).then((s) => {
      setName(s.name); setFather(s.fatherName); setVillage(s.village); setAddress(s.address); setPincode(s.pincode);
      if (s.name) setStage("verify"); // details already saved -> go straight to verification
    }).catch(() => {});
    api.getMyProfile(token).then((p: Profile) => {
      setPhone(p.phone); setSkills(p.skills.join(", "));
    }).catch(() => {});
  }, [token]);

  async function proceed(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      await api.verifyIdentity({ name, fatherName: father, village, address, pincode }, token);
      const education = [
        b10 || y10 || p10 ? { school: b10, degree: `Class 10${p10 ? ` (${p10}%)` : ""}`, year: y10 } : null,
        b12 || y12 || p12 ? { school: b12, degree: `Class 12${p12 ? ` (${p12}%)` : ""}`, year: y12 } : null,
        college || deg || ydeg ? { school: college, degree: deg, year: ydeg } : null,
      ].filter(Boolean) as { school: string; degree: string; year: string }[];
      await api.saveProfile({
        phone,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        hasExperience: !!(company || title),
        education,
        experience: company || title ? [{ company, title, years }] : [],
      }, token);
      setStage("verify");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not save details");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "verify") {
    return (
      <>
        <div className="card" style={{ textAlign: "center" }}>
          <h2 style={{ margin: 0 }}>Identity verification</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>Verify each item to finish your profile.</p>
        </div>
        <VerificationScreen token={token} onComplete={onComplete} onConfirm={onConfirm} />
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button type="button" className="link" onClick={() => setStage("details")}>← Edit my details</button>
        </div>
      </>
    );
  }

  return (
    <form className="card" onSubmit={proceed}>
      <h2 style={{ marginTop: 0 }}>Your details</h2>

      <div className="section-title">Background</div>
      <div className="row">
        <div className="col"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="col"><label>Father&apos;s name</label><input value={father} onChange={(e) => setFather(e.target.value)} /></div>
      </div>
      <div className="row">
        <div className="col"><label>Village / Town</label><input value={village} onChange={(e) => setVillage(e.target.value)} /></div>
        <div className="col"><label>Pincode</label><input value={pincode} onChange={(e) => setPincode(e.target.value)} /></div>
      </div>
      <label>Address</label>
      <textarea value={address} onChange={(e) => setAddress(e.target.value)} />
      <div className="row">
        <div className="col"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="col"><label>Skills (comma separated)</label><input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="node, react" /></div>
      </div>

      <div className="section-title">Class 10th</div>
      <div className="row">
        <div className="col"><label>Board / School</label><input value={b10} onChange={(e) => setB10(e.target.value)} /></div>
        <div className="col"><label>Year</label><input value={y10} onChange={(e) => setY10(e.target.value)} /></div>
        <div className="col"><label>Percentage</label><input value={p10} onChange={(e) => setP10(e.target.value)} /></div>
      </div>

      <div className="section-title">Class 12th</div>
      <div className="row">
        <div className="col"><label>Board / School</label><input value={b12} onChange={(e) => setB12(e.target.value)} /></div>
        <div className="col"><label>Year</label><input value={y12} onChange={(e) => setY12(e.target.value)} /></div>
        <div className="col"><label>Percentage</label><input value={p12} onChange={(e) => setP12(e.target.value)} /></div>
      </div>

      <div className="section-title">Degree</div>
      <div className="row">
        <div className="col"><label>College</label><input value={college} onChange={(e) => setCollege(e.target.value)} /></div>
        <div className="col"><label>Degree</label><input value={deg} onChange={(e) => setDeg(e.target.value)} /></div>
        <div className="col"><label>Year</label><input value={ydeg} onChange={(e) => setYdeg(e.target.value)} /></div>
      </div>

      <div className="section-title">Employment experience <span className="muted">(optional)</span></div>
      <div className="row">
        <div className="col"><label>Company</label><input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        <div className="col"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="col"><label>Years</label><input value={years} onChange={(e) => setYears(e.target.value)} /></div>
      </div>

      {msg && <div className="error">{msg}</div>}
      <div style={{ marginTop: 18 }}>
        <button type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Saving…" : "Proceed to verification →"}
        </button>
      </div>
    </form>
  );
}

function Referrals({ token }: { token: string; candidateName?: string }) {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [referrers, setReferrers] = useState<import("@/lib/api").Referrer[]>([]);
  const [mine, setMine] = useState<import("@/lib/api").ReferralRequest[]>([]);
  const [msg, setMsg] = useState("");

  const loadMine = useCallback(async () => {
    try { setMine((await api.myReferrals(token)).requests); } catch {/* */}
  }, [token]);
  const loadReferrers = useCallback(async (c: string) => {
    setMsg("");
    try {
      const res = await api.listReferrers(c, token);
      setReferrers(res.referrers);
      if (res.referrers.length === 0) setMsg("No referrers available yet.");
    } catch (err) { setMsg(err instanceof ApiError ? err.message : "Could not load referrers"); }
  }, [token]);

  // Show ALL referrers by default; the company box just filters.
  useEffect(() => { loadMine(); loadReferrers(""); }, [loadMine, loadReferrers]);

  function search(e?: React.FormEvent) {
    e?.preventDefault();
    loadReferrers(company);
  }

  function openRequest(r: import("@/lib/api").Referrer) {
    router.push(`/candidate/referral/${r.referrerId}?name=${encodeURIComponent(r.name || "")}&company=${encodeURIComponent(r.company || "")}`);
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Get a referral</h2>
        <p className="muted" style={{ marginTop: 0 }}>Employees available to refer you. Your verified profile is shared; their contact stays private. Filter by company if you like.</p>
        <form className="row" onSubmit={search}>
          <input className="col" placeholder="Filter by company (optional, e.g. Google)" value={company} onChange={(e) => setCompany(e.target.value)} />
          <button type="submit">Filter</button>
        </form>
        {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
      </div>

      <div className="ref-grid">
        {referrers.map((r) => (
          <div className="ref-card" key={r.referrerId}>
            <div className="ref-photo">
              {r.photo ? <img src={r.photo} alt={r.name} /> : <span>{(r.name || "?").charAt(0).toUpperCase()}</span>}
            </div>
            <div className="ref-name">{r.name || "Employee"}</div>
            <div className="muted" style={{ fontSize: 13 }}>{r.role || "—"}{r.years ? ` · ${r.years} yrs` : ""}</div>
            <div className="tag" style={{ margin: "6px 0" }}>{r.company}</div>
            {r.description && <p className="muted ref-desc">{r.description}</p>}
            <button type="button" style={{ width: "100%", marginTop: "auto" }} onClick={() => openRequest(r)}>
              Get referral
            </button>
          </div>
        ))}
      </div>

      <h2>My referral requests</h2>
      {mine.length === 0 && <p className="muted">No requests yet.</p>}
      {mine.map((r) => (
        <div className="card" key={r.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{r.referrerCompany || "Company"}{r.targetRole ? ` · ${r.targetRole}` : ""}</b>
            <span className={r.status === "accepted" ? "badge ok" : r.status === "declined" ? "badge" : "badge scan"}
              style={r.status === "declined" ? { background: "#fde8e6", color: "var(--err)" } : {}}>
              {r.status === "accepted" ? "✓ accepted — you've got a referrer" : r.status}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

function Tests({ token }: { token: string }) {
  const router = useRouter();
  const [invites, setInvites] = useState<import("@/lib/api").Invitation[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api.invitedAssessments(token)
      .then((r) => { setInvites(r.invitations); if (!r.invitations.length) setMsg("No test invitations yet. A recruiter will invite you to a proctored test."); })
      .catch(() => setMsg("Could not load your test invitations"));
  }, [token]);
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>My proctored tests</h2>
        <p className="muted" style={{ marginTop: 0 }}>Tests a recruiter invited you to. They&apos;re proctored — use a single screen, stay in fullscreen, don&apos;t switch tabs.</p>
        {msg && <div className="muted">{msg}</div>}
      </div>
      {invites.map((t) => (
        <div className="card" key={t.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p className="job-title">{t.assessmentTitle}</p>
              <p className="muted">{t.language} · {t.durationMins} min · proctored</p>
            </div>
            <button type="button" onClick={() => router.push(`/candidate/test/${t.assessmentId}`)}>Take test</button>
          </div>
        </div>
      ))}
    </>
  );
}
