"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type VerifyState, type VerifyResult, type VDoc } from "@/lib/api";
import { downloadIdv } from "@/lib/idv";

type Row = { key: string; icon: string; label: string; sub: string; docs: string[]; optional?: boolean };
const ROWS: Row[] = [
  { key: "aadhaar", icon: "🪪", label: "Aadhaar Card", sub: "Upload front & back", docs: ["aadhaar_front", "aadhaar_back"] },
  { key: "pan", icon: "💳", label: "PAN Card", sub: "Verify using your PAN", docs: ["pan"] },
  { key: "tenth", icon: "📄", label: "Class 10th Marksheet", sub: "Verify using your 10th", docs: ["tenth"] },
  { key: "twelfth", icon: "📑", label: "Class 12th Marksheet", sub: "Verify using your 12th", docs: ["twelfth"] },
  { key: "resume", icon: "📃", label: "Resume", sub: "Optional · upload resume", docs: ["resume"], optional: true },
  { key: "employment", icon: "💼", label: "Employment Experience", sub: "Optional · previous employer", docs: ["employment"], optional: true },
];
const REQUIRED = ["aadhaar_front", "aadhaar_back", "pan", "tenth", "twelfth"];

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
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(String(r.result));
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}

export default function VerificationScreen({
  token,
  onComplete,
  onConfirm,
}: {
  token: string;
  onComplete?: (done: boolean) => void;
  onConfirm?: () => void;
}) {
  const [state, setState] = useState<VerifyState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, VerifyResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const load = useCallback(async () => {
    try {
      setState(await api.verifyState(token));
    } catch {/* ignore */}
  }, [token]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!state) return;
    const st = new Map(state.docs.map((d) => [d.docType, d.status]));
    const done = REQUIRED.every((dt) => ["verified", "flagged"].includes(st.get(dt) || ""));
    onCompleteRef.current?.(done);
    if (state.nextStep && state.nextStep !== "done" && open === null) {
      const row = ROWS.find((r) => r.docs.includes(state.nextStep));
      if (row) setOpen(row.key);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function postDoc(docType: string, file: File): Promise<VerifyResult> {
    const imageBase64 = await fileToDataUrl(file);
    const res = await api.verifyDocument({ docType, imageBase64 }, token);
    setResults((p) => ({ ...p, [docType]: res }));
    return res;
  }
  async function submitSingle(docType: string, file: File) {
    setBusy(docType);
    try { await postDoc(docType, file); await load(); } catch {/* */} finally { setBusy(null); }
  }
  async function submitAadhaar(f: File, b: File) {
    setBusy("aadhaar");
    try {
      const fr = await postDoc("aadhaar_front", f);
      if (fr.status === "verified" || fr.status === "flagged") await postDoc("aadhaar_back", b);
      await load();
      setFront(null); setBack(null);
    } catch {/* */} finally { setBusy(null); }
  }

  if (!state) return <p className="muted">Loading verification…</p>;

  const st = new Map<string, VDoc>(state.docs.map((d) => [d.docType, d]));
  const rowDone = (r: Row) => r.docs.every((dt) => ["verified", "flagged"].includes(st.get(dt)?.status || ""));
  const rowActive = (r: Row) => r.docs.includes(state.nextStep);
  const complete = REQUIRED.every((dt) => ["verified", "flagged"].includes(st.get(dt)?.status || ""));

  return (
    <div className="vcard">
      <div className="vhead">
        <div className="hi">Hello{state.name ? `, ${state.name.split(" ")[0]}` : ""} 👋</div>
        <div className="sub">Verify your identity</div>
      </div>

      {ROWS.map((r) => {
        const done = rowDone(r);
        const active = rowActive(r) || (r.optional && !done && state.nextStep === r.docs[0]);
        const locked = !done && !active;
        const isOpen = open === r.key;
        const fault = results[r.docs[0]];
        return (
          <div key={r.key}>
            <div
              className={`vrow${locked ? " locked" : ""}`}
              onClick={() => !locked && setOpen(isOpen ? null : r.key)}
            >
              <div className="vrow-ic">{r.icon}</div>
              <div className="vrow-tx">
                <div className="t">{r.label}</div>
                <div className="s">{r.sub}</div>
              </div>
              <div className="vrow-rt">
                {done ? <span className="vpill">✓ VERIFIED</span> : locked ? <span className="vchev">🔒</span> : <span className="vchev">{isOpen ? "▾" : "›"}</span>}
              </div>
            </div>

            {isOpen && !done && (
              <div className="vpanel">
                {r.key === "aadhaar" ? (
                  <>
                    <div className="grid2">
                      <FilePick label={front ? `Front: ${front.name}` : "Choose front"} onPick={setFront} />
                      <FilePick label={back ? `Back: ${back.name}` : "Choose back"} onPick={setBack} />
                    </div>
                    <button type="button" style={{ marginTop: 10 }} disabled={!front || !back || busy === "aadhaar"}
                      onClick={() => front && back && submitAadhaar(front, back)}>
                      {busy === "aadhaar" ? "Scanning…" : "Upload & verify"}
                    </button>
                  </>
                ) : (
                  <UploadButton busy={busy === r.docs[0]} onPick={(f) => submitSingle(r.docs[0], f)} />
                )}
                {fault && fault.status === "mismatch" && (
                  <div className="error" style={{ marginTop: 8 }}>
                    ⚠ Name mismatch ({(fault.nameScore * 100).toFixed(0)}%, need 70%). {fault.attemptsLeft} attempt(s) left.
                  </div>
                )}
                {fault && fault.status === "flagged" && <div className="muted" style={{ marginTop: 8 }}>{fault.message}</div>}
                {st.get(r.docs[0])?.extractedName && (
                  <div className="muted" style={{ marginTop: 6 }}>OCR read: <b>{st.get(r.docs[0])?.extractedName}</b></div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="vfoot">
        {complete ? (
          <>
            <div className="ok" style={{ textAlign: "center", marginBottom: 10 }}>✓ Identity verified</div>
            <button type="button" style={{ width: "100%" }} onClick={onConfirm}>Submit &amp; apply for jobs →</button>
            <button type="button" className="ghost" style={{ width: "100%", marginTop: 8 }}
              onClick={async () => { try { downloadIdv(await api.myIdvReport(token)); } catch {/* */} }}>
              ⬇ Download IDV report
            </button>
          </>
        ) : (
          <button type="button" style={{ width: "100%" }} disabled>Complete required verifications to continue</button>
        )}
      </div>
      <div className="powered">powered by <b>verihire</b></div>
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
function UploadButton({ busy, onPick }: { busy: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      <button type="button" className="ghost dropzone" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Scanning document…" : "⬆ Upload & verify"}
      </button>
    </>
  );
}
