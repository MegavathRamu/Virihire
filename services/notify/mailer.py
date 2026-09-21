"""Email sender for auto job-alerts (Resend / sandbox), branded by the company."""
import os
import requests

EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "sandbox").lower()
EMAIL_FROM = os.environ.get("EMAIL_FROM", "onboarding@resend.dev")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()


def compose_job_alert(name: str, job: dict):
    """A 'matching role posted — please apply' email with the job details. (text, html)."""
    company = job.get("company", "the company")
    role = job.get("title", "a role")
    skills = ", ".join(job.get("skills", []))
    loc = job.get("location", "")
    desc = job.get("description", "")
    greeting = f"Dear {name}," if name else "Dear Candidate,"
    text = "\n".join([
        greeting,
        "",
        f"A new role matching your profile was just posted on Verihire by {company}.",
        "",
        f"Role: {role}",
        f"Company: {company}",
        *( [f"Location: {loc}"] if loc else [] ),
        *( [f"Skills: {skills}"] if skills else [] ),
        *( [f"About the role: {desc}"] if desc else [] ),
        "",
        "Your skills look like a strong match — could you please apply? "
        "Log in to your Verihire account to apply, or reply to this email to express interest.",
        "",
        "Warm regards,",
        f"{company} — Talent Acquisition",
        "(sent via Verihire)",
    ])
    detail_rows = "".join(
        f'<tr><td style="color:#6b7280;padding:4px 12px 4px 0">{k}</td><td><b>{v}</b></td></tr>'
        for k, v in [("Role", role), ("Company", company), ("Location", loc), ("Skills", skills)] if v
    )
    html = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1e1b34;line-height:1.6;max-width:580px">
  <p>{greeting}</p>
  <p>A new role matching your profile was just posted on <b>Verihire</b> by <b>{company}</b>.</p>
  <table style="margin:14px 0;padding:14px 18px;background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px;border-collapse:collapse">{detail_rows}</table>
  {f'<p style="color:#374151">{desc}</p>' if desc else ''}
  <p>Your skills look like a strong match — <b>could you please apply?</b> Log in to your Verihire account to apply, or reply to this email to express interest.</p>
  <p style="margin-top:22px">Warm regards,<br/><b>{company} — Talent Acquisition</b><br/>
  <span style="color:#8a8f98;font-size:13px">sent via Verihire</span></p>
</div>"""
    return text, html


def send_email(to_email: str, subject: str, text: str, html: str, from_name: str, reply_to: str):
    """Returns (ok, error)."""
    if EMAIL_PROVIDER == "resend" and RESEND_API_KEY:
        try:
            sender = f"{from_name} <{EMAIL_FROM}>" if from_name else EMAIL_FROM
            payload = {"from": sender, "to": [to_email], "subject": subject, "text": text, "html": html}
            if reply_to:
                payload["reply_to"] = [reply_to]
            r = requests.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json=payload, timeout=30,
            )
            return (True, "") if r.status_code in (200, 201, 202) else (False, f"resend {r.status_code}: {r.text[:160]}")
        except Exception as e:  # noqa: BLE001
            return False, str(e)
    # sandbox
    print(f"\n===== [notify] SANDBOX EMAIL =====\nTo: {to_email}\nFrom: {from_name} <{EMAIL_FROM}>\n"
          f"Subject: {subject}\n\n{text}\n==================================\n", flush=True)
    return True, ""
