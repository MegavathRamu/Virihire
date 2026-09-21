// Correlated, progressive integrity scoring.
// A single weak signal barely matters; multiple DISTINCT strong signals together
// are what lower the score. Output is a confidence band, never a verdict.
export interface Ev { type: string; severity?: string; at?: string; detail?: string; }

const TYPE: Record<string, { per: number; cap: number; strong: boolean }> = {
  display_change:  { per: 15, cap: 30, strong: true },   // external monitor connected
  big_paste:       { per: 12, cap: 24, strong: true },   // large pasted block
  paste:           { per: 6,  cap: 18, strong: true },
  fullscreen_exit: { per: 8,  cap: 24, strong: true },
  tab_switch:      { per: 8,  cap: 24, strong: true },
  blur:            { per: 4,  cap: 16, strong: false },  // window lost focus
  camera_off:      { per: 6,  cap: 18, strong: false },
  copy:            { per: 3,  cap: 9,  strong: false },
  fast_answer:     { per: 4,  cap: 12, strong: false },  // answer with no thinking pause
};

export function scoreEvents(events: Ev[]): { score: number; confidence: string } {
  const counts: Record<string, number> = {};
  for (const e of events || []) counts[e.type] = (counts[e.type] || 0) + 1;

  let deduction = 0;
  const distinctStrong = new Set<string>();
  for (const [type, n] of Object.entries(counts)) {
    const w = TYPE[type];
    if (!w) continue;
    deduction += Math.min(w.per * n, w.cap);
    if (w.strong) distinctStrong.add(type);
  }
  // Correlation bonus: weak signals alone ≈ nothing; several strong ones together bite.
  if (distinctStrong.size >= 3) deduction += 15;
  else if (distinctStrong.size === 2) deduction += 6;

  const score = Math.max(0, Math.min(100, Math.round(100 - deduction)));
  const confidence = score >= 85 ? "High" : score >= 60 ? "Medium" : "Low";
  return { score, confidence };
}

const PHRASE: Record<string, string> = {
  display_change: "a second display was connected",
  big_paste: "a large block of code was pasted",
  paste: "code was pasted",
  fullscreen_exit: "exited fullscreen",
  tab_switch: "switched away from the test tab",
  blur: "the test window lost focus",
  camera_off: "camera was off",
  copy: "copied from the editor",
  fast_answer: "answered with no thinking pause",
};

// Plain-English explanation of the evidence (no LLM needed).
export function explainEvents(events: Ev[]): string {
  const counts: Record<string, number> = {};
  for (const e of events || []) counts[e.type] = (counts[e.type] || 0) + 1;
  const parts = Object.entries(counts)
    .filter(([t]) => PHRASE[t])
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${PHRASE[t]}${n > 1 ? ` (${n}×)` : ""}`);
  if (parts.length === 0) return "No integrity signals were raised during this attempt.";
  const strong = ["display_change", "big_paste", "paste", "fullscreen_exit", "tab_switch"].filter((t) => counts[t]).length;
  const lead = strong >= 2 ? "Multiple strong signals occurred together: " : "Signals observed: ";
  return lead + parts.join("; ") + ".";
}
