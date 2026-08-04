"""Stripe webhook: checkout.session.completed -> settle the payment item.

Trust chain (do not reorder, do not let any write precede step 3):
1. The Stripe signature authenticates the payload (503 if no webhook secret
   is configured, 400 on a bad signature).
2. Session metadata names the tenant, application and item (400 if any is
   missing).
3. The tenant's stored stripe_account_id must equal the event's connected-
   account id BEFORE ANY WRITE — otherwise one tenant could settle payments
   against another tenant's application.
4. Idempotency: a payment entity with provider_ref == the session id means
   this session was already processed — no-op on replay.

Unauthenticated by design (Stripe, not a NeoApex caller, hits this route) —
it trusts only the Stripe signature.
"""
import logging

import stripe
from fastapi import APIRouter, HTTPException, Request

from app.checkout_service import get_application, get_payment_plan_block
from app.config import settings
from app.payment_emails import balance_reminder_html, payment_receipt_html
from app.registration.datacore import list_entities, sql_literal
from app.registration.emails import send_application_email
from app.registration.engine import create_application_item, get_items, settle_payment_item
from app.registration.tokens import make_link_token
from app.tenant_lookup import get_tenant_entity

logger = logging.getLogger("enrollx.stripe_webhook")

router = APIRouter()


def _already_processed(tenant_id: str, application_id: str, session_id: str) -> bool:
    """Dedupe on provider_ref, filtered in PYTHON — mirrors the fix inside
    settle_payment_item (app/registration/engine.py, the `if provider_ref:`
    block). provider_ref is written only by `payment` rows, so a tenant with
    no prior Stripe payment has no such column; a SQL predicate on it makes
    DuckDB raise a binder error -> 400 from /api/query -> 500 out of enrollx,
    and Stripe retries the same failure forever. application_id IS safe to
    filter in SQL (payments, items and activities all write it), and narrows
    the scan to one application's payments."""
    where = f"application_id = {sql_literal(application_id)}"
    rows = list_entities(tenant_id, "payment", where, None)
    return any(str(r.get("provider_ref") or "") == str(session_id) for r in rows)


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Stripe webhook secret is not configured")

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Invalid Stripe webhook signature")

    if event["type"] != "checkout.session.completed":
        return {"received": True, "handled": False}

    session = event["data"]["object"]
    meta = session.get("metadata") or {}
    tenant_id = meta.get("tenant_id")
    application_id = meta.get("application_id")
    item_id = meta.get("item_id")
    kind = meta.get("kind") or "full"
    if not tenant_id or not application_id or not item_id:
        raise HTTPException(400, "Session metadata missing tenant/application/item")

    # Step 3 of the trust chain: connected account must map to exactly this
    # tenant before any write.
    tenant_row = get_tenant_entity(tenant_id, None)
    if tenant_row is None or tenant_row.get("stripe_account_id") != event.get("account"):
        raise HTTPException(400, "Connected account does not match tenant")

    session_id = str(session["id"])
    if _already_processed(tenant_id, application_id, session_id):
        return {"received": True, "duplicate": True}

    items = get_items(tenant_id, application_id, None)
    item_row = next((i for i in items if str(i.get("entity_id")) == str(item_id)), None)
    if item_row is None:
        raise HTTPException(400, "Session metadata names an unknown application item")

    amount = int(session.get("amount_total") or 0)
    currency = str(session.get("currency") or "usd").lower()
    result = settle_payment_item(
        tenant_id,
        application_id,
        item_row,
        provider="stripe",
        kind=kind,
        amount=amount,
        currency=currency,
        provider_ref=session_id,
        recorded_by="stripe:webhook",
        token=None,
    )

    tenant_name = str(tenant_row.get("name") or tenant_id)
    application = get_application(tenant_id, application_id, None)
    email = (application or {}).get("applicant_email")
    if email:
        try:
            send_application_email(
                tenant_id,
                application_id,
                "payment_receipt",
                email,
                f"Payment received — {tenant_name}",
                payment_receipt_html(tenant_name, kind, amount, currency, application_id),
                None,
            )
        except Exception:
            logger.exception("payment receipt email failed (application %s)", application_id)

    # Task 7 inserts the deposit branch here

    return {
        "received": True,
        "handled": True,
        "payment_id": (result.get("payment") or {}).get("entity_id"),
    }
