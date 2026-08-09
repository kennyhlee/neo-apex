"""The `workflow_item.status` vocabulary is single-sourced in
`app.workflows.shared.ItemStatus`.

These tests are the guard rail for that claim: the vocabulary is exactly
five values, `in_progress` is gone (Plan 1 follow-up #23), the derived sets
are derived rather than re-spelled, and `StrEnum` semantics hold so a raw
DataCore string still compares and hashes equal to its member.
"""
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
