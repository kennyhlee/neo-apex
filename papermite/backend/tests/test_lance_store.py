"""Tests for lance_store.py after datacore migration.

These tests verify the public API contract is preserved:
- get_active_model() returns the correct dict shape
- commit_finalize() stores per-entity-type via datacore and returns correct shape
- preview_finalize() detects unchanged vs changed models
- Change detection skips writes for identical models
- Rollback via change_id reverts all entity types
"""

import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

from app.config import Settings
from app.models.extraction import (
    EntityResult,
    ExtractionResult,
    FieldMapping,
)
from app.storage.lance_store import (
    commit_finalize,
    get_active_model,
    preview_finalize,
)


def _make_extraction(tenant_id: str, filename: str = "test.pdf") -> ExtractionResult:
    """Build a minimal ExtractionResult with student and staff entity types."""
    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        raw_text="test document text",
        entities=[
            EntityResult(
                entity_type="student",
                entity={"first_name": "Alice", "last_name": "Smith"},
                field_mappings=[
                    FieldMapping(field_name="first_name", value="Alice", source="base_model", required=True),
                    FieldMapping(field_name="last_name", value="Smith", source="base_model", required=True),
                    FieldMapping(field_name="bus_route", value="Route 5", source="custom_field", required=False),
                ],
            ),
            EntityResult(
                entity_type="staff",
                entity={"name": "Bob Jones", "role": "teacher"},
                field_mappings=[
                    FieldMapping(field_name="name", value="Bob Jones", source="base_model", required=True),
                    FieldMapping(field_name="role", value="teacher", source="base_model", required=True),
                ],
            ),
        ],
    )


def _patch_settings_and_reset(tmp_dir: str):
    """Patch settings.lancedb_dir and reset singletons for test isolation."""
    import app.storage.lance_store as module
    module._store = None
    return patch(
        "app.storage.lance_store.settings",
        Settings(lancedb_dir=Path(tmp_dir)),
    )


# -- get_active_model contract --

def test_get_active_model_none_when_no_data():
    """Returns None when no model has been committed for the tenant."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            result = get_active_model("tenant_new")
            assert result is None


def test_get_active_model_returns_correct_shape():
    """After commit, get_active_model returns dict with exactly the expected keys."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = get_active_model("t1")
            assert result is not None
            expected_keys = {"tenant_id", "version", "status", "model_definition", "source_filename", "created_by", "created_at"}
            assert set(result.keys()) == expected_keys
            assert result["tenant_id"] == "t1"
            assert result["status"] == "active"
            assert result["source_filename"] == "test.pdf"
            assert result["created_by"] == "admin"


def test_get_active_model_definition_has_entity_types():
    """model_definition is keyed by entity type with base_fields and custom_fields."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = get_active_model("t1")
            model_def = result["model_definition"]
            assert "student" in model_def
            assert "staff" in model_def
            assert "base_fields" in model_def["student"]
            assert "custom_fields" in model_def["student"]


def test_get_active_model_no_internal_fields_leaked():
    """Return dict must not contain datacore-internal fields."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = get_active_model("t1")
            # No datacore internals
            for key in ("_change_id", "_updated_at", "_version", "_status", "entity_type"):
                assert key not in result
            # No underscore metadata in model_definition
            for entity_type, defn in result["model_definition"].items():
                for key in defn:
                    assert not key.startswith("_"), f"Leaked internal key {key} in {entity_type}"


# -- commit_finalize contract --

def test_commit_finalize_returns_correct_shape():
    """commit_finalize returns dict with expected keys and status 'finalized'."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            result = commit_finalize("t1", extraction, created_by="admin")

            expected_keys = {"tenant_id", "version", "status", "model_definition", "source_filename", "created_by", "created_at"}
            assert set(result.keys()) == expected_keys
            assert result["status"] == "finalized"
            assert result["version"] == 1
            assert result["tenant_id"] == "t1"
            assert result["source_filename"] == "test.pdf"
            assert result["created_by"] == "admin"


def test_commit_finalize_unchanged_model_skips_write():
    """Committing the same model twice returns status 'unchanged' without incrementing version."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            first = commit_finalize("t1", extraction, created_by="admin")
            assert first["status"] == "finalized"
            assert first["version"] == 1

            second = commit_finalize("t1", extraction, created_by="admin")
            assert second["status"] == "unchanged"
            assert second["version"] == 1  # not incremented


def test_commit_finalize_changed_model_increments_version():
    """A changed model gets a new version."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction1 = _make_extraction("t1", filename="v1.pdf")
            result1 = commit_finalize("t1", extraction1, created_by="admin")
            assert result1["version"] == 1

            # Change the extraction — add a new field
            extraction2 = _make_extraction("t1", filename="v2.pdf")
            extraction2.entities[0].field_mappings.append(
                FieldMapping(field_name="grade", value="5", source="base_model", required=False)
            )
            result2 = commit_finalize("t1", extraction2, created_by="admin")
            assert result2["status"] == "finalized"
            assert result2["version"] >= 2


# -- preview_finalize contract --

def test_preview_finalize_pending_confirmation():
    """Preview returns 'pending_confirmation' when no existing model."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            result = preview_finalize("t1", extraction)

            assert result["status"] == "pending_confirmation"
            assert result["version"] == 1
            assert "model_definition" in result
            assert result["source_filename"] == "test.pdf"


def test_preview_finalize_unchanged():
    """Preview returns 'unchanged' when model matches active."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = preview_finalize("t1", extraction)
            assert result["status"] == "unchanged"
            assert result["version"] == 1
            assert result["created_by"] == "admin"


# -- Per-entity-type storage --

def test_per_entity_type_versioning():
    """Each entity type stored as separate datacore model record."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            from datacore import Store
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            # Verify individual entity types are stored separately in datacore
            # by checking we can retrieve them independently
            from app.storage.lance_store import _get_store
            store = _get_store()
            student_model = store.get_active_model("t1", "student")
            staff_model = store.get_active_model("t1", "staff")

            assert student_model is not None
            assert staff_model is not None
            assert student_model["entity_type"] == "student"
            assert staff_model["entity_type"] == "staff"


def test_tenant_isolation():
    """Different tenants don't see each other's models."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            ext1 = _make_extraction("t1")
            ext2 = _make_extraction("t2")
            commit_finalize("t1", ext1, created_by="admin1")
            commit_finalize("t2", ext2, created_by="admin2")

            r1 = get_active_model("t1")
            r2 = get_active_model("t2")
            assert r1["created_by"] == "admin1"
            assert r2["created_by"] == "admin2"

            # Tenant 3 has nothing
            assert get_active_model("t3") is None


def test_rollback_reverts_all_entity_types():
    """Rollback by change_id reverts all entity types from a finalization."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            # First commit — baseline
            ext1 = _make_extraction("t1", filename="v1.pdf")
            commit_finalize("t1", ext1, created_by="admin")

            # Second commit — changed model (add a field)
            ext2 = _make_extraction("t1", filename="v2.pdf")
            ext2.entities[0].field_mappings.append(
                FieldMapping(field_name="grade", value="5", source="base_model", required=False)
            )
            result2 = commit_finalize("t1", ext2, created_by="admin")
            assert result2["version"] >= 2

            # Find the change_id from the second commit
            from app.storage.lance_store import _get_store
            store = _get_store()
            student = store.get_active_model("t1", "student")
            change_id = student["_change_id"]

            # Rollback
            store.rollback_by_change_id("t1", change_id)

            # Should be back to v1
            model = get_active_model("t1")
            assert model is not None
            assert model["source_filename"] == "v1.pdf"
