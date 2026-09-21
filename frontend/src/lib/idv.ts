// Builds a self-contained IDV (Identity Verification) report as an HTML file and
// downloads it. The file embeds all document images, so it opens anywhere and can
// be printed to PDF.
import type { VerifyReport } from "./api";

const LABELS: Record<string, string> = {
  aadhaar_front: "Aadhaar — Front",
  aadhaar_back: "Aadhaar — Back",
  pan: "PAN card",
  tenth: "10th marksheet",
  twelfth: "12th marksheet",
  resume: "Resume",
  employment: "Employment letter",
};
const ORDER = ["aadhaar_front", "aadhaar_back", "pan", "tenth", "twelfth", "resume", "employment"];

function maskNumber(docType: string, num: string): string {
  if (!num) return "—";
  if (docType.startsWith("aadhaar")) return "XXXX XXXX " + num.slice(-4); // last 4 only
  if (docType === "pan") return num.slice(0, 2) + "****" + num.slice(-1);
  return num;
}

function statusPill(status: string): string {
  const map: Record<string, [string, string, string]> = {
    verified: ["#059669", "#d1fae5", "✓ Verified"],
    flagged: ["#e11d48", "#ffe4e6", "⚠ Flagged"],
    mismatch: ["#b45309", "#fef3c7", "Mismatch"],
    pending: ["#6b7280", "#eef2f8", "Not provided"],
  };
  const [c, bg, t] = map[status] || map.pending;
  return `<span style="color:${c};background:${bg};border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700">${t}</span>`;
}

export function buildIdvHtml(r: VerifyReport): string {
  const imgByType = new Map(r.images.map((i) => [i.docType, i.imageBase64]));
  const docByType = new Map(r.docs.map((d) => [d.docType, d]));
  const overall = statusPill(r.overallStatus === "incomplete" ? "pending" : r.overallStatus);

  // Page 1 — summary table of every document.
  const summaryRows = ORDER.map((dt) => {
    const d = docByType.get(dt);
    const status = d?.status || "pending";
    return `<tr>
      <td style="font-weight:600">${LABELS[dt]}</td>
      <td>${statusPill(status)}</td>
      <td>${d?.extractedName || "—"}</td>
      <td style="font-variant-numeric:tabular-nums">${maskNumber(dt, d?.extractedNumber || "")}</td>
    </tr>`;
  }).join("");

  // One full page per uploaded document, stacked, with a large image.
  const docPages = ORDER.filter((dt) => imgByType.has(dt)).map((dt, i) => {
    const d = docByType.get(dt);
    const img = imgByType.get(dt) || "";
    return `<section class="page doc">
      <div class="striphd"><span class="brand">veri<span style="color:#f5a623">hire</span></span>
        <span class="strip-t">Document ${i + 1} · ${LABELS[dt]}</span></div>
      <div class="docbody">
        <h2>${LABELS[dt]}</h2>
        <div class="dmeta">
          <div><span>Status</span>${statusPill(d?.status || "pending")}</div>
          <div><span>Name on document</span><b>${d?.extractedName || "—"}</b></div>
          <div><span>Number</span><b style="font-variant-numeric:tabular-nums">${maskNumber(dt, d?.extractedNumber || "")}</b></div>
        </div>
        <div class="docimg"><img src="${img}" alt="${LABELS[dt]}"/></div>
      </div>
    </section>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>IDV Report — ${r.name || r.candidateId}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1e1b34;margin:0;background:#eceaf6}
  .page{max-width:820px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;
        box-shadow:0 12px 40px -22px rgba(79,70,229,.45);min-height:1040px;display:flex;flex-direction:column}
  .hd{background:linear-gradient(135deg,#7c3aed,#4f46e5,#2563eb);color:#fff;padding:26px 32px;
      display:flex;justify-content:space-between;align-items:center}
  .hd .brand{font-weight:800;font-size:24px}
  .hd .ttl{font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px}
  .striphd{background:linear-gradient(135deg,#7c3aed,#4f46e5,#2563eb);color:#fff;padding:14px 32px;
           display:flex;justify-content:space-between;align-items:center}
  .striphd .brand{font-weight:800;font-size:18px}
  .strip-t{font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.9}
  .body{padding:28px 32px;flex:1}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;margin:6px 0 26px;font-size:15px}
  .meta b{display:block;color:#4f46e5;font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  h2{font-size:22px;margin:0 0 16px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;
     border-bottom:2px solid #ece9f6;padding:10px}
  td{padding:14px 10px;border-bottom:1px solid #f1eefb;vertical-align:middle}
  .docbody{padding:28px 32px;flex:1;display:flex;flex-direction:column}
  .dmeta{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:20px}
  .dmeta>div{display:flex;flex-direction:column;gap:6px}
  .dmeta span{color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .docimg{flex:1;display:flex;align-items:center;justify-content:center;background:#f7f6fc;
          border:1px solid #ece9f6;border-radius:10px;padding:16px}
  .docimg img{max-width:100%;max-height:760px;object-fit:contain;border-radius:6px}
  .ft{padding:18px 32px;color:#6b7280;font-size:12px;border-top:1px solid #ece9f6}
  @media print{
    body{background:#fff}
    .page{box-shadow:none;margin:0;border-radius:0;min-height:100vh;page-break-after:always}
  }
</style></head><body>

<section class="page">
  <div class="hd">
    <div><div class="brand">veri<span style="color:#f5a623">hire</span></div>
    <div class="ttl">Identity Verification Report</div></div>
    <div style="text-align:right"><div style="font-size:13px;opacity:.9">${r.generatedAt}</div>
    <div style="margin-top:8px">${overall}</div></div>
  </div>
  <div class="body">
    <div class="meta">
      <div><b>Candidate</b>${r.name || "—"}</div>
      <div><b>Candidate ID</b>${r.candidateId}</div>
      <div><b>Father's name</b>${r.fatherName || "—"}</div>
      <div><b>Verified name (Aadhaar)</b>${r.anchorName || "—"}</div>
    </div>
    <h2 style="font-size:16px">Documents summary</h2>
    <table>
      <thead><tr><th>Document</th><th>Status</th><th>Name on document</th><th>Number</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </div>
  <div class="ft">Verified by Verihire's own OCR engine. Sensitive numbers are masked. Names are
  cross-checked against the Aadhaar name (≥70% match). This is a document-OCR verification, not a
  government KYC validation. Document images follow on the next pages.</div>
</section>

${docPages}

</body></html>`;
}

export function downloadIdv(r: VerifyReport) {
  const html = buildIdvHtml(r);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `IDV_${(r.name || r.candidateId).replace(/\s+/g, "_")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
