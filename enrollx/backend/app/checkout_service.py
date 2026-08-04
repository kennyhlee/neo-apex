"""Creates Stripe Checkout Sessions on the tenant's connected account.

Amount derivation (binding contract for Plans 4-5):
- the chosen plan lives in registration_application.draft_data (JSON string)
  under "payment_plan_selection": "pay_in_full" | "deposit"
- the payment_plan block config carries integer-cent amounts:
  {"currency": "usd", "amount_full": 50000,
   "plans": [{"type": "pay_in_full"}, {"type": "deposit", "deposit_amount": 10000}]}
- pay_in_full                              -> charge amount_full        (kind "full")
- deposit chosen, no paid deposit yet      -> charge deposit_amount     (kind "deposit")
- deposit chosen, deposit already paid     -> charge the remainder      (kind "balance")
"""
import json
import logging
from dataclasses import dataclass

import stripe
from fastapi import HTTPException

from app.config import settings
from app.registration.datacore import dc_query, sql_literal
from app.registration.engine import rows_matching
from app.tenant_lookup import get_tenant_entity

logger = logging.getLogger("enrollx.checkout")


@dataclass
class CheckoutContext:
    application: dict
    item: dict
    kind: str      # full | deposit | balance
    amount: int    # integer cents
    currency: str  # lowercase ISO code


def get_application(tenant_id: str, application_id: str, token: str | None) -> dict | None:
    rows = dc_query(
        tenant_id,
        "SELECT * FROM data WHERE entity_type = 'registration_application' "
        f"AND entity_id = {sql_literal(application_id)} AND _status = 'active'",
        token,
    )
    return rows[0] if rows else None


def _as_int(value) -> int | None:
    """Flattened DataCore values are always strings — including numbers."""
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def get_payment_plan_block(tenant_id: str, application: dict, token: str | None) -> dict:
    """The payment_plan block of the EXACT config revision this application
    was started against — it carries the amount that will be charged.

    Goes through rows_matching (list_entities under the hood, which scopes to
    `_status = 'active'`) and filters `version` in Python, for two reasons:

    - Superseded revisions stay in the same table with _status='archived'
      (store.py:350-355), and a config is updated at least twice on its way
      to published. Worse, rollback (actions.py:427-437) deliberately
      re-publishes an archived config KEEPING its original version number,
      so two rows can share a version and carry different blocks — i.e. a
      different amount_full. Without the active filter, `rows[0]` picked one
      in unspecified DuckDB scan order: a wrong-amount-charged hazard.
    - Every flattened column is a string (query.py:189-235), so
      `WHERE version = 3` makes DuckDB cast the whole column to INTEGER.
      The tenant's entities table holds every entity type from every
      service, so one admindash or papermite entity with a non-numeric
      `version` raises Conversion Error -> DataCore 500 -> no checkout works
      for that tenant.

    Deliberately NOT engine.get_config_for_application: its published-config
    fallback would silently charge a different amount than the one this
    application was quoted. Nothing matching is a strict 409.
    """
    # Scoped by version alone: there is ONE config lineage per tenant now
    # (spec §2), and applications no longer carry a program_id at all — the
    # old `program_id=...` filter would have matched nothing on every new
    # application, 409-ing every checkout.
    version = int(application.get("config_version") or 0)
    rows = [
        r
        for r in rows_matching(tenant_id, "registration_config", token)
        if _as_int(r.get("version")) == version
    ]
    if not rows:
        raise HTTPException(409, "No registration config found for this application")
    blocks = rows[0].get("blocks")
    if isinstance(blocks, str):
        try:
            blocks = json.loads(blocks)
        except ValueError:
            blocks = []
    for block in blocks or []:
        if block.get("type") == "payment_plan":
            return block
    raise HTTPException(409, "This registration flow has no payment_plan block")


def _plan_selection(application: dict, plans: dict) -> str:
    draft = application.get("draft_data")
    if isinstance(draft, str) and draft:
        try:
            draft = json.loads(draft)
        except ValueError:
            draft = {}
    if not isinstance(draft, dict):
        draft = {}
    selection = draft.get("payment_plan_selection")
    if not selection and len(plans) == 1:
        selection = next(iter(plans))
    if selection not in plans:
        raise HTTPException(409, "No valid payment plan selected on this application")
    return str(selection)


def _open_payment_item(
    tenant_id: str, application_id: str, item_id: str | None, token: str | None
) -> dict:
    where = (
        "entity_type = 'application_item' "
        f"AND application_id = {sql_literal(application_id)} "
        "AND kind = 'payment' AND _status = 'active'"
    )
    if item_id:
        where += f" AND entity_id = {sql_literal(item_id)}"
    rows = dc_query(tenant_id, f"SELECT * FROM data WHERE {where}", token)
    open_items = [r for r in rows if r.get("status") not in ("verified", "waived")]
    if not open_items:
        raise HTTPException(409, "No open payment item on this application")
    return open_items[0]


def _deposit_already_paid(tenant_id: str, application_id: str, token: str | None) -> bool:
    rows = dc_query(
        tenant_id,
        "SELECT entity_id FROM data WHERE entity_type = 'payment' "
        f"AND application_id = {sql_literal(application_id)} "
        "AND kind = 'deposit' AND status = 'paid' AND _status = 'active'",
        token,
    )
    return bool(rows)


def build_checkout_context(
    tenant_id: str, application_id: str, item_id: str | None, token: str | None
) -> CheckoutContext:
    application = get_application(tenant_id, application_id, token)
    if application is None:
        raise HTTPException(404, "Application not found")
    if application.get("status") in ("declined", "withdrawn"):
        raise HTTPException(
            409, f"Cannot take payment on a {application['status']} application"
        )

    block = get_payment_plan_block(tenant_id, application, token)
    cfg = block.get("config") or {}
    currency = str(cfg.get("currency") or "usd").lower()
    amount_full = int(cfg.get("amount_full") or 0)
    if amount_full <= 0:
        raise HTTPException(409, "payment_plan block has no amount_full configured")
    plans = {str(p.get("type")): p for p in (cfg.get("plans") or []) if p.get("type")}
    selection = _plan_selection(application, plans)
    item = _open_payment_item(tenant_id, application_id, item_id, token)

    if selection == "deposit":
        deposit_amount = int(plans["deposit"].get("deposit_amount") or 0)
        if deposit_amount <= 0 or deposit_amount >= amount_full:
            raise HTTPException(409, "deposit plan has an invalid deposit_amount")
        if _deposit_already_paid(tenant_id, application_id, token):
            kind, amount = "balance", amount_full - deposit_amount
        else:
            kind, amount = "deposit", deposit_amount
    else:
        kind, amount = "full", amount_full

    return CheckoutContext(application, item, kind, amount, currency)


def create_checkout_session(
    tenant_id: str,
    application_id: str,
    item_id: str | None,
    success_url: str,
    cancel_url: str,
    token: str | None,
) -> dict:
    if not settings.stripe_secret_key:
        raise HTTPException(503, "Stripe is not configured (ENROLLX_STRIPE_SECRET_KEY)")

    tenant_row = get_tenant_entity(tenant_id, token)
    account_id = (tenant_row or {}).get("stripe_account_id")
    if not account_id:
        raise HTTPException(409, "Tenant has not connected a Stripe account")

    ctx = build_checkout_context(tenant_id, application_id, item_id, token)
    label = {"full": "Program fee", "deposit": "Deposit", "balance": "Balance"}[ctx.kind]
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            # Card only, deliberately. Without this the connected account's
            # own dashboard settings decide, and a school that enables
            # ACH/SEPA/Bacs/boleto gets checkout.session.completed with
            # payment_status "unpaid" — the webhook would then mark the item
            # verified, write a paid payment row, email a receipt and (for a
            # deposit) invite the parent to pay the remainder, for money that
            # has not arrived and may never. Restricting the method makes
            # "verified means paid" true by construction. Supporting delayed-
            # notification methods needs a payment_status gate and an
            # async_payment_succeeded handler; that is deferred follow-up.
            payment_method_types=["card"],
            line_items=[
                {
                    "price_data": {
                        "currency": ctx.currency,
                        "unit_amount": ctx.amount,
                        "product_data": {"name": f"{label} — application {application_id}"},
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "tenant_id": tenant_id,
                "application_id": application_id,
                "item_id": str(ctx.item["entity_id"]),
                "kind": ctx.kind,
            },
            api_key=settings.stripe_secret_key,
            stripe_account=str(account_id),
        )
    except stripe.StripeError as exc:
        # Connected account not enabled for charges, capability revoked,
        # account deauthorized, invalid key, rate limit, Stripe outage. Bare
        # this propagates as a 500 — on the parent channel that is a family
        # staring at "Internal Server Error" while trying to pay a school,
        # with nothing in the logs.
        logger.exception(
            "stripe checkout session creation failed (tenant_id=%r application_id=%r "
            "item_id=%r account=%r kind=%r amount=%r currency=%r)",
            tenant_id, application_id, str(ctx.item["entity_id"]), account_id,
            ctx.kind, ctx.amount, ctx.currency,
        )
        raise HTTPException(
            502,
            "Stripe could not start this payment. The school's Stripe account may "
            f"not be able to accept charges yet ({exc.__class__.__name__}).",
        )

    logger.info(
        "stripe checkout session created (tenant_id=%r application_id=%r item_id=%r "
        "account=%r kind=%r amount=%r currency=%r session_id=%r)",
        tenant_id, application_id, str(ctx.item["entity_id"]), account_id,
        ctx.kind, ctx.amount, ctx.currency, session.id,
    )
    return {
        "checkout_url": session.url,
        "session_id": session.id,
        "kind": ctx.kind,
        "amount": ctx.amount,
        "currency": ctx.currency,
    }
