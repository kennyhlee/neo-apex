"""Tenant profile and onboarding status endpoints."""
import json
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.api.auth import get_current_user, require_role
from app.config import settings
from app.model_merge import merge_model_definition

router = APIRouter()


def _datacore_url(path: str) -> str:
    return f"{settings.datacore_api_url}{path}"


def _registry_url(path: str) -> str:
    return f"{settings.datacore_api_url}/registry{path}"


@router.get("/tenants/{tenant_id}")
def get_tenant_profile(tenant_id: str, user=Depends(require_role("admin", "staff"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "tenants",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch tenant")
    rows = resp.json().get("data", [])
    if not rows:
        return {"tenant_id": tenant_id, "name": user["tenant_name"]}
    row = rows[0]
    skip_keys = {"_status", "_version", "_created_at", "_updated_at", "_change_id",
                  "entity_type", "entity_id", "base_data", "custom_fields", "vector"}
    data = {k: v for k, v in row.items()
            if k not in skip_keys and v is not None and not k.startswith("_")}
    data["tenant_id"] = tenant_id
    # name is immutable post-creation and may be absent/None on the stored
    # entity; fall back to the JWT's tenant_name so the field is never blank.
    if not data.get("name"):
        data["name"] = user["tenant_name"]
    return data


@router.put("/tenants/{tenant_id}")
def update_tenant_profile(tenant_id: str, body: dict, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    body.pop("name", None)
    body.pop("tenant_id", None)

    existing_resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "tenants",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    result = existing_resp.json()
    if existing_resp.status_code == 200 and result.get("data"):
        existing = result["data"][0]
        # Only keep fields that have real values — strip internal metadata,
        # encoded columns, vectors, and null fields from the flattened row
        skip_keys = {"_status", "_version", "_created_at", "_updated_at", "_change_id",
                      "entity_type", "entity_id", "base_data", "custom_fields", "vector"}
        base_data = {k: v for k, v in existing.items()
                     if k not in skip_keys and v is not None and not k.startswith("_")}
        base_data.update(body)
    else:
        base_data = {"tenant_id": tenant_id, **body}

    resp = httpx.put(
        _datacore_url(f"/tenants/{tenant_id}"),
        json={"base_data": base_data},
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Failed to update tenant")
    return {**base_data, "tenant_id": tenant_id}


@router.get("/tenants/{tenant_id}/model")
def get_model(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    md = rows[0].get("model_definition")
    return json.loads(md) if isinstance(md, str) else md


@router.get("/tenants/{tenant_id}/model/entities")
def get_model_entities(tenant_id: str, user=Depends(get_current_user)):
    """Return every entity in the tenant's model as {entity_type: {base_fields, custom_fields}}."""
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    entities: dict = {}
    for row in resp.json().get("data", []):
        et = row.get("entity_type")
        md = row.get("model_definition")
        if isinstance(md, str):
            try:
                md = json.loads(md)
            except (ValueError, TypeError):
                continue
        if not isinstance(md, dict) or not et:
            continue
        entities[et] = {
            "base_fields": md.get("base_fields", []),
            "custom_fields": md.get("custom_fields", []),
        }
    return {"entities": entities}


@router.get("/tenants/{tenant_id}/model/info")
def get_model_info(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    model = rows[0]
    return {
        "model_definition": json.loads(model["model_definition"]) if isinstance(model.get("model_definition"), str) else model.get("model_definition"),
        "version": model.get("_version"),
        "change_id": model.get("_change_id"),
        "created_at": model.get("_created_at"),
        "updated_at": model.get("_updated_at"),
    }


BASE_MODEL_PATH = Path(__file__).parent.parent / "data" / "base_model.json"


@router.post("/tenants/{tenant_id}/model/use-default")
def use_default_model(tenant_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    base_model = json.loads(BASE_MODEL_PATH.read_text())

    resp = httpx.put(
        _datacore_url(f"/models/{tenant_id}"),
        json={
            "model_definition": base_model,
            "source_filename": "base_model.json",
            "created_by": user["name"],
        },
        timeout=30.0,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to store model")

    httpx.post(
        _registry_url(f"/onboarding/{tenant_id}/complete-step"),
        json={"step_id": "model_setup"},
    )

    return base_model


class SyncDefaultsRequest(BaseModel):
    force: bool = False


def _normalize_fields(fields: list[dict]) -> list[dict]:
    return sorted(fields, key=lambda f: f["name"])


@router.post("/tenants/{tenant_id}/model/sync-defaults")
def sync_default_model(tenant_id: str, body: SyncDefaultsRequest | None = None,
                       user=Depends(require_role("admin")),
                       authorization: str = Header(...)):
    """Field-level, non-destructive sync of base_model.json into the tenant's
    models. Missing entity types are added whole. Existing types get the
    current base fields merged in (model_merge.merge_model_definition: base
    fields win, custom fields preserved, carried-forward required-no-default
    fields demoted). Only types whose merged definition differs are written,
    in one PUT. Before writing, apexflow's model-preflight is asked whether
    any published workflow would become stale/broken; see design D3/D4 and
    the base-model rule in the root CLAUDE.md.
    """
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    force = bool(body and body.force)
    base_model = json.loads(BASE_MODEL_PATH.read_text())

    resp = httpx.post(_datacore_url("/query"), json={
        "tenant_id": tenant_id, "table": "models",
        "sql": "SELECT entity_type, model_definition FROM data WHERE _status = 'active'",
    })
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    existing: dict[str, dict] = {}
    for r in resp.json().get("data", []):
        md = r.get("model_definition")
        if isinstance(md, str):
            md = json.loads(md)
        existing[r["entity_type"]] = md or {}

    to_write: dict[str, dict] = {}
    added_entities: list[str] = []
    changed: dict[str, dict] = {}
    for et, base_def in base_model.items():
        if et not in existing:
            to_write[et] = base_def
            added_entities.append(et)
            continue
        cur = existing[et]
        cur_base = cur.get("base_fields", []) or []
        cur_custom = cur.get("custom_fields", []) or []
        merged = merge_model_definition(base_def.get("base_fields", []), cur_base + cur_custom)
        if (_normalize_fields(merged["base_fields"]) == _normalize_fields(cur_base)
                and _normalize_fields(merged["custom_fields"]) == _normalize_fields(cur_custom)):
            continue
        before_names = {f["name"] for f in cur_base + cur_custom}
        added_fields = sorted(f["name"] for f in merged["base_fields"] if f["name"] not in before_names)
        required_before = {f["name"] for f in cur_base + cur_custom if f.get("required")}
        demoted = sorted(f["name"] for f in merged["custom_fields"]
                         if f["name"] in required_before and not f.get("required"))
        to_write[et] = merged
        changed[et] = {"added_fields": added_fields, "demoted_fields": demoted}

    report = {"added_entities": sorted(added_entities), "changed": changed, "workflows_at_risk": []}
    if not to_write:
        return report

    try:
        pf = httpx.post(
            f"{settings.apexflow_backend_url}/api/workflows/{tenant_id}/model-preflight",
            json={"models": to_write},
            headers={"Authorization": authorization},
            timeout=30.0,
        )
        pf_ok = pf.status_code == 200
    except httpx.HTTPError:
        pf_ok = False
    if pf_ok:
        rank = {"current": 0, "stale": 1, "broken": 2}
        report["workflows_at_risk"] = [
            d for d in pf.json().get("definitions", [])
            if rank.get(d.get("health_after"), 2) > rank.get(d.get("health_before"), 2)
        ]
        if report["workflows_at_risk"] and not force:
            raise HTTPException(status_code=409, detail={"reason": "workflows_at_risk", **report})
    else:
        if not force:
            raise HTTPException(status_code=502, detail={"reason": "preflight_unavailable", **report})
        report["preflight"] = "unavailable"

    put_resp = httpx.put(_datacore_url(f"/models/{tenant_id}"), json={
        "model_definition": to_write,
        "source_filename": "base_model.json",
        "created_by": user["name"],
    }, timeout=30.0)
    if put_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to sync model")
    return report


@router.get("/tenants/{tenant_id}/onboarding-status")
def get_onboarding_status(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_registry_url(f"/onboarding/{tenant_id}"))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch onboarding")
    return resp.json()


class MarkStepRequest(BaseModel):
    step_id: str
    completed: bool = True


@router.post("/tenants/{tenant_id}/onboarding-status")
def update_onboarding_status(tenant_id: str, body: MarkStepRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _registry_url(f"/onboarding/{tenant_id}/complete-step"),
        json={"step_id": body.step_id},
    )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to update onboarding")
    return resp.json()
