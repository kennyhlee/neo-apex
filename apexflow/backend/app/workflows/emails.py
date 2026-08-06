# apexflow/backend/app/workflows/emails.py
"""Resend email delivery — generic transport client only.

Ported from enrollx/backend/app/registration/emails.py (interface map §4),
minus the registration-specific pieces per task-1-brief.md Step 1 ("delete
registration-specific ... code from the copies"):

- `send_application_email` logged every send as an `application_activity`
  entity via `app.registration.engine.log_activity`. `engine.py` is not part
  of this task's file list (no workflow-instance/activity-log engine exists
  in apexflow-backend yet), so that call site has no target to port against.
- The four v1 templates (`magic_link_email`, `submission_receipt_email`,
  `status_change_email`, `action_needed_email`) are registration/application
  copy tied to that same not-yet-ported engine's vocabulary.

Only the transport-level `send_email` survives. A later task can reintroduce
activity-logged, templated sends against apexflow's own generic workflow
entities once that engine exists — see interface map §4 for the original
templates' exact copy and escaping rules if/when they're needed again.

When APEXFLOW_RESEND_API_KEY is unset (dev/test), messages are logged
instead of sent.
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger("apexflow.emails")

RESEND_URL = "https://api.resend.com/emails"


def send_email(to: str, subject: str, body_html: str) -> str:
    """Returns 'sent', 'logged' (no API key configured), or 'failed'.

    Never raises — Resend failures degrade to 'failed' and are logged, since
    callers must not break because email delivery is down.
    """
    if not settings.resend_api_key:
        logger.info("EMAIL (logged, APEXFLOW_RESEND_API_KEY unset): to=%s subject=%r",
                    to, subject)
        return "logged"
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to],
                  "subject": subject, "html": body_html},
            timeout=15.0,
        )
    except httpx.RequestError:
        logger.warning("EMAIL failed (Resend unreachable): to=%s subject=%r", to, subject)
        return "failed"
    if resp.status_code >= 400:
        logger.warning("EMAIL failed (%s): to=%s subject=%r body=%s",
                       resp.status_code, to, subject, getattr(resp, "text", ""))
        return "failed"
    return "sent"
