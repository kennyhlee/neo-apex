"""Resend email delivery (spec section 9, v1 templates).

When ENROLLX_RESEND_API_KEY is unset (dev/test), messages are logged instead
of sent. Every application-scoped send is recorded as an application_activity
of type email_sent. Failures never raise — lifecycle actions must not break
because email is down.
"""
import logging

import httpx

from app.config import settings
from app.registration.engine import log_activity

logger = logging.getLogger("enrollx.emails")

RESEND_URL = "https://api.resend.com/emails"


def send_email(to: str, subject: str, html: str) -> str:
    """Returns 'sent', 'logged' (no API key configured), or 'failed'."""
    if not settings.resend_api_key:
        logger.info("EMAIL (logged, ENROLLX_RESEND_API_KEY unset): to=%s subject=%r",
                    to, subject)
        return "logged"
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to],
                  "subject": subject, "html": html},
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


def send_application_email(tenant_id, application_entity_id, kind, to, subject, html,
                           token=None) -> str:
    """BINDING name (Plans 3/5). Send + log as application_activity email_sent."""
    outcome = send_email(to, subject, html)
    log_activity(tenant_id, application_entity_id, "email_sent", "",
                 f"{kind}:{to}:{outcome}", "system", token)
    return outcome


# ── v1 templates ──────────────────────────────────────────────────────────

def magic_link_email(program_label: str, link: str) -> tuple[str, str]:
    return (
        f"Your registration link — {program_label}",
        f"<p>Use this link to continue your registration for {program_label} "
        f"and to check its status any time:</p>"
        f'<p><a href="{link}">{link}</a></p>'
        f"<p>Keep this email — the link is your access to the application.</p>",
    )


def submission_receipt_email(program_label: str, application_display_id: str) -> tuple[str, str]:
    return (
        f"Application received — {program_label}",
        f"<p>We received your application ({application_display_id}) for "
        f"{program_label}. We will email you when its status changes.</p>",
    )


def status_change_email(program_label: str, new_status: str) -> tuple[str, str]:
    label = new_status.replace("_", " ")
    return (
        f"Application update — {program_label}",
        f"<p>Your application for {program_label} is now: <strong>{label}</strong>.</p>"
        f"<p>Open your registration link for details and any remaining steps.</p>",
    )


def action_needed_email(program_label: str, item_title: str, reason: str) -> tuple[str, str]:
    why = f" Reason: {reason}" if reason else ""
    return (
        f"Action needed — {program_label}",
        f"<p>An item on your application needs attention: "
        f"<strong>{item_title}</strong>.{why}</p>"
        f"<p>Open your registration link to fix it.</p>",
    )
