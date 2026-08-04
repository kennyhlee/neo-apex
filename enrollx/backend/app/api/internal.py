"""Private-network routes for familyhub-backend (Plan 5).

Auth: X-Internal-Key header equal to ENROLLX_INTERNAL_KEY (constant-time
compare). No JWT here — these routes are reachable only over the private
network, and every application-scoped route re-validates the magic-link
token against the application's token_version.

Parents may only save_draft / complete_item / submit (PARENT_ACTIONS).
"""
import hmac as hmac_mod

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict

from app.config import settings
from app.registration import emails, engine, tokens
from app.registration.actions import PARENT_ACTIONS, _school_label, perform_action

NON_RESENDABLE_STATUSES = {"declined", "withdrawn"}


def require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    """BINDING dependency name (Plan 5 tests reference it)."""
    if not x_internal_key or not hmac_mod.compare_digest(
            x_internal_key, settings.internal_key):
        raise HTTPException(401, "Invalid internal key")


router = APIRouter(dependencies=[Depends(require_internal_key)])


class StartRequest(BaseModel):
    school_year: str
    applicant_email: str


class InternalActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


class RequestLinkRequest(BaseModel):
    email: str


def resolve_token(token: str) -> tuple[str, dict]:
    try:
        tenant_id, app_entity_id, _sig = tokens.parse_link_token(token)
    except tokens.TokenError:
        raise HTTPException(401, "Invalid link")
    app_row = engine.get_application(tenant_id, app_entity_id)
    if not app_row:
        raise HTTPException(401, "Invalid link")
    try:
        tokens.verify_link_token(token, int(app_row.get("token_version") or 1))
    except tokens.TokenError:
        raise HTTPException(401, "Invalid link")
    return tenant_id, app_row


def _send_magic_link(tenant_id, app_row):
    link_token = tokens.make_link_token(tenant_id, app_row["entity_id"],
                                        int(app_row.get("token_version") or 1))
    link = tokens.magic_link_url(link_token)
    subject, body_html = emails.magic_link_email(_school_label(tenant_id, app_row), link)
    emails.send_application_email(tenant_id, app_row["entity_id"], "magic_link",
                                  app_row.get("applicant_email", ""), subject, body_html)
    return link_token, link


@router.post("/internal/registration/{tenant_id}/start", status_code=201)
def start_application(tenant_id: str, body: StartRequest):
    result = engine.create_application(tenant_id, body.school_year,
                                       "parent", body.applicant_email, actor="parent")
    app_row = engine.require_application(tenant_id, result["application"]["entity_id"])
    link_token, link = _send_magic_link(tenant_id, app_row)
    return {**result, "token": link_token, "link": link}


@router.get("/internal/registration/{tenant_id}/config")
def public_config(tenant_id: str):
    """The parent-facing bundle (spec §3).

    `capacity` is a snapshot for the CURRENT default school year: this route
    has no school_year of its own, and `default_school_year()` is the same
    July-rollover rule the parent start page and the staff form both use, so
    the "we're full" notice a parent sees matches the year the application
    they are about to start will be created under.

    The config is hydrated (see `engine.hydrate_config_blocks`) because
    familyhub cannot resolve entity-model fields itself.
    """
    config = engine.get_published_config(tenant_id)
    if not config:
        raise HTTPException(404, "This school is not open for registration")
    return {
        "config": engine.hydrate_config_blocks(tenant_id, config),
        "tenant": {"tenant_id": tenant_id, "name": engine.tenant_label(tenant_id)},
        "capacity": engine.capacity_state(tenant_id, engine.default_school_year()),
    }


@router.post("/internal/registration/{tenant_id}/request-link")
def request_link(tenant_id: str, body: RequestLinkRequest, background_tasks: BackgroundTasks):
    """Token-less lost-link recovery. Always 200 {} — never disclose matches.

    Matching is local, in-process computation (no per-outcome network call),
    so it does not itself create a timing signal. The one operation that
    could — sending the magic-link email, a real network call to Resend in
    production — only happens on a match, so it is deferred to a
    BackgroundTask: the response is written and returned to the caller
    identically on a hit or a miss, and any send happens strictly after
    that response has gone out. Starlette's TestClient still runs pending
    background tasks to completion before control returns to the test, so
    this doesn't change observable behavior for the test suite.
    """
    wanted = body.email.strip().lower()
    from app.registration import datacore as dc

    apps = dc.list_entities(tenant_id, "registration_application", "")
    for app_row in apps:
        if str(app_row.get("applicant_email", "")).strip().lower() != wanted:
            continue
        if app_row.get("status") in NON_RESENDABLE_STATUSES:
            continue
        background_tasks.add_task(_send_magic_link, tenant_id, app_row)
    return {}


@router.get("/internal/application-by-token/{token}")
def application_by_token(token: str):
    tenant_id, app_row = resolve_token(token)
    config = engine.get_config_for_application(tenant_id, app_row)
    return {
        "application": app_row,
        "items": engine.get_items(tenant_id, app_row["entity_id"]),
        # Hydrated for the same reason as public_config: familyhub cannot
        # resolve entity-model fields itself.
        "config": engine.hydrate_config_blocks(tenant_id, config),
    }


@router.post("/internal/application-by-token/{token}/actions")
def action_by_token(token: str, body: InternalActionRequest):
    tenant_id, app_row = resolve_token(token)
    if body.action not in PARENT_ACTIONS:
        raise HTTPException(
            403, f"Action '{body.action}' is not permitted on the parent channel")
    params = body.model_dump(exclude={"action"})
    return perform_action(tenant_id, app_row["entity_id"], body.action, params,
                          actor="parent", token=None)


@router.get("/internal/application-by-token/{token}/documents")
def documents_by_token(token: str):
    tenant_id, app_row = resolve_token(token)
    from app.registration import datacore as dc

    eid = app_row["entity_id"]
    own_tag = f"parent:{eid}"
    docs = dc.list_entities(tenant_id, "document",
                            f"application_id = {dc.sql_literal(eid)}")
    visible = [d for d in docs
               if d.get("uploaded_by") == own_tag or not engine.as_bool(d.get("sensitive"))]
    return {"documents": [{
        "entity_id": d["entity_id"],
        "document_id": d.get("document_id", ""),
        "filename": d.get("filename", ""),
        "uploaded_by": d.get("uploaded_by", ""),
        "item_id": d.get("item_id", ""),
    } for d in visible]}
