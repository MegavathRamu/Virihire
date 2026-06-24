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
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")


def personalize(name: str, summary: str, message: str) -> str:
    """Return the email body. Uses Claude if a key is set, else a template."""
    if ANTHROPIC_API_KEY:
        try:
            return _claude_personalize(name, summary, message)
        except Exception as e:  # noqa: BLE001
            print(f"[campaign] LLM personalize failed, using template: {e}", flush=True)
    greeting = f"Hi {name}," if name else "Hi,"
    return f"{greeting}\n\n{message}\n\nBest regards,\nThe Recruiting Team"


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


def send_email(to_email: str, subject: str, body: str):
    """Returns (ok: bool, error: str)."""
    if EMAIL_PROVIDER == "sendgrid" and SENDGRID_API_KEY:
        return _send_sendgrid(to_email, subject, body)
    # sandbox
    print(
        f"\n===== [campaign] SANDBOX EMAIL =====\nTo: {to_email}\nFrom: {EMAIL_FROM}\n"
        f"Subject: {subject}\n\n{body}\n===================================\n",
        flush=True,
    )
    return True, ""


def _send_sendgrid(to_email: str, subject: str, body: str):
    try:
        resp = requests.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {SENDGRID_API_KEY}", "Content-Type": "application/json"},
            json={
                "personalizations": [{"to": [{"email": to_email}]}],
                "from": {"email": EMAIL_FROM},
                "subject": subject,
                "content": [{"type": "text/plain", "value": body}],
            },
            timeout=30,
        )
        if resp.status_code in (200, 201, 202):
            return True, ""
        return False, f"sendgrid {resp.status_code}: {resp.text[:200]}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)
