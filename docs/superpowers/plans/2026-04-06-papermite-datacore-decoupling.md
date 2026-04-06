# Papermite DataCore Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Papermite's direct LanceDB dependency by routing model reads/writes through DataCore's HTTP API and moving preview logic to the frontend.

**Architecture:** DataCore gets two new model endpoints (`GET /api/models/{tenant_id}` for listing all active models, `PUT /api/models/{tenant_id}` for storing). Papermite backend replaces direct `lance_store.py` calls with `httpx` calls to DataCore. Papermite frontend does preview comparison locally instead of calling the backend. The `datacore` Python package is removed from Papermite's dependencies.

**Tech Stack:** Python, FastAPI, httpx, React/TypeScript, LanceDB (DataCore only)

**Spec:** `docs/superpowers/specs/2026-04-06-papermite-datacore-decoupling-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/api/routes.py` | Modify | Add `GET /api/models/{tenant_id}` and `PUT /api/models/{tenant_id}` |
| `datacore/tests/test_api.py` | Modify | Tests for new endpoints |
| `papermite/backend/app/config.py` | Modify | Add `datacore_api_url`, remove `lancedb_dir` |
| `papermite/backend/app/api/extraction.py` | Modify | Replace `lance_store.get_active_model` with httpx call |
| `papermite/backend/app/api/extract.py` | Modify | Replace `lance_store.get_active_model` with httpx call |
| `papermite/backend/app/api/finalize.py` | Modify | Remove preview endpoint, rewrite commit to use httpx + DataCore |
| `papermite/backend/app/storage/lance_store.py` | Delete | No longer needed |
| `papermite/backend/app/storage/__init__.py` | Delete | No longer needed |
| `papermite/backend/tests/test_lance_store.py` | Delete | Tests for deleted code |
| `papermite/backend/tests/test_registry_store.py` | Delete | Tests for already-deleted code |
| `papermite/pyproject.toml` | Modify | Remove `datacore` dependency |
| `papermite/frontend/src/api/client.ts` | Modify | Remove `previewFinalize()` |
| `papermite/frontend/src/pages/FinalizedPage.tsx` | Modify | Local preview instead of API call |
| `papermite/frontend/src/types/models.ts` | Modify | Keep types, no changes needed |

---

### Task 1: Add `GET /api/models/{tenant_id}` to DataCore

**Files:**
- Modify: `datacore/src/datacore/api/routes.py`
- Modify: `datacore/tests/test_api.py`

This endpoint lists all active models for a tenant and assembles them into a combined model definition — the same aggregation `lance_store.get_active_model()` does today.

- [ ] **Step 1: Write the failing test**

Add to `datacore/tests/test_api.py`:

```python
def test_list_models_returns_combined_definition(app_client):
    client, store = app_client
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={
            "base_fields": [{"name": "first_name", "type": "str", "required": True}],
            "custom_fields": [],
            "_source_filename": "test.pdf",
            "_created_by": "Jane",
        },
    )
    store.put_model(
        tenant_id="t1",
        entity_type="contact",
        model_definition={
            "base_fields": [{"name": "phone", "type": "phone", "required": True}],
            "custom_fields": [],
            "_source_filename": "test.pdf",
            "_created_by": "Jane",
        },
    )

    response = client.get("/api/models/t1")
    assert response.status_code == 200
    data = response.json()
    assert data["tenant_id"] == "t1"
    assert "student" in data["model_definition"]
    assert "contact" in data["model_definition"]
    assert data["model_definition"]["student"]["base_fields"][0]["name"] == "first_name"
    assert "version" in data
    assert "source_filename" in data
    assert "created_by" in data
    assert "created_at" in data


def test_list_models_empty_returns_404(app_client):
    client, _ = app_client
    response = client.get("/api/models/t1")
    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && uv run python -m pytest tests/test_api.py::test_list_models_returns_combined_definition tests/test_api.py::test_list_models_empty_returns_404 -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 3: Implement the endpoint**

In `datacore/src/datacore/api/routes.py`, inside `register_routes()`, add after the existing `get_model` endpoint (around line 141):

```python
    @app.get("/api/models/{tenant_id}")
    def list_tenant_models(tenant_id: str):
        """List all active models for a tenant, assembled into a combined definition."""
        rows = store.list_models(tenant_id, status="active")
        if not rows:
            raise HTTPException(status_code=404, detail="No models found")

        model_definition = {}
        for row in rows:
            entity_type = row["entity_type"]
            defn = row["model_definition"]
            clean_defn = {k: v for k, v in defn.items() if not k.startswith("_")}
            model_definition[entity_type] = clean_defn

        latest_row = max(rows, key=lambda r: r["_version"])
        first_defn = latest_row["model_definition"]

        return {
            "tenant_id": tenant_id,
            "version": max(row["_version"] for row in rows),
            "status": "active",
            "model_definition": model_definition,
            "source_filename": first_defn.get("_source_filename", ""),
            "created_by": first_defn.get("_created_by", ""),
            "created_at": max(row["_created_at"] for row in rows),
        }
```

**IMPORTANT:** This new route MUST be registered BEFORE the existing `get_model` route (`/api/models/{tenant_id}/{entity_type}`) to avoid FastAPI matching `{entity_type}` as a path parameter. Move the new route above the existing one.

- [ ] **Step 4: Run tests**

Run: `cd datacore && uv run python -m pytest tests/test_api.py -v`
Expected: All tests pass including the 2 new ones

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/api/routes.py datacore/tests/test_api.py
git commit -m "feat(datacore): add GET /api/models/{tenant_id} for combined model listing"
```

---

### Task 2: Add `PUT /api/models/{tenant_id}` to DataCore

**Files:**
- Modify: `datacore/src/datacore/api/routes.py`
- Modify: `datacore/tests/test_api.py`

This endpoint stores a finalized model definition, handling unchanged detection, tenant entity creation, and versioning — replacing what `lance_store.commit_finalize()` does today.

- [ ] **Step 1: Write the failing tests**

Add to `datacore/tests/test_api.py`:

```python
def test_put_models_creates_new(app_client):
    client, store = app_client
    response = client.put("/api/models/t1", json={
        "model_definition": {
            "student": {
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            }
        },
        "source_filename": "test.pdf",
        "created_by": "Jane Admin",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "finalized"
    assert data["version"] == 1
    assert "student" in data["model_definition"]
    assert data["source_filename"] == "test.pdf"
    assert data["created_by"] == "Jane Admin"


def test_put_models_unchanged(app_client):
    client, store = app_client
    body = {
        "model_definition": {
            "student": {
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            }
        },
        "source_filename": "test.pdf",
        "created_by": "Jane Admin",
    }
    client.put("/api/models/t1", json=body)
    # Second put with same definition
    response = client.put("/api/models/t1", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "unchanged"


def test_put_models_increments_version(app_client):
    client, store = app_client
    body1 = {
        "model_definition": {
            "student": {
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            }
        },
        "source_filename": "v1.pdf",
        "created_by": "Jane",
    }
    r1 = client.put("/api/models/t1", json=body1)
    assert r1.json()["version"] == 1

    body2 = {
        "model_definition": {
            "student": {
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                ],
                "custom_fields": [],
            }
        },
        "source_filename": "v2.pdf",
        "created_by": "Jane",
    }
    r2 = client.put("/api/models/t1", json=body2)
    assert r2.json()["version"] == 2
    assert r2.json()["status"] == "finalized"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && uv run python -m pytest tests/test_api.py::test_put_models_creates_new tests/test_api.py::test_put_models_unchanged tests/test_api.py::test_put_models_increments_version -v`
Expected: FAIL

- [ ] **Step 3: Implement the endpoint**

Add a request model at the top of `register_routes()` or near the other models:

```python
class PutModelsRequest(BaseModel):
    model_definition: dict
    source_filename: str
    created_by: str
```

Add the route inside `register_routes()`, before the existing per-entity-type routes:

```python
    @app.put("/api/models/{tenant_id}")
    def put_tenant_models(tenant_id: str, body: PutModelsRequest):
        """Store a finalized model definition for a tenant.

        Compares against existing active models. Returns 'unchanged' if identical.
        Creates tenant entity if missing. Stores each entity type with shared change_id.
        """
        # Normalize for comparison
        def normalize(md: dict) -> dict:
            return {
                et: {
                    "base_fields": sorted(d.get("base_fields", []), key=lambda f: f["name"]),
                    "custom_fields": sorted(d.get("custom_fields", []), key=lambda f: f["name"]),
                }
                for et, d in sorted(md.items())
            }

        # Check if unchanged
        existing_rows = store.list_models(tenant_id, status="active")
        if existing_rows:
            existing_def = {}
            for row in existing_rows:
                et = row["entity_type"]
                defn = row["model_definition"]
                existing_def[et] = {k: v for k, v in defn.items() if not k.startswith("_")}

            if normalize(existing_def) == normalize(body.model_definition):
                latest = max(existing_rows, key=lambda r: r["_version"])
                first_defn = latest["model_definition"]
                return {
                    "tenant_id": tenant_id,
                    "version": max(r["_version"] for r in existing_rows),
                    "status": "unchanged",
                    "model_definition": existing_def,
                    "source_filename": first_defn.get("_source_filename", ""),
                    "created_by": first_defn.get("_created_by", ""),
                    "created_at": max(r["_created_at"] for r in existing_rows),
                }

        # Ensure tenant exists
        if store.get_active_entity(tenant_id, "tenant", tenant_id) is None:
            store.put_entity(
                tenant_id=tenant_id,
                entity_type="tenant",
                entity_id=tenant_id,
                base_data={"tenant_id": tenant_id},
            )

        # Store each entity type with shared change_id
        change_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        max_version = 0

        for entity_type, definition in body.model_definition.items():
            model_def_with_meta = {
                **definition,
                "_source_filename": body.source_filename,
                "_created_by": body.created_by,
            }
            result = store.put_model(
                tenant_id=tenant_id,
                entity_type=entity_type,
                model_definition=model_def_with_meta,
                change_id=change_id,
            )
            max_version = max(max_version, result["_version"])

        return {
            "tenant_id": tenant_id,
            "version": max_version,
            "status": "finalized",
            "model_definition": body.model_definition,
            "source_filename": body.source_filename,
            "created_by": body.created_by,
            "created_at": now,
        }
```

Note: `uuid` and `datetime`/`timezone` are already imported at the top of `routes.py`.

- [ ] **Step 4: Run all tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/api/routes.py datacore/tests/test_api.py
git commit -m "feat(datacore): add PUT /api/models/{tenant_id} for model finalization"
```

---

### Task 3: Update Papermite config — add DataCore API URL, remove lancedb_dir

**Files:**
- Modify: `papermite/backend/app/config.py`

- [ ] **Step 1: Update config.py**

Replace `papermite/backend/app/config.py`:

```python
import json
import os
from pathlib import Path
from pydantic_settings import BaseSettings


def _load_services() -> dict:
    config_path = Path(__file__).resolve().parent.parent.parent.parent / "services.json"
    if config_path.exists():
        with open(config_path) as f:
            return json.load(f)["services"]
    return {}


_services = _load_services()


def _svc_url(key: str) -> str:
    svc = _services.get(key, {})
    host = svc.get("host", "localhost")
    port = svc.get("port", 6210)
    return f"http://{host}:{port}"


def _cors_origins() -> list[str]:
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]
    return [_svc_url(k) for k in _services if k.endswith("-frontend")]


class Settings(BaseSettings):
    datacore_auth_url: str = _svc_url("datacore") + "/auth"
    datacore_api_url: str = _svc_url("datacore") + "/api"
    default_model: str = "anthropic:claude-haiku-4-5-20251001"
    available_models: list[str] = [
        "anthropic:claude-haiku-4-5-20251001",
        "anthropic:claude-sonnet-4-6",
        "openai:gpt-4.1",
        "openai:gpt-5",
        "ollama:llama3.2",
    ]
    upload_dir: Path = Path(__file__).parent.parent / "uploads"
    port: int = _services.get("papermite-backend", {}).get("port", 6210)
    cors_origins: list[str] = _cors_origins()

    model_config = {"env_prefix": "PAPERMITE_"}


settings = Settings()
```

Key changes: Added `datacore_api_url`. Removed `lancedb_dir`.

- [ ] **Step 2: Verify import works**

Run: `cd papermite/backend && python -c "from app.config import settings; print(settings.datacore_api_url)"`
Expected: `http://localhost:6300/api`

- [ ] **Step 3: Commit**

```bash
git add papermite/backend/app/config.py
git commit -m "refactor(papermite): add datacore_api_url, remove lancedb_dir from config"
```

---

### Task 4: Update Papermite extraction.py and extract.py — use DataCore HTTP

**Files:**
- Modify: `papermite/backend/app/api/extraction.py`
- Modify: `papermite/backend/app/api/extract.py`

Both files import `get_active_model` from `lance_store`. Replace with an httpx call to DataCore.

- [ ] **Step 1: Update extraction.py**

Replace `papermite/backend/app/api/extraction.py`:

```python
"""Schema and model endpoints."""
import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.domain import ENTITY_CLASSES

router = APIRouter()


def _get_active_model(tenant_id: str) -> dict | None:
    """Fetch the combined active model from DataCore API."""
    resp = httpx.get(f"{settings.datacore_api_url}/models/{tenant_id}")
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    return resp.json()


@router.get("/schema")
def get_schema(user: UserRecord = Depends(require_admin)):
    """Return base model schemas so frontend knows which fields are base vs custom."""
    schemas = {}
    for name, cls in ENTITY_CLASSES.items():
        fields = {}
        for field_name, field_info in cls.model_fields.items():
            if field_name == "custom_fields":
                continue
            fields[field_name] = {
                "type": str(field_info.annotation),
                "required": field_info.is_required(),
                "default": repr(field_info.default) if field_info.default is not None else None,
            }
        schemas[name] = fields
    return schemas


@router.get("/config/models")
def get_available_models(user: UserRecord = Depends(require_admin)):
    """Return available LLM model options."""
    return {
        "default": settings.default_model,
        "models": settings.available_models,
    }


@router.get("/tenants/{tenant_id}/model")
def get_tenant_model(tenant_id: str, user: UserRecord = Depends(require_admin)):
    """Return the active model definition for the tenant, if it exists."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    model = _get_active_model(tenant_id)
    if model is None:
        return None
    return model
```

- [ ] **Step 2: Update extract.py**

Replace `papermite/backend/app/api/extract.py`:

```python
"""Document field extraction endpoint for cross-project add-student-entry flow."""
import shutil
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.services.parser import parse_document
from app.services.field_extractor import extract_fields

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}


def _get_active_model(tenant_id: str) -> dict | None:
    """Fetch the combined active model from DataCore API."""
    resp = httpx.get(f"{settings.datacore_api_url}/models/{tenant_id}")
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    return resp.json()


@router.post("/extract/{tenant_id}/{entity_type}")
def extract_document_fields(
    tenant_id: str,
    entity_type: str,
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_admin),
):
    """Extract field values from an uploaded document, guided by the entity model."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file format: {suffix}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    model = _get_active_model(tenant_id)
    if model is None:
        raise HTTPException(
            status_code=404,
            detail="No active model definition found. Configure a model first via Papermite.",
        )

    model_definition = model["model_definition"]
    if entity_type not in model_definition:
        raise HTTPException(
            status_code=404,
            detail=f"Entity type '{entity_type}' not found in model definition. "
                   f"Available: {', '.join(sorted(model_definition.keys()))}",
        )

    upload_dir = settings.upload_dir / tenant_id / "extract"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / Path(file.filename or "unknown").name
    try:
        with file_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        text = parse_document(file_path)
        fields = extract_fields(
            text=text,
            entity_type=entity_type,
            model_definition=model_definition,
            model_id=settings.default_model,
        )

        return {"fields": fields}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")
    finally:
        if file_path.exists():
            file_path.unlink()
```

- [ ] **Step 3: Commit**

```bash
git add papermite/backend/app/api/extraction.py papermite/backend/app/api/extract.py
git commit -m "refactor(papermite): fetch models via DataCore HTTP API"
```

---

### Task 5: Rewrite Papermite finalize.py — remove preview, commit via DataCore

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`

Move `_build_model_definition` and `_infer_type` from `lance_store.py` into `finalize.py`. Remove `preview` endpoint. Rewrite `commit` to POST to DataCore.

- [ ] **Step 1: Replace finalize.py**

```python
"""Finalize endpoint — commit model definition via DataCore API."""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.extraction import ExtractionResult, EntityResult

router = APIRouter()


class FinalizeRequest(BaseModel):
    extraction: ExtractionResult


def _infer_type(value) -> str:
    """Infer a simple type string from a Python value."""
    if value is None:
        return "str"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (list, dict)):
        return "selection"
    return "str"


def _build_model_definition(entities: list[EntityResult]) -> dict:
    """Convert extraction entities into a model definition (schema only)."""
    from app.models.domain import ENTITY_CLASSES

    model_def: dict[str, dict] = {}

    for entity_result in entities:
        entity_type = entity_result.entity_type.lower()

        model_class = ENTITY_CLASSES.get(entity_type)
        schema_fields = set(model_class.model_fields.keys()) if model_class else set()

        base_fields: list[dict] = []
        custom_fields: list[dict] = []

        for mapping in entity_result.field_mappings:
            field_type = mapping.field_type if mapping.field_type != "str" else _infer_type(mapping.value)
            field_def: dict = {
                "name": mapping.field_name,
                "type": field_type,
                "required": mapping.required,
            }
            if field_type == "selection":
                field_def["options"] = mapping.options or []
                field_def["multiple"] = mapping.multiple or False

            if mapping.source == "base_model":
                base_fields.append(field_def)
            else:
                custom_fields.append(field_def)

        if entity_type in model_def:
            existing_base_names = {f["name"] for f in model_def[entity_type]["base_fields"]}
            existing_custom_names = {f["name"] for f in model_def[entity_type]["custom_fields"]}
            for f in base_fields:
                if f["name"] not in existing_base_names:
                    model_def[entity_type]["base_fields"].append(f)
            for f in custom_fields:
                if f["name"] not in existing_custom_names:
                    model_def[entity_type]["custom_fields"].append(f)
        else:
            model_def[entity_type] = {
                "base_fields": base_fields,
                "custom_fields": custom_fields,
            }

    return model_def


@router.post("/tenants/{tenant_id}/finalize/commit")
async def finalize_commit(
    tenant_id: str,
    request: FinalizeRequest,
    user: UserRecord = Depends(require_admin),
):
    """Build model definition from extraction and store via DataCore API."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    extraction = request.extraction
    if extraction.tenant_id != tenant_id:
        raise HTTPException(status_code=400, detail="Extraction tenant_id mismatch")

    model_definition = _build_model_definition(extraction.entities)

    resp = httpx.put(
        f"{settings.datacore_api_url}/models/{tenant_id}",
        json={
            "model_definition": model_definition,
            "source_filename": extraction.filename,
            "created_by": user.name,
        },
        timeout=30.0,
    )
    if resp.status_code != 200:
        detail = resp.json().get("detail", "Finalization failed") if resp.headers.get("content-type", "").startswith("application/json") else "Finalization failed"
        raise HTTPException(status_code=resp.status_code, detail=detail)

    result = resp.json()
    return {
        "status": result["status"],
        "tenant_id": tenant_id,
        "version": result["version"],
        "entity_count": len(extraction.entities),
        "model_definition": result["model_definition"],
        "source_filename": result["source_filename"],
        "created_by": result["created_by"],
        "created_at": result["created_at"],
    }
```

Note: The `preview` endpoint is removed entirely. The `commit` endpoint no longer calls `lance_store` — it uses `httpx.put` to DataCore.

- [ ] **Step 2: Verify Papermite starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`

This will fail because `main.py` still registers the finalize router which previously had both endpoints. But the router name is the same (`finalize.router`), so it should work. However, check if anything else imports from `lance_store`.

- [ ] **Step 3: Commit**

```bash
git add papermite/backend/app/api/finalize.py
git commit -m "refactor(papermite): rewrite finalize to use DataCore HTTP API, remove preview"
```

---

### Task 6: Delete Papermite storage layer and update dependencies

**Files:**
- Delete: `papermite/backend/app/storage/lance_store.py`
- Delete: `papermite/backend/app/storage/__init__.py`
- Delete: `papermite/backend/tests/test_lance_store.py`
- Delete: `papermite/backend/tests/test_registry_store.py`
- Modify: `papermite/pyproject.toml`

- [ ] **Step 1: Delete storage files**

```bash
rm papermite/backend/app/storage/lance_store.py
rm papermite/backend/app/storage/__init__.py
rmdir papermite/backend/app/storage 2>/dev/null || true
```

- [ ] **Step 2: Delete obsolete test files**

```bash
rm papermite/backend/tests/test_lance_store.py
rm papermite/backend/tests/test_registry_store.py
```

- [ ] **Step 3: Remove datacore dependency from pyproject.toml**

In `papermite/pyproject.toml`, remove this line from `dependencies`:
```
    "datacore @ file:///Users/kennylee/Development/NeoApex/datacore",
```

Also remove `"python-toon>=0.1"` if it was only used by lance_store (check first — if other files import toon, keep it).

Run: `grep -r "import toon\|from toon" papermite/backend/app/ --include="*.py"`

If no matches outside storage, remove `"python-toon>=0.1"` from dependencies.

- [ ] **Step 4: Verify Papermite starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git rm papermite/backend/app/storage/lance_store.py papermite/backend/app/storage/__init__.py papermite/backend/tests/test_lance_store.py papermite/backend/tests/test_registry_store.py
git add papermite/pyproject.toml
git commit -m "refactor(papermite): remove storage layer and datacore dependency"
```

---

### Task 7: Update Papermite frontend — local preview

**Files:**
- Modify: `papermite/frontend/src/api/client.ts`
- Modify: `papermite/frontend/src/pages/FinalizedPage.tsx`

- [ ] **Step 1: Remove `previewFinalize` from client.ts**

In `papermite/frontend/src/api/client.ts`, delete the `previewFinalize` function (lines 184-199) and its import usage.

- [ ] **Step 2: Rewrite FinalizedPage.tsx useEffect for local preview**

In `papermite/frontend/src/pages/FinalizedPage.tsx`:

Replace the imports at the top:
```typescript
import { commitFinalize, getActiveModel } from "../api/client";
```

Remove `previewFinalize` from the import.

Replace the `useEffect` (lines 160-185) with:

```typescript
  useEffect(() => {
    if (!id || previewCalledRef.current) return;
    previewCalledRef.current = true;

    getDraft(id).then(async (draft) => {
      if (!draft) {
        navigate("/");
        return;
      }
      setExtraction(draft);
      setStatus("previewing");

      try {
        // Build model definition from draft extraction locally
        const modelDef: Record<string, { base_fields: Array<Record<string, unknown>>; custom_fields: Array<Record<string, unknown>> }> = {};
        for (const entity of draft.entities) {
          const entityType = entity.entity_type.toLowerCase();
          const baseFields: Array<Record<string, unknown>> = [];
          const customFields: Array<Record<string, unknown>> = [];

          for (const mapping of entity.field_mappings) {
            const fieldDef: Record<string, unknown> = {
              name: mapping.field_name,
              type: mapping.field_type || "str",
              required: mapping.required,
            };
            if (mapping.field_type === "selection") {
              fieldDef.options = mapping.options || [];
              fieldDef.multiple = mapping.multiple || false;
            }
            if (mapping.source === "base_model") {
              baseFields.push(fieldDef);
            } else {
              customFields.push(fieldDef);
            }
          }

          if (modelDef[entityType]) {
            const existingBaseNames = new Set(modelDef[entityType].base_fields.map((f) => f.name));
            const existingCustomNames = new Set(modelDef[entityType].custom_fields.map((f) => f.name));
            for (const f of baseFields) {
              if (!existingBaseNames.has(f.name as string)) modelDef[entityType].base_fields.push(f);
            }
            for (const f of customFields) {
              if (!existingCustomNames.has(f.name as string)) modelDef[entityType].custom_fields.push(f);
            }
          } else {
            modelDef[entityType] = { base_fields: baseFields, custom_fields: customFields };
          }
        }

        // Fetch current active model to compare
        let isUnchanged = false;
        let existingVersion = 0;
        let existingMeta: { source_filename?: string; created_by?: string; created_at?: string } = {};

        try {
          const active = await getActiveModel(user.tenant_id);
          if (active && active.model_definition) {
            existingVersion = active.version;
            existingMeta = {
              source_filename: active.source_filename,
              created_by: active.created_by,
              created_at: active.created_at,
            };

            // Normalize and compare
            const normalize = (md: Record<string, { base_fields: unknown[]; custom_fields: unknown[] }>) => {
              const sorted: Record<string, unknown> = {};
              for (const et of Object.keys(md).sort()) {
                sorted[et] = {
                  base_fields: [...md[et].base_fields].sort((a: any, b: any) => (a.name > b.name ? 1 : -1)),
                  custom_fields: [...md[et].custom_fields].sort((a: any, b: any) => (a.name > b.name ? 1 : -1)),
                };
              }
              return JSON.stringify(sorted);
            };

            isUnchanged = normalize(active.model_definition) === normalize(modelDef);
          }
        } catch {
          // No existing model — treat as new
        }

        const previewData: FinalizePreviewResponse = {
          status: isUnchanged ? "unchanged" : "pending_confirmation",
          tenant_id: user.tenant_id,
          version: isUnchanged ? existingVersion : existingVersion + 1,
          entity_count: draft.entities.length,
          model_definition: isUnchanged && existingMeta.source_filename ? modelDef : modelDef,
          source_filename: isUnchanged ? (existingMeta.source_filename || draft.filename) : draft.filename,
          created_by: isUnchanged ? existingMeta.created_by : user.name,
          created_at: isUnchanged ? existingMeta.created_at : undefined,
        };

        setPreview(previewData);
        setStatus(isUnchanged ? "unchanged" : "preview");

      } catch (e) {
        setError(e instanceof Error ? e.message : "Preview failed");
        setStatus("error");
      }
    });
  }, [id, user.tenant_id, user.name, navigate]);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd papermite/frontend && npx tsc -b`

- [ ] **Step 4: Commit**

```bash
git add papermite/frontend/src/api/client.ts papermite/frontend/src/pages/FinalizedPage.tsx
git commit -m "refactor(papermite): move preview logic to frontend, remove previewFinalize API call"
```

---

### Task 8: Verify end-to-end

- [ ] **Step 1: Run DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 2: Verify Papermite backend starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Verify no remaining datacore imports in Papermite**

Run: `grep -r "from datacore\|import datacore" papermite/ --include="*.py" | grep -v __pycache__ | grep -v .venv`
Expected: No matches

- [ ] **Step 4: Verify no remaining lance_store references**

Run: `grep -r "lance_store\|lancedb_dir\|NEOAPEX_LANCEDB" papermite/ --include="*.py" --include="*.ts" --include="*.tsx" | grep -v __pycache__ | grep -v .venv | grep -v node_modules`
Expected: No matches

- [ ] **Step 5: Start all services and test**

```bash
./start-services.sh
```

Verify:
1. DataCore on 6300 — `curl -s http://localhost:6300/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"jane@acme.edu","password":"admin123"}'`
2. Papermite backend on 6210 — login works
3. Papermite frontend on 6200 — Landing page loads, model displays (if one exists)
4. Finalize flow: preview shows locally without backend call, confirm saves via DataCore
