"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Job, type Profile } from "@/lib/api";
import { useSession } from "@/lib/session";
import Header from "@/components/Header";
import VerificationWizard from "@/components/VerificationWizard";

export default function CandidatePage() {
  const router = useRouter();
  const { session, ready, setSession } = useSession();
  const [tab, setTab] = useState<"jobs" | "profile">("jobs");
  const [complete, setComplete] = useState(false); // entire profile verified?

  useEffect(() => {
    if (ready && !session) router.replace("/");
    if (ready && session && session.role !== "candidate") router.replace("/recruiter");
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
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            My profile
          </button>
        </div>
        {tab === "jobs" && complete ? (
          <JobSearch token={token} />
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
  const [profileComplete, setProfileComplete] = useState(false);
  const [phone, setPhone] = useState("");
  const [skills, setSkills] = useState("");
  const [hasExperience, setHasExperience] = useState(false);
  const [school, setSchool] = useState("");
  const [degree, setDegree] = useState("");
  const [year, setYear] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [years, setYears] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getMyProfile(token)
      .then((p: Profile) => {
        setPhone(p.phone);
        setSkills(p.skills.join(", "));
        setHasExperience(p.hasExperience);
        if (p.education[0]) {
          setSchool(p.education[0].school);
          setDegree(p.education[0].degree);
          setYear(p.education[0].year);
        }
        if (p.experience[0]) {
          setCompany(p.experience[0].company);
          setTitle(p.experience[0].title);
          setYears(p.experience[0].years);
        }
      })
      .catch(() => {/* no profile yet — fine */});
  }, [token]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await api.saveProfile(
        {
          phone,
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
          hasExperience,
          education: school || degree || year ? [{ school, degree, year }] : [],
          experience: hasExperience && (company || title) ? [{ company, title, years }] : [],
        },
        token
      );
      setMsg("✓ Profile saved");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form className="card" onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>My profile</h2>

      <label>Phone</label>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label>Skills (comma separated)</label>
      <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="node, react, mongodb" />

      <hr />
      <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={hasExperience}
          onChange={(e) => setHasExperience(e.target.checked)}
        />
        I have work experience (uncheck if you are a fresher)
      </label>

      <h3>Education</h3>
      <div className="row">
        <div className="col">
          <label>School / College</label>
          <input value={school} onChange={(e) => setSchool(e.target.value)} />
        </div>
        <div className="col">
          <label>Degree</label>
          <input value={degree} onChange={(e) => setDegree(e.target.value)} />
        </div>
        <div className="col">
          <label>Year</label>
          <input value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
      </div>

      {hasExperience && (
        <>
          <h3>Experience</h3>
          <div className="row">
            <div className="col">
              <label>Company</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="col">
              <label>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="col">
              <label>Years</label>
              <input value={years} onChange={(e) => setYears(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>

    <div className="card">
      <VerificationWizard
        token={token}
        onComplete={(done) => {
          setProfileComplete(done);
          onComplete?.(done);
        }}
      />
    </div>

    {profileComplete ? (
      <div className="card" style={{ textAlign: "center" }}>
        <p className="ok" style={{ fontSize: 15 }}>✓ Your profile is complete and verified.</p>
        <button type="button" onClick={onConfirm}>Confirm &amp; apply for jobs →</button>
      </div>
    ) : (
      <div className="card" style={{ textAlign: "center" }}>
        <p className="muted">Complete &amp; verify your documents above to unlock job applications.</p>
      </div>
    )}
    </>
  );
}
