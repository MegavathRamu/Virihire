"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type VerifyState, type VerifyResult, type VDoc } from "@/lib/api";

// Single-file steps (after Aadhaar). Aadhaar is handled as one combined step.
const SINGLE_STEPS: { key: string; label: string; hint: string }[] = [
  { key: "pan", label: "PAN card", hint: "Name must match your Aadhaar" },
  { key: "tenth", label: "10th marksheet", hint: "Name must match your Aadhaar" },
  { key: "twelfth", label: "12th marksheet", hint: "Name must match your Aadhaar" },
  { key: "resume", label: "Resume (optional)", hint: "Optional · upload an image; name must match your Aadhaar" },
  { key: "employment", label: "Employment letter (optional)", hint: "Optional · name must match your Aadhaar" },
];

// Required to finish the profile (employment is optional).
const REQUIRED = ["aadhaar_front", "aadhaar_back", "pan", "tenth", "twelfth"];

// Read + downscale the image (max 1600px, JPEG) before upload. Keeps payloads
// small (faster OCR, avoids gRPC/HTTP size limits) without hurting OCR quality.
function fileToDataUrl(file: File): Promise<string> {
  const MAX = 1600;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(r.result)); // fallback: original
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}

export default function VerificationWizard({
  token,
  onComplete,
}: {
  token: string;
  onComplete?: (done: boolean) => void;
}) {
  const [state, setState] = useState<VerifyState | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Report completion (required docs verified/flagged) up to the page.
  useEffect(() => {
    if (!state) return;
    const status = new Map(state.docs.map((d) => [d.docType, d.status]));
    const done = REQUIRED.every((dt) => ["verified", "flagged"].includes(status.get(dt) || ""));
    onCompleteRef.current?.(done);
  }, [state]);
  const [name, setName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [results, setResults] = useState<Record<string, VerifyResult>>({});
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await api.verifyState(token);
      setState(s);
      setName(s.name);
      setFatherName(s.fatherName);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load verification state");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function startIdentity(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      setState(await api.verifyIdentity({ name, fatherName }, token));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed to save identity");
    }
  }

  // Post one document, return its result (no reload).
  async function postDoc(docType: string, file: File): Promise<VerifyResult> {
    const imageBase64 = await fileToDataUrl(file);
    const res = await api.verifyDocument({ docType, imageBase64 }, token);
    setResults((p) => ({ ...p, [docType]: res }));
    return res;
  }

  async function submitSingle(docType: string, file: File) {
    setBusyStep(docType);
    setErr("");
    try {
      await postDoc(docType, file);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setBusyStep(null);
    }
  }

  // Aadhaar: upload front + back together; verify front (name), then store back.
  async function submitAadhaar(front: File, back: File) {
    setBusyStep("aadhaar");
    setErr("");
    try {
      const fr = await postDoc("aadhaar_front", front);
      // Only proceed to back once the front is accepted (verified or flagged).
      if (fr.status === "verified" || fr.status === "flagged") {
        await postDoc("aadhaar_back", back);
      }
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setBusyStep(null);
    }
  }

  if (!state) return <p className="muted">Loading verification…</p>;

  const docByType = new Map<string, VDoc>(state.docs.map((d) => [d.docType, d]));
  const isDone = (dt: string) => {
    const s = docByType.get(dt)?.status;
    return s === "verified" || s === "flagged";
  };

  const frontDoc = docByType.get("aadhaar_front");
  const aadhaarActive = state.nextStep === "aadhaar_front" || state.nextStep === "aadhaar_back";
  const aadhaarComplete = isDone("aadhaar_front") && isDone("aadhaar_back");
  const frontRes = results["aadhaar_front"];

  return (
    <div>
      <div className="section-title" style={{ marginTop: 0 }}>Identity verification</div>
      <p className="muted" style={{ marginTop: 0 }}>
        Documents are read by our own OCR engine and cross-checked against your Aadhaar name (≥70% match).
        Each step unlocks the next.
      </p>

      {/* Step 0 — identity */}
      <div className="doc" style={{ marginBottom: 12 }}>
        <div className="doc-head">
          <span className="doc-label">Your details</span>
          {state.name ? <span className="badge ok">✓ saved</span> : null}
        </div>
        <form onSubmit={startIdentity}>
          <div className="row">
            <div className="col">
              <label>Your name (as per Aadhaar)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="col">
              <label>Father&apos;s name</label>
              <input value={fatherName} onChange={(e) => setFatherName(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="submit">{state.name ? "Update" : "Start verification"}</button>
          </div>
        </form>
      </div>

      {err && <div className="error">{err}</div>}

      {/* Step 1 — Aadhaar (front + back together) */}
      {state.name && (
        <AadhaarStep
          active={aadhaarActive}
          complete={aadhaarComplete}
          busy={busyStep === "aadhaar"}
          frontDoc={frontDoc}
          frontResult={frontRes}
          onSubmit={submitAadhaar}
        />
      )}

      {/* Steps 2+ — single-file, gated */}
      {state.name &&
        SINGLE_STEPS.map((step, i) => {
          const doc = docByType.get(step.key);
          const status = doc?.status || "pending";
          const done = status === "verified" || status === "flagged";
          const active = state.nextStep === step.key;
          const locked = !done && !active;
          const res = results[step.key];
          return (
            <StepCard
              key={step.key}
              index={i + 2}
              label={step.label}
              hint={step.hint}
              status={status}
              locked={locked}
              active={active}
              doc={doc}
              res={res}
              busy={busyStep === step.key}
              onPick={(f) => submitSingle(step.key, f)}
            />
          );
        })}

      {state.name && state.nextStep === "done" && (
        <div className="ok">✓ All documents processed. Verification complete.</div>
      )}
    </div>
  );
}

function AadhaarStep({
  active,
  complete,
  busy,
  frontDoc,
  frontResult,
  onSubmit,
}: {
  active: boolean;
  complete: boolean;
  busy: boolean;
  frontDoc?: VDoc;
  frontResult?: VerifyResult;
  onSubmit: (front: File, back: File) => void;
}) {
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const locked = false; // Aadhaar is always the first step

  return (
    <div className="doc" style={{ marginBottom: 12 }}>
      <div className="doc-head">
        <span className="doc-label">1. Aadhaar (front &amp; back)</span>
        {complete && <span className="badge ok">✓ Verified</span>}
        {active && !complete && <span className="badge scan">Action needed</span>}
      </div>
      <p className="muted" style={{ margin: "2px 0 8px" }}>
        Upload <b>both</b> sides; verification runs once both are added.
      </p>

      {frontDoc?.extractedName && (
        <p className="muted" style={{ margin: 0 }}>
          OCR read: <b>{frontDoc.extractedName}</b>
          {frontDoc.extractedNumber ? ` · ${frontDoc.extractedNumber}` : ""}
        </p>
      )}

      {active && frontResult && frontResult.status === "mismatch" && (
        <div className="error" style={{ border: "1px solid var(--err)", borderRadius: 8, padding: 10, margin: "8px 0" }}>
          <b>⚠ Possible fraud — name mismatch.</b>
          <div>{frontResult.message}</div>
          <div className="muted">Match {(frontResult.nameScore * 100).toFixed(0)}% (need 70%) · {frontResult.attemptsLeft} attempt(s) left.</div>
        </div>
      )}
      {frontResult && frontResult.status === "flagged" && (
        <div className="muted" style={{ margin: "8px 0" }}>{frontResult.message}</div>
      )}

      {!complete && (
        <>
          <div className="grid2" style={{ marginTop: 8 }}>
            <FilePick label={front ? `Front: ${front.name}` : "Choose Aadhaar front"} onPick={setFront} />
            <FilePick label={back ? `Back: ${back.name}` : "Choose Aadhaar back"} onPick={setBack} />
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" disabled={!front || !back || busy} onClick={() => front && back && onSubmit(front, back)}>
              {busy ? "Scanning both sides…" : "Upload & verify Aadhaar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StepCard({
  index, label, hint, status, locked, active, doc, res, busy, onPick,
}: {
  index: number; label: string; hint: string; status: string; locked: boolean;
  active: boolean; doc?: VDoc; res?: VerifyResult; busy: boolean; onPick: (f: File) => void;
}) {
  return (
    <div className="doc" style={{ marginBottom: 12, opacity: locked ? 0.55 : 1 }}>
      <div className="doc-head">
        <span className="doc-label">{index}. {label}</span>
        {status === "verified" && <span className="badge ok">✓ Verified</span>}
        {status === "flagged" && <span className="badge" style={{ background: "#fde8e6", color: "var(--err)" }}>⚠ Flagged</span>}
        {locked && <span className="badge" style={{ background: "#eef2f8", color: "var(--muted)" }}>🔒 Locked</span>}
        {active && status !== "flagged" && <span className="badge scan">Action needed</span>}
      </div>
      <p className="muted" style={{ margin: "2px 0 8px" }}>{hint}</p>

      {doc?.extractedName && (
        <p className="muted" style={{ margin: 0 }}>
          OCR read: <b>{doc.extractedName}</b>{doc.extractedNumber ? ` · ${doc.extractedNumber}` : ""}
        </p>
      )}

      {active && res && res.status === "mismatch" && (
        <div className="error" style={{ border: "1px solid var(--err)", borderRadius: 8, padding: 10, margin: "8px 0" }}>
          <b>⚠ Possible fraud — name mismatch.</b>
          <div>{res.message}</div>
          <div className="muted">Match {(res.nameScore * 100).toFixed(0)}% (need 70%) · {res.attemptsLeft} attempt(s) left.</div>
        </div>
      )}
      {res && res.status === "flagged" && <div className="muted" style={{ margin: "8px 0" }}>{res.message}</div>}

      {(active || locked) && <UploadButton disabled={locked || busy} busy={busy} onPick={onPick} />}
    </div>
  );
}

function FilePick({ label, onPick }: { label: string; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      <button type="button" className="ghost dropzone" onClick={() => ref.current?.click()}>{label}</button>
    </>
  );
}

function UploadButton({ disabled, busy, onPick }: { disabled: boolean; busy: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      <button type="button" className="ghost dropzone" disabled={disabled} onClick={() => ref.current?.click()}>
        {busy ? "Scanning document…" : "⬆ Upload & verify"}
      </button>
    </>
  );
}
