"""Email provider abstraction + optional LLM personalization.

Providers (EMAIL_PROVIDER env):
  * "sandbox" (default): renders the email and logs it — no real send, no keys.
  * "sendgrid": sends via SendGrid (needs SENDGRID_API_KEY, EMAIL_FROM).

LLM personalization (optional): if ANTHROPIC_API_KEY is set, the recruiter's
message is rewritten as a personalized outreach email with Claude. Otherwise a
simple template is used.
"""
import os
import requests

EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "sandbox").lower()
EMAIL_FROM = os.environ.get("EMAIL_FROM", "recruiting@naukri.local")
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "").strip()
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")


def compose_email(name: str, message: str, company: str = "", role: str = ""):
    """Build a company-branded shortlist email. Returns (text, html)."""
    org = company.strip() or "the hiring team"
    greeting = f"Dear {name}," if name else "Dear Candidate,"
    shortlist = (
        f"Congratulations! You have been shortlisted for the {role} role at {company}."
        if (role and company) else
        f"Congratulations! You have been shortlisted for an opening at {company}." if company else
        "Congratulations! You have been shortlisted for a role."
    )
    note = message.strip() or "Our team reviewed your profile and would like to take your candidature forward."
    text = "\n".join([
        greeting,
        "",
        shortlist,
        "",
        note,
        "",
        "We appreciate the experience and skills you bring, and we would like to move you "
        "to the next round of our hiring process.",
        "",
        "Please reply to this email with your availability for the next steps. "
        "We look forward to speaking with you.",
        "",
        "Warm regards,",
        f"{org} — Talent Acquisition",
        "(sent via Verihire)",
    ])
    html = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1e1b34;line-height:1.6;max-width:580px">
  <p>{greeting}</p>
  <p style="font-size:16px"><b>{shortlist}</b></p>
  <p style="margin:16px 0;padding:14px 18px;background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px">{note}</p>
  <p>We appreciate the experience and skills you bring, and we would like to move you to the
  <b>next round</b> of our hiring process.</p>
  <p>Please reply to this email with your availability for the next steps. We look forward to speaking with you.</p>
  <p style="margin-top:22px">Warm regards,<br/><b>{org} — Talent Acquisition</b><br/>
  <span style="color:#8a8f98;font-size:13px">sent via Verihire</span></p>
</div>"""
    return text, html


def _claude_personalize(name: str, summary: str, message: str) -> str:
    prompt = (
        "Write a short, warm recruiting outreach email body (no subject line).\n"
        f"Candidate name: {name or 'there'}\n"
        f"Candidate background: {summary or 'n/a'}\n"
        f"Recruiter's note to convey: {message}\n"
        "Keep it under 120 words, professional, and personalized. Output only the email body."
    )
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": ANTHROPIC_MODEL,
            "max_tokens": 400,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"].strip()


def send_email(to_email: str, subject: str, text: str, html: str = "", from_name: str = "", reply_to: str = ""):
    """Returns (ok: bool, error: str). from_name = company display name; reply_to = recruiter email."""
    if EMAIL_PROVIDER == "resend" and RESEND_API_KEY:
        return _send_resend(to_email, subject, text, html, from_name, reply_to)
    if EMAIL_PROVIDER == "sendgrid" and SENDGRID_API_KEY:
        return _send_sendgrid(to_email, subject, text, html)
    # sandbox
    sender = f"{from_name} <{EMAIL_FROM}>" if from_name else EMAIL_FROM
    print(
        f"\n===== [campaign] SANDBOX EMAIL =====\nTo: {to_email}\nFrom: {sender}\nReply-To: {reply_to}\n"
        f"Subject: {subject}\n\n{text}\n===================================\n",
        flush=True,
    )
    return True, ""


def _send_resend(to_email: str, subject: str, text: str, html: str, from_name: str, reply_to: str):
    try:
        # From shows the company name; the verified domain address carries it.
        sender = f"{from_name} <{EMAIL_FROM}>" if from_name else EMAIL_FROM
        payload = {"from": sender, "to": [to_email], "subject": subject, "text": text}
        if html:
            payload["html"] = html
        if reply_to:
            payload["reply_to"] = [reply_to]
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        if resp.status_code in (200, 201, 202):
            return True, ""
        return False, f"resend {resp.status_code}: {resp.text[:200]}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def _send_sendgrid(to_email: str, subject: str, text: str, html: str):
    try:
        content = [{"type": "text/plain", "value": text}]
        if html:
            content.append({"type": "text/html", "value": html})
        resp = requests.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {SENDGRID_API_KEY}", "Content-Type": "application/json"},
            json={
                "personalizations": [{"to": [{"email": to_email}]}],
                "from": {"email": EMAIL_FROM},
                "subject": subject,
                "content": content,
            },
            timeout=30,
        )
        if resp.status_code in (200, 201, 202):
            return True, ""
        return False, f"sendgrid {resp.status_code}: {resp.text[:200]}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)
