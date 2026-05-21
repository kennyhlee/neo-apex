# Papermite Include Missing Default Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure `mapper.map_extraction` returns exactly one `EntityResult` per entity type declared in `app.models.domain.ENTITY_CLASSES`, adding a placeholder (full base-field coverage, `value=None`) for any type the AI did not extract. Fixes the bug where a document missing a given entity type produces a model definition that omits it entirely.

**Architecture:** Single coverage-backstop block added immediately after `entities = _consolidate_entities(entities)` inside `map_extraction`. The block iterates `ENTITY_CLASSES.items()` and calls `_map_entity_list([{}], entity_type, model_class, tenant_id)` for any type not already represented in `entities`. Leverages existing helpers (`_map_entity_list`, `_map_entity`, `_consolidate_entities`) without modifying them. No changes outside `mapper.py` and one new test file (well, additions to existing test file).

**Tech Stack:** Python 3, Pydantic, pytest, `uv` for dependency management. Tests run from `papermite/backend/`.

**Spec source (authoritative):**
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-include-missing-default-entities/proposal.md`
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-include-missing-default-entities/design.md`
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-include-missing-default-entities/specs/papermite-mapper-default-entity-coverage/spec.md`
- `/Users/kennylee/Development/NeoApex/openspec/changes/papermite-include-missing-default-entities/tasks.md`

**Out of scope:** UI changes, DataCore changes, Launchpad changes, changes to `ENTITY_CLASSES` contents, changes to `_build_model_definition`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `papermite/backend/app/services/mapper.py` | Modify (single insertion after line ~293) | Add coverage-backstop loop in `map_extraction` |
| `papermite/backend/tests/test_mapper.py` | Modify (append tests) | Cover the 7 mapper-level scenarios |
| `papermite/backend/tests/test_finalize_mapper_integration.py` | Create | One integration test that wires `map_extraction` → `_build_model_definition` |

Three commits total (one per task group). No new modules.

---

## Conventions

- All paths absolute, relative to repo root `/Users/kennylee/Development/NeoApex`.
- Test runs: `cd papermite/backend && uv run python -m pytest <args>` (the `cd` is required — backend has its own `pyproject.toml`).
- Commit messages follow `<type>(papermite): <summary>` per repo convention. Final commit includes issue reference.
- TDD: write failing test → run to confirm failure → implement minimum code → run to confirm pass → commit.

---

### Task 1: Add the coverage backstop to `map_extraction`

**Files:**
- Modify: `papermite/backend/app/services/mapper.py:267-299` (function `map_extraction`)
- Modify: `papermite/backend/tests/test_mapper.py` (append the trigger test)

This task adds the production code AND the smallest failing test that drives it. Subsequent tasks layer more tests on top.

- [ ] **Step 1.1: Add the failing trigger test**

Append the following to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_mapper.py` (preserve all existing content, two blank lines before the new test):

```python


def test_map_extraction_all_placeholders_when_raw_is_empty():
    """With nothing extracted, every entity type in ENTITY_CLASSES must appear."""
    from app.models.domain import ENTITY_CLASSES

    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    types = {e.entity_type for e in result.entities}
    expected = {k.upper() for k in ENTITY_CLASSES}
    assert types == expected
    assert len(result.entities) == len(ENTITY_CLASSES)
```

- [ ] **Step 1.2: Run the test and confirm it fails**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_map_extraction_all_placeholders_when_raw_is_empty -v
```

Expected: FAIL. Today, `RawExtraction()` produces 0 entities (every guard `if raw.tenant` / `if raw_list:` is false). The assertion `len(result.entities) == 8` will fail with `0 != 8`. Either failure mode is fine.

- [ ] **Step 1.3: Add the coverage backstop in `mapper.py`**

Use the Edit tool on `/Users/kennylee/Development/NeoApex/papermite/backend/app/services/mapper.py`. Find this exact block (currently the tail of `map_extraction`):

```python
    # Consolidate multiple entities of the same type into one
    entities = _consolidate_entities(entities)

    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        entities=entities,
    )
```

Replace it with:

```python
    # Consolidate multiple entities of the same type into one
    entities = _consolidate_entities(entities)

    # Coverage backstop: every entity type in ENTITY_CLASSES must be present.
    # When the AI did not extract a type, add a placeholder EntityResult with
    # full base-field coverage so downstream model definitions stay canonical.
    existing_types = {e.entity_type.lower() for e in entities}
    for entity_type, model_class in ENTITY_CLASSES.items():
        if entity_type in existing_types:
            continue
        entities.extend(
            _map_entity_list([{}], entity_type, model_class, tenant_id)
        )

    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        entities=entities,
    )
```

Note: `ENTITY_CLASSES`, `_map_entity_list`, `EntityResult`, and `ExtractionResult` are already imported at the top of `mapper.py` (lines 1-13). No new imports needed.

- [ ] **Step 1.4: Run the test and confirm it passes**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_map_extraction_all_placeholders_when_raw_is_empty -v
```

Expected: PASS.

- [ ] **Step 1.5: Run all existing mapper tests to confirm no regression**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py -v
```

Expected: all pre-existing tests still pass (test_map_family, test_map_contact_guardian, test_map_contact_medical, test_map_no_guardian_entity_type, test_map_contact_custom_fields, test_student_selection_fields_are_single_select, test_program_multi_select_fields, test_consolidator_preserves_single_select_cardinality, test_extraction_result_has_no_raw_text_field) PLUS the new test.

Note: pre-existing tests check entity counts for specific types (e.g., `test_map_family` asserts `len(family_entities) == 1` for FAMILY). The backstop adds placeholders for OTHER types, not duplicating FAMILY. So those filtered-by-type asserts remain green. If any pre-existing test asserts a total entity count (e.g., `len(result.entities) == 1`), it WILL break — but skim the existing tests first; they appear to filter by type, not count total. If a regression appears, STOP and report.

- [ ] **Step 1.6: Commit**

```
git add papermite/backend/app/services/mapper.py papermite/backend/tests/test_mapper.py
git commit -m "feat(papermite): mapper guarantees all ENTITY_CLASSES types in extraction output"
```

---

### Task 2: Cover the only-tenant scenario

**Files:**
- Modify: `papermite/backend/tests/test_mapper.py` (append one test)

- [ ] **Step 2.1: Append the test**

Append to `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_mapper.py` (two blank lines before):

```python


def test_map_extraction_only_tenant_extracted_yields_7_placeholders():
    """When AI extracts ONLY tenant, the other 7 entity types appear as placeholders."""
    from app.models.domain import ENTITY_CLASSES

    raw = RawExtraction(tenant={"name": "Acme School"})
    result = map_extraction(raw, "t1", "f.pdf")

    # 8 total: TENANT (extracted) + 7 placeholders
    assert len(result.entities) == len(ENTITY_CLASSES)

    # TENANT carries the extracted name
    tenant = next(e for e in result.entities if e.entity_type == "TENANT")
    name_mapping = next(m for m in tenant.field_mappings if m.field_name == "name")
    assert name_mapping.value == "Acme School"
    assert name_mapping.source == "base_model"

    # Every other entity type has only base_model mappings with value=None
    # (placeholders have no extracted values)
    for e in result.entities:
        if e.entity_type == "TENANT":
            continue
        for m in e.field_mappings:
            assert m.source == "base_model", (
                f"{e.entity_type}.{m.field_name} unexpectedly has source={m.source}"
            )
            # Non-selection placeholder values are None.
            # Selection fields (List[str] with defaults) carry the default list as value.
            if m.field_type != "selection":
                assert m.value is None, (
                    f"{e.entity_type}.{m.field_name} expected None, got {m.value!r}"
                )
```

- [ ] **Step 2.2: Run the test and confirm it passes**

(Backstop from Task 1 already handles this case — test should pass on first run.)

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_map_extraction_only_tenant_extracted_yields_7_placeholders -v
```

Expected: PASS. If it fails, STOP — investigate before changing the test.

- [ ] **Step 2.3: Commit**

```
git add papermite/backend/tests/test_mapper.py
git commit -m "test(papermite): cover only-tenant extraction yields 7 placeholders"
```

---

### Task 3: Cover multi-student consolidation + 7 placeholders

**Files:**
- Modify: `papermite/backend/tests/test_mapper.py`

- [ ] **Step 3.1: Append the test**

```python


def test_map_extraction_multiple_students_consolidate_others_are_placeholders():
    """Three extracted students consolidate to one STUDENT EntityResult;
    7 other entity types appear as placeholders."""
    from app.models.domain import ENTITY_CLASSES

    raw = RawExtraction(students=[
        {"first_name": "A"},
        {"first_name": "B"},
        {"first_name": "C"},
    ])
    result = map_extraction(raw, "t1", "f.pdf")

    # Total = 8 (one per ENTITY_CLASSES key)
    assert len(result.entities) == len(ENTITY_CLASSES)

    # Exactly one STUDENT after consolidation
    students = [e for e in result.entities if e.entity_type == "STUDENT"]
    assert len(students) == 1

    # first_name mapping exists with one of the three input values
    # (consolidator keeps the first encountered)
    student = students[0]
    first_name_mappings = [m for m in student.field_mappings if m.field_name == "first_name"]
    assert len(first_name_mappings) == 1
    assert first_name_mappings[0].value in {"A", "B", "C"}

    # The other 7 types are present and have no consolidated extracted data
    # (they were never extracted — the backstop added them)
    non_student_types = {k.upper() for k in ENTITY_CLASSES if k != "student"}
    actual_non_student_types = {e.entity_type for e in result.entities if e.entity_type != "STUDENT"}
    assert actual_non_student_types == non_student_types
```

- [ ] **Step 3.2: Run the test and confirm it passes**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_map_extraction_multiple_students_consolidate_others_are_placeholders -v
```

Expected: PASS.

- [ ] **Step 3.3: Commit**

```
git add papermite/backend/tests/test_mapper.py
git commit -m "test(papermite): cover multi-student consolidation with placeholders for other types"
```

---

### Task 4: Cover full base-field coverage on a placeholder

**Files:**
- Modify: `papermite/backend/tests/test_mapper.py`

This task verifies the placeholder shape requirement: a placeholder STUDENT has ALL Student base fields, with `source="base_model"`, selection options carried through for `grade_level`/`gender`/`status`.

- [ ] **Step 4.1: Append the test**

```python


def test_placeholder_student_has_full_base_field_coverage():
    """Placeholder STUDENT entity contains all base fields from the Student Pydantic class."""
    from app.models.domain import Student

    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    student = next(e for e in result.entities if e.entity_type == "STUDENT")

    # Every base field declared on Student (excluding system fields) appears in
    # field_mappings exactly once. System fields are tenant_id, entity_type, custom_fields.
    SYSTEM = {"tenant_id", "entity_type", "custom_fields"}
    expected_fields = set(Student.model_fields.keys()) - SYSTEM
    mapping_names = {m.field_name for m in student.field_mappings}
    assert mapping_names == expected_fields

    # All mappings are sourced from base_model (no custom fields in a placeholder)
    for m in student.field_mappings:
        assert m.source == "base_model"

    # Selection-type Student fields carry non-empty options lists from the
    # Pydantic class defaults
    selection_field_names = {"grade_level", "gender", "status"}
    for name in selection_field_names:
        m = next(m for m in student.field_mappings if m.field_name == name)
        assert m.field_type == "selection", f"{name} expected selection type, got {m.field_type}"
        assert m.options, f"{name} expected non-empty options list, got {m.options}"
```

- [ ] **Step 4.2: Run and confirm pass**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_placeholder_student_has_full_base_field_coverage -v
```

Expected: PASS.

- [ ] **Step 4.3: Commit**

```
git add papermite/backend/tests/test_mapper.py
git commit -m "test(papermite): assert placeholder STUDENT has full base-field coverage"
```

---

### Task 5: Cover placeholder list-entity tenant_id and UUID id behavior

**Files:**
- Modify: `papermite/backend/tests/test_mapper.py`

The placeholder list-entities (FAMILY, STUDENT, CONTACT, PROGRAM, ENROLLMENT, ATTENDANCE, REGISTRATION_APPLICATION) get their `<entity_type>_id` auto-filled with a UUID slice via `_map_entity_list`. TENANT does NOT — its `tenant_id` is set via `setdefault` before the UUID check.

- [ ] **Step 5.1: Append both tests**

```python


def test_placeholder_list_entity_gets_tenant_id_and_uuid_id():
    """A placeholder FAMILY has tenant_id == 't1' and an auto-generated family_id."""
    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    family = next(e for e in result.entities if e.entity_type == "FAMILY")

    assert family.entity["tenant_id"] == "t1"
    # _map_entity_list generates an 8-character UUID slice when the id field
    # is None on a list-type entity
    family_id = family.entity.get("family_id")
    assert isinstance(family_id, str)
    assert len(family_id) == 8


def test_placeholder_tenant_keeps_caller_provided_tenant_id():
    """A placeholder TENANT keeps tenant_id='t1' — no UUID overwrite happens
    because _map_entity_list's setdefault sets tenant_id before the UUID gate."""
    raw = RawExtraction()  # raw.tenant is None
    result = map_extraction(raw, "t1", "f.pdf")

    tenant = next(e for e in result.entities if e.entity_type == "TENANT")

    assert tenant.entity["tenant_id"] == "t1"
    # Sanity: tenant_id is not an 8-char UUID slice
    assert tenant.entity["tenant_id"] != "t1"[:8] or tenant.entity["tenant_id"] == "t1"
    # Stronger: tenant_id is literally the caller-provided value
    assert tenant.entity["tenant_id"] == "t1"
```

- [ ] **Step 5.2: Run both and confirm pass**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_placeholder_list_entity_gets_tenant_id_and_uuid_id tests/test_mapper.py::test_placeholder_tenant_keeps_caller_provided_tenant_id -v
```

Expected: 2 passed.

- [ ] **Step 5.3: Commit**

```
git add papermite/backend/tests/test_mapper.py
git commit -m "test(papermite): cover placeholder tenant_id and UUID id behavior"
```

---

### Task 6: Cover the attendance-placeholder case

**Files:**
- Modify: `papermite/backend/tests/test_mapper.py`

`ATTENDANCE` is the special case: `Attendance` is in `ENTITY_CLASSES` but has NO corresponding field on `RawExtraction` (no `raw.attendances`). The existing extraction logic NEVER produces an ATTENDANCE entity. The backstop is the only way it can appear.

- [ ] **Step 6.1: Append the test**

```python


def test_placeholder_attendance_is_added_despite_no_raw_field():
    """ATTENDANCE has no raw.attendances source field but still appears as
    a placeholder thanks to the coverage backstop iterating ENTITY_CLASSES."""
    from app.models.domain import Attendance

    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    attendances = [e for e in result.entities if e.entity_type == "ATTENDANCE"]
    assert len(attendances) == 1

    att = attendances[0]
    # Attendance base fields (excluding system fields) all appear
    SYSTEM = {"tenant_id", "entity_type", "custom_fields"}
    expected = set(Attendance.model_fields.keys()) - SYSTEM
    actual = {m.field_name for m in att.field_mappings}
    assert actual == expected

    # tenant_id is the caller-provided value
    assert att.entity["tenant_id"] == "t1"
```

- [ ] **Step 6.2: Run and confirm pass**

```
cd papermite/backend && uv run python -m pytest tests/test_mapper.py::test_placeholder_attendance_is_added_despite_no_raw_field -v
```

Expected: PASS.

- [ ] **Step 6.3: Commit**

```
git add papermite/backend/tests/test_mapper.py
git commit -m "test(papermite): cover ATTENDANCE placeholder despite no raw extraction field"
```

---

### Task 7: Integration test through `_build_model_definition`

**Files:**
- Create: `papermite/backend/tests/test_finalize_mapper_integration.py`

The whole point of the change is that downstream consumers get a complete model definition. Verify that by piping an empty extraction through `mapper.map_extraction` and then through `finalize._build_model_definition`, the resulting dict has all 8 entity-type keys with non-empty `base_fields`.

- [ ] **Step 7.1: Create the integration test file**

Create `/Users/kennylee/Development/NeoApex/papermite/backend/tests/test_finalize_mapper_integration.py` with:

```python
"""Integration: mapper.map_extraction → finalize._build_model_definition.

Verifies that the backstop in map_extraction propagates through to the
model definition dict that gets written to DataCore — every entity type
in ENTITY_CLASSES appears with non-empty base_fields, even when the
source document had nothing to extract.
"""
from app.api.finalize import _build_model_definition
from app.models.domain import ENTITY_CLASSES
from app.models.extraction import RawExtraction
from app.services.mapper import map_extraction


def test_build_model_definition_includes_all_entity_types_for_empty_extraction():
    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    model_def = _build_model_definition(result.entities)

    # Every ENTITY_CLASSES key appears in the model definition
    expected_keys = set(ENTITY_CLASSES.keys())
    actual_keys = set(model_def.keys())
    assert actual_keys == expected_keys

    # Every entry has non-empty base_fields (each Pydantic class declares at
    # least one base field beyond the system fields)
    for entity_type, definition in model_def.items():
        assert "base_fields" in definition, f"{entity_type} missing base_fields"
        assert isinstance(definition["base_fields"], list)
        assert len(definition["base_fields"]) > 0, (
            f"{entity_type} has empty base_fields"
        )
        # custom_fields is always present (placeholders carry zero custom fields)
        assert "custom_fields" in definition
        assert definition["custom_fields"] == []
```

- [ ] **Step 7.2: Run and confirm pass**

```
cd papermite/backend && uv run python -m pytest tests/test_finalize_mapper_integration.py -v
```

Expected: PASS.

- [ ] **Step 7.3: Commit**

```
git add papermite/backend/tests/test_finalize_mapper_integration.py
git commit -m "test(papermite): integration covers all 8 entity types in built model definition"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 8.1: Run the full Papermite backend test suite**

```
cd papermite/backend && uv run python -m pytest tests/ --ignore=tests/test_auth.py -v
```

The `--ignore=tests/test_auth.py` skips a pre-existing collection error unrelated to this change (`get_registry_store` was removed from `app.storage` in earlier work — not introduced by this branch). Verify this is still the same pre-existing failure by running:

```
git log -1 --oneline -- papermite/backend/tests/test_auth.py
```

The output's commit SHA should be on `main`, not the current branch.

Expected: full suite (~92 tests including the new ones) passes. If anything fails, STOP and report.

- [ ] **Step 8.2: No commit (verification step)**

---

### Task 9: Manual end-to-end smoke (optional)

**Files:** none (manual verification)

Skip in subagent-driven execution unless explicitly requested. If executed manually:

- [ ] **Step 9.1:** `./start-services.sh`
- [ ] **Step 9.2:** Upload a PDF with only tenant info via Papermite UI (http://localhost:5700). On the Review page, confirm all 8 entity cards appear: TENANT (populated), STUDENT/FAMILY/CONTACT/PROGRAM/ENROLLMENT/ATTENDANCE/REGISTRATION_APPLICATION (empty fields).
- [ ] **Step 9.3:** Click Finalize → Confirm. Open Launchpad's Model section and confirm all 8 entity types are listed in the saved model.

---

## Final wrap-up

After Task 8 passes (and optionally Task 9), the OpenSpec change `papermite-include-missing-default-entities` is ready for the archive step. Open a PR using the existing pattern (push branch → `gh pr create`). The plan does not handle PR creation or archive — that's the finishing-a-development-branch skill's job.

**Reference:** the previous change (`papermite-persist-tenant-on-finalize`, merged as PR #74 with archive commit `cfd3a43`) used the same workflow shape.
