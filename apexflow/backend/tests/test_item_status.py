"""The `workflow_item.status` vocabulary is single-sourced in
`app.workflows.shared.ItemStatus`.

These tests are the guard rail for that claim: the vocabulary is exactly
five values, `in_progress` is gone (Plan 1 follow-up #23), the derived sets
are derived rather than re-spelled, and `StrEnum` semantics hold so a raw
DataCore string still compares and hashes equal to its member.
"""
import inspect
import re
from pathlib import Path

from app.workflows import engine
from app.workflows.engine import COMPLETABLE_STATUSES
from app.workflows.shared import ITEM_DONE_STATUSES, ItemStatus


def test_vocabulary_is_exactly_the_five_written_statuses():
    assert {s.value for s in ItemStatus} == {
        "not_started", "submitted", "verified", "waived", "rejected",
    }


def test_in_progress_is_gone():
    """Plan 1 follow-up #23: declared legal, never written, never tested."""
    assert "in_progress" not in {s.value for s in ItemStatus}
    assert "in_progress" not in COMPLETABLE_STATUSES


def test_members_compare_equal_to_plain_strings():
    """StrEnum, not Enum -- raw DataCore strings must keep comparing."""
    assert ItemStatus.SUBMITTED == "submitted"
    assert "submitted" in ITEM_DONE_STATUSES
    assert {"status": "verified"}.get("status") in ITEM_DONE_STATUSES


def test_derived_sets():
    assert ITEM_DONE_STATUSES == frozenset(
        {ItemStatus.SUBMITTED, ItemStatus.VERIFIED, ItemStatus.WAIVED}
    )
    assert COMPLETABLE_STATUSES == frozenset(
        {ItemStatus.NOT_STARTED, ItemStatus.SUBMITTED, ItemStatus.REJECTED}
    )


def test_engine_writes_no_bare_status_literals():
    """Every status the engine assigns comes from ItemStatus, so a typo is an
    AttributeError at import rather than a silently wrong row."""
    src = inspect.getsource(engine)
    for literal in ('"not_started"', '"submitted"', '"verified"',
                    '"waived"', '"rejected"'):
        assert f'"status": {literal}' not in src, (
            f"engine.py still writes a bare status literal {literal}"
        )
        assert f'changes["status"] = {literal}' not in src


def test_generated_ts_matches_the_enum():
    """`workflow-forms/src/itemStatus.generated.ts` is generated from this enum
    by `apexflow/backend/scripts/generate_item_status_ts.py` and committed.
    This test is the drift alarm: change the enum without re-running the
    generator and it fails."""
    repo = Path(__file__).resolve().parents[3]
    generated = (repo / "workflow-forms/src/itemStatus.generated.ts").read_text()
    for s in ItemStatus:
        assert f"'{s.value}'" in generated, f"{s.value} missing from generated TS"
    assert "in_progress" not in generated
    # every status the generated file declares is a real member, so a stale
    # extra value is caught too
    declared = set(re.findall(r"'([a-z_]+)'", generated))
    assert declared == {s.value for s in ItemStatus}


def test_generated_ts_done_statuses_match():
    repo = Path(__file__).resolve().parents[3]
    generated = (repo / "workflow-forms/src/itemStatus.generated.ts").read_text()
    # split on "= [" so the `readonly ItemStatus[]` annotation's own bracket
    # doesn't truncate the list
    block = generated.split("ITEM_DONE_STATUSES")[1].split("= [")[1]
    done = set(re.findall(r"'([a-z_]+)'", block.split("]")[0]))
    assert done == {s.value for s in ITEM_DONE_STATUSES}
