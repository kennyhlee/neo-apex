"""Stripe Connect (Standard) onboarding.

Staff request a connect link; Stripe redirects the browser back to the
unauthenticated callback, which verifies the signed state, exchanges the
code, and stores stripe_account_id on the tenant entity in DataCore.
"""
from urllib.parse import urlencode

import stripe
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.config import settings
from app.registration.datacore import dc_update
from app.stripe_state import make_state, verify_state
from app.tenancy import require_staff_tenant
from app.tenant_lookup import entity_base_data, get_tenant_entity

router = APIRouter()


@router.get("/stripe/{tenant_id}/connect-link")
def connect_link(tenant_id: str, user=Depends(require_staff_tenant)):
    if not settings.stripe_client_id:
        raise HTTPException(
            503, "Stripe Connect is not configured (ENROLLX_STRIPE_CLIENT_ID)"
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
        return RedirectResponse(f"{settings_page}?stripe_error=denied", status_code=303)

    tenant_id = verify_state(state)
    if tenant_id is None:
        return RedirectResponse(f"{settings_page}?stripe_error=bad_state", status_code=303)

    try:
        resp = stripe.OAuth.token(
            grant_type="authorization_code",
            code=code,
            api_key=settings.stripe_secret_key,
        )
    except stripe.StripeError:
        return RedirectResponse(
            f"{settings_page}?stripe_error=exchange_failed", status_code=303
        )

    account_id = str(resp["stripe_user_id"])
    row = get_tenant_entity(tenant_id, None)
    if row is None:
        return RedirectResponse(f"{settings_page}?stripe_error=no_tenant", status_code=303)

    base = entity_base_data(row)
    base["stripe_account_id"] = account_id
    dc_update(tenant_id, "tenant", tenant_id, base, None)
    return RedirectResponse(f"{settings_page}?stripe_connected=1", status_code=303)
