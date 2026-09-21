"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, type Assessment, type ProctorEvent } from "@/lib/api";
import { useSession } from "@/lib/session";

type Phase = "loading" | "check" | "test" | "done";

// Client-side live estimate (mirrors the server's correlated scoring, roughly).
const W: Record<string, { per: number; cap: number; strong: boolean }> = {
  display_change: { per: 15, cap: 30, strong: true },
  big_paste: { per: 12, cap: 24, strong: true },
  paste: { per: 6, cap: 18, strong: true },
  fullscreen_exit: { per: 8, cap: 24, strong: true },
  tab_switch: { per: 8, cap: 24, strong: true },
  blur: { per: 4, cap: 16, strong: false },
  camera_off: { per: 6, cap: 18, strong: false },
  copy: { per: 3, cap: 9, strong: false },
};
function liveScore(events: ProctorEvent[]) {
  const c: Record<string, number> = {};
  events.forEach((e) => (c[e.type] = (c[e.type] || 0) + 1));
  let d = 0;
  const strong = new Set<string>();
  for (const [t, n] of Object.entries(c)) {
    const w = W[t]; if (!w) continue;
    d += Math.min(w.per * n, w.cap);
    if (w.strong) strong.add(t);
  }
  if (strong.size >= 3) d += 15; else if (strong.size === 2) d += 6;
  return Math.max(0, Math.min(100, Math.round(100 - d)));
}

export default function TestPage() {
  const router = useRouter();
  const params = useParams();
  const { session, ready, setSession } = useSession();
  const assessmentId = String(params.id || "");

  const [phase, setPhase] = useState<Phase>("loading");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [submissionId, setSubmissionId] = useState("");
  const [code, setCode] = useState("");
  const [score, setScore] = useState(100);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<{ integrityScore: number; confidence: string } | null>(null);
  const [runResults, setRunResults] = useState<import("@/lib/api").RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [singleDisplay, setSingleDisplay] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const eventsRef = useRef<ProctorEvent[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const submittedRef = useRef(false);

  const addEvent = useCallback((type: string, severity: string, detail = "") => {
    eventsRef.current.push({ type, severity, at: new Date().toISOString(), detail });
    setScore(liveScore(eventsRef.current));
  }, []);

  // load assessment + start attempt
  useEffect(() => {
    if (ready && !session) { router.replace("/"); return; }
    if (!session) return;
    (async () => {
      try {
        const a = await api.getAssessment(assessmentId, session.token);
        setAssessment(a);
        setSecondsLeft((a.durationMins || 30) * 60);
        const s = await api.startSubmission(assessmentId, session.name, session.token);
        setSubmissionId(s.id);
        setPhase("check");
      } catch {
        setPhase("check");
      }
    })();
  }, [ready, session, assessmentId, router]);

  function checkDisplays() {
    const scr = window.screen as unknown as { isExtended?: boolean };
    const ext = scr.isExtended === true;
    setSingleDisplay(!ext);
    return !ext;
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamOn(true);
    } catch {
      setCamOn(false);
    }
  }

  const submit = useCallback(async () => {
    if (submittedRef.current || !session) return;
    submittedRef.current = true;
    try {
      const s = await api.submitAttempt(submissionId, code, eventsRef.current, session.token);
      setResult({ integrityScore: s.integrityScore, confidence: s.confidence });
    } catch (e) {
      setResult({ integrityScore: liveScore(eventsRef.current), confidence: "—" });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setPhase("done");
  }, [session, submissionId, code]);

  async function run() {
    if (!session) return;
    setRunning(true);
    try { setRunResults(await api.runCode(assessmentId, code, session.token)); }
    catch {/* */} finally { setRunning(false); }
  }

  async function startTest() {
    try { await document.documentElement.requestFullscreen(); } catch {/* */}
    checkDisplays();
    setPhase("test");
  }

  // proctoring listeners (active during the test)
  useEffect(() => {
    if (phase !== "test") return;
    const onVis = () => { if (document.hidden) addEvent("tab_switch", "strong", "left the test tab"); };
    const onBlur = () => addEvent("blur", "weak", "window lost focus");
    const onFs = () => { if (!document.fullscreenElement) addEvent("fullscreen_exit", "strong", "exited fullscreen"); };
    const displayTimer = setInterval(() => {
      const scr = window.screen as unknown as { isExtended?: boolean };
      if (scr.isExtended === true && singleDisplay) { setSingleDisplay(false); addEvent("display_change", "strong", "second display detected"); }
    }, 4000);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFs);
      clearInterval(displayTimer);
    };
  }, [phase, addEvent, singleDisplay]);

  // countdown
  useEffect(() => {
    if (phase !== "test") return;
    const t = setInterval(() => setSecondsLeft((s) => {
      if (s <= 1) { clearInterval(t); submit(); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [phase, submit]);

  // keep the webcam preview bound to whichever video element is mounted
  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [phase, camOn]);

  if (!ready || !session) return null;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const band = score >= 85 ? "High" : score >= 60 ? "Medium" : "Low";
  const bandColor = score >= 85 ? "var(--ok)" : score >= 60 ? "#b45309" : "var(--err)";

  // ---------- render ----------
  if (phase === "loading") return <div className="container"><p className="muted">Loading test…</p></div>;

  if (phase === "check") {
    return (
      <div className="container" style={{ maxWidth: 620 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{assessment?.title || "Assessment"} — system check</h2>
          <p className="muted" style={{ marginTop: 0 }}>This test is proctored. We record integrity signals (fullscreen, tab switches, copy-paste, extra displays). You&apos;ll see your live Integrity Score during the test.</p>
          <ul style={{ lineHeight: 2 }}>
            <li>{singleDisplay ? "✅" : "⚠️"} Single display {singleDisplay ? "" : "— please disconnect extra monitors"}</li>
            <li>{camOn ? "✅ Camera on" : "◻️ Camera (recommended)"} <button type="button" className="link" onClick={startCamera}>{camOn ? "restart" : "enable camera"}</button></li>
            <li>✅ Fullscreen will be enabled on start</li>
          </ul>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: 180, borderRadius: 10, display: camOn ? "block" : "none", margin: "8px 0" }} />
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => { checkDisplays(); startTest(); }} disabled={!singleDisplay}>
              {singleDisplay ? "Start test →" : "Disconnect extra display to start"}
            </button>
            <button type="button" className="link" style={{ marginLeft: 12 }} onClick={() => router.push("/candidate")}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="container" style={{ maxWidth: 620 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <p className="ok" style={{ fontSize: 16 }}>✅ Submitted</p>
          <p className="muted">Your answer was submitted. The recruiter will review it along with the integrity report.</p>
          {result && (
            <p><b>Integrity:</b> {result.confidence} ({result.integrityScore}/100)</p>
          )}
          <button type="button" onClick={() => router.push("/candidate")}>Back to Verihire</button>
        </div>
      </div>
    );
  }

  // phase === "test"
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* live proctoring bar */}
      <div style={{ background: "var(--card)", borderBottom: "1px solid var(--border)", padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <b>{assessment?.title}</b>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <span className="tag">{singleDisplay ? "✓ single display" : "⚠ extra display"}</span>
          <span className="tag">{camOn ? "✓ camera" : "camera off"}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>⏱ {mm}:{ss}</span>
          <span className="badge" style={{ background: "#f5f3ff", color: bandColor }}>Integrity {band} · {score}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 0, flex: 1 }}>
        <div style={{ padding: 20, borderRight: "1px solid var(--border)", overflow: "auto" }}>
          <h3>Problem</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{assessment?.question || "No description."}</p>
          <p className="muted" style={{ fontSize: 12 }}>Language: {assessment?.language}</p>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: 150, borderRadius: 10, marginTop: 10, display: camOn ? "block" : "none" }} />
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column" }}>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onCopy={() => addEvent("copy", "weak", "copied from editor")}
            onPaste={(e) => {
              const len = (e.clipboardData.getData("text") || "").length;
              addEvent(len > 40 ? "big_paste" : "paste", "strong", `${len} chars pasted`);
            }}
            placeholder="// write your solution here"
            style={{ flex: 1, minHeight: 340, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.5 }}
          />
          {runResults && (
            <div style={{ marginTop: 10, background: "#faf9ff", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
              <b style={{ fontSize: 13 }}>Test results: {runResults.passed}/{runResults.total} passed</b>
              {runResults.results.map((r, i) => (
                <div key={i} className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {r.passed ? "✅" : "❌"} input {r.input} → got {r.error ? `error: ${r.error}` : r.got} {r.passed ? "" : `(expected ${r.expected})`}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>Leaving fullscreen / switching tabs / extra displays are logged.</span>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="ghost" onClick={run} disabled={running}>{running ? "Running…" : "Run"}</button>
              <button type="button" onClick={submit}>Submit test</button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

