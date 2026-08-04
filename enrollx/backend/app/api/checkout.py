"""Checkout session routes.

Staff channel: JWT + tenant + role via require_staff_tenant.
Parent channel: internal route for the familyhub facade — X-Internal-Key
over the private network plus the magic-link token (roadmap contract).
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.internal import require_internal_key, resolve_token
from app.checkout_service import create_checkout_session
from app.config import settings
from app.tenancy import require_staff_tenant

router = APIRouter()
internal_router = APIRouter(dependencies=[Depends(require_internal_key)])


class CheckoutRequest(BaseModel):
    item_id: str | None = None


@router.post("/registration/{tenant_id}/applications/{application_id}/checkout")
def staff_checkout(
    tenant_id: str,
    application_id: str,
    body: CheckoutRequest,
    user=Depends(require_staff_tenant),
):
    base = f"{settings.frontend_public_url}/applications/{application_id}"
    return create_checkout_session(
        tenant_id,
        application_id,
        body.item_id,
        success_url=f"{base}?payment=success",
        cancel_url=f"{base}?payment=cancelled",
        token=user["_token"],
    )


@internal_router.post("/application-by-token/{token}/checkout")
def parent_checkout(token: str, body: CheckoutRequest):
    tenant_id, app_row = resolve_token(token)
    application_id = app_row["entity_id"]
    base = f"{settings.familyhub_public_url}/application/{token}"
    return create_checkout_session(
        tenant_id,
        application_id,
        body.item_id,
        success_url=f"{base}?payment=success",
        cancel_url=f"{base}?payment=cancelled",
        token=None,
    )
