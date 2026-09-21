// Email invites for assessments (Resend / sandbox).
const PROVIDER = (process.env.EMAIL_PROVIDER || "sandbox").toLowerCase();
const FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";
const KEY = (process.env.RESEND_API_KEY || "").trim();
const APP_URL = process.env.APP_URL || "http://localhost:3000";

export function inviteEmail(assessmentId: string, title: string, durationMins: number) {
  const link = `${APP_URL}/candidate/test/${assessmentId}`;
  const text = [
    "Hi,",
    "",
    `You've been invited to take a proctored assessment on Verihire: "${title}" (${durationMins} min).`,
    "",
    `Start it here: ${link}`,
    "",
    "Log in to your Verihire candidate account, use a single screen, and stay in fullscreen — the test is proctored.",
    "",
    "— Verihire",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1e1b34;line-height:1.6;max-width:560px">
    <p>Hi,</p>
    <p>You've been invited to take a proctored assessment on <b>Verihire</b>:</p>
    <p style="margin:14px 0;padding:14px 18px;background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px">
      <b>${title}</b><br/><span style="color:#6b7280">${durationMins} minutes · proctored</span></p>
    <p><a href="${link}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Start the test →</a></p>
    <p style="color:#6b7280;font-size:13px">Log in to your Verihire candidate account, use a single screen, and stay in fullscreen — the test is proctored.</p>
    <p style="color:#8a8f98;font-size:13px">— Verihire</p></div>`;
  return { subject: `Assessment invite: ${title}`, text, html };
}

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  if (!to) return;
  if (PROVIDER === "resend" && KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
      });
      if (!res.ok) console.warn(`[assessment] resend ${res.status}: ${(await res.text()).slice(0, 160)}`);
    } catch (e) {
      console.warn("[assessment] email error:", (e as Error).message);
    }
    return;
  }
  console.log(`\n===== [assessment] SANDBOX EMAIL =====\nTo: ${to}\nSubject: ${subject}\n\n${text}\n====================================\n`);
}
