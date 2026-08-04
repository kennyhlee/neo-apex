"""Stripe Connect (Standard) onboarding.

Staff request a connect link; Stripe redirects the browser back to the
unauthenticated callback, which verifies the signed state, exchanges the
code, and stores stripe_account_id on the tenant entity in DataCore.

Every failure branch redirects to the settings page with a short
`?stripe_error=` code — a code is all the browser gets, so each branch also
logs the cause here. That log line is the only place an operator can find
out WHY an admin saw "Stripe connection did not complete".
"""
import logging
from urllib.parse import urlencode

import stripe
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.config import settings
from app.stripe_state import make_state, verify_state
from app.tenancy import require_staff_tenant
from app.tenant_lookup import get_tenant_entity, update_tenant_entity

logger = logging.getLogger("enrollx.stripe_connect")

router = APIRouter()


@router.get("/stripe/{tenant_id}/connect-link")
def connect_link(tenant_id: str, user=Depends(require_staff_tenant)):
    # Both halves are needed to finish onboarding: the client id starts the
    # OAuth flow, the secret key completes the token exchange in the
    # callback. Guarding only the client id lets an admin walk the entire
    # Stripe flow and fail at the very end with a generic exchange_failed.
    missing = [
        name
        for name, value in (
            ("ENROLLX_STRIPE_CLIENT_ID", settings.stripe_client_id),
            ("ENROLLX_STRIPE_SECRET_KEY", settings.stripe_secret_key),
        )
        if not value
    ]
    if missing:
        raise HTTPException(
            503, f"Stripe Connect is not configured ({', '.join(missing)})"
        )
    params = urlencode(
        {
            "response_type": "code",
            "client_id": settings.stripe_client_id,
            "scope": "read_write",
            "redirect_uri": settings.stripe_redirect_url,
            "state": make_state(tenant_id),
        }
    )
    return {"url": f"https://connect.stripe.com/oauth/authorize?{params}"}


@router.get("/stripe/connect/callback")
def connect_callback(
    code: str | None = None, state: str | None = None, error: str | None = None
):
    settings_page = f"{settings.frontend_public_url}/settings/payments"
    if error or not code or not state:
        logger.info(
            "stripe connect callback denied (error=%r code_present=%s state_present=%s)",
            error, bool(code), bool(state),
        )
        return RedirectResponse(f"{settings_page}?stripe_error=denied", status_code=303)

    tenant_id = verify_state(state)
    if tenant_id is None:
        logger.warning(
            "stripe connect callback rejected: state failed verification "
            "(forged, tampered, or older than the TTL)"
        )
        return RedirectResponse(f"{settings_page}?stripe_error=bad_state", status_code=303)

    try:
        resp = stripe.OAuth.token(
            grant_type="authorization_code",
            code=code,
            api_key=settings.stripe_secret_key,
        )
    except stripe.StripeError:
        logger.exception(
            "stripe connect token exchange failed (tenant_id=%r)", tenant_id
        )
        return RedirectResponse(
            f"{settings_page}?stripe_error=exchange_failed", status_code=303
        )

    account_id = str(resp["stripe_user_id"])
    row = get_tenant_entity(tenant_id, None)
    if row is None:
        logger.error(
            "stripe connect callback found no tenant entity (tenant_id=%r account=%r)",
            tenant_id, account_id,
        )
        return RedirectResponse(f"{settings_page}?stripe_error=no_tenant", status_code=303)

    try:
        update_tenant_entity(tenant_id, row, {"stripe_account_id": account_id}, None)
    except HTTPException:
        # Mid-redirect: raising here would hand the admin's browser raw JSON
        # instead of the settings page every other branch redirects to. The
        # Stripe account is now connected but unrecorded, so this must be
        # loud in the log even though the browser only sees a code.
        logger.exception(
            "stripe connect callback failed to store stripe_account_id "
            "(tenant_id=%r account=%r) — the account is connected on Stripe's "
            "side but not recorded; retry the flow",
            tenant_id, account_id,
        )
        return RedirectResponse(
            f"{settings_page}?stripe_error=save_failed", status_code=303
        )

    logger.info(
        "stripe connect completed (tenant_id=%r account=%r)", tenant_id, account_id
    )
    return RedirectResponse(f"{settings_page}?stripe_connected=1", status_code=303)
