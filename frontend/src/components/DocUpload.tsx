"use client";
import { useRef, useState } from "react";

export interface DocState {
  fileName: string;
  preview: string; // data URL for image preview ("" for non-images)
  status: "empty" | "scanning" | "done";
}

export const emptyDoc: DocState = { fileName: "", preview: "", status: "empty" };

// A single document upload tile with an OCR-style "scanning" step.
// Verification against a provider is intentionally out of scope — this captures
// the document and shows it as uploaded.
export default function DocUpload({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: DocState;
  onChange: (next: DocState) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanPct, setScanPct] = useState(0);

  function handleFile(file: File) {
    // Simulated OCR scan progress, then "uploaded".
    const begin = (preview: string) => {
      onChange({ fileName: file.name, preview, status: "scanning" });
      setScanPct(0);
      let pct = 0;
      const timer = setInterval(() => {
        pct += 20;
        setScanPct(pct);
        if (pct >= 100) {
          clearInterval(timer);
          onChange({ fileName: file.name, preview, status: "done" });
        }
      }, 250);
    };
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => begin(String(reader.result));
      reader.readAsDataURL(file);
    } else {
      begin(""); // non-image (e.g. PDF): no inline preview
    }
  }

  return (
    <div className="doc">
      <div className="doc-head">
        <span className="doc-label">{label}</span>
        {value.status === "done" && <span className="badge ok">✓ Uploaded</span>}
        {value.status === "scanning" && <span className="badge scan">Scanning… {scanPct}%</span>}
      </div>
      {hint && <p className="muted" style={{ margin: "2px 0 8px" }}>{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {value.status === "empty" ? (
        <button type="button" className="ghost dropzone" onClick={() => inputRef.current?.click()}>
          ⬆ Upload document
        </button>
      ) : (
        <div className="doc-preview">
          {value.preview ? (
            <img src={value.preview} alt={value.fileName} />
          ) : (
            <span className="doc-file">📄 {value.fileName}</span>
          )}
          <div className="doc-actions">
            <span className="doc-file">{value.fileName}</span>
            <button type="button" className="link" onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button type="button" className="link danger" onClick={() => onChange(emptyDoc)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
