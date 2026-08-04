"""The single typed-action dispatcher behind
POST /api/registration/{tenant}/applications/{application_id}/actions.

PARENT_ACTIONS and perform_action are BINDING names — Plan 5's familyhub
facade calls them via the /internal token routes.
"""
import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.registration import datacore as dc
from app.registration import emails, engine, tokens
from app.registration.family import (
    match_or_create_family,
    normalize_signature,
    signature_key,
)
from app.registration.items import validate_blocks
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
                  if engine.as_bool(i.get("blocking"))
                  and i.get("status") not in engine.ITEM_DONE_STATUSES]
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


# ── review handlers ───────────────────────────────────────────────────────

def _verify_item(tenant_id, application_entity_id, params, actor, token):
    engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "verified")
    updated_item = _update_item(tenant_id, item, {"status": "verified"}, actor, token)
    result = {"item": updated_item}
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    if enrolled:
        result["application"] = enrolled
    return result


def _reject_item(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "rejected")
    updated_item = _update_item(tenant_id, item, {"status": "rejected"}, actor, token)
    result = {"item": updated_item}
    # approved -> pending_items is deliberately not a legal transition (see
    # statuses.ALLOWED_TRANSITIONS); the pending_items flip only applies
    # pre-approval. An already-approved application stays approved here.
    if app_row.get("status") in {"submitted", "in_review"}:
        result["application"] = engine.set_application_status(
            tenant_id, app_row, "pending_items", actor, token)
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.action_needed_email(
            _program_label(app_row), item.get("title", "item"),
            str(params.get("reason", "")))
        emails.send_application_email(tenant_id, application_entity_id, "action_needed",
                                      email, subject, html, token)
    return result


def _waive_item(tenant_id, application_entity_id, params, actor, token):
    engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "waived")
    updated_item = _update_item(tenant_id, item, {"status": "waived"}, actor, token)
    result = {"item": updated_item}
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    if enrolled:
        result["application"] = enrolled
    return result


def _request_changes(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    updated = engine.set_application_status(tenant_id, app_row, "pending_items", actor, token)
    note = str(params.get("note", "")).strip()
    if note:
        engine.log_activity(tenant_id, application_entity_id, "note", "", note, actor, token)
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.action_needed_email(
            _program_label(app_row), "Application changes requested", note)
        emails.send_application_email(tenant_id, application_entity_id, "action_needed",
                                      email, subject, html, token)
    return {"application": updated}


def _decline(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    updated = engine.set_application_status(
        tenant_id, app_row, "declined", actor, token,
        extra_changes={"decided_at": engine.now_iso()})
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.status_change_email(_program_label(app_row), "declined")
        emails.send_application_email(tenant_id, application_entity_id, "status_change",
                                      email, subject, html, token)
    return {"application": updated}


def _promote_waitlist(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    updated = engine.set_application_status(tenant_id, app_row, "in_review", actor, token)
    return {"application": updated}


def _resend_link(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    email = app_row.get("applicant_email")
    if not email:
        raise HTTPException(400, "Application has no applicant_email to send the link to")
    # Revocation is bumping token_version BEFORE minting: the previous link's
    # signature was computed against the old version, so once this write lands
    # verify_link_token(old_token, <new stored version>) fails closed. Minting
    # from the current (un-bumped) version, as a naive resend would, leaves the
    # old link valid forever — that defeats the point of a resend.
    new_version = int(app_row.get("token_version") or 1) + 1
    app_row = engine.update_application(
        tenant_id, app_row, {"token_version": new_version}, token)
    link_token = tokens.make_link_token(tenant_id, application_entity_id, new_version)
    link = tokens.magic_link_url(link_token)
    subject, html = emails.magic_link_email(_program_label(app_row), link)
    emails.send_application_email(tenant_id, application_entity_id, "magic_link",
                                  email, subject, html, token)
    return {"link": link}


def _record_offline_payment(tenant_id, application_entity_id, params, actor, token):
    engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    amount = params.get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool):
        raise HTTPException(400, "amount is required as integer cents")
    result = engine.settle_payment_item(
        tenant_id, application_entity_id, item,
        provider="offline", kind=str(params.get("kind", "offline")),
        amount=amount, currency=str(params.get("currency", "USD")),
        recorded_by=actor, actor=actor, token=token)
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    if enrolled:
        result["application"] = enrolled
    return result


def _approve(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    status = app_row.get("status", "draft")
    if status not in {"submitted", "in_review"}:
        raise HTTPException(409, {"error": f"approve not allowed in status '{status}'",
                                  "allowed": ["submitted", "in_review"]})
    draft = json.loads(app_row.get("draft_data") or "{}")

    # 1. Family: match-or-create from draft family fields.
    # Called serially, exactly once for this approval — see the module-level
    # concurrency note in family.py: match_or_create_family is a read-then-write
    # with no locking, so this must never be fanned out across siblings or
    # wrapped in a concurrent construct.
    #
    # `applicant_email` OUTRANKS the draft-supplied `primary_email`. The
    # applicant email is the address the magic link was actually delivered to
    # — it is link-verified. `draft.family.primary_email` is free text the
    # parent can change at will via save_draft, so letting it win meant a
    # parent could type another family's email and have their student silently
    # attached to that existing family. The draft value is now only a fallback
    # for staff-created applications that have no applicant_email at all.
    family_fields = dict(draft.get("family") or {})
    if app_row.get("applicant_email"):
        family_fields["primary_email"] = app_row["applicant_email"]

    # I8: refuse to mint a junk family. Nothing upstream guarantees any
    # family-identifying data exists — applicant_email is optional,
    # complete_item never inspects draft_data, and _submit only checks item
    # statuses. Without this guard a staff-created application with no email
    # and empty items approves into a brand-new family literally named
    # "Family", one per approval, corrupting the core family registry.
    if not signature_key(normalize_signature(family_fields)):
        raise HTTPException(422, {
            "error": "Cannot approve: no family-identifying data on the application",
            "missing": ["family.primary_email (or applicant_email)",
                        "family.primary_phone",
                        "family.family_name + family.primary_address"],
            "hint": "At least one of these signatures is required to match or "
                    "create a family.",
        })

    student_fields = dict(draft.get("student") or {})
    first_name = str(student_fields.pop("first_name", "") or "").strip()
    last_name = str(student_fields.pop("last_name", "") or "").strip()
    if not first_name and not last_name:
        raise HTTPException(422, {
            "error": "Cannot approve: the application has no student name",
            "missing": ["student.first_name", "student.last_name"],
        })

    family_id, family_outcome = match_or_create_family(tenant_id, family_fields, token)
    engine.log_activity(
        tenant_id, application_entity_id, "note", "",
        f"family_{family_outcome}:{family_id}", actor, token)

    # 2. Student
    student_base = {
        "first_name": first_name,
        "last_name": last_name,
        "family_id": family_id,
        "status": "Enrolled",
    }
    for k, v in student_fields.items():
        if v not in (None, ""):
            student_base.setdefault(k, v)
    student = dc.dc_create(tenant_id, "student", student_base, token)

    # 3. Enrollment
    enrollment = dc.dc_create(tenant_id, "enrollment", {
        "student_id": student["entity_id"],
        "program_id": app_row.get("program_id", ""),
        "enrollment_date": engine.now_iso()[:10],
        "status": "active",
    }, token)

    # 4. Start due-date clocks on unfinished post-approval items
    now = datetime.now(timezone.utc)
    for item in engine.get_items(tenant_id, application_entity_id, token):
        days = item.get("due_days_after_approval")
        if days and not item.get("due_at") and item.get("status") not in {"verified", "waived"}:
            base = engine.entity_base_data(item)
            base["due_at"] = (now + timedelta(days=int(days))).isoformat()
            dc.dc_update(tenant_id, "application_item", item["entity_id"], base, token)

    # 5. Status write with decision fields
    updated = engine.set_application_status(
        tenant_id, app_row, "approved", actor, token,
        extra_changes={"family_id": family_id, "student_id": student["entity_id"],
                       "decided_at": engine.now_iso()})

    # 6. Notify
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.status_change_email(_program_label(app_row), "approved")
        emails.send_application_email(tenant_id, application_entity_id, "status_change",
                                      email, subject, html, token)

    # 7. Straight to enrolled if nothing remains open
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    return {"application": enrolled or updated,
            "family_id": family_id,
            "student_id": student["entity_id"],
            "enrollment_id": enrollment["entity_id"]}


def _publish_config(tenant_id, config_entity_id, params, actor, token):
    """Path quirk (BINDING, contract note 1): for this action only, the
    {application_id} path segment carries the registration_config entity_id
    — not an application entity_id. Every other handler in this module keeps
    treating that segment as an application id; this is the sole exception,
    scoped entirely to this function.

    No application activity row is written here: configs are not
    applications, so there is nothing for engine.log_activity to log against.
    """
    cfg = dc.get_entity(tenant_id, "registration_config", config_entity_id, token)
    if not cfg:
        raise HTTPException(404, "registration_config not found")
    was_published_before = cfg.get("status") == "archived"
    if cfg.get("status") == "published":
        raise HTTPException(409, "Config is already published")
    try:
        blocks = json.loads(cfg.get("blocks") or "[]")
    except json.JSONDecodeError:
        raise HTTPException(422, {"error": "blocks is not valid JSON", "details": ["blocks"]})
    errors = validate_blocks(blocks)
    if errors:
        raise HTTPException(422, {"error": "Invalid blocks", "details": errors})

    program_id = cfg.get("program_id", "")
    siblings = dc.list_entities(
        tenant_id, "registration_config",
        f"program_id = {dc.sql_literal(program_id)}", token)

    # Archive any currently published config for the same program — item
    # derivation assumes exactly one published config per program, so two
    # configs left `published` at once would make it ambiguous which one a
    # new application derives its items from.
    for p in siblings:
        if p["entity_id"] == cfg["entity_id"] or p.get("status") != "published":
            continue
        p_base = engine.entity_base_data(p)
        p_base["status"] = "archived"
        dc.dc_update(tenant_id, "registration_config", p["entity_id"], p_base, token)

    base = engine.entity_base_data(cfg)
    base["status"] = "published"
    if was_published_before:
        # Re-publishing an archived config is a ROLLBACK to that generation, so
        # it keeps its original version. Chosen over rejecting the re-publish
        # because a version number must identify exactly one config content
        # permanently: applications pin `config_version`, and
        # get_config_for_application resolves that pin against archived rows
        # too. Minting a NEW version for unchanged content would silently
        # re-point every application pinned to the old number at a different
        # config. Preserving it keeps every existing pin resolving to the same
        # blocks it always did, and makes rollback a first-class operation
        # rather than something callers must fake by cloning a draft.
        base["version"] = int(cfg.get("version") or 0)
    else:
        # Scan ALL configs for the program, not just published ones. Scanning
        # published-only returned 0 whenever none was currently published (e.g.
        # every config archived), handing the new config version 1 and
        # colliding with the archived original.
        # Self is excluded: a draft's `version` is a placeholder until publish
        # assigns the real one.
        base["version"] = max((int(s.get("version") or 0) for s in siblings
                               if s["entity_id"] != cfg["entity_id"]),
                              default=0) + 1
    updated = dc.dc_update(tenant_id, "registration_config", cfg["entity_id"], base, token)
    return {"config": updated}


_HANDLERS = {
    "save_draft": _save_draft,
    "complete_item": _complete_item,
    "submit": _submit,
    "verify_item": _verify_item,
    "reject_item": _reject_item,
    "waive_item": _waive_item,
    "request_changes": _request_changes,
    "decline": _decline,
    "promote_waitlist": _promote_waitlist,
    "resend_link": _resend_link,
    "record_offline_payment": _record_offline_payment,
    "approve": _approve,
    "publish_config": _publish_config,
}
