"""The single typed-action dispatcher behind
POST /api/registration/{tenant}/applications/{application_id}/actions.

PARENT_ACTIONS and perform_action are BINDING names — Plan 5's familyhub
facade calls them via the /internal token routes.
"""
import json

from fastapi import HTTPException

from app.registration import datacore as dc
from app.registration import emails, engine
from app.registration.statuses import assert_item_transition

PARENT_ACTIONS = {"save_draft", "complete_item", "submit"}

ALL_ACTIONS = {
    "save_draft", "complete_item", "submit", "approve", "decline",
    "request_changes", "verify_item", "reject_item", "waive_item",
    "record_offline_payment", "promote_waitlist", "publish_config", "resend_link",
}

COMPLETE_ITEM_APP_STATUSES = {"draft", "submitted", "in_review", "pending_items", "approved"}


def perform_action(tenant_id, application_entity_id, action, params, actor, token=None):
    if action not in ALL_ACTIONS:
        raise HTTPException(
            400, f"Unknown action '{action}'. Allowed: {sorted(ALL_ACTIONS)}")
    return _HANDLERS[action](tenant_id, application_entity_id, params, actor, token)


# ── shared helpers ────────────────────────────────────────────────────────

def _require_item(tenant_id, application_entity_id, params, token):
    item_id = params.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    item = dc.get_entity(tenant_id, "application_item", item_id, token)
    if not item or item.get("application_id") != application_entity_id:
        raise HTTPException(404, "Item not found on this application")
    return item


def _update_item(tenant_id, item_row, changes, actor, token):
    base = engine.entity_base_data(item_row)
    base.update(changes)
    updated = dc.dc_update(tenant_id, "application_item", item_row["entity_id"], base, token)
    engine.log_activity(
        tenant_id, item_row.get("application_id", ""), "item_change",
        item_row.get("status", "not_started"),
        f"{item_row.get('title', 'item')}:{changes.get('status', '?')}", actor, token)
    return updated


def _maybe_enroll(tenant_id, application_entity_id, actor, token):
    """approved -> enrolled once every item is verified or waived."""
    app_row = engine.get_application(tenant_id, application_entity_id, token)
    if not app_row or app_row.get("status") != "approved":
        return None
    items = engine.get_items(tenant_id, application_entity_id, token)
    if all(i.get("status") in {"verified", "waived"} for i in items):
        return engine.set_application_status(tenant_id, app_row, "enrolled", actor, token)
    return None


def _program_label(app_row):
    return str(app_row.get("program_id", ""))


# ── runtime handlers ──────────────────────────────────────────────────────

def _save_draft(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    status = app_row.get("status", "draft")
    if status not in {"draft", "pending_items"}:
        raise HTTPException(409, {"error": f"save_draft not allowed in status '{status}'",
                                  "allowed": ["draft", "pending_items"]})
    patch = params.get("draft_data")
    if not isinstance(patch, dict):
        raise HTTPException(400, "draft_data must be a JSON object")
    draft = json.loads(app_row.get("draft_data") or "{}")
    draft.update(patch)
    updated = engine.update_application(tenant_id, app_row,
                                        {"draft_data": json.dumps(draft)}, token)
    return {"application": updated}


def _complete_item(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    status = app_row.get("status", "draft")
    if status not in COMPLETE_ITEM_APP_STATUSES:
        raise HTTPException(409, {"error": f"complete_item not allowed in status '{status}'",
                                  "allowed": sorted(COMPLETE_ITEM_APP_STATUSES)})
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "submitted")
    changes = {"status": "submitted", "completed_by": actor}
    if params.get("payload_ref"):
        changes["payload_ref"] = str(params["payload_ref"])
    updated_item = _update_item(tenant_id, item, changes, actor, token)
    result = {"item": updated_item}
    if status == "pending_items":
        items = engine.get_items(tenant_id, application_entity_id, token)
        if not any(i.get("status") == "rejected" for i in items):
            result["application"] = engine.set_application_status(
                tenant_id, app_row, "in_review", actor, token)
    return result


def _submit(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    items = engine.get_items(tenant_id, application_entity_id, token)
    incomplete = [i.get("title", "?") for i in items
                  if i.get("blocking") and i.get("status") not in engine.ITEM_DONE_STATUSES]
    if incomplete:
        raise HTTPException(409, {"error": "Blocking items incomplete", "items": incomplete})
    full = engine.is_capacity_full(tenant_id, app_row.get("program_id", ""), token)
    target = "waitlisted" if full else "submitted"
    updated = engine.set_application_status(
        tenant_id, app_row, target, actor, token,
        extra_changes={"submitted_at": engine.now_iso()})
    email = app_row.get("applicant_email")
    if email:
        if target == "submitted":
            subject, html = emails.submission_receipt_email(
                _program_label(app_row), app_row.get("application_id", ""))
            kind = "submission_receipt"
        else:
            subject, html = emails.status_change_email(_program_label(app_row), "waitlisted")
            kind = "status_change"
        emails.send_application_email(tenant_id, application_entity_id, kind,
                                      email, subject, html, token)
    return {"application": updated}


def _not_implemented(name):
    def handler(tenant_id, application_entity_id, params, actor, token):
        raise NotImplementedError(f"action '{name}' arrives in a later task")
    return handler


_HANDLERS = {
    "save_draft": _save_draft,
    "complete_item": _complete_item,
    "submit": _submit,
    # Replaced in Tasks 11-13:
    "approve": _not_implemented("approve"),
    "decline": _not_implemented("decline"),
    "request_changes": _not_implemented("request_changes"),
    "verify_item": _not_implemented("verify_item"),
    "reject_item": _not_implemented("reject_item"),
    "waive_item": _not_implemented("waive_item"),
    "record_offline_payment": _not_implemented("record_offline_payment"),
    "promote_waitlist": _not_implemented("promote_waitlist"),
    "publish_config": _not_implemented("publish_config"),
    "resend_link": _not_implemented("resend_link"),
}
