"""SMS provider abstraction.

Providers (SMS_PROVIDER env):
  * "sandbox" (default): renders the SMS and logs it — no real send, no keys.
  * "twilio": sends via Twilio (needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
"""
import os
import requests

SMS_PROVIDER = os.environ.get("SMS_PROVIDER", "sandbox").lower()
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_FROM = os.environ.get("TWILIO_FROM", "").strip()


def send_sms(to_phone: str, text: str):
    """Returns (ok: bool, error: str)."""
    if SMS_PROVIDER == "twilio" and TWILIO_SID and TWILIO_TOKEN:
        return _send_twilio(to_phone, text)
    # sandbox
    print(
        f"\n===== [notify] SANDBOX SMS =====\nTo: {to_phone}\n\n{text}\n================================\n",
        flush=True,
    )
    return True, ""


def _send_twilio(to_phone: str, text: str):
    try:
        resp = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            data={"To": to_phone, "From": TWILIO_FROM, "Body": text},
            auth=(TWILIO_SID, TWILIO_TOKEN),
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return True, ""
        return False, f"twilio {resp.status_code}: {resp.text[:200]}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)
