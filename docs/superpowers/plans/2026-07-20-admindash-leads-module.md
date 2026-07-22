# AdminDash Leads Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lead-management module to AdminDash — intake (public web form + manual + email import), a fixed pipeline, a denormalized activity log, and a convert-to-family action.

**Architecture:** Leads and activities are new DataCore entity types (`lead`, `lead_activity`) stored in the existing shared per-tenant entities table — no new storage. A dedicated AdminDash backend `leads` router enforces lead-specific rules (public-intake field allowlist, tenant validation, stage auto-logging, convert guard) by proxying to DataCore's entity + query API over sync `httpx`. The frontend uses a fixed lead schema (not the model-driven DynamicForm) with new pages plus one public unauthenticated route.

**Tech Stack:** Python 3 / FastAPI / httpx / pytest + respx (backend); React 19 + TypeScript + Vite, native fetch, `@neoapex/ui-tokens` (frontend); DataCore LanceDB entity store.

## Global Constraints

- Pipeline stages, in order: `New`, `Contacted`, `Tour Scheduled`, `Toured`, `Enrolled`, `Lost`. `Enrolled` and `Lost` are terminal. Copy this list verbatim wherever stages are enumerated.
- Activity types: `call`, `email`, `note` (admin-created), `stage_change` (system-created only).
- Lead `source` values: `web_form`, `manual`, `email_import`.
- DataCore entity `PUT` **replaces** `base_data` — every update must read the current entity via `/api/query`, merge, and send the full `base_data`.
- DataCore `/api/query` body: `{tenant_id, table: "entities", sql}`; the SQL references the table alias `data`; `base_data` fields are flattened to top-level columns; response is `{data: [...rows], total}`.
- DataCore entity create: `POST {datacore}/api/entities/{tenant}/{type}` with `{base_data, custom_fields}` → `201` with the full record (includes `entity_id`, and `base_data.lead_id` once the abbrev exists).
- DataCore has **no auth**; every authenticated AdminDash route uses `Depends(require_authenticated_user)`. The single public route must NOT use it.
- Backend HTTP to DataCore uses **sync `httpx`** (so `respx` intercepts it in tests), mirroring `app/api/entities.py`.
- Match existing code style. Backend files live under `admindash/backend/app/`; run backend commands from `admindash/` with `uv run`.
- Timestamps: rely on DataCore's `_created_at` / `_updated_at` metadata; do not hand-roll timestamps in `base_data`.

---

## Task 1: DataCore — human-friendly `lead` ids

**Files:**
- Modify: `datacore/src/datacore/api/routes.py` (the `DEFAULT_ABBREVS` dict near the top)
- Test: `datacore/tests/test_entities_api.py` (or the existing entity-API test module; create `test_lead_id.py` if none fits)

**Interfaces:**
- Produces: leads created via `POST /api/entities/{tenant}/lead` receive `base_data.lead_id` of the form `{ABBREV}-LD{YY}{NNNN}`.

- [ ] **Step 1: Locate the current abbrevs and existing entity-create test**

Run: `grep -n "DEFAULT_ABBREVS" datacore/src/datacore/api/routes.py` and `ls datacore/tests/ | grep -i entit`
Expected: `DEFAULT_ABBREVS = {"student": "ST", "program": "PR"}` around line 20; an entities API test file exists.

- [ ] **Step 2: Write the failing test**

Add to the entity-API test module (adjust fixture names to match the file's existing DataCore test client + tenant setup):

```python
def test_lead_gets_sequential_human_id(client, seeded_tenant):
    # seeded_tenant creates a 'tenant' entity so _check_tenant_exists passes
    resp = client.post(
        f"/api/entities/{seeded_tenant}/lead",
        json={"base_data": {"guardian_name": "Sam Rivera", "email": "sam@example.com"}},
    )
    assert resp.status_code == 201
    lead_id = resp.json()["base_data"]["lead_id"]
    assert "-LD" in lead_id  # e.g. TES-LD260001
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd datacore && uv run python -m pytest tests/ -k lead_gets_sequential_human_id -v`
Expected: FAIL — `lead_id` KeyError (no abbrev registered).

- [ ] **Step 4: Add the abbrev**

In `routes.py`:

```python
DEFAULT_ABBREVS = {
    "student": "ST",
    "program": "PR",
    "lead": "LD",
}
```

- [ ] **Step 5: Run the test and the full datacore suite**

Run: `cd datacore && uv run python -m pytest tests/ -k lead_gets_sequential_human_id -v`
Expected: PASS
Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: all pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add datacore/src/datacore/api/routes.py datacore/tests/
git commit -m "feat(datacore): sequential human id for lead entity type"
```

---

## Task 2: AdminDash backend — leads DataCore client helpers + schemas

**Files:**
- Create: `admindash/backend/app/api/leads.py`
- Test: `admindash/backend/tests/test_leads.py`

**Interfaces:**
- Produces (module-level, used by later tasks):
  - `STAGES: list[str]` — the six stages in order.
  - `TERMINAL_STAGES = {"Enrolled", "Lost"}`.
  - `ACTIVITY_TYPES = {"call", "email", "note"}`.
  - `router = APIRouter()`.
  - `_dc_create(tenant, entity_type, base_data, token) -> dict` (returns DataCore record; `token=None` allowed for public path).
  - `_dc_update(tenant, entity_type, entity_id, base_data, token) -> dict`.
  - `_dc_query(tenant, sql, token) -> list[dict]` (returns the `data` list).
  - `_get_lead(tenant, lead_id, token) -> dict | None` (active lead row incl. `entity_id`, flattened base_data columns).

- [ ] **Step 1: Write the failing test for the client helpers via the create route (defined in Task 3). Start with the module import + schema test:**

```python
# admindash/backend/tests/test_leads.py
import httpx
import respx


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


def test_stages_constant_is_ordered():
    from app.api.leads import STAGES
    assert STAGES == ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k stages_constant -v`
Expected: FAIL — `ModuleNotFoundError: app.api.leads`.

- [ ] **Step 3: Create the module with constants, schemas, and helpers**

```python
# admindash/backend/app/api/leads.py
"""Lead-management routes — proxy to DataCore with lead-specific business rules."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator

from app.auth import require_authenticated_user
from app.config import settings

router = APIRouter()

STAGES = ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]
TERMINAL_STAGES = {"Enrolled", "Lost"}
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


def _dc_query(tenant: str, sql: str, token: str | None) -> list[dict]:
    resp = _dc("POST", "/api/query", token,
               {"tenant_id": tenant, "table": "entities", "sql": sql})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore query failed: {resp.text}")
    return resp.json().get("data", [])


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
    guardian_name: str
    email: str | None = None
    phone: str | None = None
    student_first_name: str | None = None
    student_last_name: str | None = None
    grade_of_interest: str | None = None
    message: str | None = None

    @model_validator(mode="after")
    def _contact_required(self):
        if not (self.email or self.phone):
            raise ValueError("At least one of email or phone is required")
        return self


class PublicLeadCreate(LeadCreate):
    """Same prospect fields; internal fields (stage/source/converted_family_id) are never accepted."""


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
```

- [ ] **Step 4: Run the constant test**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k stages_constant -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/api/leads.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): leads router scaffold — DataCore helpers and schemas"
```

---

## Task 3: AdminDash backend — create / list / get lead routes

**Files:**
- Modify: `admindash/backend/app/api/leads.py`
- Modify: `admindash/backend/app/main.py` (register router)
- Test: `admindash/backend/tests/test_leads.py`

**Interfaces:**
- Consumes: helpers/schemas from Task 2.
- Produces: `POST /api/leads/{tenant}`, `GET /api/leads/{tenant}?stage=`, `GET /api/leads/{tenant}/{lead_id}`.

- [ ] **Step 1: Write failing tests**

```python
@respx.mock
def test_create_lead_manual(client):
    _stub_auth(respx)
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld1", "base_data": {
                "guardian_name": "Sam Rivera", "email": "sam@example.com",
                "source": "manual", "stage": "New"}})
    )
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "Sam Rivera", "email": "sam@example.com"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    sent = route.calls.last.request
    import json as _j
    body = _j.loads(sent.content)
    assert body["base_data"]["source"] == "manual"
    assert body["base_data"]["stage"] == "New"


@respx.mock
def test_create_lead_requires_contact(client):
    _stub_auth(respx)
    resp = client.post("/api/leads/t1", json={"guardian_name": "No Contact"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 422


@respx.mock
def test_list_leads_filters_by_stage(client):
    _stub_auth(respx)
    route = respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"entity_id": "ld1", "stage": "Toured"}], "total": 1}))
    resp = client.get("/api/leads/t1?stage=Toured", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    import json as _j
    sql = _j.loads(route.calls.last.request.content)["sql"]
    assert "entity_type = 'lead'" in sql and "stage = 'Toured'" in sql


def test_list_leads_requires_auth(client):
    resp = client.get("/api/leads/t1")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k "create_lead or list_leads" -v`
Expected: FAIL (routes not defined / 404).

- [ ] **Step 3: Implement the routes in `leads.py`**

```python
@router.post("/leads/{tenant_id}", status_code=201)
def create_lead(tenant_id: str, body: LeadCreate, user=Depends(require_authenticated_user)):
    base = body.model_dump(exclude_none=True)
    base.update({"source": "manual", "stage": "New"})
    return _dc_create(tenant_id, "lead", base, user["_token"])


@router.get("/leads/{tenant_id}")
def list_leads(tenant_id: str, stage: str | None = None, user=Depends(require_authenticated_user)):
    where = "entity_type = 'lead' AND _status = 'active'"
    if stage:
        if stage not in STAGES:
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
```

- [ ] **Step 4: Register the router in `main.py`**

Add import and include (mount under `/api` so paths are `/api/leads/...`):

```python
from app.api import auth, entities, extract, health, leads, query
...
app.include_router(leads.router, prefix="/api", tags=["leads"])
```

- [ ] **Step 5: Run tests**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k "create_lead or list_leads" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admindash/backend/app/api/leads.py admindash/backend/app/main.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): create/list/get lead routes"
```

---

## Task 4: AdminDash backend — stage transition with auto-logged activity

**Files:**
- Modify: `admindash/backend/app/api/leads.py`
- Test: `admindash/backend/tests/test_leads.py`

**Interfaces:**
- Consumes: `_get_lead`, `_dc_update`, `_dc_create`, `STAGES`.
- Produces: `PATCH /api/leads/{tenant}/{lead_id}/stage`; internal `_log_stage_change(tenant, lead_id, frm, to, token)`.

- [ ] **Step 1: Write failing tests**

```python
def _stub_lead(mock, lead_id="ld1", stage="New"):
    mock.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [
            {"entity_id": lead_id, "guardian_name": "Sam", "email": "s@e.com",
             "stage": stage, "source": "manual"}], "total": 1}))


@respx.mock
def test_stage_change_updates_and_logs(client):
    _stub_auth(respx)
    _stub_lead(respx, stage="New")
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1", "base_data": {"stage": "Contacted"}}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={"entity_id": "la1"}))
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Contacted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert upd.called and act.called
    import json as _j
    act_body = _j.loads(act.calls.last.request.content)["base_data"]
    assert act_body["type"] == "stage_change"
    assert act_body["stage_from"] == "New" and act_body["stage_to"] == "Contacted"
    assert act_body["created_by"] == "system"


@respx.mock
def test_stage_change_same_stage_no_activity(client):
    _stub_auth(respx)
    _stub_lead(respx, stage="Contacted")
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={}))
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Contacted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert not act.called


@respx.mock
def test_stage_change_rejects_unknown_stage(client):
    _stub_auth(respx)
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Nope"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k stage_change -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```python
def _log_stage_change(tenant: str, lead_id: str, frm: str, to: str, token: str | None):
    _dc_create(tenant, "lead_activity", {
        "lead_id": lead_id, "type": "stage_change", "body": f"{frm} → {to}",
        "stage_from": frm, "stage_to": to, "created_by": "system",
    }, token)


@router.patch("/leads/{tenant_id}/{lead_id}/stage")
def update_stage(tenant_id: str, lead_id: str, body: StageUpdate,
                 user=Depends(require_authenticated_user)):
    if body.stage not in STAGES:
        raise HTTPException(400, f"Unknown stage: {body.stage}")
    lead = _get_lead(tenant_id, lead_id, user["_token"])
    if not lead:
        raise HTTPException(404, "Lead not found")
    current = lead.get("stage", "New")
    base = _lead_base_data(lead)  # helper below: reconstruct base_data for full PUT
    base["stage"] = body.stage
    updated = _dc_update(tenant_id, "lead", lead_id, base, user["_token"])
    if body.stage != current:
        _log_stage_change(tenant_id, lead_id, current, body.stage, user["_token"])
    return updated
```

Add a helper that reconstructs the lead's `base_data` from the flattened query row (drop metadata/system columns) so the full-replace PUT keeps existing fields:

```python
_LEAD_FIELDS = ["guardian_name", "email", "phone", "student_first_name",
                "student_last_name", "grade_of_interest", "message", "source",
                "stage", "lead_id", "converted_family_id"]


def _lead_base_data(row: dict) -> dict:
    return {k: row[k] for k in _LEAD_FIELDS if row.get(k) is not None}
```

- [ ] **Step 4: Run tests**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k stage_change -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/api/leads.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): lead stage transitions with auto-logged stage_change"
```

---

## Task 5: AdminDash backend — activity create + timeline

**Files:**
- Modify: `admindash/backend/app/api/leads.py`
- Test: `admindash/backend/tests/test_leads.py`

**Interfaces:**
- Produces: `POST /api/leads/{tenant}/{lead_id}/activities`, `GET /api/leads/{tenant}/{lead_id}/activities`.

- [ ] **Step 1: Write failing tests**

```python
@respx.mock
def test_add_activity(client):
    _stub_auth(respx)
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={"entity_id": "la1"}))
    resp = client.post("/api/leads/t1/ld1/activities",
        json={"type": "call", "body": "Left voicemail"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    import json as _j
    b = _j.loads(act.calls.last.request.content)["base_data"]
    assert b["type"] == "call" and b["lead_id"] == "ld1" and b["created_by"] == "u1"


@respx.mock
def test_add_activity_rejects_bad_type(client):
    _stub_auth(respx)
    resp = client.post("/api/leads/t1/ld1/activities",
        json={"type": "carrier_pigeon", "body": "x"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 400


@respx.mock
def test_list_activities_desc(client):
    _stub_auth(respx)
    route = respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"entity_id": "la2"}, {"entity_id": "la1"}], "total": 2}))
    resp = client.get("/api/leads/t1/ld1/activities", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    import json as _j
    sql = _j.loads(route.calls.last.request.content)["sql"]
    assert "lead_activity" in sql and "lead_id = 'ld1'" in sql and "ORDER BY _created_at DESC" in sql
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k activit -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```python
@router.post("/leads/{tenant_id}/{lead_id}/activities", status_code=201)
def add_activity(tenant_id: str, lead_id: str, body: ActivityCreate,
                 user=Depends(require_authenticated_user)):
    if body.type not in ACTIVITY_TYPES:
        raise HTTPException(400, f"Unknown activity type: {body.type}")
    return _dc_create(tenant_id, "lead_activity", {
        "lead_id": lead_id, "type": body.type, "body": body.body,
        "created_by": user.get("id", "unknown"),
    }, user["_token"])


@router.get("/leads/{tenant_id}/{lead_id}/activities")
def list_activities(tenant_id: str, lead_id: str, user=Depends(require_authenticated_user)):
    rows = _dc_query(
        tenant_id,
        f"SELECT * FROM data WHERE entity_type = 'lead_activity' "
        f"AND lead_id = '{lead_id}' AND _status = 'active' ORDER BY _created_at DESC",
        user["_token"])
    return {"activities": rows}
```

- [ ] **Step 4: Run tests**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k activit -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/api/leads.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): lead activity log create + timeline"
```

---

## Task 6: AdminDash backend — convert to family

**Files:**
- Modify: `admindash/backend/app/api/leads.py`
- Test: `admindash/backend/tests/test_leads.py`

**Interfaces:**
- Consumes: `_get_lead`, `_dc_create`, `_dc_update`, `_lead_base_data`, `_log_stage_change`, `TERMINAL_STAGES`.
- Produces: `POST /api/leads/{tenant}/{lead_id}/convert`.

- [ ] **Step 1: Write failing tests**

```python
@respx.mock
def test_convert_creates_family_student_and_links(client):
    _stub_auth(respx)
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [
            {"entity_id": "ld1", "guardian_name": "Sam", "email": "s@e.com",
             "stage": "Toured", "source": "manual"}], "total": 1}))
    fam = respx.post("http://localhost:5800/api/entities/t1/family").mock(
        return_value=httpx.Response(201, json={"entity_id": "fam1", "base_data": {"family_id": "F-1"}}))
    stu = respx.post("http://localhost:5800/api/entities/t1/student").mock(
        return_value=httpx.Response(201, json={"entity_id": "stu1"}))
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={}))
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "Rivera Family", "primary_address": "1 Main St",
              "student_first_name": "Ada", "student_last_name": "Rivera"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    assert fam.called and stu.called and upd.called and act.called
    import json as _j
    stu_body = _j.loads(stu.calls.last.request.content)["base_data"]
    assert stu_body["family_id"] == "fam1" and stu_body["status"] == "Enrolled"
    lead_body = _j.loads(upd.calls.last.request.content)["base_data"]
    assert lead_body["converted_family_id"] == "fam1" and lead_body["stage"] == "Enrolled"


@respx.mock
def test_convert_guards_double_conversion(client):
    _stub_auth(respx)
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [
            {"entity_id": "ld1", "guardian_name": "Sam", "email": "s@e.com",
             "stage": "Enrolled", "converted_family_id": "famX"}], "total": 1}))
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "X", "primary_address": "Y",
              "student_first_name": "A", "student_last_name": "B"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 409
    assert "famX" in resp.json()["detail"]
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k convert -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```python
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
    prev_stage = base.get("stage", "New")
    base["stage"] = "Enrolled"
    _dc_update(tenant_id, "lead", lead_id, base, token)
    if prev_stage != "Enrolled":
        _log_stage_change(tenant_id, lead_id, prev_stage, "Enrolled", token)

    return {"family_id": family_id, "student_id": student["entity_id"], "lead_id": lead_id}
```

- [ ] **Step 4: Run tests**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k convert -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/api/leads.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): convert lead to family + student with double-convert guard"
```

---

## Task 7: AdminDash backend — public web-form intake (unauthenticated)

**Files:**
- Modify: `admindash/backend/app/api/leads.py`
- Test: `admindash/backend/tests/test_leads.py`

**Interfaces:**
- Consumes: `_tenant_exists`, `_dc_create`, `PublicLeadCreate`.
- Produces: `POST /api/public/leads/{tenant}` (no auth).

- [ ] **Step 1: Write failing tests**

```python
@respx.mock
def test_public_intake_creates_web_form_lead(client):
    respx.post("http://localhost:5800/api/query").mock(  # tenant existence check
        return_value=httpx.Response(200, json={"data": [{"entity_id": "t1"}], "total": 1}))
    create = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={"entity_id": "ld1"}))
    resp = client.post("/api/public/leads/t1",
        json={"guardian_name": "Prospect", "email": "p@e.com", "stage": "Enrolled",
              "converted_family_id": "hack"})  # internal fields must be ignored
    assert resp.status_code == 201
    import json as _j
    b = _j.loads(create.calls.last.request.content)["base_data"]
    assert b["source"] == "web_form" and b["stage"] == "New"
    assert "converted_family_id" not in b


@respx.mock
def test_public_intake_unknown_tenant_404(client):
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0}))
    resp = client.post("/api/public/leads/ghost",
        json={"guardian_name": "P", "email": "p@e.com"})
    assert resp.status_code == 404


def test_public_intake_needs_no_jwt(client):
    # No Authorization header at all — must not 401 on auth (tenant check will run)
    import respx as _r
    with _r.mock:
        _r.post("http://localhost:5800/api/query").mock(
            return_value=httpx.Response(200, json={"data": [], "total": 0}))
        resp = client.post("/api/public/leads/t1", json={"guardian_name": "P", "phone": "555"})
    assert resp.status_code != 401
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -k public_intake -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```python
@router.post("/public/leads/{tenant_id}", status_code=201)
def public_intake(tenant_id: str, body: PublicLeadCreate):
    if not _tenant_exists(tenant_id):
        raise HTTPException(404, "Unknown tenant")
    base = body.model_dump(exclude_none=True)
    base.update({"source": "web_form", "stage": "New"})  # force; internal fields never in schema
    return _dc_create(tenant_id, "lead", base, None)
```

Note: `PublicLeadCreate` has no `stage`/`converted_family_id` fields, so FastAPI ignores them in the payload — the test's injected internal fields are dropped at validation.

- [ ] **Step 4: Run tests + full backend suite**

Run: `cd admindash && uv run pytest backend/tests/test_leads.py -v`
Expected: PASS.
Run: `cd admindash && uv run pytest backend/tests/ -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/api/leads.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): public unauthenticated lead intake with field allowlist"
```

---

## Task 8: Frontend — types, API client, email parser

**Files:**
- Modify: `admindash/frontend/src/types/models.ts`
- Modify: `admindash/frontend/src/api/client.ts`
- Create: `admindash/frontend/src/utils/parseInquiryEmail.ts`

**Interfaces:**
- Produces: `Lead`, `LeadActivity`, `LEAD_STAGES` types/consts; client fns `listLeads`, `getLead`, `createLead`, `updateLeadStage`, `listActivities`, `addActivity`, `convertLead`, `submitPublicLead`; `parseInquiryEmail`.

- [ ] **Step 1: Add types to `models.ts`**

```typescript
export const LEAD_STAGES = [
  'New', 'Contacted', 'Tour Scheduled', 'Toured', 'Enrolled', 'Lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export interface Lead {
  entity_id: string;
  lead_id?: string;
  guardian_name: string;
  email?: string;
  phone?: string;
  student_first_name?: string;
  student_last_name?: string;
  grade_of_interest?: string;
  message?: string;
  source: 'web_form' | 'manual' | 'email_import';
  stage: LeadStage;
  converted_family_id?: string;
  _created_at?: string;
  _updated_at?: string;
}

export interface LeadActivity {
  entity_id: string;
  lead_id: string;
  type: 'call' | 'email' | 'note' | 'stage_change';
  body: string;
  stage_from?: string;
  stage_to?: string;
  created_by: string;
  _created_at?: string;
}
```

- [ ] **Step 2: Add client functions to `client.ts`** (mirror existing fetch+`authHeaders()` style)

```typescript
import type { Lead, LeadActivity } from '../types/models.ts';

export async function listLeads(tenantId: string, stage?: string): Promise<Lead[]> {
  const q = stage ? `?stage=${encodeURIComponent(stage)}` : '';
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}${q}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).leads as Lead[];
}

export async function getLead(tenantId: string, leadId: string): Promise<Lead> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createLead(tenantId: string, fields: Partial<Lead>): Promise<Lead> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function updateLeadStage(tenantId: string, leadId: string, stage: string): Promise<Lead> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/stage`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ stage }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function listActivities(tenantId: string, leadId: string): Promise<LeadActivity[]> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/activities`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).activities as LeadActivity[];
}

export async function addActivity(tenantId: string, leadId: string, type: string, body: string): Promise<LeadActivity> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/activities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ type, body }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface ConvertPayload {
  family_name: string; primary_address: string;
  primary_email?: string; primary_phone?: string;
  student_first_name: string; student_last_name: string; grade_level?: string;
}
export async function convertLead(tenantId: string, leadId: string, payload: ConvertPayload) {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/convert`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (resp.status === 409) throw new Error(await resp.text());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Public intake — NO auth header.
export async function submitPublicLead(tenantId: string, fields: Partial<Lead>): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/public/leads/${tenantId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}
```

- [ ] **Step 3: Create `parseInquiryEmail.ts`**

```typescript
// Best-effort extraction of lead fields from a pasted inquiry email.
export interface ParsedInquiry {
  guardian_name?: string;
  email?: string;
  phone?: string;
  student_first_name?: string;
  student_last_name?: string;
  message?: string;
}

export function parseInquiryEmail(text: string): ParsedInquiry {
  const out: ParsedInquiry = {};
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out.email = email[0];
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phone) out.phone = phone[1].trim();
  const name = text.match(/(?:my name is|from|regards,|thanks,|sincerely,)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (name) out.guardian_name = name[1].trim();
  const student = text.match(/(?:my child|my son|my daughter|student)\s+(?:is\s+)?([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i);
  if (student) { out.student_first_name = student[1]; if (student[2]) out.student_last_name = student[2]; }
  out.message = text.trim().slice(0, 2000);
  return out;
}
```

- [ ] **Step 4: Type-check**

Run: `cd admindash/frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/types/models.ts admindash/frontend/src/api/client.ts admindash/frontend/src/utils/parseInquiryEmail.ts
git commit -m "feat(admindash): lead types, API client, email parser"
```

---

## Task 9: Frontend — leads pipeline page + i18n

**Files:**
- Rewrite: `admindash/frontend/src/pages/LeadPage.tsx`
- Modify: `admindash/frontend/src/pages/LeadPage.css` (styles for the board)
- Modify: `admindash/frontend/src/i18n/translations.ts` (add `leads.*` keys under both `en-US` and `zh-CN`)

**Interfaces:**
- Consumes: `listLeads`, `LEAD_STAGES`, `Lead`; the tenant comes from the auth user (see Step 3 — `LeadPage` must receive `tenant`).
- Produces: `LeadPage` renders the pipeline and opens the detail view (Task 10) and the create modals (Task 11).

- [ ] **Step 1: Add i18n keys** to `translations.ts` for both locales (keep `lead.title` used by the placeholder; add the rest):

```typescript
// within 'en-US':
'leads.title': 'Leads',
'leads.addManual': 'Add Lead',
'leads.importEmail': 'Import from Email',
'leads.filterAll': 'All stages',
'leads.empty': 'No leads yet',
'leads.convert': 'Convert to Family',
'leads.addActivity': 'Add Activity',
'leads.stage': 'Stage',
'leads.activityTimeline': 'Activity',
// within 'zh-CN': provide translations for each of the above keys.
```

- [ ] **Step 2: Rewrite `LeadPage.tsx`** as a stage-grouped board with a stage filter and buttons that open the create modals + detail view. Accept a `tenant` prop.

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listLeads } from '../api/client.ts';
import { LEAD_STAGES, type Lead, type LeadStage } from '../types/models.ts';
import LeadDetailDrawer from '../components/LeadDetailDrawer.tsx';
import AddLeadModal from '../components/AddLeadModal.tsx';
import ImportEmailModal from '../components/ImportEmailModal.tsx';
import './LeadPage.css';

export default function LeadPage({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<LeadStage | ''>('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLeads(await listLeads(tenant, filter || undefined)); }
    catch (e) { setError(String(e)); }
  }, [tenant, filter]);

  useEffect(() => { void load(); }, [load]);

  const byStage = (s: LeadStage) => leads.filter((l) => l.stage === s);

  return (
    <div className="leads-page">
      <header className="leads-header">
        <h1>{t('leads.title')}</h1>
        <div className="leads-actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value as LeadStage | '')}>
            <option value="">{t('leads.filterAll')}</option>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setShowAdd(true)}>{t('leads.addManual')}</button>
          <button onClick={() => setShowImport(true)}>{t('leads.importEmail')}</button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {leads.length === 0 && <p>{t('leads.empty')}</p>}
      <div className="leads-board">
        {LEAD_STAGES.map((stage) => (
          <div key={stage} className="leads-column">
            <h2>{stage} <span>{byStage(stage).length}</span></h2>
            {byStage(stage).map((l) => (
              <button key={l.entity_id} className="lead-card" onClick={() => setSelected(l)}>
                <strong>{l.guardian_name}</strong>
                <small>{l.student_first_name} {l.student_last_name}</small>
                <small>{l.email || l.phone}</small>
              </button>
            ))}
          </div>
        ))}
      </div>
      {selected && (
        <LeadDetailDrawer tenant={tenant} lead={selected}
          onClose={() => setSelected(null)} onChanged={() => { void load(); }} />
      )}
      {showAdd && <AddLeadModal tenant={tenant}
        onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); void load(); }} />}
      {showImport && <ImportEmailModal tenant={tenant}
        onClose={() => setShowImport(false)} onCreated={() => { setShowImport(false); void load(); }} />}
    </div>
  );
}
```

- [ ] **Step 3: Update `App.tsx`** to pass `tenant` to `LeadPage`:

Change `<Route path="/leads" element={<LeadPage />} />` to `<Route path="/leads" element={<LeadPage tenant={tenant} />} />`.

- [ ] **Step 4: Add board styles** to `LeadPage.css` (horizontal columns, cards) using `ui-tokens` CSS variables. Keep the existing `.placeholder-page` rule or remove if unused.

```css
.leads-header { display: flex; justify-content: space-between; align-items: center; }
.leads-actions { display: flex; gap: var(--space-2, 8px); }
.leads-board { display: flex; gap: var(--space-3, 12px); overflow-x: auto; }
.leads-column { min-width: 200px; flex: 1; }
.lead-card { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  padding: var(--space-2, 8px); margin-bottom: var(--space-2, 8px);
  border: 1px solid var(--color-border, #ddd); border-radius: var(--radius-md, 6px); background: var(--color-surface, #fff); cursor: pointer; }
```

- [ ] **Step 5: Type-check** (components referenced in Steps 2 are created in Tasks 10–11; expect unresolved-import errors until then — that's acceptable mid-task. Verify no errors in THIS file's own logic by temporarily building after Task 11.)

Run: `cd admindash/frontend && npx tsc -b` (defer green until Task 11; note failures are only the not-yet-created modal/drawer imports).

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/pages/LeadPage.tsx admindash/frontend/src/pages/LeadPage.css admindash/frontend/src/App.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): leads pipeline board page + i18n"
```

---

## Task 10: Frontend — lead detail drawer (stage control, timeline, add activity, convert entry)

**Files:**
- Create: `admindash/frontend/src/components/LeadDetailDrawer.tsx`
- Create: `admindash/frontend/src/components/LeadDetailDrawer.css`
- Create: `admindash/frontend/src/components/ConvertToFamilyModal.tsx`

**Interfaces:**
- Consumes: `getLead`, `listActivities`, `addActivity`, `updateLeadStage`, `convertLead`, `LEAD_STAGES`, `Lead`, `LeadActivity`.
- Props: `{ tenant: string; lead: Lead; onClose: () => void; onChanged: () => void }`.

- [ ] **Step 1: Implement `LeadDetailDrawer.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listActivities, addActivity, updateLeadStage } from '../api/client.ts';
import { LEAD_STAGES, type Lead, type LeadActivity } from '../types/models.ts';
import ConvertToFamilyModal from './ConvertToFamilyModal.tsx';
import './LeadDetailDrawer.css';

const ACTIVITY_TYPES = ['call', 'email', 'note'] as const;

export default function LeadDetailDrawer(
  { tenant, lead, onClose, onChanged }:
  { tenant: string; lead: Lead; onClose: () => void; onChanged: () => void },
) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [stage, setStage] = useState(lead.stage);
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>('note');
  const [actBody, setActBody] = useState('');
  const [showConvert, setShowConvert] = useState(false);

  const loadActs = useCallback(async () => {
    setActivities(await listActivities(tenant, lead.entity_id));
  }, [tenant, lead.entity_id]);
  useEffect(() => { void loadActs(); }, [loadActs]);

  async function changeStage(next: string) {
    setStage(next as Lead['stage']);
    await updateLeadStage(tenant, lead.entity_id, next);
    await loadActs();
    onChanged();
  }

  async function submitActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!actBody.trim()) return;
    await addActivity(tenant, lead.entity_id, actType, actBody.trim());
    setActBody('');
    await loadActs();
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="lead-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose}>×</button>
        <h2>{lead.guardian_name}</h2>
        <p>{lead.email} {lead.phone}</p>
        <p>{lead.student_first_name} {lead.student_last_name} — {lead.grade_of_interest}</p>

        <label>{t('leads.stage')}
          <select value={stage} onChange={(e) => void changeStage(e.target.value)}>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <button disabled={!!lead.converted_family_id} onClick={() => setShowConvert(true)}>
          {lead.converted_family_id ? `Converted → ${lead.converted_family_id}` : t('leads.convert')}
        </button>

        <form onSubmit={submitActivity} className="activity-form">
          <select value={actType} onChange={(e) => setActType(e.target.value as typeof actType)}>
            {ACTIVITY_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </select>
          <input value={actBody} onChange={(e) => setActBody(e.target.value)} placeholder={t('leads.addActivity')} />
          <button type="submit">+</button>
        </form>

        <h3>{t('leads.activityTimeline')}</h3>
        <ul className="activity-list">
          {activities.map((a) => (
            <li key={a.entity_id}>
              <span className={`badge badge-${a.type}`}>{a.type}</span>
              <span>{a.type === 'stage_change' ? `${a.stage_from} → ${a.stage_to}` : a.body}</span>
              <small>{a._created_at?.slice(0, 16).replace('T', ' ')}</small>
            </li>
          ))}
        </ul>

        {showConvert && (
          <ConvertToFamilyModal tenant={tenant} lead={lead}
            onClose={() => setShowConvert(false)}
            onConverted={() => { setShowConvert(false); onChanged(); onClose(); }} />
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Implement `ConvertToFamilyModal.tsx`** (pre-fill mapping per design D7; collect required `primary_address`)

```tsx
import { useState } from 'react';
import { convertLead } from '../api/client.ts';
import type { Lead } from '../types/models.ts';

export default function ConvertToFamilyModal(
  { tenant, lead, onClose, onConverted }:
  { tenant: string; lead: Lead; onClose: () => void; onConverted: () => void },
) {
  const [familyName, setFamilyName] = useState(`${lead.guardian_name}`);
  const [address, setAddress] = useState('');
  const [firstName, setFirstName] = useState(lead.student_first_name ?? '');
  const [lastName, setLastName] = useState(lead.student_last_name ?? '');
  const [grade, setGrade] = useState(lead.grade_of_interest ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim() || !firstName.trim() || !lastName.trim()) {
      setError('Address and student name are required.'); return;
    }
    try {
      await convertLead(tenant, lead.entity_id, {
        family_name: familyName, primary_address: address,
        primary_email: lead.email, primary_phone: lead.phone,
        student_first_name: firstName, student_last_name: lastName,
        grade_level: grade || undefined,
      });
      onConverted();
    } catch (err) { setError(String(err)); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Convert to Family</h3>
        {error && <p className="error">{error}</p>}
        <label>Family name<input value={familyName} onChange={(e) => setFamilyName(e.target.value)} /></label>
        <label>Primary address*<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label>Student first name*<input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
        <label>Student last name*<input value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        <label>Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} /></label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Convert</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Add `LeadDetailDrawer.css`** (backdrop + right-side drawer + simple badge colors, using `ui-tokens` variables). Reuse existing `.modal-backdrop`/`.modal` styles if present in the app's CSS; otherwise define minimal ones here.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/components/LeadDetailDrawer.tsx admindash/frontend/src/components/LeadDetailDrawer.css admindash/frontend/src/components/ConvertToFamilyModal.tsx
git commit -m "feat(admindash): lead detail drawer, stage control, timeline, convert modal"
```

---

## Task 11: Frontend — manual add + email-import modals

**Files:**
- Create: `admindash/frontend/src/components/AddLeadModal.tsx`
- Create: `admindash/frontend/src/components/ImportEmailModal.tsx`
- Create: `admindash/frontend/src/components/LeadModal.css` (shared modal styles if not already present)

**Interfaces:**
- Consumes: `createLead`, `parseInquiryEmail`.
- Props (both): `{ tenant: string; onClose: () => void; onCreated: () => void }`.

- [ ] **Step 1: Implement `AddLeadModal.tsx`**

```tsx
import { useState } from 'react';
import { createLead } from '../api/client.ts';

export default function AddLeadModal(
  { tenant, onClose, onCreated }: { tenant: string; onClose: () => void; onCreated: () => void },
) {
  const [f, setF] = useState({ guardian_name: '', email: '', phone: '',
    student_first_name: '', student_last_name: '', grade_of_interest: '', message: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.guardian_name.trim() || (!f.email.trim() && !f.phone.trim())) {
      setError('Guardian name and at least one contact (email or phone) are required.'); return;
    }
    try {
      const payload = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      await createLead(tenant, payload);
      onCreated();
    } catch (err) { setError(String(err)); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Add Lead</h3>
        {error && <p className="error">{error}</p>}
        <label>Guardian name*<input value={f.guardian_name} onChange={set('guardian_name')} /></label>
        <label>Email<input value={f.email} onChange={set('email')} /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
        <label>Student first name<input value={f.student_first_name} onChange={set('student_first_name')} /></label>
        <label>Student last name<input value={f.student_last_name} onChange={set('student_last_name')} /></label>
        <label>Grade of interest<input value={f.grade_of_interest} onChange={set('grade_of_interest')} /></label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Implement `ImportEmailModal.tsx`** (paste → parse → editable review → confirm with `source: 'email_import'`)

```tsx
import { useState } from 'react';
import { createLead } from '../api/client.ts';
import { parseInquiryEmail } from '../utils/parseInquiryEmail.ts';

export default function ImportEmailModal(
  { tenant, onClose, onCreated }: { tenant: string; onClose: () => void; onCreated: () => void },
) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function doParse() {
    const p = parseInquiryEmail(raw);
    setParsed({
      guardian_name: p.guardian_name ?? '', email: p.email ?? '', phone: p.phone ?? '',
      student_first_name: p.student_first_name ?? '', student_last_name: p.student_last_name ?? '',
      message: p.message ?? '',
    });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    if (!parsed.guardian_name.trim() || (!parsed.email.trim() && !parsed.phone.trim())) {
      setError('Guardian name and at least one contact are required.'); return;
    }
    try {
      const payload = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v.trim()));
      await createLead(tenant, { ...payload, source: 'email_import' });
      onCreated();
    } catch (err) { setError(String(err)); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={confirm}>
        <h3>Import from Email</h3>
        {error && <p className="error">{error}</p>}
        {!parsed ? (
          <>
            <textarea rows={10} value={raw} onChange={(e) => setRaw(e.target.value)}
              placeholder="Paste the inquiry email here…" />
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="button" onClick={doParse} disabled={!raw.trim()}>Parse</button>
            </div>
          </>
        ) : (
          <>
            {Object.keys(parsed).map((k) => (
              <label key={k}>{k}
                <input value={parsed[k]} onChange={(e) => setParsed({ ...parsed, [k]: e.target.value })} />
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" onClick={() => setParsed(null)}>Back</button>
              <button type="submit">Create Lead</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
```

Note: `createLead` for email-import passes `source: 'email_import'`, but the backend `create_lead` route forces `source=manual`. To honor the source, extend `LeadCreate` in the backend to accept an optional `source` limited to `manual|email_import` (default `manual`) and use it — update `create_lead`:

```python
class LeadCreate(BaseModel):
    ...
    source: str | None = None  # 'manual' | 'email_import'; validated below
    ...

# in create_lead:
src = body.source if body.source in ("manual", "email_import") else "manual"
base = body.model_dump(exclude_none=True, exclude={"source"})
base.update({"source": src, "stage": "New"})
```

Add a backend test asserting `source=email_import` is honored and any other value falls back to `manual`. (Public intake still forces `web_form` and does not expose `source`.)

- [ ] **Step 3: Shared modal CSS** — ensure `.modal-backdrop`, `.modal`, `.modal-actions`, `.error` exist (add `LeadModal.css` imported by the modals if the app has no global equivalent).

- [ ] **Step 4: Full frontend build + lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: build + lint pass (all imports from Tasks 9–11 now resolve).

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/components/AddLeadModal.tsx admindash/frontend/src/components/ImportEmailModal.tsx admindash/frontend/src/components/LeadModal.css admindash/backend/app/api/leads.py admindash/backend/tests/test_leads.py
git commit -m "feat(admindash): manual add + email-import lead modals; honor email_import source"
```

---

## Task 12: Frontend — public web-form inquiry page + public route

**Files:**
- Create: `admindash/frontend/src/pages/PublicInquiryPage.tsx`
- Create: `admindash/frontend/src/pages/PublicInquiryPage.css`
- Modify: `admindash/frontend/src/App.tsx` (add a public route OUTSIDE the auth guard)

**Interfaces:**
- Consumes: `submitPublicLead`; reads `:tenantId` from the route.

- [ ] **Step 1: Implement `PublicInquiryPage.tsx`**

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { submitPublicLead } from '../api/client.ts';
import './PublicInquiryPage.css';

export default function PublicInquiryPage() {
  const { tenantId = '' } = useParams();
  const [f, setF] = useState({ guardian_name: '', email: '', phone: '',
    student_first_name: '', student_last_name: '', grade_of_interest: '', message: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.guardian_name.trim() || !f.email.trim()) {
      setError('Name and email are required.'); return;
    }
    try {
      const payload = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      await submitPublicLead(tenantId, payload);
      setDone(true);
    } catch { setError('Sorry, something went wrong. Please try again.'); }
  }

  if (done) return <div className="inquiry-page"><h1>Thank you!</h1><p>We’ll be in touch soon.</p></div>;

  return (
    <div className="inquiry-page">
      <h1>Request Information</h1>
      {error && <p className="error">{error}</p>}
      <form onSubmit={submit}>
        <label>Your name*<input value={f.guardian_name} onChange={set('guardian_name')} /></label>
        <label>Email*<input value={f.email} onChange={set('email')} /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
        <label>Student first name<input value={f.student_first_name} onChange={set('student_first_name')} /></label>
        <label>Student last name<input value={f.student_last_name} onChange={set('student_last_name')} /></label>
        <label>Grade of interest<input value={f.grade_of_interest} onChange={set('grade_of_interest')} /></label>
        <label>Message<textarea value={f.message} onChange={set('message')} /></label>
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Wire the public route in `App.tsx`** — add it as a sibling of `/login`, BEFORE the catch-all auth guard, so it renders without a session:

```tsx
import PublicInquiryPage from './pages/PublicInquiryPage.tsx';
// inside the top-level <Routes>, before the path="*" guarded route:
<Route path="/inquire/:tenantId" element={<PublicInquiryPage />} />
```

- [ ] **Step 3: Add minimal `PublicInquiryPage.css`** (centered card form using `ui-tokens`).

- [ ] **Step 4: Build + lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: pass.

- [ ] **Step 5: Manual check the public route renders unauthenticated**

Run: `cd admindash/frontend && npm run dev` then visit `http://localhost:5600/inquire/<tenant_id>` in a logged-out browser; confirm the form shows (no redirect to /login).

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/pages/PublicInquiryPage.tsx admindash/frontend/src/pages/PublicInquiryPage.css admindash/frontend/src/App.tsx
git commit -m "feat(admindash): public lead inquiry web form + unauthenticated route"
```

---

## Task 13: Full verification

**Files:** none (verification only).

- [ ] **Step 1: DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: all pass.

- [ ] **Step 2: AdminDash backend tests**

Run: `cd admindash && uv run pytest backend/tests/ -q`
Expected: all pass.

- [ ] **Step 3: Frontend build + lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both pass, no TypeScript errors.

- [ ] **Step 4: Manual smoke test** (all services up via `./start-services.sh`)

  1. Log into AdminDash, open Leads. Add a lead manually → appears under **New**.
  2. Import from email: paste a sample inquiry → review parsed fields → create → appears with source `email_import`.
  3. Open a lead → advance stage New→Contacted→Tour Scheduled; confirm each transition adds a `stage_change` entry to the timeline.
  4. Add a `call` and a `note` activity; confirm they show newest-first.
  5. Visit `/inquire/<tenant_id>` logged-out, submit the form; confirm a new **New** lead with source `web_form`.
  6. Convert a lead to family: fill address + student name → Convert; confirm a Family + Student were created (check Students page) and the lead is now **Enrolled** and links to the family. Re-open convert → confirm it is blocked as already-converted.

- [ ] **Step 5: Final commit (if any smoke fixes were needed)**

```bash
git add -A && git commit -m "test(admindash): verify leads module end to end"
```

---

## Self-Review Notes

- **Spec coverage:** intake manual (T3) / public (T7,T12) / email (T8,T11); pipeline entity + stages + list/filter (T1,T3) and transitions (T4); activity log single denormalized type + auto stage_change + timeline (T4,T5); conversion pre-fill + link + mark enrolled + double-convert guard (T6,T10). All capabilities mapped.
- **Cross-service order:** Task 1 (DataCore) ships first; AdminDash tolerates a missing `lead_id`, so ordering is safe.
- **Type consistency:** activity from/to stored as flat `stage_from`/`stage_to` (not a nested `metadata` object) — used consistently in backend (T4) and frontend rendering (T10). `Lead.entity_id` is the identifier threaded through all client calls and routes.
