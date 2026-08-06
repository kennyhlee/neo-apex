# apexflow/backend/app/api/instances.py
"""Instances API routes (Task 6): instance creation.

Single route this task adds: `POST
/api/workflows/{tenant_id}/definitions/{definition_id}/instances`. Item-level
operations (`save_draft`, `complete_item`, `verify_item`, `reject_item`,
`waive_item`) get NO routes here — Task 8's single action endpoint
(`POST /api/workflows/{tenant_id}/instances/{entity_id}/actions`) dispatches
to them as built-ins, alongside machine transitions. This module is HTTP
wiring only; all business logic lives in app.workflows.engine.

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
"""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app.auth import require_staff_tenant
from app.workflows import engine

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
    """
    token = user.get("_token")
    return engine.create_instance(
        tenant_id, definition_id, body.context, body.channel,
        applicant_email=body.applicant_email, token=token,
    )
