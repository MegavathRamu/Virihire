"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Applicant, type Campaign, type CandidateMatch, type Job, type Notification } from "@/lib/api";
import { useSession } from "@/lib/session";
import Header from "@/components/Header";
import { downloadIdv } from "@/lib/idv";

export default function RecruiterPage() {
  const router = useRouter();
  const { session, ready, setSession } = useSession();

  useEffect(() => {
    if (ready && !session) router.replace("/");
    if (ready && session && session.role !== "recruiter")
      router.replace(session.role === "referrer" ? "/referrer" : "/candidate");
  }, [ready, session, router]);

  if (!ready || !session) return null;
  const token = session.token;
  const myId = session.userId;

  return (
    <>
      <Header session={session} onLogout={() => { setSession(null); router.replace("/"); }} />
      <div className="container">
        <PostJob token={token} />
        <Assessments token={token} />
        <MyJobs token={token} myId={myId} />
      </div>
    </>
  );
}

function PostJob({ token }: { token: string }) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await api.createJob(
        {
          title,
          company,
          location,
          description,
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        },
        token
      );
      setMsg("✓ Job posted");
      setTitle(""); setCompany(""); setLocation(""); setSkills(""); setDescription("");
      window.dispatchEvent(new Event("jobs:refresh"));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Post failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Post a job</h2>
      <div className="row">
        <div className="col">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="col">
          <label>Company</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} required />
        </div>
        <div className="col">
          <label>Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>
      <label>Skills (comma separated)</label>
      <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="node, grpc" />
      <label>Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Posting…" : "Post job"}
        </button>
      </div>
    </form>
  );
}

// Per-job automatic matching: builds the query from the JOB (title + skills +
// description) and runs the semantic model — no manual query. Lists matched
// candidates with checkboxes; confirm emails the ticked ones.
function MatchCandidates({ token, job }: { token: string; job: Job }) {
  const [matches, setMatches] = useState<CandidateMatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(`You're shortlisted — ${job.title} at ${job.company}`);
  const [message, setMessage] = useState(
    `Thank you for your interest in the ${job.title} position at ${job.company}. After reviewing your profile, we are pleased to shortlist you for this role and would like to invite you to the next round of our selection process.`
  );
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);

  // Query derived automatically from the role.
  const roleQuery = [job.title, (job.skills || []).join(" "), job.description].filter(Boolean).join(". ");

  useEffect(() => {
    let active = true;
    (async () => {
      setBusy(true);
      setMsg("");
      try {
        const res = await api.searchCandidates(roleQuery, token);
        if (active) setMatches(res.matches);
        if (active && res.matches.length === 0) setMsg("No candidates indexed yet.");
      } catch (err) {
        if (active) setMsg(err instanceof ApiError ? err.message : "Matching failed");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [roleQuery, token]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function confirmSend() {
    if (selected.size === 0) return;
    setSending(true);
    setMsg("");
    setCampaign(null);
    try {
      let c = await api.createCampaign({ subject, message, candidateIds: Array.from(selected), company: job.company, role: job.title }, token);
      setCampaign(c);
      for (let i = 0; i < 10 && c.status !== "done"; i++) {
        await new Promise((r) => setTimeout(r, 800));
        c = await api.getCampaign(c.id, token);
        setCampaign(c);
      }
      setSelected(new Set());
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <hr />
      <div className="section-title" style={{ marginTop: 0 }}>
        Matching candidates for {job.title}
      </div>
      {busy && <p className="muted">Running match…</p>}
      {!busy && msg && <div className="error">{msg}</div>}

      {matches.map((m) => (
        <label
          key={m.candidateId}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            marginTop: 10,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            style={{ width: "auto", marginTop: 4 }}
            checked={selected.has(m.candidateId)}
            onChange={() => toggle(m.candidateId)}
          />
          <div style={{ flex: 1 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <b>{m.name || `Candidate ${m.candidateId.slice(-6)}`}</b>
              <span className="row" style={{ alignItems: "center", gap: 10 }}>
                <span className="tag">match {(m.score * 100).toFixed(0)}%</span>
                <button
                  type="button"
                  className="link"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      downloadIdv(await api.candidateIdvReport(m.candidateId, token));
                    } catch {/* ignore */}
                  }}
                >
                  ⬇ IDV report
                </button>
              </span>
            </div>
            <div>
              {m.skills.map((s) => (
                <span className="tag" key={s}>
                  {s}
                </span>
              ))}
            </div>
            <p className="muted" style={{ margin: "4px 0 0" }}>{m.summary}</p>
          </div>
        </label>
      ))}

      {selected.size > 0 && (
        <>
          <div className="section-title">Email {selected.size} selected candidate(s)</div>
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label>Message</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={confirmSend} disabled={sending}>
              {sending ? "Sending…" : `Confirm & email ${selected.size}`}
            </button>
          </div>
        </>
      )}

      {campaign && (
        <div className={campaign.status === "done" ? "ok" : "muted"} style={{ marginTop: 12 }}>
          Campaign {campaign.status} — {campaign.sent} sent, {campaign.failed} failed of {campaign.total}.
          <ul style={{ margin: "6px 0" }}>
            {campaign.recipients.map((r) => (
              <li key={r.candidateId} className="muted">
                {r.name || r.candidateId.slice(-6)} ({r.email || "no email"}) — {r.status}
                {r.error ? `: ${r.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function MyJobs({ token, myId }: { token: string; myId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [notifyId, setNotifyId] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.listJobs("");
      setJobs(res.jobs.filter((j) => j.recruiterId === myId));
    } catch {
      setMsg("Failed to load your jobs");
    }
  }, [myId]);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("jobs:refresh", h);
    return () => window.removeEventListener("jobs:refresh", h);
  }, [load]);

  async function viewApplicants(jobId: string) {
    if (openId === jobId) {
      setOpenId(null);
      return;
    }
    setMsg("");
    try {
      const res = await api.applicants(jobId, token);
      setApplicants(res.applicants);
      setOpenId(jobId);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Failed to load applicants");
    }
  }

  async function reindex() {
    try {
      await api.reindex(token);
      setMatchId(null);
      setMsg("✓ Re-indexed candidates — reopen a role to see fresh matches.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Reindex failed");
    }
  }

  async function viewNotifications(jobId: string) {
    if (notifyId === jobId) {
      setNotifyId(null);
      return;
    }
    try {
      const res = await api.jobNotifications(jobId, token);
      setNotifs(res.notifications);
      setNotifyId(jobId);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Failed to load notifications");
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>My job postings</h2>
        <button type="button" className="link" onClick={reindex}>
          Re-index candidates
        </button>
      </div>
      {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
      {jobs.length === 0 && <p className="muted">You haven&apos;t posted any jobs yet.</p>}
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <p className="job-title">{j.title}</p>
              <p className="muted">
                {j.company} · {j.location || "Location N/A"}
              </p>
            </div>
            <div className="row">
              <button onClick={() => setMatchId(matchId === j.id ? null : j.id)}>
                {matchId === j.id ? "Hide matches" : "Matching candidates"}
              </button>
              <button className="ghost" onClick={() => viewNotifications(j.id)}>
                {notifyId === j.id ? "Hide notified" : "Auto-notified"}
              </button>
              <button className="ghost" onClick={() => viewApplicants(j.id)}>
                {openId === j.id ? "Hide applicants" : "View applicants"}
              </button>
            </div>
          </div>

          {matchId === j.id && <MatchCandidates token={token} job={j} />}

          {notifyId === j.id && (
            <>
              <hr />
              <div className="section-title" style={{ marginTop: 0 }}>
                Auto-notified by SMS on posting
              </div>
              {notifs.length === 0 && <p className="muted">No candidates were notified.</p>}
              {notifs.map((n) => (
                <div key={n.candidateId} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
                  <span>
                    <b>{n.name || n.candidateId.slice(-6)}</b>{" "}
                    <span className="muted">· {n.phone || "no phone"}</span>
                  </span>
                  <span>
                    <span className="tag">match {(n.score * 100).toFixed(0)}%</span>
                    <span className={n.status === "sent" ? "tag" : "muted"} style={n.status === "sent" ? { background: "#e6f4ea", color: "var(--ok)" } : {}}>
                      {n.status === "sent" ? "✓ SMS sent" : `${n.status}${n.error ? `: ${n.error}` : ""}`}
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}

          {openId === j.id && (
            <>
              <hr />
              <div className="section-title" style={{ marginTop: 0 }}>Applicants</div>
              {applicants.length === 0 && <p className="muted">No applicants yet.</p>}
              {applicants.map((a) => (
                <div key={a.candidateId} style={{ marginBottom: 12 }}>
                  <b>Candidate {a.candidateId.slice(-6)}</b>{" "}
                  <span className="muted">· {a.status}</span>
                  {a.profile ? (
                    <div>
                      <span className="muted">Phone: {a.profile.phone || "—"} · </span>
                      <span className="muted">
                        {a.profile.hasExperience ? "Experienced" : "Fresher"}
                      </span>
                      <div>
                        {a.profile.skills.map((s) => (
                          <span className="tag" key={s}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="muted">No profile filled in.</div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function Assessments({ token }: { token: string }) {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [durationMins, setDurationMins] = useState("30");
  const [cases, setCases] = useState<{ input: string; expected: string }[]>([{ input: "", expected: "" }]);
  const [list, setList] = useState<import("@/lib/api").Assessment[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [subs, setSubs] = useState<import("@/lib/api").Submission[]>([]);
  const [invEmail, setInvEmail] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList((await api.myAssessments(token)).assessments); } catch {/* */}
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const testCases = cases.filter((c) => c.input.trim() || c.expected.trim());
      await api.createAssessment({ title, question, language, durationMins: Number(durationMins) || 30, testCases }, token);
      setMsg("✓ Assessment created. Invite a candidate below to send it by email.");
      setTitle(""); setQuestion(""); setCases([{ input: "", expected: "" }]);
      await load();
    } catch (err) { setMsg(err instanceof ApiError ? err.message : "Create failed"); }
    finally { setBusy(false); }
  }

  async function viewSubs(id: string) {
    if (openId === id) { setOpenId(null); return; }
    try { setSubs((await api.assessmentSubmissions(id, token)).submissions); setOpenId(id); }
    catch (err) { setMsg(err instanceof ApiError ? err.message : "Failed to load submissions"); }
  }

  async function invite(id: string) {
    const email = (invEmail[id] || "").trim();
    if (!email) return;
    try {
      await api.inviteCandidate(id, email, token);
      setMsg(`✓ Invite emailed to ${email}`);
      setInvEmail((p) => ({ ...p, [id]: "" }));
    } catch (err) { setMsg(err instanceof ApiError ? err.message : "Invite failed"); }
  }

  const bandColor = (c: string) => (c === "High" ? "var(--ok)" : c === "Medium" ? "#b45309" : "var(--err)");

  return (
    <>
      <form className="card" onSubmit={create}>
        <h2 style={{ marginTop: 0 }}>Proctored assessments</h2>
        <div className="row">
          <div className="col"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="col"><label>Language</label><input value={language} onChange={(e) => setLanguage(e.target.value)} /></div>
          <div className="col"><label>Duration (min)</label><input value={durationMins} onChange={(e) => setDurationMins(e.target.value)} /></div>
        </div>
        <label>Question / problem statement</label>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Candidate implements: function solve(input) { ... }" />

        <div className="section-title">Test cases <span className="muted">(input is JSON passed to solve(input); output string-compared)</span></div>
        {cases.map((c, i) => (
          <div className="row" key={i} style={{ marginBottom: 6 }}>
            <input className="col" placeholder="input e.g. [2,7,11]" value={c.input}
              onChange={(e) => setCases((cs) => cs.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} />
            <input className="col" placeholder="expected e.g. 9" value={c.expected}
              onChange={(e) => setCases((cs) => cs.map((x, j) => (j === i ? { ...x, expected: e.target.value } : x)))} />
            <button type="button" className="link danger" onClick={() => setCases((cs) => cs.filter((_, j) => j !== i))}>remove</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setCases((cs) => [...cs, { input: "", expected: "" }])}>+ add test case</button>

        {msg && <div className={msg.startsWith("✓") ? "ok" : "error"}>{msg}</div>}
        <div style={{ marginTop: 12 }}><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create assessment"}</button></div>
      </form>

      {list.map((a) => (
        <div className="card" key={a.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div><p className="job-title">{a.title}</p><p className="muted">{a.language} · {a.durationMins} min · {a.testCases?.length || 0} test case(s)</p></div>
            <button className="ghost" onClick={() => viewSubs(a.id)}>{openId === a.id ? "Hide submissions" : "View submissions"}</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="col" placeholder="candidate email to invite" value={invEmail[a.id] || ""}
              onChange={(e) => setInvEmail((p) => ({ ...p, [a.id]: e.target.value }))} />
            <button type="button" onClick={() => invite(a.id)}>Send invite ✉</button>
          </div>
          {openId === a.id && (
            <>
              <hr />
              {subs.length === 0 && <p className="muted">No submissions yet.</p>}
              {subs.map((s) => (
                <div key={s.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <b>{s.candidateName || s.candidateId.slice(-6)}</b>
                    <span className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span className="tag">{s.testsPassed}/{s.testsTotal} tests</span>
                      {s.similarPercent >= 70 && <span className="badge" style={{ background: "#fde8e6", color: "var(--err)" }}>⚠ {s.similarPercent}% similar</span>}
                      <span className="badge" style={{ background: "#f5f3ff", color: bandColor(s.confidence) }}>Integrity {s.confidence} · {s.integrityScore}/100</span>
                    </span>
                  </div>
                  {s.integritySummary && <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>{s.integritySummary}</p>}
                  {s.events.length > 0 && (
                    <div style={{ margin: "4px 0" }}>
                      {s.events.map((e, i) => (<span className="tag" key={i} title={e.at}>{e.type.replace(/_/g, " ")}</span>))}
                    </div>
                  )}
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>View submitted code</summary>
                    <pre style={{ whiteSpace: "pre-wrap", background: "#faf9ff", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 12 }}>{s.code || "(empty)"}</pre>
                  </details>
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </>
  );
}
