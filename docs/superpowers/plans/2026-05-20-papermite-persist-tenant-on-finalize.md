# Papermite Persist Tenant On Finalize — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Papermite's `POST /api/tenants/{tenant_id}/finalize/commit` writes the model definition, also persist values extracted from the `TENANT` `EntityResult` to DataCore's `tenants` table, merging only into empty fields so user-typed values are preserved. Fixes GitHub issue #69 (Launchpad tenant detail blank after finalize).

**Architecture:** A handful of pure helpers in `papermite/backend/app/api/finalize.py` (`_is_empty`, `_split_extracted_tenant`, `_split_existing_tenant_row`, `_merge_fields`, `_fetch_existing_tenant_row`) plus a small block of wiring at the bottom of `finalize_commit`. Reads the existing tenant row via `POST /api/query` (same pattern Launchpad uses) and writes the merged result via `PUT /api/tenants/{tenant_id}`. Base/custom split is done by membership in `Tenant.model_fields` — no `toon` dependency added. On any tenant read/write failure, raises HTTP 502; the prior model write is not rolled back.

**Tech Stack:** Python 3, FastAPI, Pydantic, `httpx`, `pytest`, `unittest.mock`. Existing test infra at `papermite/backend/tests/`. Backend deps managed via `uv`.

**Spec source (authoritative for behavior):**
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-persist-tenant-on-finalize/proposal.md`
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-persist-tenant-on-finalize/design.md`
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-persist-tenant-on-finalize/specs/papermite-finalize-tenant-persistence/spec.md`
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-persist-tenant-on-finalize/tasks.md`

**Out of scope:** No UI changes. No DataCore changes. No new dependencies. No changes to extraction/mapper. No retry/queue. Stringified values from `/api/query` are pass-through (matches existing Launchpad behavior).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `papermite/backend/app/api/finalize.py` | Modify | Add pure helpers (`_is_empty`, `_split_extracted_tenant`, `_split_existing_tenant_row`, `_merge_fields`), I/O helper (`_fetch_existing_tenant_row`), wire into `finalize_commit` |
| `papermite/backend/tests/test_finalize_helpers.py` | Create | Pure-helper unit tests (9 cases) |
| `papermite/backend/tests/test_finalize_api.py` | Modify | Endpoint integration tests for tenant persistence (7 new cases) |

All new helpers live in `finalize.py` (one file, focused responsibility). No new module. No abstraction beyond what the requirements demand.

---

## Conventions used by this plan

- All paths absolute and relative to repo root `/Users/kennylee/Development/NeoApex`.
- All test runs use `cd papermite/backend && uv run python -m pytest <args>`. The `cd` is required because the backend has its own `pyproject.toml` and `uv` lockfile.
- Commit messages follow the pattern visible in `git log --oneline -20` for papermite work: `<type>(papermite): <summary>` where `<type>` is `feat`, `fix`, `test`, or `refactor`. Include the issue number `(#69)` in the final commit.
- TDD: every task writes a failing test first, runs it to confirm failure, then implements minimum code, then runs to confirm pass, then commits.

---

### Task 1: Add `_is_empty` helper (pure)

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`
- Create: `papermite/backend/tests/test_finalize_helpers.py`

- [ ] **Step 1.1: Create the test file with two failing tests**

Create `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_helpers.py` with this exact content:

```python
"""Unit tests for pure helpers in app.api.finalize.

These cover the building blocks used to persist extracted tenant values
to DataCore on finalize (issue #69).
"""
from app.api.finalize import _is_empty


def test_is_empty_returns_true_for_none_and_blank_strings():
    assert _is_empty(None) is True
    assert _is_empty("") is True
    assert _is_empty("   ") is True
    assert _is_empty("\t\n") is True


def test_is_empty_returns_false_for_falsy_nonblank_values():
    # Falsy but meaningful — must NOT be treated as empty
    assert _is_empty(0) is False
    assert _is_empty(False) is False
    assert _is_empty([]) is False
    assert _is_empty({}) is False
    # Strings that LOOK falsy but are real content (e.g. from DataCore
    # query flattening which stringifies everything)
    assert _is_empty("0") is False
    assert _is_empty("False") is False
    assert _is_empty(" x ") is False
```

- [ ] **Step 1.2: Run the tests and confirm they fail with ImportError**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected output contains: `ImportError: cannot import name '_is_empty' from 'app.api.finalize'` (or `ModuleNotFoundError` style). Either way: 2 errors collected, 0 passed.

- [ ] **Step 1.3: Add `_is_empty` to `finalize.py`**

In `/Users/kennylee/Development/NeoApex/papermite/backend/app/api/finalize.py`, after the existing `_infer_type` function (currently ending at line 28) and before `_build_model_definition` (currently at line 31), insert this helper:

```python
def _is_empty(value) -> bool:
    """Return True iff `value` is None or a whitespace-only string.

    Falsy non-string values (0, False, [], {}) are NOT empty — they are
    legitimate user input. Strings like "0" or "False" (which can arise
    from DataCore's query flattening that stringifies everything) are
    also NOT empty.
    """
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False
```

- [ ] **Step 1.4: Run the tests and confirm they pass**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 2 passed.

- [ ] **Step 1.5: Commit**

```bash
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_helpers.py
git commit -m "test(papermite): add _is_empty helper for finalize tenant persistence"
```

---

### Task 2: Add `_split_extracted_tenant` helper (pure)

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`
- Modify: `papermite/backend/tests/test_finalize_helpers.py`

- [ ] **Step 2.1: Add the failing test**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_helpers.py`:

```python


def test_split_extracted_tenant_routes_by_source_and_drops_empties():
    from app.api.finalize import _split_extracted_tenant
    from app.models.extraction import EntityResult, FieldMapping

    entity = EntityResult(
        entity_type="TENANT",
        entity={},  # contents irrelevant — splitter reads field_mappings
        field_mappings=[
            FieldMapping(field_name="name", value="Acme", source="base_model",
                         required=True, field_type="str"),
            FieldMapping(field_name="contact_phone", value=None, source="base_model",
                         required=False, field_type="phone"),
            FieldMapping(field_name="display_name", value="   ", source="base_model",
                         required=True, field_type="str"),
            FieldMapping(field_name="school_district_code", value="DC-100",
                         source="custom_field", required=False, field_type="str"),
            FieldMapping(field_name="legacy", value="", source="custom_field",
                         required=False, field_type="str"),
        ],
    )

    base, custom = _split_extracted_tenant(entity)

    assert base == {"name": "Acme"}
    assert custom == {"school_district_code": "DC-100"}
```

- [ ] **Step 2.2: Run the test and confirm it fails**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py::test_split_extracted_tenant_routes_by_source_and_drops_empties -v
```

Expected: `ImportError: cannot import name '_split_extracted_tenant'`.

- [ ] **Step 2.3: Implement `_split_extracted_tenant` in `finalize.py`**

In `/Users/kennylee/Development/NeoApex/papermite/backend/app/api/finalize.py`, immediately after `_is_empty` (added in Task 1), insert:

```python
def _split_extracted_tenant(entity: "EntityResult") -> tuple[dict, dict]:
    """Split an extracted TENANT entity's field_mappings into base and custom dicts.

    - Mappings with `source == "base_model"` go to the base dict.
    - Mappings with `source == "custom_field"` go to the custom dict.
    - Mappings whose value is empty (per `_is_empty`) are dropped from both.

    Returns:
        (extracted_base, extracted_custom)
    """
    extracted_base: dict = {}
    extracted_custom: dict = {}
    for mapping in entity.field_mappings:
        if _is_empty(mapping.value):
            continue
        if mapping.source == "base_model":
            extracted_base[mapping.field_name] = mapping.value
        elif mapping.source == "custom_field":
            extracted_custom[mapping.field_name] = mapping.value
    return extracted_base, extracted_custom
```

Note: the `EntityResult` type referenced in the signature is already imported at the top of `finalize.py` (line 9: `from app.models.extraction import ExtractionResult, EntityResult`). The string annotation `"EntityResult"` works either way; keep it as a regular reference if you prefer — both are fine since the import already exists.

To use the unquoted form, replace the signature with:

```python
def _split_extracted_tenant(entity: EntityResult) -> tuple[dict, dict]:
```

Pick whichever matches the surrounding style — the existing `_build_model_definition` uses `list[EntityResult]` (unquoted) at line 31, so prefer the unquoted form.

- [ ] **Step 2.4: Run the test and confirm it passes**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 3 passed.

- [ ] **Step 2.5: Commit**

```bash
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_helpers.py
git commit -m "test(papermite): add _split_extracted_tenant helper"
```

---

### Task 3: Add `_split_existing_tenant_row` helper (pure)

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`
- Modify: `papermite/backend/tests/test_finalize_helpers.py`

Context: classification uses `app.models.domain.Tenant.model_fields`. The current `Tenant` fields are (see `papermite/backend/app/models/domain.py:150-161`):
`tenant_id, entity_type, custom_fields, name, display_name, contact_email, contact_phone, primary_address, mailing_address, license_number, capacity, accreditation, insurance_provider`. The three system fields (`tenant_id`, `entity_type`, `custom_fields`) are excluded from the base-key set so they cannot accidentally route an arbitrary key to base when they appear in the existing row.

- [ ] **Step 3.1: Add the failing tests**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_helpers.py`:

```python


def test_split_existing_tenant_row_uses_tenant_model_fields_as_discriminator():
    from app.api.finalize import _split_existing_tenant_row

    cleaned = {
        "name": "Acme",
        "contact_email": "a@x.com",
        "school_district_code": "DC-100",
        "accreditation_id": "ACC-42",
    }
    base, custom = _split_existing_tenant_row(cleaned)

    # name and contact_email are real Tenant base fields
    assert base == {"name": "Acme", "contact_email": "a@x.com"}
    # the others are not in Tenant.model_fields
    assert custom == {
        "school_district_code": "DC-100",
        "accreditation_id": "ACC-42",
    }


def test_split_existing_tenant_row_excludes_system_fields_from_base_bucket():
    """tenant_id / entity_type / custom_fields are NOT base-classified even though
    they're declared on Tenant — they're system fields."""
    from app.api.finalize import _split_existing_tenant_row

    cleaned = {
        "tenant_id": "t1",
        "entity_type": "tenant",
        "custom_fields": "should-not-happen-but-be-safe",
        "name": "Acme",
    }
    base, custom = _split_existing_tenant_row(cleaned)

    assert base == {"name": "Acme"}
    # tenant_id / entity_type / custom_fields fall through to custom because
    # they're filtered out of the base-key set
    assert custom == {
        "tenant_id": "t1",
        "entity_type": "tenant",
        "custom_fields": "should-not-happen-but-be-safe",
    }
```

- [ ] **Step 3.2: Run the tests and confirm they fail**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 2 new tests error with `ImportError: cannot import name '_split_existing_tenant_row'`.

- [ ] **Step 3.3: Implement `_split_existing_tenant_row` in `finalize.py`**

Two changes to `/Users/kennylee/Development/NeoApex/papermite/backend/app/api/finalize.py`:

(a) Add an import at the top — find the existing imports near lines 1-9, then add this line **after** `from app.models.extraction import ExtractionResult, EntityResult`:

```python
from app.models.domain import Tenant
```

(b) Just below the imports, add a module-level constant (before the existing `router = APIRouter()` line):

```python
# Base-data field names for the Tenant entity. Used to classify columns
# returned by DataCore's /api/query (which flattens base_data and
# custom_fields into a single top-level column set). System fields are
# excluded so they cannot accidentally route an unrelated key to the
# base bucket.
_TENANT_BASE_KEYS: frozenset[str] = frozenset(
    set(Tenant.model_fields.keys()) - {"tenant_id", "entity_type", "custom_fields"}
)
```

(c) Add the helper next to the other helpers (immediately after `_split_extracted_tenant` from Task 2):

```python
def _split_existing_tenant_row(cleaned: dict) -> tuple[dict, dict]:
    """Split a cleaned existing tenant row into base and custom dicts.

    "Cleaned" means: already stripped of internal columns (_status,
    _version, _created_at, _updated_at, _change_id, entity_type,
    entity_id, base_data, custom_fields, vector), any key starting
    with `_`, and any None value. The caller (_fetch_existing_tenant_row)
    is responsible for that cleaning step.

    Classification: keys in `_TENANT_BASE_KEYS` go to base; everything
    else goes to custom.
    """
    existing_base: dict = {}
    existing_custom: dict = {}
    for key, value in cleaned.items():
        if key in _TENANT_BASE_KEYS:
            existing_base[key] = value
        else:
            existing_custom[key] = value
    return existing_base, existing_custom
```

- [ ] **Step 3.4: Run the tests and confirm they pass**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 5 passed.

- [ ] **Step 3.5: Commit**

```bash
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_helpers.py
git commit -m "test(papermite): add _split_existing_tenant_row helper"
```

---

### Task 4: Add `_merge_fields` helper (pure)

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`
- Modify: `papermite/backend/tests/test_finalize_helpers.py`

- [ ] **Step 4.1: Add the failing tests**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_helpers.py`:

```python


def test_merge_fields_fills_missing_keys():
    from app.api.finalize import _merge_fields
    assert _merge_fields({"a": "x"}, {"b": "y"}) == {"a": "x", "b": "y"}


def test_merge_fields_fills_none_and_empty_and_whitespace():
    from app.api.finalize import _merge_fields
    existing = {"a": None, "b": "", "c": "   "}
    extracted = {"a": "1", "b": "2", "c": "3"}
    assert _merge_fields(existing, extracted) == {"a": "1", "b": "2", "c": "3"}


def test_merge_fields_preserves_nonempty_string_over_extracted():
    from app.api.finalize import _merge_fields
    assert _merge_fields({"a": "kept"}, {"a": "overwritten"}) == {"a": "kept"}


def test_merge_fields_preserves_stringified_false_and_zero():
    """DataCore /api/query stringifies all values: False -> 'False', 0 -> '0',
    [] -> '[]'. Those are non-empty strings and MUST be preserved."""
    from app.api.finalize import _merge_fields
    existing = {"a": "False", "b": "0", "c": "[]"}
    extracted = {"a": True, "b": 1, "c": [1, 2]}
    assert _merge_fields(existing, extracted) == {"a": "False", "b": "0", "c": "[]"}


def test_merge_fields_preserves_existing_keys_not_in_extracted():
    from app.api.finalize import _merge_fields
    existing = {"a": "kept", "b": "also-kept"}
    extracted = {"c": "new"}
    assert _merge_fields(existing, extracted) == {
        "a": "kept",
        "b": "also-kept",
        "c": "new",
    }
```

- [ ] **Step 4.2: Run the tests and confirm they fail**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 5 new tests error with `ImportError: cannot import name '_merge_fields'`.

- [ ] **Step 4.3: Implement `_merge_fields` in `finalize.py`**

In `/Users/kennylee/Development/NeoApex/papermite/backend/app/api/finalize.py`, immediately after `_split_existing_tenant_row` (added in Task 3), insert:

```python
def _merge_fields(existing: dict, extracted: dict) -> dict:
    """Return a new dict that fills empty fields in `existing` with values from `extracted`.

    For each (k, v) in `extracted`: if `_is_empty(existing.get(k))`, set
    the merged value to v; otherwise keep existing's value. Keys present
    in `existing` but absent from `extracted` are preserved unchanged.

    Pure function — no I/O. Does not mutate either input.
    """
    merged = dict(existing)
    for key, extracted_value in extracted.items():
        if _is_empty(merged.get(key)):
            merged[key] = extracted_value
    return merged
```

- [ ] **Step 4.4: Run the tests and confirm they pass**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 10 passed.

- [ ] **Step 4.5: Commit**

```bash
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_helpers.py
git commit -m "test(papermite): add _merge_fields helper for tenant persistence"
```

---

### Task 5: Add `_fetch_existing_tenant_row` helper (I/O — mocked)

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`
- Modify: `papermite/backend/tests/test_finalize_helpers.py`

This helper makes a real HTTP call in production, so the tests mock `httpx.post`.

- [ ] **Step 5.1: Add the failing tests**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_helpers.py`:

```python


def test_fetch_existing_tenant_row_returns_empty_dict_when_no_active_row():
    from unittest.mock import MagicMock, patch
    from app.api.finalize import _fetch_existing_tenant_row

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"data": [], "total": 0}

    with patch("app.api.finalize.httpx.post", return_value=mock_resp) as mock_post:
        result = _fetch_existing_tenant_row("t1")

    assert result == {}
    assert mock_post.call_count == 1
    call_kwargs = mock_post.call_args.kwargs
    assert call_kwargs["json"] == {
        "tenant_id": "t1",
        "table": "tenants",
        "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
    }


def test_fetch_existing_tenant_row_cleans_internal_and_underscore_columns():
    from unittest.mock import MagicMock, patch
    from app.api.finalize import _fetch_existing_tenant_row

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [
            {
                "_status": "active",
                "_version": 3,
                "_created_at": "2026-01-01",
                "_updated_at": "2026-01-02",
                "_change_id": "abc",
                "entity_type": "tenant",
                "entity_id": "t1",
                "base_data": "<encoded-toon>",
                "custom_fields": "<encoded-toon>",
                "vector": [0.1, 0.2],
                "_abbrev": "AC",  # underscore-prefixed → drop
                "name": "Acme",
                "contact_email": "a@x.com",
                "contact_phone": None,  # None → drop
                "school_district_code": "DC-100",
            }
        ],
        "total": 1,
    }

    with patch("app.api.finalize.httpx.post", return_value=mock_resp):
        result = _fetch_existing_tenant_row("t1")

    assert result == {
        "name": "Acme",
        "contact_email": "a@x.com",
        "school_district_code": "DC-100",
    }


def test_fetch_existing_tenant_row_raises_502_on_non_2xx():
    from unittest.mock import MagicMock, patch
    import pytest as _pytest
    from fastapi import HTTPException
    from app.api.finalize import _fetch_existing_tenant_row

    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.json.return_value = {"detail": "boom"}

    with patch("app.api.finalize.httpx.post", return_value=mock_resp):
        with _pytest.raises(HTTPException) as exc_info:
            _fetch_existing_tenant_row("t1")

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Failed to persist tenant from extraction"


def test_fetch_existing_tenant_row_raises_502_on_connection_error():
    from unittest.mock import patch
    import pytest as _pytest
    import httpx
    from fastapi import HTTPException
    from app.api.finalize import _fetch_existing_tenant_row

    with patch(
        "app.api.finalize.httpx.post",
        side_effect=httpx.ConnectError("unreachable"),
    ):
        with _pytest.raises(HTTPException) as exc_info:
            _fetch_existing_tenant_row("t1")

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Failed to persist tenant from extraction"
```

- [ ] **Step 5.2: Run the tests and confirm they fail**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 4 new tests error with `ImportError: cannot import name '_fetch_existing_tenant_row'`.

- [ ] **Step 5.3: Implement `_fetch_existing_tenant_row` in `finalize.py`**

In `/Users/kennylee/Development/NeoApex/papermite/backend/app/api/finalize.py`, immediately after `_merge_fields` (added in Task 4), insert:

```python
# Columns returned by DataCore's /api/query that are storage internals
# rather than tenant data. Stripped before classification.
_TENANT_ROW_INTERNAL_COLUMNS: frozenset[str] = frozenset({
    "_status", "_version", "_created_at", "_updated_at", "_change_id",
    "entity_type", "entity_id", "base_data", "custom_fields", "vector",
})


def _fetch_existing_tenant_row(tenant_id: str) -> dict:
    """Read the active tenant row from DataCore and return its cleaned columns.

    Uses POST /api/query (the same pattern Launchpad's
    `update_tenant_profile` uses) because DataCore exposes no
    GET-by-id endpoint for tenants.

    Returns {} when no active row exists.

    Cleaning: drops internal storage columns, any key starting with `_`
    (e.g. `_abbrev` — DataCore re-derives it on PUT), and any None value.

    Raises HTTPException(502) on any non-2xx response or transport
    failure.
    """
    try:
        resp = httpx.post(
            f"{settings.datacore_api_url}/query",
            json={
                "tenant_id": tenant_id,
                "table": "tenants",
                "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
            },
            timeout=30.0,
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Failed to persist tenant from extraction",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Failed to persist tenant from extraction",
        )

    rows = resp.json().get("data", [])
    if not rows:
        return {}

    raw = rows[0]
    cleaned: dict = {}
    for key, value in raw.items():
        if key in _TENANT_ROW_INTERNAL_COLUMNS:
            continue
        if key.startswith("_"):
            continue
        if value is None:
            continue
        cleaned[key] = value
    return cleaned
```

- [ ] **Step 5.4: Run the tests and confirm they pass**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_helpers.py -v
```

Expected: 14 passed.

- [ ] **Step 5.5: Commit**

```bash
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_helpers.py
git commit -m "test(papermite): add _fetch_existing_tenant_row helper"
```

---

### Task 6: Wire tenant persistence into `finalize_commit` — happy path test

**Files:**
- Modify: `papermite/backend/app/api/finalize.py:80-123`
- Modify: `papermite/backend/tests/test_finalize_api.py`

Context: the existing `finalize_commit` function ends at line 123. The wiring goes after the existing model-write block (which today ends at the `return { ... }` block at lines 113-123). Behavior to add: locate the TENANT entity → split extracted → if both buckets empty, return as today → otherwise fetch + split existing → merge each bucket → PUT to DataCore.

The endpoint integration tests in this task and the next set live in `test_finalize_api.py` because they exercise the full HTTP path via the FastAPI `TestClient`.

- [ ] **Step 6.1: Add the failing happy-path test**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_api.py` (at the end of the file, after `test_finalize_rejects_tenant_mismatch`):

```python


def _payload_with_tenant_entity(
    tenant_base: dict | None = None,
    tenant_custom: dict | None = None,
) -> dict:
    """Build a finalize payload whose extraction includes a TENANT entity.

    `tenant_base` and `tenant_custom` are dicts of field_name -> value.
    Each pair becomes a FieldMapping with the matching `source`.
    """
    tenant_base = tenant_base or {}
    tenant_custom = tenant_custom or {}
    mappings = []
    for name, value in tenant_base.items():
        mappings.append({
            "field_name": name, "value": value, "source": "base_model",
            "required": False, "field_type": "str",
        })
    for name, value in tenant_custom.items():
        mappings.append({
            "field_name": name, "value": value, "source": "custom_field",
            "required": False, "field_type": "str",
        })
    return {
        "extraction": {
            "extraction_id": "e1",
            "tenant_id": "t1",
            "filename": "app.pdf",
            "entities": [
                {
                    "entity_type": "TENANT",
                    "entity": {},  # mapper produces this; splitter doesn't read it
                    "field_mappings": mappings,
                }
            ],
            "status": "pending_review",
        }
    }


def test_finalize_persists_extracted_tenant_when_row_empty():
    """Happy path: no existing tenant row → PUT the merged extracted values."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url, "json": json})
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        if "/models/" in url:
            mock_resp.json.return_value = _datacore_response_payload(
                json.get("model_definition") or {}
            )
        else:
            mock_resp.json.return_value = {}
        return mock_resp

    def fake_post(url, *, json, timeout):  # noqa: ARG001
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [], "total": 0}
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post", side_effect=fake_post) as mock_post:
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_tenant_entity(
                tenant_base={"name": "Acme"},
                tenant_custom={"school_district_code": "DC-100"},
            ),
        )

    assert resp.status_code == 200, resp.text

    # Exactly two PUTs: models first, tenants second
    assert len(put_calls) == 2, put_calls
    assert "/models/t1" in put_calls[0]["url"]
    assert put_calls[1]["url"].endswith("/tenants/t1")
    assert put_calls[1]["json"] == {
        "base_data": {"name": "Acme"},
        "custom_fields": {"school_district_code": "DC-100"},
    }

    # And we read existing first
    assert mock_post.call_count == 1
```

- [ ] **Step 6.2: Run the test and confirm it fails**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py::test_finalize_persists_extracted_tenant_when_row_empty -v
```

Expected: FAIL with `assert len(put_calls) == 2` (currently only 1 PUT happens). The behavior under test does not yet exist.

- [ ] **Step 6.3: Wire tenant persistence into `finalize_commit`**

In `/Users/kennylee/Development/NeoApex/papermite/backend/app/api/finalize.py`, modify `finalize_commit` to add tenant persistence after the existing model-write success block.

Find the current end of `finalize_commit` (the `return { ... }` block, lines 113-123 of the original file). Immediately before that `return`, insert this block:

```python
    # --- Persist extracted tenant values to DataCore (issue #69) ---
    # Pure: locate the TENANT entity and split its field_mappings.
    tenant_entity = next(
        (e for e in extraction.entities if e.entity_type == "TENANT"),
        None,
    )
    if tenant_entity is not None:
        extracted_base, extracted_custom = _split_extracted_tenant(tenant_entity)
        if extracted_base or extracted_custom:
            cleaned = _fetch_existing_tenant_row(tenant_id)
            existing_base, existing_custom = _split_existing_tenant_row(cleaned)
            merged_base = _merge_fields(existing_base, extracted_base)
            merged_custom = _merge_fields(existing_custom, extracted_custom)

            try:
                tenant_resp = httpx.put(
                    f"{settings.datacore_api_url}/tenants/{tenant_id}",
                    json={"base_data": merged_base, "custom_fields": merged_custom},
                    timeout=30.0,
                )
            except httpx.HTTPError:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to persist tenant from extraction",
                )
            if tenant_resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail="Failed to persist tenant from extraction",
                )
    # --- end tenant persistence ---
```

The full `finalize_commit` after this change should look like (for reference — the existing top portion is unchanged):

```python
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
        detail = "Finalization failed"
        try:
            detail = resp.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=resp.status_code, detail=detail)

    result = resp.json()

    # --- Persist extracted tenant values to DataCore (issue #69) ---
    tenant_entity = next(
        (e for e in extraction.entities if e.entity_type == "TENANT"),
        None,
    )
    if tenant_entity is not None:
        extracted_base, extracted_custom = _split_extracted_tenant(tenant_entity)
        if extracted_base or extracted_custom:
            cleaned = _fetch_existing_tenant_row(tenant_id)
            existing_base, existing_custom = _split_existing_tenant_row(cleaned)
            merged_base = _merge_fields(existing_base, extracted_base)
            merged_custom = _merge_fields(existing_custom, extracted_custom)

            try:
                tenant_resp = httpx.put(
                    f"{settings.datacore_api_url}/tenants/{tenant_id}",
                    json={"base_data": merged_base, "custom_fields": merged_custom},
                    timeout=30.0,
                )
            except httpx.HTTPError:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to persist tenant from extraction",
                )
            if tenant_resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail="Failed to persist tenant from extraction",
                )
    # --- end tenant persistence ---

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

- [ ] **Step 6.4: Run the test and confirm it passes**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py::test_finalize_persists_extracted_tenant_when_row_empty -v
```

Expected: PASS.

- [ ] **Step 6.5: Run the existing finalize tests to confirm no regression**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py -v
```

Expected: all tests pass, including the two pre-existing tests (`test_renamed_custom_field_is_passed_through_to_datacore`, `test_finalize_rejects_tenant_mismatch`).

Note: the pre-existing happy-path test (`test_renamed_custom_field_is_passed_through_to_datacore`) uses a `STUDENT` entity, so the new tenant-write code path does not fire for it — `tenant_entity` is `None` and the block is skipped. No mock change needed for that test.

- [ ] **Step 6.6: Commit**

```bash
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_api.py
git commit -m "feat(papermite): persist extracted tenant values to DataCore on finalize"
```

---

### Task 7: Merge-with-existing scenario test

**Files:**
- Modify: `papermite/backend/tests/test_finalize_api.py`

- [ ] **Step 7.1: Add the failing-then-passing test**

(With Task 6's wiring in place, this test should pass immediately once written — it's exercising the same code path with a different `httpx.post` mock. Write it, then run it.)

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_api.py`:

```python


def test_finalize_merges_with_existing_tenant_row():
    """Existing non-empty fields are preserved; empty/None fields get filled.

    The existing-row payload mimics what /api/query actually returns:
    flattened columns from both base_data and custom_fields, with
    everything stringified.
    """
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url, "json": json})
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        if "/models/" in url:
            mock_resp.json.return_value = _datacore_response_payload(
                json.get("model_definition") or {}
            )
        else:
            mock_resp.json.return_value = {}
        return mock_resp

    def fake_post(url, *, json, timeout):  # noqa: ARG001
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        # Simulate /api/query flattening: base_data + custom_fields keys
        # appear as top-level string columns. Plus the internal columns
        # that the cleaning step must strip.
        mock_resp.json.return_value = {
            "data": [
                {
                    "_status": "active",
                    "_version": 2,
                    "_abbrev": "AC",
                    "entity_type": "tenant",
                    "entity_id": "t1",
                    "base_data": "<encoded>",
                    "custom_fields": "<encoded>",
                    "vector": [0.0],
                    "name": "User Typed Name",
                    "contact_email": None,
                    "school_district_code": "",
                    "legacy_marker": "keep-me",
                }
            ],
            "total": 1,
        }
        return mock_resp

    payload = _payload_with_tenant_entity(
        tenant_base={"name": "Extracted Name", "contact_email": "a@x.com"},
        tenant_custom={"school_district_code": "DC-100"},
    )

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post", side_effect=fake_post):
        resp = client.post("/api/tenants/t1/finalize/commit", json=payload)

    assert resp.status_code == 200, resp.text

    # Find the tenants PUT (it's the second one)
    tenant_put = next(c for c in put_calls if c["url"].endswith("/tenants/t1"))
    body = tenant_put["json"]

    # name was non-empty in existing -> preserved
    assert body["base_data"]["name"] == "User Typed Name"
    # contact_email was None in existing -> filled
    assert body["base_data"]["contact_email"] == "a@x.com"
    # school_district_code was "" in existing -> filled
    assert body["custom_fields"]["school_district_code"] == "DC-100"
    # legacy_marker was non-empty and absent from extraction -> preserved
    assert body["custom_fields"]["legacy_marker"] == "keep-me"
```

- [ ] **Step 7.2: Run the test and confirm it passes**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py::test_finalize_merges_with_existing_tenant_row -v
```

Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add papermite/backend/tests/test_finalize_api.py
git commit -m "test(papermite): cover finalize tenant merge with existing row"
```

---

### Task 8: Skip-condition tests

**Files:**
- Modify: `papermite/backend/tests/test_finalize_api.py`

- [ ] **Step 8.1: Add both skip-condition tests**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_api.py`:

```python


def test_finalize_skips_tenant_write_when_no_tenant_entity():
    """STUDENT/FAMILY only — no TENANT entity → no /query and no /tenants PUT."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url})
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _datacore_response_payload(
            json.get("model_definition") or {}
        )
        return mock_resp

    # Reuse the existing student-only payload helper.
    payload = _payload_with_renamed_custom_field()

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post") as mock_post:
        resp = client.post("/api/tenants/t1/finalize/commit", json=payload)

    assert resp.status_code == 200, resp.text
    # Only the models PUT happened.
    assert len(put_calls) == 1
    assert "/models/t1" in put_calls[0]["url"]
    # No /api/query call.
    assert mock_post.call_count == 0


def test_finalize_skips_tenant_write_when_all_tenant_mappings_are_empty():
    """TENANT entity exists but every mapping value is None or whitespace."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url})
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _datacore_response_payload(
            json.get("model_definition") or {}
        )
        return mock_resp

    # Build a TENANT entity with only empty values
    payload = _payload_with_tenant_entity(
        tenant_base={"name": None, "display_name": "   ", "contact_email": ""},
        tenant_custom={},
    )

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post") as mock_post:
        resp = client.post("/api/tenants/t1/finalize/commit", json=payload)

    assert resp.status_code == 200, resp.text
    # Only the models PUT happened.
    assert len(put_calls) == 1
    assert "/models/t1" in put_calls[0]["url"]
    # No /api/query call — the splitter returned empty buckets so the
    # whole block was skipped before any I/O.
    assert mock_post.call_count == 0
```

- [ ] **Step 8.2: Run the tests and confirm they pass**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py::test_finalize_skips_tenant_write_when_no_tenant_entity tests/test_finalize_api.py::test_finalize_skips_tenant_write_when_all_tenant_mappings_are_empty -v
```

Expected: 2 passed.

- [ ] **Step 8.3: Commit**

```bash
git add papermite/backend/tests/test_finalize_api.py
git commit -m "test(papermite): cover finalize tenant skip conditions"
```

---

### Task 9: Failure-isolation tests (502 paths)

**Files:**
- Modify: `papermite/backend/tests/test_finalize_api.py`

- [ ] **Step 9.1: Add three failure tests**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_api.py`:

```python


def test_finalize_raises_502_when_tenants_put_fails():
    """Tenants PUT returns 500 → 502 surfaced. Model PUT already succeeded."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url})
        mock_resp = MagicMock()
        if "/models/" in url:
            mock_resp.status_code = 200
            mock_resp.json.return_value = _datacore_response_payload(
                json.get("model_definition") or {}
            )
        else:
            # Tenants PUT fails
            mock_resp.status_code = 500
            mock_resp.json.return_value = {"detail": "boom"}
        return mock_resp

    def fake_post(url, *, json, timeout):  # noqa: ARG001
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [], "total": 0}
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post", side_effect=fake_post):
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_tenant_entity(tenant_base={"name": "Acme"}),
        )

    assert resp.status_code == 502, resp.text
    assert resp.json()["detail"] == "Failed to persist tenant from extraction"
    # Critically: the model PUT still happened first.
    assert any("/models/t1" in c["url"] for c in put_calls)


def test_finalize_raises_502_when_query_fails():
    """The /api/query call returns 500 → 502 surfaced. Model PUT already succeeded."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url})
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _datacore_response_payload(
            json.get("model_definition") or {}
        )
        return mock_resp

    def fake_post(url, *, json, timeout):  # noqa: ARG001
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.json.return_value = {"detail": "query failed"}
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post", side_effect=fake_post):
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_tenant_entity(tenant_base={"name": "Acme"}),
        )

    assert resp.status_code == 502, resp.text
    assert resp.json()["detail"] == "Failed to persist tenant from extraction"
    # Model PUT was first; tenants PUT was never attempted (query failed).
    assert any("/models/t1" in c["url"] for c in put_calls)
    assert not any("/tenants/t1" in c["url"] for c in put_calls)


def test_finalize_does_not_attempt_tenant_work_when_model_put_fails():
    """Model PUT 500 → existing failure response is unchanged; no tenant work."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url})
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.json.return_value = {"detail": "model write failed"}
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post") as mock_post:
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_tenant_entity(tenant_base={"name": "Acme"}),
        )

    # Matches pre-change behavior: HTTPException with the DataCore status
    # (or the default detail). Not the new 502 detail string.
    assert resp.status_code == 500, resp.text
    assert resp.json()["detail"] != "Failed to persist tenant from extraction"

    # Only the models PUT was attempted; no tenants PUT and no /api/query.
    assert len(put_calls) == 1
    assert "/models/t1" in put_calls[0]["url"]
    assert mock_post.call_count == 0
```

- [ ] **Step 9.2: Run the three new tests and confirm they pass**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py::test_finalize_raises_502_when_tenants_put_fails tests/test_finalize_api.py::test_finalize_raises_502_when_query_fails tests/test_finalize_api.py::test_finalize_does_not_attempt_tenant_work_when_model_put_fails -v
```

Expected: 3 passed.

- [ ] **Step 9.3: Commit**

```bash
git add papermite/backend/tests/test_finalize_api.py
git commit -m "test(papermite): cover finalize tenant-persistence failure paths"
```

---

### Task 10: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 10.1: Run the full Papermite backend test suite**

Run:
```bash
cd papermite/backend && uv run python -m pytest tests/ -v
```

Expected: all tests pass. No regressions in existing files (`test_auth.py`, `test_cloudflare_ip.py`, `test_cors_production.py`, `test_domain.py`, `test_extract_api.py`, `test_extraction_pipeline.py`, `test_extractor.py`, `test_mapper.py`). The previously-existing `test_finalize_api.py` tests still pass alongside the new tests.

If anything fails, do NOT delete or skip tests. Read the failure, then return to the relevant Task to diagnose. Common pitfalls:
- `_TENANT_BASE_KEYS` computed at import time — if `Tenant` changes shape later, the constant won't update at runtime. Today this is fine; just don't replace with a function call inside the helper.
- Mocks for `httpx.put` need to handle BOTH the `/models/` URL and the `/tenants/` URL distinctly. Re-check Task 6/7 mocks if a test fails with "tenants PUT response had no model_definition" or similar.

- [ ] **Step 10.2: No commit needed (verification step)**

This task is verification only. If everything passes, proceed to Task 11.

---

### Task 11: Manual end-to-end smoke (optional but recommended)

**Files:** none (manual verification)

- [ ] **Step 11.1: Start all services**

Run:
```bash
./start-services.sh
```

Wait for the script to confirm all three services (datacore on :5800, papermite on :5710, launchpad on :5510 plus their frontends) are reachable.

- [ ] **Step 11.2: Run the end-to-end test through the UI**

In a browser:
1. Open `http://localhost:5500` (Launchpad frontend) and log in as a tenant admin.
2. Open `http://localhost:5700` (Papermite frontend).
3. Upload a document that contains identifiable tenant fields (school name, contact email, address). A sample PDF with school admin info is in `papermite/backend/data/` if available; otherwise any PDF with school info works.
4. Click through Review → Finalize → Confirm & Save.
5. Return to Launchpad and navigate to the tenant settings / tenant detail page (`/tenant`).
6. Confirm the extracted tenant fields appear populated in inputs that were previously empty.
7. If you typed a value into the tenant form before this flow, confirm that value is still present after finalize (extraction did not overwrite it).

- [ ] **Step 11.3: Tear down**

Stop services with whatever method `start-services.sh` documents (usually Ctrl-C if it's foregrounded; otherwise `./start-services.sh -i` and choose to kill).

---

## Final wrap-up

After Task 10 (and optionally Task 11) succeeds, the OpenSpec change should be marked complete in `openspec/changes/papermite-persist-tenant-on-finalize/tasks.md` (all checkboxes flipped to `[x]`). The change is then ready for archival via `openspec archive` or the `opsx:archive` skill — but archival is outside the scope of this implementation plan.

**Suggested final commit message** (only if there are leftover doc/checkbox updates not covered above):

```bash
git commit -m "fix(papermite): persist extracted tenant values to DataCore on finalize (#69)"
```

(The functional commit in Task 6 is the load-bearing one; this final commit is only needed if extra non-code updates accumulate.)
