"""Lead-management routes — proxy to DataCore with lead-specific business rules."""
import json
import re
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict

from app.auth import require_authenticated_user
from app.config import settings

router = APIRouter()

DEFAULT_STAGES = ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]
ACTIVITY_TYPES = {"call", "email", "note"}


# ── DataCore client helpers (sync httpx so respx intercepts) ──────────────
def _dc(method: str, path: str, token: str | None, json_body: dict | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    try:
        resp = httpx.request(
            method, f"{settings.datacore_url}{path}",
            json=json_body, headers=headers, timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "DataCore is unreachable")
    return resp


def _dc_create(tenant: str, entity_type: str, base_data: dict, token: str | None) -> dict:
    resp = _dc("POST", f"/api/entities/{tenant}/{entity_type}", token,
               {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore create failed: {resp.text}")
    return resp.json()


def _dc_update(tenant: str, entity_type: str, entity_id: str, base_data: dict, token: str | None) -> dict:
    resp = _dc("PUT", f"/api/entities/{tenant}/{entity_type}/{entity_id}", token,
               {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore update failed: {resp.text}")
    return resp.json()


def _dc_query(tenant: str, sql: str, token: str | None, table: str = "entities") -> list[dict]:
    resp = _dc("POST", "/api/query", token,
               {"tenant_id": tenant, "table": table, "sql": sql})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore query failed: {resp.text}")
    return resp.json().get("data", [])


# ── Model-driven stage helpers ────────────────────────────────────────────
def _lead_model(tenant: str, token: str | None) -> dict | None:
    """Return the lead entity's model definition {base_fields, custom_fields} or None."""
    rows = _dc_query(
        tenant,
        "SELECT * FROM data WHERE entity_type = 'lead' AND _status = 'active'",
        token, table="models",
    )
    if not rows:
        return None
    try:
        md = rows[0]["model_definition"]
        if isinstance(md, str):
            md = json.loads(md)
        if isinstance(md, dict) and "lead" in md:
            return md["lead"]
        return md
    except Exception:
        return None


def _stage_options(tenant: str, token: str | None) -> list[str]:
    """Stage options from the lead model's `stage` selection field, else DEFAULT_STAGES."""
    model = _lead_model(tenant, token)
    if model:
        fields = model.get("base_fields", []) + model.get("custom_fields", [])
        for f in fields:
            if f.get("name") == "stage" and f.get("options"):
                return f["options"]
    return DEFAULT_STAGES


def _get_lead(tenant: str, lead_id: str, token: str | None) -> dict | None:
    rows = _dc_query(
        tenant,
        f"SELECT * FROM data WHERE entity_type = 'lead' "
        f"AND entity_id = '{lead_id}' AND _status = 'active'",
        token,
    )
    return rows[0] if rows else None


def _tenant_exists(tenant: str) -> bool:
    rows = _dc_query(
        tenant,
        f"SELECT entity_id FROM data WHERE entity_type = 'tenant' "
        f"AND entity_id = '{tenant}' AND _status = 'active'",
        None,
    )
    return bool(rows)


# ── Schemas ───────────────────────────────────────────────────────────────
class LeadCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    guardian_name: str | None = None
    email: str | None = None
    phone: str | None = None
    student_first_name: str | None = None
    student_last_name: str | None = None
    grade_of_interest: str | None = None
    message: str | None = None
    source: str | None = None


class PublicLeadCreate(BaseModel):
    """Prospect-facing fields — reserved internal keys are stripped in the route."""
    model_config = ConfigDict(extra="allow")

    guardian_name: str | None = None
    email: str | None = None
    phone: str | None = None
    student_first_name: str | None = None
    student_last_name: str | None = None
    grade_of_interest: str | None = None
    message: str | None = None


class StageUpdate(BaseModel):
    stage: str


class ActivityCreate(BaseModel):
    type: str
    body: str


class ConvertRequest(BaseModel):
    family_name: str
    primary_address: str
    primary_email: str | None = None
    primary_phone: str | None = None
    student_first_name: str
    student_last_name: str
    grade_level: str | None = None
    target_stage: str | None = None


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("/public/leads/{tenant_id}", status_code=201)
def public_intake(tenant_id: str, body: PublicLeadCreate):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", tenant_id):
        raise HTTPException(404, "Unknown tenant")
    if not _tenant_exists(tenant_id):
        raise HTTPException(404, "Unknown tenant")
    base = body.model_dump(exclude_none=True)
    # Strip reserved internal keys — a prospect must not set these.
    for k in ("stage", "source", "converted_family_id", "lead_id"):
        base.pop(k, None)
    base.update({"source": "web_form", "stage": _stage_options(tenant_id, None)[0]})
    return _dc_create(tenant_id, "lead", base, None)


@router.post("/leads/{tenant_id}", status_code=201)
def create_lead(tenant_id: str, body: LeadCreate, user=Depends(require_authenticated_user)):
    base = body.model_dump(exclude_none=True, exclude={"source"})
    src = body.source if body.source in ("manual", "email_import") else "manual"
    base["source"] = src
    base["stage"] = _stage_options(tenant_id, user["_token"])[0]
    return _dc_create(tenant_id, "lead", base, user["_token"])


@router.get("/leads/{tenant_id}")
def list_leads(tenant_id: str, stage: str | None = None, user=Depends(require_authenticated_user)):
    where = "entity_type = 'lead' AND _status = 'active'"
    if stage:
        if stage not in _stage_options(tenant_id, user["_token"]):
            raise HTTPException(400, f"Unknown stage: {stage}")
        where += f" AND stage = '{stage}'"
    rows = _dc_query(tenant_id, f"SELECT * FROM data WHERE {where}", user["_token"])
    return {"leads": rows}


@router.get("/leads/{tenant_id}/{lead_id}")
def get_lead(tenant_id: str, lead_id: str, user=Depends(require_authenticated_user)):
    lead = _get_lead(tenant_id, lead_id, user["_token"])
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


# Preserve ALL lead fields (base + custom) from a flattened entity row, dropping
# only system/metadata columns — stage/convert PUTs REPLACE base_data, so anything
# omitted here is lost.
_SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector"}


def _lead_base_data(row: dict) -> dict:
    return {k: v for k, v in row.items()
            if k not in _SYSTEM_COLS and not k.startswith("_") and v is not None}


def _log_stage_change(tenant: str, lead_id: str, frm: str, to: str, token: str | None):
    _dc_create(tenant, "lead_activity", {
        "lead_id": lead_id, "type": "stage_change", "body": f"{frm} → {to}",
        "stage_from": frm, "stage_to": to, "created_by": "system",
    }, token)


@router.post("/leads/{tenant_id}/{lead_id}/activities", status_code=201)
def add_activity(tenant_id: str, lead_id: str, body: ActivityCreate,
                 user=Depends(require_authenticated_user)):
    if body.type not in ACTIVITY_TYPES:
        raise HTTPException(400, f"Unknown activity type: {body.type}")
    return _dc_create(tenant_id, "lead_activity", {
        "lead_id": lead_id, "type": body.type, "body": body.body,
        "created_by": user.get("id", "unknown"),
    }, user["_token"])


@router.post("/leads/{tenant_id}/{lead_id}/convert", status_code=201)
def convert_lead(tenant_id: str, lead_id: str, body: ConvertRequest,
                 user=Depends(require_authenticated_user)):
    token = user["_token"]
    lead = _get_lead(tenant_id, lead_id, token)
    if not lead:
        raise HTTPException(404, "Lead not found")
    if lead.get("converted_family_id"):
        raise HTTPException(409, f"Lead already converted to family {lead['converted_family_id']}")

    family = _dc_create(tenant_id, "family", {
        "family_name": body.family_name,
        "primary_address": body.primary_address,
        "primary_email": body.primary_email or lead.get("email"),
        "primary_phone": body.primary_phone or lead.get("phone"),
    }, token)
    family_id = family["entity_id"]

    student_base = {
        "first_name": body.student_first_name,
        "last_name": body.student_last_name,
        "family_id": family_id,
        "primary_address": body.primary_address,
        "status": "Enrolled",
    }
    if body.grade_level:
        student_base["grade_level"] = body.grade_level
    student = _dc_create(tenant_id, "student", student_base, token)

    base = _lead_base_data(lead)
    base["converted_family_id"] = family_id
    opts = _stage_options(tenant_id, token)
    if body.target_stage is not None and body.target_stage not in opts:
        raise HTTPException(400, f"Unknown target stage: {body.target_stage}")
    target = body.target_stage or opts[-1]
    prev_stage = base.get("stage")
    base["stage"] = target
    _dc_update(tenant_id, "lead", lead_id, base, token)
    if prev_stage != target:
        _log_stage_change(tenant_id, lead_id, prev_stage, target, token)

    return {"family_id": family_id, "student_id": student["entity_id"], "lead_id": lead_id}


@router.get("/leads/{tenant_id}/{lead_id}/activities")
def list_activities(tenant_id: str, lead_id: str, user=Depends(require_authenticated_user)):
    rows = _dc_query(
        tenant_id,
        f"SELECT * FROM data WHERE entity_type = 'lead_activity' "
        f"AND lead_id = '{lead_id}' AND _status = 'active' ORDER BY _created_at DESC",
        user["_token"])
    return {"activities": rows}


@router.patch("/leads/{tenant_id}/{lead_id}/stage")
def update_stage(tenant_id: str, lead_id: str, body: StageUpdate,
                 user=Depends(require_authenticated_user)):
    if body.stage not in _stage_options(tenant_id, user["_token"]):
        raise HTTPException(400, f"Unknown stage: {body.stage}")
    lead = _get_lead(tenant_id, lead_id, user["_token"])
    if not lead:
        raise HTTPException(404, "Lead not found")
    current = lead.get("stage", "New")
    base = _lead_base_data(lead)
    base["stage"] = body.stage
    updated = _dc_update(tenant_id, "lead", lead_id, base, user["_token"])
    if body.stage != current:
        _log_stage_change(tenant_id, lead_id, current, body.stage, user["_token"])
    return updated
