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
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import APIRouter, HTTPException, Request

from app.checkout_service import get_application, get_payment_plan_block
from app.config import settings
from app.payment_emails import balance_reminder_html, payment_receipt_html
from app.registration.datacore import dc_query, list_entities, sql_literal
from app.registration.emails import send_application_email
from app.registration.engine import create_application_item, get_items, settle_payment_item
from app.registration.tokens import make_link_token
from app.tenant_lookup import get_tenant_entity

logger = logging.getLogger("enrollx.stripe_webhook")

router = APIRouter()

# Title of the non-blocking balance-due item created after a deposit
# settles. Also doubles as the idempotency key for _ensure_balance_obligation
# (see its docstring) — application_id + title are both written by every
# application_item row, so the lookup is safe to leave in SQL (task-7-
# corrections.md C5), unlike the sparse provider_ref column below.
BALANCE_ITEM_TITLE = "Balance payment"


def _as_plain_dict(obj):
    """Normalize a real Stripe object to a plain (recursively-converted)
    dict.

    stripe.Webhook.construct_event returns a stripe.StripeObject in
    production. Unlike very old SDK versions, StripeObject in stripe>=15 is
    NOT a dict subclass and does not implement `.get()` — only `__getitem__`
    / `__getattr__` — so `event.get("account")` raises AttributeError at
    runtime even though `event["account"]` and `event.account` both work.
    `.to_dict()` (recursive by default) converts the whole tree, including
    nested objects like `data.object` and `metadata`, into plain dicts so
    every `.get(...)` call below behaves as expected. Test fakes that stub
    `construct_event` to return a plain dict already (no `.to_dict`
    attribute) pass through unchanged.
    """
    to_dict = getattr(obj, "to_dict", None)
    return to_dict() if callable(to_dict) else obj


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


def _ensure_balance_obligation(
    tenant_id: str, tenant_name: str, application: dict
) -> None:
    """After a deposit settles: create the non-blocking balance item once,
    and email the parent a balance-reminder with their hub link.

    Idempotent via a title lookup: application_id and title are both written
    by every application_item row, and this application's items already
    exist by the time a deposit settles, so the flattened columns are
    materialized — safe to filter in SQL (task-7-corrections.md C5), unlike
    the sparse provider_ref column _already_processed must avoid. This lookup
    is the backstop for the caller's already_settled gate, not a replacement
    for it — see the call site's comment.

    Deliberately has no internal try/except: the caller wraps this whole
    call best-effort, with more context (session_id) than this function has,
    so exceptions are left to propagate up to that handler.
    """
    application_id = str(application["entity_id"])
    existing = dc_query(
        tenant_id,
        "SELECT entity_id FROM data WHERE entity_type = 'application_item' "
        f"AND application_id = {sql_literal(application_id)} "
        f"AND title = {sql_literal(BALANCE_ITEM_TITLE)} AND _status = 'active'",
        None,
    )
    if existing:
        return

    block = get_payment_plan_block(tenant_id, application, None)
    cfg = block.get("config") or {}
    amount_full = int(cfg.get("amount_full") or 0)
    plans = {str(p.get("type")): p for p in (cfg.get("plans") or []) if p.get("type")}
    deposit_amount = int((plans.get("deposit") or {}).get("deposit_amount") or 0)
    balance = amount_full - deposit_amount
    if balance <= 0:
        return

    due_dt = datetime.now(timezone.utc) + timedelta(days=settings.balance_due_days)
    create_application_item(
        tenant_id,
        application_id,
        {
            "block_id": str(block.get("block_id") or "payment_plan"),
            "kind": "payment",
            "title": BALANCE_ITEM_TITLE,
            "blocking": False,
            "due_at": due_dt.isoformat(),
        },
        None,
    )

    email = application.get("applicant_email")
    if not email:
        return
    link_token = make_link_token(
        tenant_id, application_id, int(application.get("token_version") or 1)
    )
    hub_url = f"{settings.familyhub_public_url}/application/{link_token}"
    currency = str(cfg.get("currency") or "usd").lower()
    send_application_email(
        tenant_id,
        application_id,
        "balance_reminder",
        email,
        f"Balance due — {tenant_name}",
        balance_reminder_html(
            tenant_name, balance, currency, due_dt.date().isoformat(), hub_url
        ),
        None,
    )


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
    event = _as_plain_dict(event)

    if event["type"] != "checkout.session.completed":
        return {"received": True, "handled": False}

    session = event["data"]["object"]
    meta = session.get("metadata") or {}
    tenant_id = meta.get("tenant_id")
    application_id = meta.get("application_id")
    item_id = meta.get("item_id")
    kind = meta.get("kind") or "full"
    if not tenant_id or not application_id or not item_id:
        logger.warning(
            "stripe webhook rejected: missing metadata (tenant_id=%r application_id=%r "
            "item_id=%r session_id=%r)", tenant_id, application_id, item_id, session.get("id"),
        )
        raise HTTPException(400, "Session metadata missing tenant/application/item")

    # Step 3 of the trust chain: connected account must map to exactly this
    # tenant before any write. Both operands must be truthy before comparing
    # — a tenant that hasn't finished Connect onboarding has no stored
    # stripe_account_id, and a platform-level (non-Connect) event has no
    # `account` at all, so two ABSENT values are not an equality of Stripe
    # account ids and must not fall through.
    tenant_row = get_tenant_entity(tenant_id, None)
    account = event.get("account")
    stored_account = (tenant_row or {}).get("stripe_account_id")
    if not stored_account or not account or str(stored_account) != str(account):
        logger.warning(
            "stripe webhook rejected: connected account mismatch (tenant_id=%r "
            "stored_account=%r event_account=%r application_id=%r session_id=%r)",
            tenant_id, stored_account, account, application_id, session.get("id"),
        )
        raise HTTPException(400, "Connected account does not match tenant")

    session_id = str(session["id"])
    if _already_processed(tenant_id, application_id, session_id):
        return {"received": True, "duplicate": True}

    items = get_items(tenant_id, application_id, None)
    item_row = next((i for i in items if str(i.get("entity_id")) == str(item_id)), None)
    if item_row is None:
        logger.warning(
            "stripe webhook rejected: unknown application item (tenant_id=%r "
            "application_id=%r item_id=%r session_id=%r)",
            tenant_id, application_id, item_id, session_id,
        )
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

    # Everything below is best-effort. settle_payment_item already committed
    # the payment + item write above, so a transient failure here (a
    # DataCore read for the applicant email, an email-provider hiccup) must
    # never surface as a 500 — that would make Stripe retry a webhook whose
    # settlement already succeeded, and the retry would short-circuit at
    # _already_processed before ever reaching this block again, so the
    # applicant would silently never get a receipt.
    #
    # already_settled=True means an EARLIER delivery (not this call) did the
    # settling and, if it got this far, already sent the receipt — see
    # settle_payment_item's docstring on the two separate read-then-write
    # dedupe windows. Sending again here would double-email the applicant
    # for one payment.
    if not result.get("already_settled"):
        tenant_name = str(tenant_row.get("name") or tenant_id)
        application = None
        try:
            application = get_application(tenant_id, application_id, None)
            email = (application or {}).get("applicant_email")
            if email:
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

        # Best-effort, same reasoning as the receipt email above: settle_
        # payment_item already committed the payment + item write, so a
        # failure here (a DataCore read, an email-provider hiccup) must
        # never surface as a 500 — that would make Stripe retry a webhook
        # whose settlement already succeeded, and the retry would
        # short-circuit at _already_processed before ever reaching this
        # block again, permanently losing the balance item and the
        # reminder for a payment that in fact succeeded.
        if kind == "deposit" and application is not None:
            try:
                _ensure_balance_obligation(tenant_id, tenant_name, application)
            except Exception:
                logger.exception(
                    "balance obligation failed (application %s session %s)",
                    application_id, session_id,
                )

    return {
        "received": True,
        "handled": True,
        "payment_id": (result.get("payment") or {}).get("entity_id"),
    }
