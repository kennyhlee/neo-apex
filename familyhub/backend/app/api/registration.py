# familyhub/backend/app/api/registration.py
"""Public registration facade routes.

No credential at all on these two routes -- the config bundle is public
data, and start creates a draft workflow_instance + issues the magic link.
start is rate limited per IP because it sends email and creates a row per
hit.

Task 10: retargeted from enrollx's `/internal/registration/{tenant_id}/*` to
apexflow's `/internal/workflows/{tenant_id}/{definition_id}/*` (interface
map §7, task-10-brief.md's familyhub retarget). Registration is now scoped
by BOTH tenant_id AND a `definition_id` lineage id (spec §6's route shape,
`/w/{tenant_id}/{definition_id}`) -- apexflow's workflow platform is
multi-definition per tenant, unlike enrollx's one-registration-per-school
model.

Response reshaping (deliberately minimal, per task-10-brief.md: "response
reshaping minimal"): apexflow's config/start responses use a fundamentally
different content model (`machine`/`steps`/sections) than enrollx's
`registration_config.blocks` (`FlowBlock[]`) that `@neoapex/flow-runtime`'s
`FlowRenderer` renders. There is no steps/sections -> blocks compiler yet
(that bridge is explicitly out of scope -- task-10-brief.md: "deeper
generalization is Phase 3"), so `_config_bundle_from_apexflow` below keeps
the WIRE CONTRACT shape (`{config: {config_id, version, status, blocks}, ...}`)
stable for the frontend but ships `blocks: []` until that compiler exists.
`tenant`/`capacity` reshape losslessly (apexflow's shapes already match).

Upstream-error policy (applies to every route in this module): 4xx from
apexflow is passed through verbatim (parent-safe, e.g. "no published
workflow_definition" -> 404). 5xx (or anything else >= 500) is NEVER passed
through -- masked to a fixed, non-diagnostic 502 via `app.relay`.
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.ratelimit import limit_start
from app.relay import relay as _relay
from app.relay import upstream_unavailable
from app.upstream import apexflow, apexflow_headers, call_upstream

router = APIRouter()


def _config_bundle_from_apexflow(data: dict) -> dict:
    definition = data.get("definition") if isinstance(data.get("definition"), dict) else {}
    return {
        "config": {
            "config_id": definition.get("definition_id", ""),
            "version": definition.get("version", 1),
            "status": "published",
            # Placeholder pending the steps/sections -> FlowBlock[] compiler
            # (Phase 3, see module docstring). Keeps the wire contract stable
            # in the meantime -- real form rendering needs that compiler.
            "blocks": [],
        },
        "tenant": data.get("tenant") or {},
        "capacity": data.get("capacity") or {"capacity": None, "admitted": 0, "full": False},
    }


@router.get("/registration/{tenant_id}/{definition_id}")
def get_registration_bundle(tenant_id: str, definition_id: str) -> Response:
    """The public config bundle: `{config, tenant, capacity}` -- see module
    docstring for the reshaping this performs."""
    resp = call_upstream(
        "GET",
        apexflow(f"/internal/workflows/{tenant_id}/{definition_id}/config"),
        headers=apexflow_headers(),
    )
    if resp.status_code >= 400:
        return _relay(resp)
    try:
        data = resp.json()
    except ValueError:
        return upstream_unavailable()
    if not isinstance(data, dict):
        return upstream_unavailable()
    return JSONResponse(_config_bundle_from_apexflow(data), status_code=200)


class StartBody(BaseModel):
    applicant_email: str

    @field_validator("applicant_email")
    @classmethod
    def basic_email_shape(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 6 or "@" not in v or "." not in v.rsplit("@", 1)[-1]:
            raise ValueError("invalid email address")
        return v


def _today() -> datetime.date:
    """Indirection point so tests can pin "today" without monkeypatching the
    stdlib `datetime.date` type directly."""
    return datetime.date.today()


def _school_year_for_date(ref: datetime.date) -> str:
    """Academic year straddling `ref`, rolling over each July --
    `${y}-${y+1}` where `y` is `ref`'s year if `ref.month >= 7` else
    `ref.year - 1`. Threaded into apexflow's `start` body as
    `context.school_year` -- apexflow's `capacity_available` guard
    (enrollment template) scopes on exactly this context key. All three
    channels (this rule, flow-runtime's `defaultSchoolYear()`, apexflow's
    enrollment template) must agree.
    """
    start_year = ref.year if ref.month >= 7 else ref.year - 1
    return f"{start_year}-{start_year + 1}"


def _application_view_from_instance(instance: dict) -> dict:
    """Minimal reshape (module docstring): apexflow's instance row uses
    `state`, the old wire contract (and flow-runtime's `ApplicationStatus`)
    used `status` -- the two vocabularies happen to be IDENTICAL string sets
    (apexflow's enrollment template was modeled on enrollx's own status
    lifecycle), so this is a pure rename, not a translation. Every other
    field is passed through unchanged (already a flattened row, which
    `EntityRecord`/`entityData()` on the frontend already tolerates)."""
    view = dict(instance)
    if "state" in view:
        view["status"] = view["state"]
    return view


@router.post(
    "/registration/{tenant_id}/{definition_id}/start",
    dependencies=[Depends(limit_start)],
)
def start_registration(tenant_id: str, definition_id: str, body: StartBody) -> Response:
    resp = call_upstream(
        "POST",
        apexflow(f"/internal/workflows/{tenant_id}/{definition_id}/start"),
        json_body={
            "context": {"school_year": _school_year_for_date(_today())},
            "applicant_email": body.applicant_email,
        },
        headers=apexflow_headers(),
    )
    if resp.status_code >= 400:
        return _relay(resp)
    try:
        data = resp.json()
    except ValueError:
        return upstream_unavailable()
    token = data.get("token")
    if not token:
        # Latent defense only -- confirmed correct today (apexflow's
        # internal.py always sets "token"). Silently building "/application/"
        # would hand the parent a broken link if it ever didn't.
        raise HTTPException(502, "Upstream did not return a magic-link token")
    body_out = {
        "application": _application_view_from_instance(data.get("instance") or {}),
        "items": data.get("items") or [],
        "token": token,
        "link": data.get("link", ""),
        "hub_url": f"/application/{token}",
    }
    return JSONResponse(body_out, status_code=resp.status_code)
