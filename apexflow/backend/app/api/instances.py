# apexflow/backend/app/api/instances.py
"""Instances API routes (Task 6 creation route; Task 8 action route).

`POST /api/workflows/{tenant_id}/definitions/{definition_id}/instances`
(Task 6). `POST /api/workflows/{tenant_id}/instances/{instance_entity_id}
/actions` (Task 8) — the single action endpoint: item-level operations
(`save_draft`, `complete_item`, `verify_item`, `reject_item`, `waive_item`),
`cancel_instance`, and machine transitions all dispatch through
`app.workflows.machine.execute_action`. This module is HTTP wiring only; all
business logic lives in app.workflows.engine / app.workflows.machine.

DECISION (task-6-brief.md): the brief's own Produces line writes the route as
`.../definitions/{entity_id}/instances`, then immediately asks "is that the
published ROW's entity_id, or the LINEAGE's business definition_id?" and
answers itself: the path segment is the lineage's `definition_id` (stable
across a lineage's draft/published/superseded versions), NOT a DataCore row
`entity_id`. A caller creating an instance knows "the enrollment workflow"
(the lineage) — not which numbered version happens to be currently
published, which is exactly what `engine.create_instance` ->
`get_published_definition` resolves internally. The path param is named
`definition_id` here (not `entity_id`) to make that concrete, even though it
occupies the same URL position as app/api/definitions.py's `{entity_id}`
(which DOES address one specific row — a different resource, deliberately
disambiguated by param name here since the two are easy to conflate, per the
interface map's identifier-trap gotcha).

DECISION (Task 8): the actions route's `{instance_entity_id}` path param
genuinely IS a DataCore `entity_id` (unlike the creation route's lineage
`definition_id` above) — `workflow_instance` rows have no separate
lineage-vs-row identity split the way `workflow_definition` rows do (Task 6's
`create_instance` already returns/looks instances up by `entity_id`
throughout). `actor = user.get("user_id", "staff")` follows the enrollx
precedent (`enrollx/backend/app/api/registration.py`, interface map §2) for
deriving a staff actor string from the auth dependency's return shape.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from app.auth import require_staff_tenant
from app.workflows import datacore as dc
from app.workflows import engine
from app.workflows import machine

router = APIRouter(prefix="/api/workflows")


class CreateInstanceRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    context: dict = {}
    channel: Literal["staff", "family"]
    applicant_email: str | None = None


@router.post("/{tenant_id}/definitions/{definition_id}/instances", status_code=201)
def create_instance_route(tenant_id: str, definition_id: str, body: CreateInstanceRequest,
                          user: dict = Depends(require_staff_tenant)):
    """Create a workflow_instance (+ derived items) for the published version
    of the `definition_id` lineage. See module docstring for why the path
    param is the lineage id, not a row entity_id.

    Staff-authenticated (`require_staff_tenant`) even for `channel: "family"`
    — this is the staff-assisted entry path (spec §6 "AdminDash tracking":
    "staff-assisted entry mounts flow-runtime in staff mode"). The
    unauthenticated family self-serve path is Task 10's internal/token-scoped
    `/internal/workflows/{tenant_id}/{definition_id}/start` route.

    DECISION (Task 8, code-review follow-up): `engine.create_instance` never
    ran system auto-advance — a machine whose INITIAL state already
    satisfies a `system` transition's guard (e.g. a `data_condition` on a
    creation-time `context` value) would sit un-advanced until the first
    item mutation triggered `run_system_transitions` from inside
    `execute_action`. `engine.py` cannot fix this itself without an
    `engine.py -> machine.py` import (machine.py already imports engine.py
    for the item built-ins — a reverse import would cycle), so this route
    does it: re-fetch the FLATTENED instance row `engine.create_instance`'s
    own envelope-shaped return can't be fed straight into
    `machine.build_eval_context` (see engine.py's row-shape convention
    note), build a `ctx`, and run `run_system_transitions` once before
    responding. `result["instance"]` is replaced with `ctx.instance` (the
    flattened, possibly-advanced row) — this deliberately changes the
    response's `"instance"` shape from the create envelope
    (`{"entity_id", "entity_type", "base_data": {...}}`) to the same
    flattened shape the actions route (`instance_action_route`, below)
    already returns, for one consistent contract across both routes.
    `"items"` is serialized from `ctx.items` (`WorkflowItem`), so this route
    and `/internal/instance-by-token` return the same narrow item contract
    rather than two shapes — the create envelope this used to echo carried a
    nested `base_data` the token route never emitted.
    """
    token = user.get("_token")
    actor = user.get("user_id", "staff")
    result = engine.create_instance(
        tenant_id, definition_id, body.context, body.channel,
        applicant_email=body.applicant_email, token=token,
    )

    instance_entity_id = result["instance"]["entity_id"]
    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_entity_id, token)
    ctx = machine.build_eval_context(tenant_id, instance_row, actor=actor, token=token)
    machine.run_system_transitions(ctx)
    result["instance"] = ctx.instance
    # `engine.create_instance` returns dc_create ENVELOPES for items; `ctx`
    # already holds the same rows parsed as `WorkflowItem` (and refreshed if
    # a system transition mutated one), so respond with the same narrow item
    # contract `/internal/instance-by-token` serves.
    result["items"] = [i.model_dump(by_alias=True) for i in ctx.items]
    return result


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


@router.post("/{tenant_id}/instances/{instance_entity_id}/actions")
def instance_action_route(tenant_id: str, instance_entity_id: str, body: ActionRequest,
                          user: dict = Depends(require_staff_tenant)):
    """The single action endpoint (Task 8): `{"action": name, ...params}` ->
    `200 {"instance": row}`, plus `"item"` when an item built-in other than
    `save_draft` ran (`ctx.item_result`, `app.workflows.primitives.
    EvalContext`'s side channel — see machine.py's module docstring,
    decision 6).

    Staff-authenticated even for a family-permitted action (`actor:
    "family"` transitions, `save_draft`/`complete_item`) — this is the
    staff-facing surface (AdminDash staff-assisted entry). The
    unauthenticated family/token-scoped surface is Task 10's internal
    `/internal/instance-by-token/{token}/actions` route, which will call
    `app.workflows.machine.execute_action` the same way with `actor`
    derived from the verified token instead of the JWT.
    """
    token = user.get("_token")
    actor = user.get("user_id", "staff")

    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_entity_id, token)
    if instance_row is None:
        raise HTTPException(404, "workflow_instance not found")

    ctx = machine.build_eval_context(tenant_id, instance_row, actor=actor, token=token)
    params = body.model_dump(exclude={"action"})
    updated_instance = machine.execute_action(ctx, body.action, params)

    response = {"instance": updated_instance}
    if ctx.item_result is not None:
        response["item"] = ctx.item_result
    return response


@router.get("/{tenant_id}/definitions/{definition_id}/instances")
def list_lineage_instances_route(tenant_id: str, definition_id: str,
                                 user: dict = Depends(require_staff_tenant)):
    """Every work item of one lineage — open AND closed, including frozen.

    Backs AdminDash's work-item management surface. Deliberately wider than the
    pipeline board's own query, which is open-only: an administrator managing a
    workflow needs to reach the closed and the frozen ones too.

    Lineage matching is done in Python rather than a SQL `where` for the same
    reason `definitions.get_published_definition` does it: on a tenant whose
    table has not materialized every column yet, a `where` predicate naming an
    unmaterialized column is a DuckDB binder error (400), not an empty result.
    `frozen_at` is exactly such a column on any tenant predating this feature,
    so it is read with `.get(..., "")` and never filtered on server-side.
    """
    token = user.get("_token")
    rows = dc.list_entities(tenant_id, "workflow_instance", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(definition_id)]
    return {"instances": [{
        "entity_id": r.get("entity_id"),
        "instance_id": r.get("instance_id", ""),
        "state": r.get("state", ""),
        "definition_version": r.get("definition_version", ""),
        "channel_started": r.get("channel_started", ""),
        "applicant_email": r.get("applicant_email", "") or "",
        "opened_at": r.get("opened_at", "") or "",
        "closed_at": r.get("closed_at", "") or "",
        "frozen_at": r.get("frozen_at", "") or "",
    } for r in rows]}


@router.get("/{tenant_id}/instances/{instance_entity_id}/allowed-actions")
def allowed_actions_route(tenant_id: str, instance_entity_id: str,
                          user: dict = Depends(require_staff_tenant)):
    """Plan 3 Task 3: the same `allowed` list `instance_action_route`'s 409
    advertises, exposed as its own read — AdminDash tracking (and the
    family token-bundle route's `"allowed"` field, `app/api/internal.py`)
    consume this to render available actions without provoking a failed
    action first. Actor = the calling staff user, same derivation as
    `instance_action_route` above."""
    token = user.get("_token")
    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_entity_id, token)
    if instance_row is None:
        raise HTTPException(404, "workflow_instance not found")

    ctx = machine.build_eval_context(tenant_id, instance_row,
                                     actor=user.get("user_id", "staff"), token=token)
    return {"state": ctx.instance.get("state"), "allowed": machine.allowed_actions(ctx)}
