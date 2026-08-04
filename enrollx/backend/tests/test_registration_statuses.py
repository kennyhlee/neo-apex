"""Table-driven transition matrices for application and item statuses."""
import pytest
from fastapi import HTTPException

from app.registration.statuses import (
    ALLOWED_TRANSITIONS,
    APPLICATION_STATUSES,
    ITEM_STATUSES,
    ITEM_TRANSITIONS,
    assert_item_transition,
    assert_transition,
)

APP_ALLOWED_PAIRS = {
    ("draft", "submitted"), ("draft", "waitlisted"), ("draft", "withdrawn"),
    ("submitted", "in_review"), ("submitted", "approved"), ("submitted", "declined"),
    ("submitted", "pending_items"), ("submitted", "withdrawn"),
    ("in_review", "approved"), ("in_review", "declined"),
    ("in_review", "pending_items"), ("in_review", "withdrawn"),
    ("pending_items", "in_review"), ("pending_items", "declined"),
    ("pending_items", "withdrawn"),
    ("waitlisted", "in_review"), ("waitlisted", "withdrawn"),
    ("approved", "enrolled"), ("approved", "withdrawn"),
}


@pytest.mark.parametrize("frm", APPLICATION_STATUSES)
@pytest.mark.parametrize("to", APPLICATION_STATUSES)
def test_application_transition_matrix(frm, to):
    if (frm, to) in APP_ALLOWED_PAIRS:
        assert_transition(frm, to)  # must not raise
    else:
        with pytest.raises(HTTPException) as exc:
            assert_transition(frm, to)
        assert exc.value.status_code == 409


def test_409_detail_lists_allowed_transitions():
    with pytest.raises(HTTPException) as exc:
        assert_transition("draft", "approved")
    assert exc.value.detail["allowed"] == sorted(ALLOWED_TRANSITIONS["draft"])


def test_every_status_has_a_transition_entry():
    assert set(ALLOWED_TRANSITIONS) == set(APPLICATION_STATUSES)
    assert set(ITEM_TRANSITIONS) == set(ITEM_STATUSES)


def test_unknown_status_is_409():
    with pytest.raises(HTTPException) as exc:
        assert_transition("bogus", "draft")
    assert exc.value.status_code == 409


ITEM_ALLOWED_PAIRS = {
    ("not_started", "in_progress"), ("not_started", "submitted"), ("not_started", "waived"),
    ("in_progress", "submitted"), ("in_progress", "waived"),
    ("submitted", "verified"), ("submitted", "rejected"), ("submitted", "waived"),
    ("rejected", "submitted"), ("rejected", "waived"),
}


@pytest.mark.parametrize("frm", ITEM_STATUSES)
@pytest.mark.parametrize("to", ITEM_STATUSES)
def test_item_transition_matrix(frm, to):
    if (frm, to) in ITEM_ALLOWED_PAIRS:
        assert_item_transition(frm, to)  # must not raise
    else:
        with pytest.raises(HTTPException) as exc:
            assert_item_transition(frm, to)
        assert exc.value.status_code == 409
