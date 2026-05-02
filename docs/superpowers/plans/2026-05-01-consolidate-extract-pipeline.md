# Consolidate Extract Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate papermite's two parse+extract paths (`/api/upload` and `/api/extract`) into one shared `extraction_pipeline` module so admindash document upload can use Claude vision via `PAPERMITE_PARSER_BACKEND=claude_merged`, eliminating the docling/RapidOCR memory load that caused a 2 GB OOM.

**Architecture:** New `app/services/extraction_pipeline.py` exposes two named entrypoints — `extract_for_discovery` (multi-entity, used by /api/upload) and `extract_for_entity` (single-entity, used by /api/extract). Both honor `settings.parser_backend` for PDFs (docling-local vs Claude vision) and fall back to docling for `.docx` / direct read for `.txt`. The legacy `parser.py`, `field_extractor.py`, and `processor.py` modules are deleted; `extract_fields` and a new `extract_fields_from_pdf` move into `extractor.py`. The `raw_text` field is removed from `ExtractionResult` and the corresponding "Show Source" UI is deleted from the papermite-frontend review page. Image format support (`.png`, `.jpg`, `.jpeg`) is dropped from `/api/extract` to align both routes on `{.pdf, .docx, .txt}`.

**Tech Stack:** Python 3.13, FastAPI, pydantic-ai, docling, Claude vision (Anthropic), pytest, React 19 + TypeScript + Vite (frontends).

---

## Repository Layout (paths used in this plan)

- `papermite/` — backend at `papermite/backend/`; frontend at `papermite/frontend/`
- `admindash/` — backend at `admindash/backend/`; frontend at `admindash/frontend/`
- All commands assume `cwd` is the repo root `/Users/kennylee/Development/NeoApex` unless otherwise noted

## Files Touched (summary)

**Created:**
- `papermite/backend/app/services/extraction_pipeline.py`
- `papermite/backend/tests/test_extraction_pipeline.py`

**Modified:**
- `papermite/backend/app/api/extract.py` (route handler)
- `papermite/backend/app/api/upload.py` (route handler)
- `papermite/backend/app/services/extractor.py` (gains `extract_fields`, `extract_fields_from_pdf`)
- `papermite/backend/app/services/mapper.py` (drops `text` arg)
- `papermite/backend/app/models/extraction.py` (drops `raw_text` field)
- `papermite/backend/tests/test_extract_api.py` (new format set + pipeline mocking)
- `papermite/backend/tests/test_mapper.py` (new mapper signature)
- `papermite/CLAUDE.md` (docs updated)
- `papermite/frontend/src/types/models.ts` (drop `raw_text`)
- `papermite/frontend/src/api/client.ts` (drop `raw_text` reference)
- `papermite/frontend/src/pages/ReviewPage.tsx` (delete Show Source UI)
- `admindash/frontend/src/components/DocumentUpload.tsx` (narrow accepted formats)
- `admindash/frontend/src/i18n/translations.ts` (update supported-formats string)
- `papermite/openspec/specs/document-field-extraction/spec.md` (sync with delta)

**Deleted:**
- `papermite/backend/app/services/parser.py`
- `papermite/backend/app/services/field_extractor.py`
- `papermite/backend/app/services/processor.py`
- `papermite/backend/tests/test_field_extractor.py`
- `papermite/backend/tests/test_processor.py`

---

## Task 1: Pre-flight Verification

**Goal:** Confirm the consolidation is greenfield and no surprise callers will break.

**Files:** none changed; reads only.

- [ ] **Step 1.1: Grep for direct callers of the three modules to be retired**

```bash
cd /Users/kennylee/Development/NeoApex
grep -rln "from app.services.parser\|from app.services.field_extractor\|from app.services.processor" \
  papermite/backend admindash/backend launchpad/backend datacore/src \
  2>/dev/null | grep -v __pycache__ | grep -v ".venv"
```

Expected exact output (no other files):
```
papermite/backend/app/api/upload.py
papermite/backend/app/api/extract.py
papermite/backend/app/services/processor.py
papermite/backend/tests/test_field_extractor.py
papermite/backend/tests/test_processor.py
```

If any other file appears, **STOP** and re-scope; the plan assumes only these five callers.

- [ ] **Step 1.2: Verify `extract_fields_from_pdf` does not yet exist**

```bash
grep -n "def extract_fields_from_pdf" /Users/kennylee/Development/NeoApex/papermite/backend/app/services/extractor.py
```

Expected output: empty (no match).

- [ ] **Step 1.3: Verify `parser_backend` setting exists in config**

```bash
grep -n "parser_backend" /Users/kennylee/Development/NeoApex/papermite/backend/app/config.py
```

Expected: a single match showing `parser_backend: str = "local"` (around line 71). If absent, **STOP** — the spec assumes it's present.

- [ ] **Step 1.4: Run the full papermite test suite as a baseline**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -q
```

Expected: all green (e.g. `51 passed`). The `test_auth.py` ignore is for a pre-existing import error unrelated to this plan. **Record the passing count.**

- [ ] **Step 1.5: Confirm working tree is clean and on `main`**

```bash
cd /Users/kennylee/Development/NeoApex
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean, branch `main`.

- [ ] **Step 1.6: Create a feature branch**

```bash
git checkout -b feat/consolidate-extract-pipeline
```

Expected: switched to new branch.

---

## Task 2: Drop `raw_text` from `ExtractionResult` and `mapper`

**Goal:** Remove the placeholder-leaking `raw_text` field end-to-end (schema → mapper → upload route → frontend types). After this task, `mapper.map_extraction()` takes 3 args and `ExtractionResult` has no `raw_text` field. The route still uses the OLD `process_document()` (which still returns `(extraction, text)` — we just stop using `text`). This task is fully reversible by `git revert`.

**Files:**
- Modify: `papermite/backend/app/models/extraction.py`
- Modify: `papermite/backend/app/services/mapper.py`
- Modify: `papermite/backend/tests/test_mapper.py`
- Modify: `papermite/backend/app/api/upload.py`
- Modify: `papermite/frontend/src/types/models.ts`
- Modify: `papermite/frontend/src/api/client.ts`
- Modify: `papermite/frontend/src/pages/ReviewPage.tsx`

- [ ] **Step 2.1: Write failing test verifying `ExtractionResult` has no `raw_text`**

Add to `papermite/backend/tests/test_mapper.py` (append at end of file):

```python
def test_extraction_result_has_no_raw_text_field():
    """raw_text was removed in the extract-pipeline consolidation."""
    from app.models.extraction import ExtractionResult
    assert "raw_text" not in ExtractionResult.model_fields
```

- [ ] **Step 2.2: Run the new test to verify it fails**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_mapper.py::test_extraction_result_has_no_raw_text_field -v
```

Expected: FAIL with `AssertionError` (the field still exists at this point).

- [ ] **Step 2.3: Remove `raw_text` from `ExtractionResult`**

In `papermite/backend/app/models/extraction.py`, change lines 36-42 from:

```python
class ExtractionResult(BaseModel):
    extraction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    filename: str
    entities: list[EntityResult]
    raw_text: str
    status: Literal["pending_review", "finalized"] = "pending_review"
```

to:

```python
class ExtractionResult(BaseModel):
    extraction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    filename: str
    entities: list[EntityResult]
    status: Literal["pending_review", "finalized"] = "pending_review"
```

- [ ] **Step 2.4: Update `mapper.map_extraction` signature**

In `papermite/backend/app/services/mapper.py` at line 267, change:

```python
def map_extraction(raw: RawExtraction, tenant_id: str, filename: str, raw_text: str) -> ExtractionResult:
    """Map a RawExtraction into an ExtractionResult with field provenance."""
```

to:

```python
def map_extraction(raw: RawExtraction, tenant_id: str, filename: str) -> ExtractionResult:
    """Map a RawExtraction into an ExtractionResult with field provenance."""
```

Also remove the `raw_text=raw_text,` line from the `return ExtractionResult(...)` block near line 299. The block becomes:

```python
    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        entities=entity_results,
        status="pending_review",
    )
```

(Adjust to match the existing kwargs in your local copy — only the `raw_text=...` line is removed.)

- [ ] **Step 2.5: Update existing `test_mapper.py` tests**

```bash
grep -n "map_extraction\|raw_text" /Users/kennylee/Development/NeoApex/papermite/backend/tests/test_mapper.py
```

For each call to `map_extraction(...)` that passes 4 args, drop the 4th. For each assertion that checks `result.raw_text`, delete that assertion. Save the file.

- [ ] **Step 2.6: Run mapper tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_mapper.py -v
```

Expected: PASS (all tests including the new `test_extraction_result_has_no_raw_text_field`).

- [ ] **Step 2.7: Update `/api/upload` to drop the `text` arg from `map_extraction` call**

In `papermite/backend/app/api/upload.py` lines 45-49, change:

```python
    try:
        # Pipeline: process (parse+extract per configured backend) → map
        raw_extraction, text = process_document(file_path, model_id)
        result = map_extraction(raw_extraction, tenant_id, file.filename, text)
        return result
```

to:

```python
    try:
        # Pipeline: process (parse+extract per configured backend) → map
        raw_extraction, _text = process_document(file_path, model_id)
        result = map_extraction(raw_extraction, tenant_id, file.filename)
        return result
```

(The `_text` underscore-prefix marks the unused return; in Task 5 we replace this with the new pipeline that returns `RawExtraction` directly.)

- [ ] **Step 2.8: Update papermite-frontend types to drop `raw_text`**

In `papermite/frontend/src/types/models.ts`, find the `ExtractionResult` interface (around line 34) and remove the `raw_text: string;` line.

- [ ] **Step 2.9: Update `client.ts` to remove the `raw_text: ""` reference**

In `papermite/frontend/src/api/client.ts` line 180, remove the `raw_text: "",` line from whatever object literal contains it (likely a `modelToExtraction()` helper).

- [ ] **Step 2.10: Delete the "Show Source" UI from `ReviewPage.tsx`**

In `papermite/frontend/src/pages/ReviewPage.tsx`:
- Find line 186 where `<pre className="review__source-text">{extraction.raw_text}</pre>` appears.
- Delete the entire conditional block that renders the source view (likely a `{showSource && (...)}` wrapper a few lines above).
- Delete the toggle button that flips the `showSource` state.
- Delete the `useState<boolean>` declaration for `showSource` (and any related handler).

The "Show Source" feature is being retired entirely; the goal is the file no longer references `raw_text`, `showSource`, or `review__source-text` after this step.

- [ ] **Step 2.11: Search for any orphaned references**

```bash
grep -rn "raw_text\|showSource\|review__source-text" /Users/kennylee/Development/NeoApex/papermite/frontend/src/
```

Expected: empty. If anything remains, delete it.

- [ ] **Step 2.12: Run papermite frontend build to confirm no TypeScript errors**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 2.13: Run full papermite backend test suite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -q
```

Expected: all green; count >= baseline from Step 1.4 (we added one new test).

- [ ] **Step 2.14: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/models/extraction.py \
        papermite/backend/app/services/mapper.py \
        papermite/backend/tests/test_mapper.py \
        papermite/backend/app/api/upload.py \
        papermite/frontend/src/types/models.ts \
        papermite/frontend/src/api/client.ts \
        papermite/frontend/src/pages/ReviewPage.tsx
git commit -m "refactor(papermite): drop raw_text from ExtractionResult and Show Source UI

The merged-vision parser path returned a placeholder string
('[Document processed in merged mode...]') in place of real raw text,
and the corresponding 'Show Source' UI is unused in practice. Remove
the field and feature in one step:

- ExtractionResult.raw_text removed
- mapper.map_extraction() drops its text parameter
- /api/upload stops forwarding text to the mapper
- papermite-frontend removes Show Source toggle, panel, and CSS

Prep step for the extraction_pipeline consolidation."
```

---

## Task 3: Move `extract_fields` and add `extract_fields_from_pdf` to `extractor.py`

**Goal:** Centralize text-based and vision-based targeted field extraction in `extractor.py` so the new pipeline can call them. `extract_fields` (text) is moved verbatim from `field_extractor.py`; `extract_fields_from_pdf` is new.

**Files:**
- Modify: `papermite/backend/app/services/extractor.py`
- Modify: `papermite/backend/tests/test_extract_api.py` (no functional change here, just preparing imports)
- Test: new tests added inline to `papermite/backend/tests/test_extractor.py` (create if missing)

- [ ] **Step 3.1: Move `extract_fields` from `field_extractor.py` to `extractor.py`**

Open `papermite/backend/app/services/field_extractor.py` and read its full content (it's ~75 lines from Task 0 context). Append the following to `papermite/backend/app/services/extractor.py`:

```python
# ─── Targeted field extraction (text-based) ───────────────────────


def _build_field_prompt(entity_type: str, all_fields: list) -> str:
    """Build an extraction prompt from the model's field definitions."""
    if not all_fields:
        return ""

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
        f"Only include fields where you find a clear value in the document.\n"
        f"OMIT any field whose value is not found — do NOT use placeholders "
        f"like '<unknown>', 'N/A', 'unknown', or empty strings.\n"
        f"Do NOT invent data.\n\n"
        f"Fields:\n" + "\n".join(field_lines)
    )


def _filter_extracted_fields(
    raw: dict, all_fields: list
) -> dict:
    known_fields = {f["name"] for f in all_fields}
    return {
        k: v
        for k, v in raw.items()
        if v is not None and v != "" and k in known_fields
    }


def extract_fields(
    text: str,
    entity_type: str,
    model_definition: dict,
    model_id: str,
) -> dict[str, Any]:
    """Extract field values from document text, guided by entity model definition.

    Returns a dict mapping field names to extracted values. Only fields with
    non-empty values are included, and only if they exist in the model
    definition (filters out hallucinated field keys). Returns empty dict if
    entity_type is not in model_definition.
    """
    entity_def = model_definition.get(entity_type)
    if not entity_def:
        return {}

    all_fields = entity_def.get("base_fields", []) + entity_def.get("custom_fields", [])
    prompt = _build_field_prompt(entity_type, all_fields)
    if not prompt:
        return {}

    agent = Agent(model_id, output_type=dict[str, Any], system_prompt=prompt)
    result = agent.run_sync(f"Extract fields from this document:\n\n{text}")
    return _filter_extracted_fields(result.output, all_fields)
```

Add `from typing import Any` to the imports at the top of `extractor.py` if not already present.

- [ ] **Step 3.2: Run existing field-extractor tests through the new module location**

Create or update `papermite/backend/tests/test_extractor.py` (create if missing). Append the following test that exercises the *new* location of `extract_fields`:

```python
"""Tests for extractor.py — discovery + targeted, text + vision."""
from unittest.mock import patch, MagicMock

from app.services.extractor import extract_fields


def test_extract_fields_returns_known_fields_only():
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
    mock_result.output = {"first_name": "Jane", "last_name": "Doe", "hallucinated": "x"}

    with patch("app.services.extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Jane Doe",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane", "last_name": "Doe"}


def test_extract_fields_unknown_entity_type_returns_empty():
    result = extract_fields(
        text="anything",
        entity_type="missing",
        model_definition={"student": {"base_fields": [], "custom_fields": []}},
        model_id="anthropic:claude-haiku-4-5-20251001",
    )
    assert result == {}


def test_extract_fields_filters_none_and_empty():
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
    mock_result.output = {"first_name": "Jane", "last_name": None}

    with patch("app.services.extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Jane",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane"}
```

- [ ] **Step 3.3: Run the new tests to verify they pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extractor.py -v
```

Expected: 3 passed.

- [ ] **Step 3.4: Write failing test for `extract_fields_from_pdf`**

Append to `papermite/backend/tests/test_extractor.py`:

```python
from pathlib import Path
from app.services.extractor import extract_fields_from_pdf


def test_extract_fields_from_pdf_returns_filtered_dict(tmp_path):
    """Vision-based targeted extraction filters to known fields, drops empty."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }

    pdf_file = tmp_path / "form.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
        "last_name": "Doe",
        "hallucinated": "ignored",
        "empty": "",
    }

    with patch("app.services.extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields_from_pdf(
            file_path=pdf_file,
            model_id="anthropic:claude-sonnet-4-6",
            entity_type="student",
            model_definition=model_definition,
        )

    assert result == {"first_name": "Jane", "last_name": "Doe"}


def test_extract_fields_from_pdf_unknown_entity_returns_empty(tmp_path):
    pdf_file = tmp_path / "form.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    result = extract_fields_from_pdf(
        file_path=pdf_file,
        model_id="anthropic:claude-sonnet-4-6",
        entity_type="missing",
        model_definition={"student": {"base_fields": [], "custom_fields": []}},
    )

    assert result == {}
```

- [ ] **Step 3.5: Run the new tests to verify they fail (function doesn't exist yet)**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extractor.py::test_extract_fields_from_pdf_returns_filtered_dict -v
```

Expected: FAIL with `ImportError: cannot import name 'extract_fields_from_pdf' from 'app.services.extractor'`.

- [ ] **Step 3.6: Implement `extract_fields_from_pdf`**

Append to `papermite/backend/app/services/extractor.py`:

```python
def extract_fields_from_pdf(
    file_path: Path,
    model_id: str,
    entity_type: str,
    model_definition: dict,
) -> dict[str, Any]:
    """Vision-based targeted field extraction.

    Sends the PDF bytes directly to a vision-capable LLM with a model-definition-
    driven prompt. Output schema and filtering match `extract_fields`.

    The caller is responsible for ensuring `model_id` is a vision-capable model
    (Anthropic Claude or OpenAI GPT-4o family). Ollama and text-only models
    will fail at the model layer with a clear error.
    """
    entity_def = model_definition.get(entity_type)
    if not entity_def:
        return {}

    all_fields = entity_def.get("base_fields", []) + entity_def.get("custom_fields", [])
    prompt = _build_field_prompt(entity_type, all_fields)
    if not prompt:
        return {}

    agent = Agent(model_id, output_type=dict[str, Any], system_prompt=prompt)
    result = agent.run_sync(
        [
            "Extract fields from this document:",
            BinaryContent(data=file_path.read_bytes(), media_type="application/pdf"),
        ]
    )
    return _filter_extracted_fields(result.output, all_fields)
```

`Path` and `BinaryContent` and `Agent` should already be imported in this file from the existing `extract_entities_from_pdf` function. Verify:

```bash
grep -n "^from\|^import" /Users/kennylee/Development/NeoApex/papermite/backend/app/services/extractor.py
```

Expected to include `from pathlib import Path` and `from pydantic_ai import Agent, BinaryContent`. If `Any` is missing, add `from typing import Any`.

- [ ] **Step 3.7: Run extractor tests and confirm all pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extractor.py -v
```

Expected: 5 passed.

- [ ] **Step 3.8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/services/extractor.py \
        papermite/backend/tests/test_extractor.py
git commit -m "refactor(papermite): move extract_fields and add extract_fields_from_pdf to extractor

Centralizes text-based and vision-based targeted field extraction in
app/services/extractor.py. extract_fields is moved verbatim from
field_extractor.py (which will be deleted in a later step).
extract_fields_from_pdf is new — mirrors extract_entities_from_pdf
but uses a model-definition-driven prompt for single-entity extraction.

Tests cover hallucinated-field filtering, empty-value filtering, and
the missing-entity-type empty-dict case."
```

---

## Task 4: Create `extraction_pipeline.py`

**Goal:** Build the new shared module that both `/api/upload` and `/api/extract` will consume.

**Files:**
- Create: `papermite/backend/app/services/extraction_pipeline.py`
- Create: `papermite/backend/tests/test_extraction_pipeline.py`

- [ ] **Step 4.1: Write failing tests for the pipeline (full file)**

Create `papermite/backend/tests/test_extraction_pipeline.py` with the following content:

```python
"""Tests for the extraction_pipeline module."""
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.models.extraction import RawExtraction


def _fake_raw_extraction() -> RawExtraction:
    return RawExtraction(students=[{"first_name": "Jane", "last_name": "Doe"}])


# ─── Discovery entrypoint ─────────────────────────────────────────


def test_extract_for_discovery_returns_raw_extraction(tmp_path, monkeypatch):
    """Discovery returns RawExtraction directly — no tuple, no placeholder."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "parsed text"
        mock_extract.return_value = _fake_raw_extraction()

        result = extract_for_discovery(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    assert isinstance(result, RawExtraction)
    assert result.students[0]["first_name"] == "Jane"
    mock_pdf.assert_not_called()


def test_extract_for_discovery_pdf_local_uses_docling(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "parsed text"
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    mock_parse.assert_called_once_with(pdf_file)
    mock_extract.assert_called_once_with("parsed text", "anthropic:claude-haiku-4-5-20251001")
    mock_pdf.assert_not_called()


def test_extract_for_discovery_pdf_merged_uses_vision(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_pdf.return_value = _fake_raw_extraction()

        extract_for_discovery(pdf_file, "anthropic:claude-sonnet-4-6")

    mock_pdf.assert_called_once_with(pdf_file, "anthropic:claude-sonnet-4-6")
    mock_parse.assert_not_called()
    mock_extract.assert_not_called()


def test_extract_for_discovery_docx_always_uses_docling(tmp_path, monkeypatch):
    """DOCX falls back to docling regardless of parser_backend."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    docx_file = tmp_path / "f.docx"
    docx_file.write_bytes(b"PK fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "from docx"
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(docx_file, "anthropic:claude-haiku-4-5-20251001")

    mock_parse.assert_called_once_with(docx_file)
    mock_pdf.assert_not_called()


def test_extract_for_discovery_txt_uses_direct_read(tmp_path, monkeypatch):
    """TXT skips docling; reads file directly."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    txt_file = tmp_path / "f.txt"
    txt_file.write_text("Student: Jane Doe")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(txt_file, "anthropic:claude-haiku-4-5-20251001")

    mock_parse.assert_not_called()  # docling not invoked for TXT
    mock_extract.assert_called_once_with("Student: Jane Doe", "anthropic:claude-haiku-4-5-20251001")
    mock_pdf.assert_not_called()


# ─── Targeted entrypoint ──────────────────────────────────────────


def test_extract_for_entity_pdf_local_uses_text_extractor(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_parse.return_value = "parsed text"
        mock_text.return_value = {"first_name": "Jane"}

        result = extract_for_entity(pdf_file, "anthropic:claude-haiku-4-5-20251001", "student", model_def)

    assert result == {"first_name": "Jane"}
    mock_parse.assert_called_once_with(pdf_file)
    mock_text.assert_called_once_with(
        "parsed text", "student", model_def, "anthropic:claude-haiku-4-5-20251001"
    )
    mock_vision.assert_not_called()


def test_extract_for_entity_pdf_merged_uses_vision_extractor(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_vision.return_value = {"first_name": "Jane"}

        result = extract_for_entity(pdf_file, "anthropic:claude-sonnet-4-6", "student", model_def)

    assert result == {"first_name": "Jane"}
    mock_vision.assert_called_once_with(
        pdf_file, "anthropic:claude-sonnet-4-6", "student", model_def
    )
    mock_parse.assert_not_called()
    mock_text.assert_not_called()


def test_extract_for_entity_docx_always_uses_text_extractor(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    docx_file = tmp_path / "f.docx"
    docx_file.write_bytes(b"PK fake")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_parse.return_value = "from docx"
        mock_text.return_value = {"first_name": "Jane"}

        extract_for_entity(docx_file, "anthropic:claude-haiku-4-5-20251001", "student", model_def)

    mock_parse.assert_called_once_with(docx_file)
    mock_text.assert_called_once()
    mock_vision.assert_not_called()


def test_extract_for_entity_txt_uses_direct_read(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    txt_file = tmp_path / "f.txt"
    txt_file.write_text("Student: Jane")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_text.return_value = {"first_name": "Jane"}

        extract_for_entity(txt_file, "anthropic:claude-haiku-4-5-20251001", "student", model_def)

    mock_parse.assert_not_called()
    mock_text.assert_called_once_with(
        "Student: Jane", "student", model_def, "anthropic:claude-haiku-4-5-20251001"
    )
    mock_vision.assert_not_called()


# ─── Error handling ───────────────────────────────────────────────


def test_pdf_with_unknown_parser_backend_raises_value_error(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "bogus_value")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with pytest.raises(ValueError, match="parser_backend"):
        extract_for_discovery(pdf_file, "anthropic:claude-sonnet-4-6")


# ─── File lifecycle ───────────────────────────────────────────────


def test_pipeline_does_not_delete_input_file(tmp_path, monkeypatch):
    """Pipeline is pure: caller owns file lifecycle."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract:
        mock_parse.return_value = "parsed"
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    assert pdf_file.exists()
    assert pdf_file.read_bytes() == b"%PDF-1.4 fake"
```

- [ ] **Step 4.2: Run tests to verify they fail (module doesn't exist)**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extraction_pipeline.py -v
```

Expected: ImportError or collection error — `app.services.extraction_pipeline` does not exist.

- [ ] **Step 4.3: Create `extraction_pipeline.py`**

Create `papermite/backend/app/services/extraction_pipeline.py` with:

```python
"""Shared parse+extract pipeline.

Owns the dispatch decision between docling-local parsing and Claude-vision-
merged parsing for PDFs, with text-based fallback paths for DOCX/TXT. Exposes
two named entrypoints — `extract_for_discovery` (multi-entity, used by
/api/upload's model-building flow) and `extract_for_entity` (single-entity,
used by /api/extract's add-student-with-document flow).

The pipeline is pure: it reads the file at the supplied path and returns; it
does not delete, move, or rename the file. Lifecycle is the caller's concern.

Dispatch table for PDFs:
    parser_backend=local         → _docling_parse → extract_entities / extract_fields
    parser_backend=claude_merged → extract_entities_from_pdf / extract_fields_from_pdf

Non-PDFs (.docx, .txt) always use the text path; Claude vision does not
natively accept DOCX, and TXT is read directly without docling.
"""
from pathlib import Path
from typing import Any

from docling.document_converter import DocumentConverter

from app.config import settings
from app.models.extraction import RawExtraction
from app.services.extractor import (
    extract_entities,
    extract_entities_from_pdf,
    extract_fields,
    extract_fields_from_pdf,
)


def _docling_parse(file_path: Path) -> str:
    """Parse a document with docling and return its markdown text."""
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")
    converter = DocumentConverter()
    result = converter.convert(str(file_path))
    return result.document.export_to_markdown()


def _read_text_or_parse(file_path: Path) -> str:
    """Get text from a file using the cheapest method that works.

    .txt → direct read (no docling load).
    Other → docling DocumentConverter.
    """
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")
    return _docling_parse(file_path)


def _is_vision_path(file_path: Path) -> bool:
    """Return True if this file should use the merged-vision path.

    Only applies to PDFs when parser_backend=claude_merged. DOCX and TXT
    always use the local text path regardless of backend.
    """
    if file_path.suffix.lower() != ".pdf":
        return False
    return settings.parser_backend == "claude_merged"


def _validate_pdf_backend() -> None:
    """Raise if parser_backend is set to an unrecognized value (PDF path only)."""
    if settings.parser_backend not in ("local", "claude_merged"):
        raise ValueError(
            f"Unknown parser_backend: {settings.parser_backend!r} "
            f"(expected 'local' or 'claude_merged')"
        )


def extract_for_discovery(file_path: Path, model_id: str) -> RawExtraction:
    """Run multi-entity discovery extraction. Used by model-building."""
    if file_path.suffix.lower() == ".pdf":
        _validate_pdf_backend()
        if _is_vision_path(file_path):
            return extract_entities_from_pdf(file_path, model_id)
    text = _read_text_or_parse(file_path)
    return extract_entities(text, model_id)


def extract_for_entity(
    file_path: Path,
    model_id: str,
    entity_type: str,
    model_definition: dict,
) -> dict[str, Any]:
    """Run targeted, model-driven extraction for a single entity type.

    Returns a flat dict of {field_name: value} filtered to fields present in
    `model_definition[entity_type]`. Returns `{}` if `entity_type` is not in
    the model definition (without invoking any LLM).
    """
    if file_path.suffix.lower() == ".pdf":
        _validate_pdf_backend()
        if _is_vision_path(file_path):
            return extract_fields_from_pdf(file_path, model_id, entity_type, model_definition)
    text = _read_text_or_parse(file_path)
    return extract_fields(text, entity_type, model_definition, model_id)
```

- [ ] **Step 4.4: Run pipeline tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extraction_pipeline.py -v
```

Expected: 11 passed.

- [ ] **Step 4.5: Run full backend suite to confirm no regressions**

```bash
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -q
```

Expected: all green; count >= baseline + new tests.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/services/extraction_pipeline.py \
        papermite/backend/tests/test_extraction_pipeline.py
git commit -m "refactor(papermite): add extraction_pipeline shared module

Two named entrypoints — extract_for_discovery and extract_for_entity —
both dispatch on settings.parser_backend for PDFs and fall back to
docling for .docx / direct read for .txt. Pipeline is pure: caller
owns file lifecycle.

Replaces the old processor.process_document() dispatcher (which is
discovery-only) and gives /api/extract a path to claude_merged
extraction it currently lacks.

11 tests cover all backend × file-extension combinations and the
unknown-backend ValueError."
```

---

## Task 5: Rewire `/api/upload` to the new pipeline

**Goal:** `/api/upload` calls `extract_for_discovery` instead of the legacy `process_document`. Behavior unchanged.

**Files:**
- Modify: `papermite/backend/app/api/upload.py`

- [ ] **Step 5.1: Update imports and call site**

In `papermite/backend/app/api/upload.py`:

Replace line 12:
```python
from app.services.processor import process_document
```
with:
```python
from app.services.extraction_pipeline import extract_for_discovery
```

Replace lines 45-49 (the try block) — currently:
```python
    try:
        # Pipeline: process (parse+extract per configured backend) → map
        raw_extraction, _text = process_document(file_path, model_id)
        result = map_extraction(raw_extraction, tenant_id, file.filename)
        return result
```
with:
```python
    try:
        # Run discovery extraction → map to ExtractionResult
        raw_extraction = extract_for_discovery(file_path, model_id)
        result = map_extraction(raw_extraction, tenant_id, file.filename)
        return result
```

- [ ] **Step 5.2: Find and update existing upload tests**

```bash
ls /Users/kennylee/Development/NeoApex/papermite/backend/tests/test_upload*.py 2>&1
```

If a `test_upload.py` exists, open it and replace any `patch("app.api.upload.process_document", ...)` with `patch("app.api.upload.extract_for_discovery", ...)`. If the test mocked the return as `(extraction, text)` tuples, change them to return just an extraction. Save.

If no `test_upload.py` exists, skip — the pipeline is covered by `test_extraction_pipeline.py`.

- [ ] **Step 5.3: Run upload-related tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/ -k upload -v
```

Expected: pass. If no tests match, that's fine — the route logic is mostly thin.

- [ ] **Step 5.4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/api/upload.py \
        papermite/backend/tests/test_upload.py 2>/dev/null || true
git commit -m "refactor(papermite): rewire /api/upload to use extraction_pipeline.extract_for_discovery"
```

(The `2>/dev/null || true` lets the commit proceed cleanly if `test_upload.py` doesn't exist.)

---

## Task 6: Rewire `/api/extract` to the new pipeline

**Goal:** `/api/extract` accepts `{.pdf, .docx, .txt}` (no images), calls `extract_for_entity`, gets Claude-vision support when `parser_backend=claude_merged`.

**Files:**
- Modify: `papermite/backend/app/api/extract.py`
- Modify: `papermite/backend/tests/test_extract_api.py`

- [ ] **Step 6.1: Update `ALLOWED_EXTENSIONS` and the 422 message**

In `papermite/backend/app/api/extract.py` line 17:
```python
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
```
Replace with:
```python
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
```

At lines 64-68 (the 422 raise), the message already uses `', '.join(sorted(ALLOWED_EXTENSIONS))` so it auto-updates. Verify by reading:
```bash
sed -n '60,70p' /Users/kennylee/Development/NeoApex/papermite/backend/app/api/extract.py
```

If the message hardcodes the old set, edit it to use the constant.

- [ ] **Step 6.2: Replace imports**

In `papermite/backend/app/api/extract.py` lines 12-13:
```python
from app.services.parser import parse_document
from app.services.field_extractor import extract_fields
```
Replace with:
```python
from app.services.extraction_pipeline import extract_for_entity
```

- [ ] **Step 6.3: Replace the parse+extract block with the pipeline call**

In `papermite/backend/app/api/extract.py` lines 88-100 (the `try:` block inside the route handler), the current code is:

```python
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
```

Replace with:

```python
    try:
        with file_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        fields = extract_for_entity(
            file_path=file_path,
            model_id=settings.default_model,
            entity_type=entity_type,
            model_definition=model_definition,
        )

        return {"fields": fields}
```

- [ ] **Step 6.4: Update `test_extract_api.py` to reflect the new pipeline**

Open `papermite/backend/tests/test_extract_api.py`. Update three things:

1. **`test_unsupported_file_format`** (around line 41) currently posts a `.docx` and expects 422. After this change `.docx` is supported. Replace the test body to use `.png`:

```python
def test_unsupported_file_format():
    """Image formats are no longer supported."""
    resp = _upload("t1", "student", "doc.png", b"data", "image/png")
    assert resp.status_code == 422
    assert "Unsupported" in resp.json()["detail"]
```

2. **`test_successful_extraction`** and **`test_partial_extraction_is_success`** currently mock `parse_document` and `extract_fields` directly. Replace those mocks with one mock of `extract_for_entity`. Example for `test_successful_extraction`:

```python
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
        patch("app.api.extract.extract_for_entity",
              return_value={"first_name": "Jane", "last_name": "Doe"}),
    ):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 200
    body = resp.json()
    assert body["fields"]["first_name"] == "Jane"
    assert body["fields"]["last_name"] == "Doe"
```

Apply the same pattern to `test_partial_extraction_is_success`.

3. **Add a new test for DOCX acceptance:**

```python
def test_docx_is_accepted():
    """DOCX is now in ALLOWED_EXTENSIONS."""
    fake_model = {
        "model_definition": {
            "student": {"base_fields": [], "custom_fields": []},
        }
    }
    with (
        patch("app.api.extract.get_active_model", return_value=fake_model),
        patch("app.api.extract.extract_for_entity", return_value={}),
    ):
        resp = _upload(
            "t1", "student", "app.docx", b"PK fake",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    assert resp.status_code == 200
```

- [ ] **Step 6.5: Run extract-route tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extract_api.py -v
```

Expected: all pass (including the new `test_docx_is_accepted`).

- [ ] **Step 6.6: Run the full backend test suite**

```bash
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -q
```

Expected: all green.

- [ ] **Step 6.7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/api/extract.py \
        papermite/backend/tests/test_extract_api.py
git commit -m "refactor(papermite): rewire /api/extract to extraction_pipeline; drop image support

/api/extract now calls extract_for_entity, which honors PAPERMITE_PARSER_BACKEND
for PDFs (docling-local vs Claude-vision-merged). DOCX and TXT are now
accepted; PNG/JPG/JPEG are no longer accepted (beta status, no consumer
impact).

The dispatch decision is fully owned by the pipeline. The route handler
contains no parser-backend conditionals."
```

---

## Task 7: Update admindash-frontend accepted formats

**Goal:** admindash UI stops offering image formats it can no longer upload successfully.

**Files:**
- Modify: `admindash/frontend/src/components/DocumentUpload.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

- [ ] **Step 7.1: Narrow `ACCEPTED_FORMATS` and `ACCEPTED_MIME`**

In `admindash/frontend/src/components/DocumentUpload.tsx` lines 5-6:

```typescript
const ACCEPTED_FORMATS = ['.pdf', '.png', '.jpg', '.jpeg'];
const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];
```

Replace with:

```typescript
const ACCEPTED_FORMATS = ['.pdf', '.docx', '.txt'];
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
```

- [ ] **Step 7.2: Update the supported-formats translation strings**

```bash
grep -n "supportedFormats\|PDF, PNG\|JPG\|JPEG" /Users/kennylee/Development/NeoApex/admindash/frontend/src/i18n/translations.ts | head -10
```

For each match referring to image formats, update the strings to name the new set. Example replacement:

```typescript
supportedFormats: 'Supported formats: PDF, DOCX, TXT',
```

Update both `en-US` and `zh-CN` (or whichever locales exist).

- [ ] **Step 7.3: Run admindash frontend build and lint**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
npm run build
npm run lint
```

Expected: both green.

- [ ] **Step 7.4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/DocumentUpload.tsx \
        admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): narrow upload formats to PDF/DOCX/TXT

Aligns with papermite-api's new ALLOWED_EXTENSIONS. Image-format support
was dropped server-side as part of the extract-pipeline consolidation
(beta status, no consumer impact)."
```

---

## Task 8: Hard-delete retired modules and tests

**Goal:** Remove the three legacy service modules and their dedicated tests now that no caller references them.

**Files (deleted):**
- `papermite/backend/app/services/parser.py`
- `papermite/backend/app/services/field_extractor.py`
- `papermite/backend/app/services/processor.py`
- `papermite/backend/tests/test_field_extractor.py`
- `papermite/backend/tests/test_processor.py`

- [ ] **Step 8.1: Verify no live imports remain**

```bash
cd /Users/kennylee/Development/NeoApex
grep -rn "from app.services.parser\|from app.services.field_extractor\|from app.services.processor\|import parser\b\|import field_extractor\|import processor" \
  papermite/backend/app papermite/backend/tests \
  2>/dev/null | grep -v __pycache__
```

Expected: empty output (no remaining imports). If anything appears, **STOP** and update that caller before proceeding.

- [ ] **Step 8.2: Delete the five files**

```bash
rm /Users/kennylee/Development/NeoApex/papermite/backend/app/services/parser.py
rm /Users/kennylee/Development/NeoApex/papermite/backend/app/services/field_extractor.py
rm /Users/kennylee/Development/NeoApex/papermite/backend/app/services/processor.py
rm /Users/kennylee/Development/NeoApex/papermite/backend/tests/test_field_extractor.py
rm /Users/kennylee/Development/NeoApex/papermite/backend/tests/test_processor.py
```

- [ ] **Step 8.3: Run the full backend suite to confirm no orphan references**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -q
```

Expected: all green. If a collection error mentions one of the deleted files, an import path is stale — fix it.

- [ ] **Step 8.4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add -u  # stages deletions
git commit -m "refactor(papermite): hard-delete parser, field_extractor, processor and their tests

These modules were folded into extraction_pipeline.py and extractor.py
in earlier commits; no callers remain. Removing them now rather than
leaving DeprecationWarning shims since there are no consumers to migrate."
```

---

## Task 9: Add `X-Papermite-Parser-Backend` response header and update docs

**Goal:** Surface the active parser backend in route responses so prod debugging can correlate failures to a specific path. Update `papermite/CLAUDE.md` to reflect the new module layout.

**Files:**
- Modify: `papermite/backend/app/api/extract.py`
- Modify: `papermite/backend/app/api/upload.py`
- Modify: `papermite/backend/tests/test_extract_api.py`
- Modify: `papermite/CLAUDE.md`

- [ ] **Step 9.1: Add the response header to `/api/extract`**

In `papermite/backend/app/api/extract.py`, change the route handler signature. Currently:

```python
@router.post("/extract/{tenant_id}/{entity_type}")
def extract_document_fields(
    tenant_id: str,
    entity_type: str,
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_admin),
):
```

Change to inject `Response` from FastAPI so we can set headers:

```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
# (Update existing import)

@router.post("/extract/{tenant_id}/{entity_type}")
def extract_document_fields(
    tenant_id: str,
    entity_type: str,
    response: Response,
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_admin),
):
```

Just before the `return {"fields": fields}` line, add:

```python
        response.headers["X-Papermite-Parser-Backend"] = settings.parser_backend
```

- [ ] **Step 9.2: Add the same header to `/api/upload`**

In `papermite/backend/app/api/upload.py`, do the equivalent edit: import `Response`, add `response: Response` to the route signature, set `response.headers["X-Papermite-Parser-Backend"] = settings.parser_backend` just before the `return result` line.

- [ ] **Step 9.3: Add a test verifying the header on `/api/extract`**

Append to `papermite/backend/tests/test_extract_api.py`:

```python
def test_extract_response_includes_parser_backend_header(monkeypatch):
    """Response carries the active parser_backend for debuggability."""
    monkeypatch.setattr("app.config.settings.parser_backend", "claude_merged")

    fake_model = {
        "model_definition": {
            "student": {"base_fields": [], "custom_fields": []},
        }
    }
    with (
        patch("app.api.extract.get_active_model", return_value=fake_model),
        patch("app.api.extract.extract_for_entity", return_value={}),
    ):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")

    assert resp.status_code == 200
    assert resp.headers["X-Papermite-Parser-Backend"] == "claude_merged"
```

- [ ] **Step 9.4: Run the new test**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/test_extract_api.py::test_extract_response_includes_parser_backend_header -v
```

Expected: pass.

- [ ] **Step 9.5: Update `papermite/CLAUDE.md`**

Read the current file:
```bash
sed -n '1,80p' /Users/kennylee/Development/NeoApex/papermite/CLAUDE.md
```

Find the "Backend" or "Architecture" section that lists `parser.py`, `processor.py`, `field_extractor.py`, etc. Replace those references with:

> `app/services/extraction_pipeline.py` — shared parse+extract dispatcher with two entrypoints: `extract_for_discovery` (multi-entity, used by `/api/upload`) and `extract_for_entity` (single-entity, used by `/api/extract`). Honors `PAPERMITE_PARSER_BACKEND` for PDF dispatch (`local` → docling, `claude_merged` → Claude vision via `BinaryContent`).
>
> `app/services/extractor.py` — text-based and vision-based extractors used by the pipeline (`extract_entities`, `extract_entities_from_pdf`, `extract_fields`, `extract_fields_from_pdf`).

If `parser.py`, `field_extractor.py`, or `processor.py` appear elsewhere in the doc, remove those mentions.

- [ ] **Step 9.6: Sync the modified spec to the live OpenSpec specs directory**

Copy the modified spec over the live one:

```bash
cp /Users/kennylee/Development/NeoApex/papermite/openspec/changes/consolidate-extract-pipeline/specs/document-field-extraction/spec.md \
   /Users/kennylee/Development/NeoApex/papermite/openspec/specs/document-field-extraction/spec.md
```

Then strip the `## MODIFIED Requirements` header line so the live spec doesn't read as a delta — it's the current spec now:

Open `papermite/openspec/specs/document-field-extraction/spec.md`, delete the first line `## MODIFIED Requirements`, save.

Verify the file still parses:
```bash
head -5 /Users/kennylee/Development/NeoApex/papermite/openspec/specs/document-field-extraction/spec.md
```

Expected: starts with `### Requirement: POST document extraction endpoint`.

- [ ] **Step 9.7: Run the full backend suite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -q
```

Expected: all green.

- [ ] **Step 9.8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/api/extract.py \
        papermite/backend/app/api/upload.py \
        papermite/backend/tests/test_extract_api.py \
        papermite/CLAUDE.md \
        papermite/openspec/specs/document-field-extraction/spec.md
git commit -m "feat(papermite): add X-Papermite-Parser-Backend response header; sync spec and CLAUDE.md

The header surfaces the active parser backend on every /api/extract and
/api/upload response, aiding production debugging when extraction quality
issues surface. CLAUDE.md and the live document-field-extraction spec
are updated to match the consolidated pipeline architecture."
```

---

## Task 10: Final verification before release

**Goal:** Confirm everything builds and passes locally.

- [ ] **Step 10.1: Run papermite backend tests with full output**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
source .venv/bin/activate
python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -v 2>&1 | tail -30
```

Expected: all tests pass; record the count.

- [ ] **Step 10.2: Run papermite frontend build**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npm run build
```

Expected: success, no TypeScript errors.

- [ ] **Step 10.3: Run admindash frontend build**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
npm run build
```

Expected: success.

- [ ] **Step 10.4: Confirm OpenSpec change still validates**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
openspec status --change "consolidate-extract-pipeline"
```

Expected: `4/4 artifacts complete`.

- [ ] **Step 10.5: Review the diff**

```bash
cd /Users/kennylee/Development/NeoApex
git log --oneline main..HEAD
git diff main...HEAD --stat
```

Expected: ~7-9 commits, ~12-16 files changed.

---

## Task 11: Release

**Goal:** Push, tag, and deploy. The deploy pipeline requires manual approval in the GitHub `production` environment.

- [ ] **Step 11.1: Push the feature branch**

```bash
cd /Users/kennylee/Development/NeoApex
git push -u origin feat/consolidate-extract-pipeline
```

- [ ] **Step 11.2: Open a PR (optional but recommended for review record)**

```bash
gh pr create --title "refactor(papermite): consolidate parse+extract into extraction_pipeline" \
  --body "$(cat <<'EOF'
## Summary

- Introduces `app/services/extraction_pipeline.py` with two named entrypoints (`extract_for_discovery`, `extract_for_entity`) shared by `/api/upload` and `/api/extract`.
- `/api/extract` now honors `PAPERMITE_PARSER_BACKEND` and gains Claude-vision support for PDFs (was hardcoded to docling).
- Drops image format support from `/api/extract`; both routes now accept `{.pdf, .docx, .txt}`.
- Removes `ExtractionResult.raw_text` and the corresponding "Show Source" UI from the papermite-frontend review page (the merged-vision path returned a placeholder string in production).
- Hard-deletes `parser.py`, `field_extractor.py`, `processor.py`, and their dedicated tests; folds `extract_fields` and adds new `extract_fields_from_pdf` into `extractor.py`.
- Adds `X-Papermite-Parser-Backend` response header for prod debugging.

OpenSpec change: `papermite/openspec/changes/consolidate-extract-pipeline/`.

## Test plan

- [x] All papermite backend tests green
- [x] papermite-frontend builds clean
- [x] admindash-frontend builds clean
- [ ] Post-deploy: confirm `X-Papermite-Parser-Backend` header on a real `/api/extract` call
- [ ] Post-deploy: confirm no docling/RapidOCR weights load when `parser_backend=claude_merged` and a PDF is uploaded via admindash

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Save the PR URL output.

- [ ] **Step 11.3: Merge the PR (after review)**

Either via the GitHub UI or:

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

- [ ] **Step 11.4: Determine the next papermite version**

```bash
gh release list --limit 5 | grep papermite
```

If the latest is `papermite-v0.2.1`, the next is `papermite-v0.3.0` (this is a refactor + minor breaking shape change to `/api/upload`'s response, so a minor version bump is appropriate).

- [ ] **Step 11.5: Cut the release**

```bash
gh release create papermite-v0.3.0 \
  --target main \
  --title "papermite v0.3.0 — consolidate parse+extract pipeline" \
  --notes "$(cat <<'EOF'
## What's new

- New `extraction_pipeline` module unifies parse+extract dispatch for both `/api/upload` and `/api/extract`.
- `/api/extract` now honors `PAPERMITE_PARSER_BACKEND` and supports `claude_merged` for PDFs — eliminates the docling/RapidOCR memory load that caused the recent OOM.
- File-format set unified across both routes: `.pdf`, `.docx`, `.txt`. Image formats no longer accepted by `/api/extract`.

## Breaking changes

- `/api/upload` response no longer includes `raw_text`. The papermite-frontend "Show Source" feature is removed in lockstep.
- `/api/extract` no longer accepts `.png`, `.jpg`, `.jpeg`. Returns HTTP 422 for these.

## Operational note

Set `PAPERMITE_PARSER_BACKEND=claude_merged` on `papermite-api` if you want the OOM-relieving Claude-vision path to be active for admindash document uploads:

\`\`\`bash
flyctl secrets set PAPERMITE_PARSER_BACKEND=claude_merged --app papermite-api
\`\`\`

If left at the default `local`, the consolidation gives you the option to flip later.
EOF
)"
```

- [ ] **Step 11.6: Cut frontend releases in lockstep**

The `/api/upload` response shape changed. Frontend bundles must be deployed together with the backend.

```bash
gh release create papermite-frontend-v0.X.Y --target main \
  --title "papermite-frontend — drop Show Source UI" \
  --notes "Removes the Show Source toggle and panel from the review page. Aligns with papermite-api v0.3.0, which no longer returns raw_text."
```

(Pick `0.X.Y` based on `gh release list --limit 5 | grep papermite-frontend`. Same pattern for `admindash-frontend`.)

```bash
gh release create admindash-frontend-v0.X.Y --target main \
  --title "admindash-frontend — narrow upload formats to PDF/DOCX/TXT" \
  --notes "Aligns with papermite-api v0.3.0 ALLOWED_EXTENSIONS. Removes PNG/JPG/JPEG from the upload picker."
```

- [ ] **Step 11.7: Approve the production deploys**

Open https://github.com/kennyhlee/neo-apex/actions and approve the deploy run for each tagged release in the `production` environment. The papermite-api deploy must complete before frontends are functional.

- [ ] **Step 11.8: Verify post-deploy**

```bash
flyctl secrets list --app papermite-api | grep PAPERMITE_PARSER_BACKEND
```

Expected: secret is set. If you want OOM relief immediately and the value is `local`, flip it:

```bash
flyctl secrets set PAPERMITE_PARSER_BACKEND=claude_merged --app papermite-api
```

Then exercise the flow:
1. Open `https://admin.floatify.com`, log in.
2. Navigate to Students → Add Student → Upload Document.
3. Drop a sample PDF.
4. Open DevTools → Network → click the `/api/extract/...` request.
5. Expected: HTTP 200 with extracted fields, response header `X-Papermite-Parser-Backend: claude_merged`.

Then check papermite-api logs:

```bash
flyctl logs --app papermite-api -n 100 | grep -i "rapidocr\|docling"
```

Expected: no recent docling/RapidOCR activity correlated with the test request (older entries from before the secret flip are fine).

---

## Task 12: Soak window (operational, not code)

**Goal:** Confirm production stability before declaring the change complete.

- [ ] **Step 12.1: Monitor for 7 days**

Track:
- `flyctl status --app papermite-api` — machine state, health checks, memory pressure.
- Customer-reported extraction failures.
- The `X-Papermite-Parser-Backend` header in any error reports.

- [ ] **Step 12.2: If stable on `claude_merged` for 7 days, open a follow-up to scale memory back**

Create a separate change via `/floatify` titled "Scale papermite-api memory back to 2 GB after extraction-pipeline soak." That's out of scope for this plan — the present plan is complete once Step 11.8 verifies the post-deploy behavior and Step 12.1 begins.

---

## Self-Review Checklist

This was performed before saving the plan. Issues found and fixed inline:

- ✅ Spec coverage: every requirement in `specs/document-extraction-pipeline/spec.md` and `specs/document-field-extraction/spec.md` maps to one or more tasks.
- ✅ No placeholders ("TBD", "TODO", "implement later"): none present.
- ✅ Type consistency: function signatures used in tests match the implementations (`extract_for_discovery → RawExtraction`, `extract_for_entity → dict[str, Any]`, `extract_fields_from_pdf` arg order matches across Tasks 3 and 4).
- ✅ Task ordering: schema cleanup (Task 2) happens before pipeline rewires (Tasks 5-6) so the codebase is internally consistent at every commit. Hard-delete (Task 8) is last among code tasks.
- ✅ Frontend lockstep: papermite-frontend changes are bundled into Task 2 (with the schema change that requires them); admindash-frontend changes are isolated in Task 7.
- ✅ Branch hygiene: Task 1.6 creates a feature branch; Task 11 merges to main.
