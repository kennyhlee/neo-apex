"""Registration lifecycle engine: fetch helpers, activity logging, guarded
status writes, capacity state, application/item creation, payment settlement.

All DataCore IO goes through app.registration.datacore (list_entities /
get_entity for reads — never raw dc_query).
"""
import json
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.registration import datacore as dc
from app.registration.items import derive_items
from app.registration.statuses import assert_transition

SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector", "_tenant"}
ITEM_DONE_STATUSES = {"submitted", "verified", "waived"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def entity_base_data(row: dict) -> dict:
    """Rebuild a full base_data dict from a flattened query row.

    DataCore's entities table is flattened across every entity_type, so a
    row for one entity_type carries None-valued columns that belong to
    other entity_types entirely. DataCore PUT REPLACES base_data wholesale,
    so a caller that wants to update a row must first reconstruct its full
    base_data (not just the changed fields) — dropping the null padding
    from unrelated entity_types along the way (precedent: admindash
    leads.py `_lead_base_data`).
    """
    return {k: v for k, v in row.items()
            if k not in SYSTEM_COLS and not k.startswith("_") and v is not None}


def log_activity(tenant_id, application_id, type_, from_value, to_value, actor, token=None):
    """Write one application_activity row. `application_id` here is the
    application's entity_id (child-entity convention — see module rules)."""
    return dc.dc_create(tenant_id, "application_activity", {
        "activity_id": uuid.uuid4().hex[:12],
        "application_id": application_id,
        "type": type_,
        "from_value": from_value or "",
        "to_value": to_value or "",
        "actor": actor,
        "at": now_iso(),
    }, token)


def get_application(tenant_id, entity_id, token=None):
    return dc.get_entity(tenant_id, "registration_application", entity_id, token)


def require_application(tenant_id, entity_id, token=None) -> dict:
    row = get_application(tenant_id, entity_id, token)
    if row is None:
        raise HTTPException(404, "Application not found")
    return row


def get_items(tenant_id, application_entity_id, token=None) -> list[dict]:
    where = f"application_id = {dc.sql_literal(application_entity_id)}"
    return dc.list_entities(tenant_id, "application_item", where, token)


def get_program(tenant_id, program_id, token=None):
    """Match by the human `program_id` field first, then fall back to
    entity_id — callers may hold either depending on where the id came
    from."""
    where = f"program_id = {dc.sql_literal(program_id)}"
    rows = dc.list_entities(tenant_id, "program", where, token)
    if not rows:
        where = f"entity_id = {dc.sql_literal(program_id)}"
        rows = dc.list_entities(tenant_id, "program", where, token)
    return rows[0] if rows else None


def get_published_config(tenant_id, program_id, token=None):
    where = (f"program_id = {dc.sql_literal(program_id)} "
             f"AND status = {dc.sql_literal('published')}")
    rows = dc.list_entities(tenant_id, "registration_config", where, token)
    return rows[0] if rows else None


def get_config_for_application(tenant_id, app_row, token=None):
    """The config version pinned at application start. Archived config
    versions are still `_status = 'active'` rows (only their own `status`
    field says 'archived') — they stay queryable so an in-flight
    application keeps working against the version it was created under
    even after a newer version is published."""
    program_id = app_row.get("program_id", "")
    where = f"program_id = {dc.sql_literal(program_id)}"
    rows = dc.list_entities(tenant_id, "registration_config", where, token)
    want = int(app_row.get("config_version") or 0)
    for r in rows:
        if int(r.get("version") or 0) == want:
            return r
    return get_published_config(tenant_id, program_id, token)


def update_application(tenant_id, app_row, changes, token=None):
    base = entity_base_data(app_row)
    base.update(changes)
    return dc.dc_update(tenant_id, "registration_application", app_row["entity_id"], base, token)


def set_application_status(tenant_id, app_row, new_status, actor, token=None, extra_changes=None):
    """Guard the transition, write it, and log it. Every application status
    write MUST go through this function — never write `status` via
    update_application directly."""
    current = app_row.get("status", "draft")
    assert_transition(current, new_status)
    changes = {"status": new_status}
    if extra_changes:
        changes.update(extra_changes)
    result = update_application(tenant_id, app_row, changes, token)
    log_activity(tenant_id, app_row["entity_id"], "status_change", current, new_status,
                 actor, token)
    return result


def capacity_state(tenant_id, program_id, token=None) -> dict:
    program = get_program(tenant_id, program_id, token)
    capacity = (program or {}).get("capacity")
    approved_where = (f"program_id = {dc.sql_literal(program_id)} "
                       f"AND status = {dc.sql_literal('approved')}")
    approved = dc.list_entities(tenant_id, "registration_application", approved_where, token)
    enrolled_where = (f"program_id = {dc.sql_literal(program_id)} "
                       f"AND status = {dc.sql_literal('active')}")
    enrollments = dc.list_entities(tenant_id, "enrollment", enrolled_where, token)
    full = capacity is not None and len(approved) + len(enrollments) >= int(capacity)
    return {"capacity": int(capacity) if capacity is not None else None,
            "approved": len(approved), "enrolled": len(enrollments), "full": full}


def is_capacity_full(tenant_id, program_id, token=None) -> bool:
    """Read-then-decide: see the capacity concurrency note in the task
    report — this is not safe against two concurrent approvals racing the
    same capacity boundary."""
    return capacity_state(tenant_id, program_id, token)["full"]


def blocking_items_complete(items) -> bool:
    return all((not i.get("blocking")) or i.get("status") in ITEM_DONE_STATUSES
               for i in items)


def create_application_item(tenant_id, application_entity_id, item_fields, token=None) -> dict:
    """Create one application_item, keyed by the application's entity_id.

    BINDING name — Plan 3 uses this to create the non-blocking balance-due
    item for deposit plans. This is the ONLY sanctioned path for creating
    application_item rows outside of create_application's own derive_items
    loop (item derivation is an invariant enforced by app.registration.items,
    never restated here)."""
    base = {"item_id": uuid.uuid4().hex[:12],
            "application_id": application_entity_id,
            "status": "not_started",
            **dict(item_fields)}
    return dc.dc_create(tenant_id, "application_item", base, token)


def create_application(tenant_id, program_id, school_year, channel, applicant_email,
                       actor, token=None) -> dict:
    """Create a draft application pinned to the currently published config,
    derive its application_item rows from that config's blocks, and log the
    initial draft status. 404s if the program has no published config."""
    config = get_published_config(tenant_id, program_id, token)
    if config is None:
        raise HTTPException(404, f"No published registration config for program '{program_id}'")
    app_id = dc.next_id(tenant_id, "registration_application", token)
    base = {
        "application_id": app_id,
        # Pre-set DataCore's auto-ID field so create doesn't mint a second,
        # different id for the same row (DataCore auto-assigns
        # "{entity_type}_id" only when the field is absent).
        "registration_application_id": app_id,
        "program_id": program_id,
        "school_year": school_year,
        "status": "draft",
        "config_version": int(config.get("version") or 1),
        "channel_started": channel,
        "token_version": 1,
        "draft_data": "{}",
    }
    if applicant_email:
        base["applicant_email"] = applicant_email
    created = dc.dc_create(tenant_id, "registration_application", base, token)
    app_entity_id = created["entity_id"]
    blocks = json.loads(config.get("blocks") or "[]")
    items = [create_application_item(tenant_id, app_entity_id, fields, token)
             for fields in derive_items(blocks)]
    # Initial status is set directly at creation (there is no prior status to
    # transition from), but it is still logged like any other status write.
    log_activity(tenant_id, app_entity_id, "status_change", "", "draft", actor, token)
    return {"application": created, "items": items}


def settle_payment_item(tenant_id, application_entity_id, item_row, *, provider, kind,
                        amount, currency="USD", provider_ref=None, recorded_by=None,
                        actor="system", token=None) -> dict:
    """Write a payment entity and mark the payment item paid.

    BINDING name — Plan 3's Stripe webhook calls this with provider='stripe'
    and provider_ref=<checkout session id>. `amount` is INTEGER CENTS —
    never a float.

    The item goes straight to 'verified': the payment record itself is the
    verification evidence, so this deliberately bypasses the item's normal
    not_started -> ... -> submitted -> verified transition guard
    (assert_item_transition). The write is still logged via log_activity,
    so the audit trail is intact even though the status-graph guard is not
    consulted for this particular write. This is a permanent design
    decision, not a placeholder: for a payment item, a recorded payment
    genuinely is the verification evidence, and the verified/waived
    short-circuit below already prevents re-settling a payment item that
    reached 'verified' by some other path.

    Idempotency on `provider_ref`: Stripe retries webhook deliveries by
    design, so a caller may invoke this twice for the same real payment,
    sometimes with a stale `item_row` snapshot (still `not_started`) taken
    before the first delivery completed. When `provider_ref` is supplied,
    this function looks up any existing `payment` for this application with
    the same `provider_ref` BEFORE creating anything. If one is found, this
    call is a no-op: no second `payment` row, no item status rewrite, no
    second activity row. The return shape always has an `already_settled`
    key so the caller (the webhook handler) can tell "this call settled it"
    (`already_settled=False`) from "an earlier call already settled it"
    (`already_settled=True`) without treating the retry as an error — both
    branches return `payment`/`item` in the same
    `{"entity_id", "entity_type", "base_data"}` shape.

    Offline settlements (`provider_ref=None`, the staff-recorded-payment
    path) are NOT deduplicated — there is no external idempotency key to
    dedupe against. The caller owns not invoking this twice for the same
    offline payment.

    Residual race (NOT fixed here — DataCore offers no compare-and-set):
    the provider_ref lookup and the payment `dc_create` are two separate
    DataCore calls with nothing atomic between them. Two calls carrying the
    same `provider_ref` that interleave between "lookup found nothing" and
    "create" can both see no existing payment and both create a payment
    row. This narrows the corruption window from "any retry, any timing"
    to "two deliveries genuinely concurrent within the gap between those
    two calls" — the same category of unresolved race as
    `capacity_state`/`is_capacity_full`'s read-then-write. Closing it fully
    would need a serialization mechanism (e.g. a unique constraint on
    `provider_ref` enforced by DataCore, or a single-writer queue) that
    does not exist anywhere in this codebase's registration path today.
    """
    if item_row.get("kind") != "payment":
        raise HTTPException(400, "settle_payment_item targets a payment item")

    if provider_ref:
        where = (f"application_id = {dc.sql_literal(application_entity_id)} "
                 f"AND provider_ref = {dc.sql_literal(provider_ref)}")
        existing = dc.list_entities(tenant_id, "payment", where, token)
        if existing:
            existing_payment = existing[0]
            return {
                "payment": {"entity_id": existing_payment["entity_id"],
                            "entity_type": "payment",
                            "base_data": entity_base_data(existing_payment)},
                "item": {"entity_id": item_row["entity_id"],
                         "entity_type": "application_item",
                         "base_data": entity_base_data(item_row)},
                "already_settled": True,
            }

    if item_row.get("status") in {"verified", "waived"}:
        raise HTTPException(409, f"Payment item is already {item_row.get('status')}")
    payment_base = {
        "application_id": application_entity_id,
        "item_id": item_row["entity_id"],
        "kind": kind,
        "amount": int(amount),
        "currency": currency,
        "status": "paid",
        "provider": provider,
        "paid_at": now_iso(),
    }
    if provider_ref:
        payment_base["provider_ref"] = provider_ref
    if recorded_by:
        payment_base["recorded_by"] = recorded_by
    payment = dc.dc_create(tenant_id, "payment", payment_base, token)
    item_base = entity_base_data(item_row)
    item_base["status"] = "verified"
    item_base["completed_by"] = actor
    item_base["payload_ref"] = payment["entity_id"]
    item = dc.dc_update(tenant_id, "application_item", item_row["entity_id"], item_base, token)
    log_activity(tenant_id, application_entity_id, "item_change",
                 item_row.get("status", "not_started"),
                 f"{item_row.get('title', 'Payment')}:paid:{provider}", actor, token)
    return {"payment": payment, "item": item, "already_settled": False}
