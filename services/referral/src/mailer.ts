// Email sender for referral notifications (Resend / sandbox).
const PROVIDER = (process.env.EMAIL_PROVIDER || "sandbox").toLowerCase();
const FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";
const KEY = (process.env.RESEND_API_KEY || "").trim();

export async function sendEmail(to: string, subject: string, text: string, html = ""): Promise<void> {
  if (!to) return;
  if (PROVIDER === "resend" && KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
      });
      if (!res.ok) console.warn(`[referral] resend ${res.status}: ${(await res.text()).slice(0, 160)}`);
    } catch (e) {
      console.warn("[referral] email error:", (e as Error).message);
    }
    return;
  }
  // sandbox
  console.log(`\n===== [referral] SANDBOX EMAIL =====\nTo: ${to}\nFrom: ${FROM}\nSubject: ${subject}\n\n${text}\n====================================\n`);
}
