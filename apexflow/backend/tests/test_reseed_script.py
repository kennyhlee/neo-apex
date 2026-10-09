# apexflow/backend/tests/test_reseed_script.py
"""Unit tests for scripts/apexflow-reseed-dev.py's PURE helpers only
(`discover_dev_tenants`, `merge_model_definition`) — task-9-brief.md Step 3:
"unit-test its pure helpers if practical." The script's I/O (archive/models
PUT/seed-template calls against a live DataCore) is explicitly NOT run by
this task; see the script's own module docstring.

The script's filename (`apexflow-reseed-dev.py`) is not a valid Python
module identifier (hyphens), so it's loaded here via `importlib` by file
path rather than a normal `import` statement.
"""
import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "apexflow-reseed-dev.py"
)


def _load_script():
    spec = importlib.util.spec_from_file_location("apexflow_reseed_dev", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


reseed = _load_script()


# --- discover_dev_tenants: pure filesystem scan -----------------------------


def test_discover_dev_tenants_reads_entities_lance_suffix(tmp_path, monkeypatch):
    lancedb_dir = tmp_path / "lancedb"
    lancedb_dir.mkdir()
    (lancedb_dir / "acme_entities.lance").mkdir()
    (lancedb_dir / "acme-afterschool_entities.lance").mkdir()
    (lancedb_dir / "acme_models.lance").mkdir()  # not an _entities table -- excluded
    (lancedb_dir / "acme_sequences.lance").mkdir()  # ditto

    monkeypatch.setattr(reseed, "LANCEDB_DIR", lancedb_dir)
    assert reseed.discover_dev_tenants() == ["acme", "acme-afterschool"]


def test_discover_dev_tenants_empty_when_directory_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(reseed, "LANCEDB_DIR", tmp_path / "does-not-exist")
    assert reseed.discover_dev_tenants() == []


def test_discover_dev_tenants_sorted():
    # Uses the REAL repo lancedb dir (read-only scan) -- just asserts the
    # invariant the caller relies on (deterministic order), not specific
    # tenant names (those change as dev data comes and goes).
    tenants = reseed.discover_dev_tenants()
    assert tenants == sorted(tenants)


# --- WIPE_ENTITY_TYPES: spec §10 coverage sanity ----------------------------


def test_wipe_entity_types_covers_registration_and_workflow_rows():
    types = set(reseed.WIPE_ENTITY_TYPES)
    for expected in (
        "registration_config", "registration_application", "application_item",
        "application_activity", "payment",
        "workflow_definition", "workflow_instance", "workflow_item", "workflow_activity",
    ):
        assert expected in types


# --- SEEDED_TEMPLATE_IDS: cross-check against the real catalog --------------


def test_seeded_template_ids_match_the_shipped_catalog():
    """The script's `SEEDED_TEMPLATE_IDS` is a hand-written literal (it must
    be readable without importing apexflow-backend's deps, since the seeders
    themselves are a deferred import). This is what stops it drifting from
    `app.templates.catalog.template_catalog()` when a third template lands:
    add one to the catalog and forget the script, and this fails."""
    from app.templates.catalog import template_catalog

    assert list(reseed.SEEDED_TEMPLATE_IDS) == [t["template_id"] for t in template_catalog()]
