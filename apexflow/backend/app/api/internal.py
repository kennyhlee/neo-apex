# apexflow/backend/app/api/internal.py
"""Token-scoped internal routes for the family channel (Task 10).

Ported/generalized from enrollx/backend/app/api/internal.py (interface map
§2-4), retargeted onto apexflow's workflow-instance vocabulary. Every route
here requires `X-Internal-Key` (`app.auth.require_internal_key`) -- no JWT.
Reachable only over the private network by familyhub-backend (or any future
token-scoped consumer); every instance-scoped route re-validates the
magic-link token against the instance's CURRENT `token_version` (the
revocation mechanism -- no expiry field, per app.workflows.tokens).

Family actor convention (binding, `app.workflows.shared.is_family_actor`):
`"family:{instance_entity_id}"`. Every action/document route below derives
this from the VERIFIED token, never from client input.

Defense in depth on the actions route: `cancel_instance` and the three
staff-only item ops (`verify_item`/`reject_item`/`waive_item`) are blocked
with 403 BEFORE `machine.execute_action` is ever called, even though
`execute_action`'s own actor-gating (`_run_item_builtin`/`cancel_instance`)
already rejects them for a family actor -- same belt-and-suspenders
precedent as enrollx's internal.py checking `PARENT_ACTIONS` before calling
`perform_action`.

resolve_token's failure modes are UNIFORMLY 401 (coordinator review fix,
superseding an earlier Task 10 draft that split this into 401 vs. 403 --
see task-10-report.md's fix log). Every one of: an unparseable/forged
token, a well-formed token whose (tenant_id, instance_entity_id) does not
resolve to any workflow_instance at all (wrong tenant, or an instance that
was never created / no longer exists), and a signature that fails against
the row's CURRENT token_version (revoked) -- all raise the SAME
`HTTPException(401, "Invalid or revoked link")`, identical status AND body.
This mirrors enrollx's own uniform-401 precedent, and for the same reason:
a 403 on "instance not found" vs. a 401 on "instance found but the
signature/version is wrong" is an EXISTENCE ORACLE -- an unauthenticated
caller (familyhub's public token routes carry no auth of their own) could
binary-search a tenant's instance-id space by watching which code comes
back. Do not reintroduce a split here without closing that leak some other
way first.

Missing/mismatched `X-Internal-Key` stays 401 too (`require_internal_key`,
app/auth.py) -- unrelated to token scope, the platform's existing internal-
auth code, unchanged. It is a coincidence that both land on 401, not the
same mechanism.

Document routes: `document.application_id` is DataCore's OWN required field
name on the blob API (datacore/src/datacore/api/document_routes.py's
`CreateDocumentRequest.application_id`) -- not renameable from here, since
DataCore itself is out of scope for this task. It holds the workflow
INSTANCE's entity_id throughout this module (interface map Gotcha A: DataCore
entity_id, never a business id). `uploaded_by` is DERIVED server-side from
the verified token as `"family:{instance_entity_id}"` -- never accepted from
a client body (roadmap security rule, verbatim) -- `TokenCreateDocumentRequest`
below has no `uploaded_by` field, so pydantic's default `extra="ignore"`
drops a client-supplied one before the handler ever sees the body.

Error-relay convention for the DataCore blob hops on THIS (family/token)
surface: masked to a fixed 502 on any non-2xx, never the raw DataCore status
or body (interface map Gotcha E: "pick a convention deliberately per
channel" -- this mirrors familyhub's OLD parent-facing `relay.py` masking,
now pulled one hop earlier into apexflow itself). The STAFF surface
(`app/api/documents.py`) instead forwards DataCore's status code verbatim
(never the body), following enrollx's own staff-proxy precedent -- staff-
facing internal errors can be more transparent than family-facing ones.
"""
import html
import logging

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from app.auth import require_internal_key
from app.config import settings
from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows import engine
from app.workflows import machine
from app.workflows.emails import send_email
from app.workflows.shared import as_bool
from app.workflows.tokens import TokenError, make_link_token, parse_link_token, verify_link_token

logger = logging.getLogger("apexflow.internal")

router = APIRouter(dependencies=[Depends(require_internal_key)])

# Blocked outright on the family/token channel -- staff-only built-ins.
# `machine.execute_action`'s own actor gating already rejects every one of
# these for a `family:*` actor; this is the same defense-in-depth precedent
# enrollx's internal.py used (checking PARENT_ACTIONS before perform_action).
BLOCKED_TOKEN_ACTIONS = frozenset({"cancel_instance", "verify_item", "reject_item", "waive_item"})


# --- request bodies ---------------------------------------------------------


class StartRequest(BaseModel):
    context: dict = {}
    applicant_email: str


class InternalActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


class RequestLinkRequest(BaseModel):
    email: str


class TokenCreateDocumentRequest(BaseModel):
    # SECURITY: no `uploaded_by` field here, deliberately (see module
    # docstring) -- pydantic's default extra="ignore" drops a client-supplied
    # one before this model is ever constructed.
    item_id: str | None = None
    filename: str
    content_type: str
    size: int
    sensitive: bool = False


# --- token resolution --------------------------------------------------------


_INVALID_TOKEN_DETAIL = "Invalid or revoked link"


def resolve_token(token: str) -> tuple[str, dict]:
    """Decode + authenticate a magic-link token against the CURRENT
    `workflow_instance` row's `token_version`.

    UNIFORM 401 on every failure mode (module docstring) -- malformed/forged
    token, unresolved (tenant, instance) scope, and a revoked/stale
    signature all raise the identical `HTTPException(401,
    _INVALID_TOKEN_DETAIL)`. This is deliberate: differentiating "instance
    doesn't exist" from "instance exists but this token is wrong" would let
    an unauthenticated caller probe instance existence."""
    try:
        tenant_id, instance_entity_id, _sig = parse_link_token(token)
    except TokenError:
        raise HTTPException(401, _INVALID_TOKEN_DETAIL)

    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_entity_id)
    if instance_row is None:
        raise HTTPException(401, _INVALID_TOKEN_DETAIL)

    try:
        verify_link_token(token, int(instance_row.get("token_version") or 1))
    except TokenError:
        raise HTTPException(401, _INVALID_TOKEN_DETAIL)

    return tenant_id, instance_row


def _family_actor(instance_row: dict) -> str:
    return f"family:{instance_row['entity_id']}"


_NO_PUBLISHED_DEFINITION_DETAIL = "No published workflow_definition for this lineage"


def _require_family_channel_definition(tenant_id: str, definition_id: str,
                                        token: str | None = None) -> dict:
    """The published row for `definition_id`, but ONLY if its
    `channel_access` is `"family"` -- 404 (never 403) otherwise, identical
    detail/status to "no published row at all". This is the same
    existence-oracle concern `resolve_token` guards against (module
    docstring): the family/token-scoped surface must not let an
    unauthenticated caller distinguish "this lineage doesn't exist/isn't
    published" from "this lineage exists but is staff_only" -- a 403 would
    leak that a staff-only definition (and its definition_id) exists."""
    row = defs.get_published_definition(tenant_id, definition_id, token)
    if row is None or row.get("channel_access") != "family":
        raise HTTPException(404, _NO_PUBLISHED_DEFINITION_DETAIL)
    return row


def _link_for(tenant_id: str, definition_id: str, link_token: str) -> str:
    return f"{settings.familyhub_base_url}/w/{tenant_id}/{definition_id}?token={link_token}"


def _send_magic_link(tenant_id: str, instance_row: dict) -> tuple[str, str]:
    """Mint a fresh token for `instance_row`'s CURRENT token_version and
    email it. Returns (token, link) so callers (start_workflow) can also
    return it in the HTTP response, same dual-use as enrollx's own
    `_send_magic_link`. Never raises -- `send_email` degrades to
    'logged'/'failed' rather than breaking the caller."""
    instance_entity_id = instance_row["entity_id"]
    token_version = int(instance_row.get("token_version") or 1)
    link_token = make_link_token(tenant_id, instance_entity_id, token_version)
    link = _link_for(tenant_id, instance_row.get("definition_id"), link_token)
    escaped_link = html.escape(link)
    subject = "Continue your application"
    body_html = f'<p>Continue where you left off: <a href="{link}">{escaped_link}</a></p>'
    send_email(instance_row.get("applicant_email", ""), subject, body_html)
    return link_token, link


# --- start / config / request-link -------------------------------------------


@router.post("/internal/workflows/{tenant_id}/{definition_id}/start", status_code=201)
def start_workflow(tenant_id: str, definition_id: str, body: StartRequest):
    """Create a workflow_instance on the family channel, run creation-time
    system auto-advance (same pattern as `app.api.instances.create_instance_route`
    -- see that route's docstring), then mint + email a magic link scoped to
    the instance's resulting token_version.

    404s (never 403s -- see `_require_family_channel_definition`) if the
    lineage has no published `channel_access: "family"` row, BEFORE
    `engine.create_instance` (which has no channel_access concept of its own
    -- it also backs the staff-side create path) ever runs."""
    _require_family_channel_definition(tenant_id, definition_id)
    result = engine.create_instance(
        tenant_id, definition_id, body.context, "family",
        applicant_email=body.applicant_email,
    )

    instance_entity_id = result["instance"]["entity_id"]
    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_entity_id)
    ctx = machine.build_eval_context(tenant_id, instance_row, actor=_family_actor(instance_row))
    machine.run_system_transitions(ctx)
    result["instance"] = ctx.instance

    link_token, link = _send_magic_link(tenant_id, ctx.instance)
    return {**result, "token": link_token, "link": link}


def _first_capacity_guard_params(machine_def) -> dict | None:
    """The FIRST `capacity_available` guard declared anywhere in the
    machine (declaration order), or None if the machine has no capacity
    concept at all. There is no instance/EvalContext yet at config-read
    time (task-10-brief.md: "capacity summary computable via the same count
    the capacity_available guard uses -- factor or reimplement minimally"),
    so this reads the guard's OWN authored params
    (`capacity_field`/`count_states`) rather than invoking
    `primitives._guard_capacity_available` itself, which requires a real
    `EvalContext.instance` to self-exclude. `scope_context_key` (school-year
    scoping) is deliberately not applied here -- there is no creation-time
    context to scope by before an instance exists, so this summary is a
    tenant-wide, unscoped count."""
    for t in machine_def.transitions:
        for g in t.guards:
            if g.primitive == "capacity_available":
                return g.params
    return None


def _capacity_summary(tenant_id: str, lineage_definition_id: str, machine_def) -> dict:
    params = _first_capacity_guard_params(machine_def)
    if params is None:
        return {"capacity": None, "admitted": 0, "full": False}

    capacity_field = params.get("capacity_field", "capacity")
    tenant_row = dc.get_entity(tenant_id, "tenant", tenant_id)
    raw_capacity = (tenant_row or {}).get(capacity_field)
    try:
        capacity = int(raw_capacity) if raw_capacity not in (None, "", "None") else None
    except (TypeError, ValueError):
        capacity = None

    count_states = set(params.get("count_states") or [])
    rows = dc.list_entities(tenant_id, "workflow_instance", "")
    admitted = sum(
        1 for r in rows
        if str(r.get("definition_id", "")) == str(lineage_definition_id)
        and r.get("state") in count_states
    )
    full = capacity is not None and admitted >= capacity
    return {"capacity": capacity, "admitted": admitted, "full": full}


@router.get("/internal/workflows/{tenant_id}/{definition_id}/config")
def workflow_config(tenant_id: str, definition_id: str):
    row = _require_family_channel_definition(tenant_id, definition_id)

    machine_def, steps = defs.parse_machine_steps(row)
    tenant_row = dc.get_entity(tenant_id, "tenant", tenant_id)

    return {
        "definition": {
            "definition_id": row.get("definition_id"),
            "name": row.get("name"),
            "version": defs._as_int(row.get("version")),
            "machine": machine_def.model_dump(by_alias=True),
            "steps": [s.model_dump(by_alias=True) for s in steps],
        },
        "tenant": {"tenant_id": tenant_id, "name": (tenant_row or {}).get("name", tenant_id)},
        "capacity": _capacity_summary(tenant_id, definition_id, machine_def),
    }


@router.post("/internal/workflows/{tenant_id}/request-link")
def request_link(tenant_id: str, body: RequestLinkRequest, background_tasks: BackgroundTasks):
    """Token-less lost-link recovery. Always 200 {} -- never disclose matches
    (anti-enumeration, enrollx precedent). Matching is local, in-process
    computation, so it creates no timing signal; the one thing that could
    (a real send) is deferred to a BackgroundTask so the response is
    identical on a hit or a miss and is written before any send happens."""
    wanted = body.email.strip().lower()
    rows = dc.list_entities(tenant_id, "workflow_instance", "")
    for row in rows:
        if str(row.get("applicant_email", "")).strip().lower() != wanted:
            continue
        if row.get("closed_at"):
            continue  # terminal/cancelled instances are not resendable
        background_tasks.add_task(_send_magic_link, tenant_id, row)
    return {}


# --- instance-by-token ---------------------------------------------------


@router.get("/internal/instance-by-token/{token}")
def instance_by_token(token: str):
    tenant_id, instance_row = resolve_token(token)
    ctx = machine.build_eval_context(tenant_id, instance_row, actor=_family_actor(instance_row))
    return {
        "instance": instance_row,
        "items": ctx.items,
        "definition": {
            "definition_id": ctx.definition["definition_id"],
            "version": ctx.definition["version"],
            "machine": ctx.definition["machine"].model_dump(by_alias=True),
            "steps": [s.model_dump(by_alias=True) for s in ctx.definition["steps"]],
        },
    }


@router.post("/internal/instance-by-token/{token}/actions")
def action_by_token(token: str, body: InternalActionRequest):
    tenant_id, instance_row = resolve_token(token)
    if body.action in BLOCKED_TOKEN_ACTIONS:
        raise HTTPException(403, f"Action '{body.action}' is not permitted on the family channel")

    ctx = machine.build_eval_context(tenant_id, instance_row, actor=_family_actor(instance_row))
    params = body.model_dump(exclude={"action"})
    updated_instance = machine.execute_action(ctx, body.action, params)

    response = {"instance": updated_instance}
    if ctx.item_result is not None:
        response["item"] = ctx.item_result
    return response


@router.get("/internal/instance-by-token/{token}/documents")
def documents_by_token(token: str):
    tenant_id, instance_row = resolve_token(token)
    eid = instance_row["entity_id"]
    own_tag = _family_actor(instance_row)
    docs = dc.list_entities(tenant_id, "document", f"application_id = {dc.sql_literal(eid)}")
    visible = [d for d in docs
               if d.get("uploaded_by") == own_tag or not as_bool(d.get("sensitive"))]
    return {"documents": [{
        "entity_id": d["entity_id"],
        "document_id": d.get("document_id", ""),
        "filename": d.get("filename", ""),
        "uploaded_by": d.get("uploaded_by", ""),
        "item_id": d.get("item_id", ""),
    } for d in visible]}


# --- token-scoped document blob proxy (new relative to enrollx -- see
# module docstring's error-relay section) ------------------------------------


def _blob_request(method: str, path: str, json_body: dict | None = None) -> httpx.Response:
    """Direct httpx call to DataCore's blob API. Local duplicate of
    `app.api.documents._dc_request` (no shared import -- this module and
    `api/documents.py` are Task 10's two independent proxy surfaces, family
    vs. staff, each with its own error-relay policy per the module
    docstring; see primitives.py's own precedent for local-duplicate-over-
    cross-import reasoning elsewhere in this codebase)."""
    try:
        return httpx.request(
            method, f"{settings.datacore_url}{path}",
            json=json_body, headers={"Content-Type": "application/json"}, timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(502, "DataCore is unreachable")


@router.post("/internal/instance-by-token/{token}/documents", status_code=201)
def create_document_by_token(token: str, body: TokenCreateDocumentRequest):
    """Presign an upload slot for this token's instance. `uploaded_by` is
    DERIVED from the verified token (`family:{instance_entity_id}`) -- never
    read from the client body, which has no such field to read."""
    tenant_id, instance_row = resolve_token(token)
    eid = instance_row["entity_id"]
    resp = _blob_request("POST", f"/api/documents/{tenant_id}", {
        "application_id": eid,  # DataCore's own fixed field name; see module docstring
        "item_id": body.item_id,
        "filename": body.filename,
        "content_type": body.content_type,
        "size": body.size,
        "sensitive": body.sensitive,
        "uploaded_by": _family_actor(instance_row),
    })
    if resp.status_code not in (200, 201):
        logger.warning("DataCore document create failed (%s): %s",
                       resp.status_code, getattr(resp, "text", ""))
        raise HTTPException(502, "Could not start the upload. Please try again.")
    return resp.json()


@router.get("/internal/instance-by-token/{token}/documents/{document_id}/url")
def document_url_by_token(token: str, document_id: str):
    """Presign a download URL -- own uploads, or non-sensitive documents of
    this instance, only. Sensitive docs are gated to their own uploader
    (parent-upload visibility rule unchanged from registration).

    INTENTIONAL GENERALIZATION (coordinator review, noted explicitly):
    familyhub's PRE-Task-10 `get_document_url` only ever allowed a parent to
    download a document THEY uploaded, full stop -- it had no
    sensitivity-based exception for download the way the LISTING route
    always did. This route instead reuses the listing route's rule
    (own-tag OR non-sensitive) for download too, so a non-sensitive document
    someone else uploaded to this SAME instance (e.g. a staff-uploaded,
    non-sensitive acknowledgment doc) is now downloadable, not just
    listable. Scope is still instance-scoped (`application_id = eid` above)
    -- this never widens ACROSS instances, only across uploaders within one."""
    tenant_id, instance_row = resolve_token(token)
    eid = instance_row["entity_id"]
    own_tag = _family_actor(instance_row)

    docs = dc.list_entities(tenant_id, "document", f"application_id = {dc.sql_literal(eid)}")
    match = next(
        (d for d in docs if d.get("document_id") == document_id or d.get("entity_id") == document_id),
        None,
    )
    if match is None:
        raise HTTPException(404, "No such document on this instance")
    if match.get("uploaded_by") != own_tag and as_bool(match.get("sensitive")):
        raise HTTPException(403, "Not permitted to view this document")

    resolved_id = str(match.get("document_id") or match.get("entity_id") or "")
    resp = _blob_request("GET", f"/api/documents/{tenant_id}/{resolved_id}/url")
    if resp.status_code != 200:
        logger.warning("DataCore document url failed (%s): %s",
                       resp.status_code, getattr(resp, "text", ""))
        raise HTTPException(502, "That document is not available right now.")
    return resp.json()
