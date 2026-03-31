# Add Student Entry — Document Field Extraction Endpoint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /api/extract/{tenant_id}/{entity_type}` endpoint that accepts document uploads, extracts field values using the existing AI pipeline, maps them to the entity model definition stored in datacore, and returns them as a flat JSON object — without storing anything.

**Architecture:** New `extract.py` API route with a single endpoint. The endpoint fetches the active model definition from datacore (via `lance_store.get_active_model`), parses the uploaded document (via `parser.parse_document`), builds a targeted extraction prompt from the model's field definitions, runs AI extraction (via `pydantic-ai` Agent), and returns extracted values mapped to field names. CORS origins list updated to include admindash (`localhost:5174`).

**Tech Stack:** FastAPI, pydantic-ai, Docling (parser), datacore (model store), pytest + httpx (testing)

---

### Task 1: CORS Update

**Files:**
- Modify: `backend/app/main.py:14` (add origin to list)
- Test: `backend/tests/test_extract.py` (created in Task 2)

- [ ] **Step 1: Update CORS origins**

In `backend/app/main.py`, change the `allow_origins` list to include `http://localhost:5174`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add admindash origin to CORS allowed origins"
```

---

### Task 2: Extraction Service — `extract_fields_from_document`

This is the core logic: given a document and an entity model definition, extract field values.

**Files:**
- Create: `backend/app/services/field_extractor.py`
- Test: `backend/tests/test_field_extractor.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_field_extractor.py`:

```python
"""Tests for field_extractor service."""
from unittest.mock import patch, MagicMock
from app.services.field_extractor import extract_fields


def test_extract_fields_maps_to_model_fields():
    """Extracted values are mapped to model field names."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "dob", "type": "date", "required": False},
                {"name": "email", "type": "email", "required": False},
            ],
            "custom_fields": [
                {"name": "allergies", "type": "str", "required": False},
            ],
        }
    }

    # Mock the AI agent to return known values
    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
        "last_name": "Doe",
        "dob": "2015-03-15",
    }

    with patch("app.services.field_extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Student: Jane Doe, born March 15 2015",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {
        "first_name": "Jane",
        "last_name": "Doe",
        "dob": "2015-03-15",
    }


def test_extract_fields_partial_extraction():
    """Partial extraction returns only the fields that were found."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "dob", "type": "date", "required": False},
            ],
            "custom_fields": [],
        }
    }

    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
    }

    with patch("app.services.field_extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Applicant: Jane",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane"}


def test_extract_fields_filters_none_and_empty():
    """None and empty-string values are excluded from the result."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }

    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
        "last_name": None,
    }

    with patch("app.services.field_extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Applicant: Jane",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane"}


def test_extract_fields_unknown_entity_type():
    """When entity_type is not in model_definition, returns empty dict."""
    model_definition = {
        "student": {
            "base_fields": [{"name": "first_name", "type": "str", "required": True}],
            "custom_fields": [],
        }
    }

    result = extract_fields(
        text="Some doc text",
        entity_type="unknown_type",
        model_definition=model_definition,
        model_id="anthropic:claude-haiku-4-5-20251001",
    )

    assert result == {}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && pytest backend/tests/test_field_extractor.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.field_extractor'`

- [ ] **Step 3: Implement `field_extractor.py`**

Create `backend/app/services/field_extractor.py`:

```python
"""Targeted field extraction from documents using AI, guided by model definitions."""
from typing import Any

from pydantic_ai import Agent


def _build_field_prompt(entity_type: str, model_definition: dict) -> str:
    """Build an extraction prompt from the model's field definitions."""
    entity_def = model_definition.get(entity_type)
    if not entity_def:
        return ""

    all_fields = entity_def.get("base_fields", []) + entity_def.get("custom_fields", [])
    field_lines = []
    for f in all_fields:
        line = f"- {f['name']} ({f['type']})"
        if f.get("required"):
            line += " [required]"
        if f.get("options"):
            line += f" options: {f['options']}"
        field_lines.append(line)

    return (
        f"Extract the following {entity_type} fields from the document.\n"
        f"Return a JSON object with field names as keys and extracted values.\n"
        f"Only include fields where you find a value in the document.\n"
        f"Do NOT invent data.\n\n"
        f"Fields:\n" + "\n".join(field_lines)
    )


def extract_fields(
    text: str,
    entity_type: str,
    model_definition: dict,
    model_id: str,
) -> dict[str, Any]:
    """Extract field values from document text, guided by entity model definition.

    Returns a dict mapping field names to extracted values.
    Only fields with non-empty, non-None values are included.
    Returns empty dict if entity_type is not in model_definition.
    """
    prompt = _build_field_prompt(entity_type, model_definition)
    if not prompt:
        return {}

    agent = Agent(model_id, output_type=dict[str, Any], system_prompt=prompt)
    result = agent.run_sync(f"Extract fields from this document:\n\n{text}")

    # Filter out None and empty-string values
    return {k: v for k, v in result.output.items() if v is not None and v != ""}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && pytest backend/tests/test_field_extractor.py -v
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/field_extractor.py backend/tests/test_field_extractor.py
git commit -m "feat: add field_extractor service for model-guided document extraction"
```

---

### Task 3: Extract API Endpoint

**Files:**
- Create: `backend/app/api/extract.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_extract_api.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_extract_api.py`:

```python
"""Tests for POST /api/extract/{tenant_id}/{entity_type} endpoint."""
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import TestUser

client = TestClient(app)

FAKE_USER = TestUser(
    user_id="u1",
    name="Test Admin",
    email="admin@test.com",
    password="pass",
    tenant_id="t1",
    tenant_name="Test Tenant",
    role="tenant_admin",
)


@pytest.fixture(autouse=True)
def mock_auth():
    """Bypass auth for all tests."""
    with patch("app.api.extract.require_admin", return_value=FAKE_USER):
        yield


def _upload(tenant_id, entity_type, filename, content, content_type="application/pdf"):
    return client.post(
        f"/api/extract/{tenant_id}/{entity_type}",
        files={"file": (filename, content, content_type)},
    )


def test_unsupported_file_format():
    """Non-PDF/PNG/JPG/JPEG files return 422."""
    resp = _upload("t1", "student", "doc.docx", b"data", "application/msword")
    assert resp.status_code == 422
    assert "Unsupported" in resp.json()["detail"]


def test_model_not_found():
    """Returns 404 when no active model exists for tenant."""
    with patch("app.api.extract.get_active_model", return_value=None):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 404
    assert "model" in resp.json()["detail"].lower()


def test_entity_type_not_in_model():
    """Returns 404 when entity_type is not in the model definition."""
    fake_model = {
        "model_definition": {
            "student": {"base_fields": [], "custom_fields": []},
        }
    }
    with patch("app.api.extract.get_active_model", return_value=fake_model):
        resp = _upload("t1", "contact", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 404
    assert "contact" in resp.json()["detail"].lower()


def test_successful_extraction():
    """Full pipeline returns extracted fields."""
    fake_model = {
        "model_definition": {
            "student": {
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                ],
                "custom_fields": [],
            }
        }
    }
    with (
        patch("app.api.extract.get_active_model", return_value=fake_model),
        patch("app.api.extract.parse_document", return_value="Student: Jane Doe"),
        patch(
            "app.api.extract.extract_fields",
            return_value={"first_name": "Jane", "last_name": "Doe"},
        ),
    ):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 200
    body = resp.json()
    assert body["fields"]["first_name"] == "Jane"
    assert body["fields"]["last_name"] == "Doe"


def test_partial_extraction_is_success():
    """Partial extraction returns 200 with whatever was found."""
    fake_model = {
        "model_definition": {
            "student": {
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                ],
                "custom_fields": [],
            }
        }
    }
    with (
        patch("app.api.extract.get_active_model", return_value=fake_model),
        patch("app.api.extract.parse_document", return_value="Applicant: Jane"),
        patch(
            "app.api.extract.extract_fields",
            return_value={"first_name": "Jane"},
        ),
    ):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 200
    assert resp.json()["fields"] == {"first_name": "Jane"}


def test_tenant_mismatch():
    """Returns 403 when tenant_id doesn't match user."""
    resp = _upload("wrong_tenant", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && pytest backend/tests/test_extract_api.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.extract'`

- [ ] **Step 3: Implement `extract.py` route**

Create `backend/app/api/extract.py`:

```python
"""Document field extraction endpoint for cross-project add-student-entry flow."""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.api.auth import require_admin
from app.config import TestUser, settings
from app.services.parser import parse_document
from app.services.field_extractor import extract_fields
from app.storage.lance_store import get_active_model

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}


@router.post("/extract/{tenant_id}/{entity_type}")
def extract_document_fields(
    tenant_id: str,
    entity_type: str,
    file: UploadFile = File(...),
    user: TestUser = Depends(require_admin),
):
    """Extract field values from an uploaded document, guided by the entity model.

    Returns {"fields": {"field_name": "value", ...}} with only successfully
    extracted fields. Partial extraction is success (HTTP 200), not failure.
    """
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    # Validate file format
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file format: {suffix}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Fetch model definition from datacore
    model = get_active_model(tenant_id)
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

    # Save uploaded file temporarily
    upload_dir = settings.upload_dir / tenant_id / "extract"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / file.filename
    try:
        with file_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        # Parse document → extract fields
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
        # Clean up temp file
        if file_path.exists():
            file_path.unlink()
```

- [ ] **Step 4: Register the router in `main.py`**

In `backend/app/main.py`, add the import and router registration:

```python
from app.api import auth, upload, extraction, finalize, extract
```

And add after the finalize router:

```python
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && pytest backend/tests/test_extract_api.py -v
```

Expected: All 6 tests PASS

- [ ] **Step 6: Run all existing tests to check for regressions**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && pytest backend/tests/ -v
```

Expected: All tests PASS (existing + new)

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/extract.py backend/app/main.py backend/tests/test_extract_api.py
git commit -m "feat: add POST /api/extract/{tenant_id}/{entity_type} endpoint for document field extraction"
```

---

### Task 4: Integration Smoke Test

Verify the full endpoint works end-to-end with a manual test.

**Files:** (none — manual verification)

- [ ] **Step 1: Start the backend server**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000 --app-dir backend
```

- [ ] **Step 2: Verify the endpoint appears in OpenAPI docs**

Open `http://localhost:8000/docs` in a browser and confirm `POST /api/extract/{tenant_id}/{entity_type}` is listed under the "extract" tag.

- [ ] **Step 3: Verify CORS headers**

```bash
curl -i -X OPTIONS http://localhost:8000/api/extract/t1/student \
  -H "Origin: http://localhost:5174" \
  -H "Access-Control-Request-Method: POST"
```

Expected: Response includes `access-control-allow-origin: http://localhost:5174`

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| Create | `backend/app/services/field_extractor.py` | Model-guided AI field extraction |
| Create | `backend/app/api/extract.py` | `POST /api/extract/{tenant_id}/{entity_type}` endpoint |
| Create | `backend/tests/test_field_extractor.py` | Unit tests for field extractor service |
| Create | `backend/tests/test_extract_api.py` | API endpoint tests |
| Modify | `backend/app/main.py` | CORS update + register extract router |
