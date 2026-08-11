"""Archive/unarchive lineage lifecycle + instance abandon/restore.

Owns the cross-cutting behaviour that spans definitions.py and machine.py;
per-route wiring assertions stay in test_definitions_api.py / test_instances.py.

Spec: docs/superpowers/specs/2026-08-11-workflow-archive-lifecycle-design.md
"""
import pytest

from app.workflows.definitions import is_archived


@pytest.mark.parametrize("lineage_status,expected", [
    ("archived", True),
    ("retired", True),      # legacy rows written before the rename
    ("active", False),
    ("deprecated", False),
    ("", False),
])
def test_is_archived_covers_archived_and_legacy_retired(lineage_status, expected):
    assert is_archived({"lineage_status": lineage_status}) is expected


def test_is_archived_on_row_with_no_lineage_status_column():
    """A tenant whose table predates the column reads back a row with the key
    absent entirely — that must be False, not a KeyError."""
    assert is_archived({}) is False
