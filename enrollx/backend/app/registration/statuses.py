"""Application/item status vocabulary and transition guards (spec section 5,
roadmap interface contracts). Status names are BINDING across all plans.

`withdrawn` transitions exist but no v1 action triggers them (roadmap has no
`withdraw` action yet — deliberate, see the plan's Contract notes).
"""
from fastapi import HTTPException

APPLICATION_STATUSES = [
    "draft", "submitted", "in_review", "pending_items", "approved",
    "enrolled", "waitlisted", "declined", "withdrawn",
]

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"submitted", "waitlisted", "withdrawn"},
    "submitted": {"in_review", "approved", "declined", "pending_items", "withdrawn"},
    "in_review": {"approved", "declined", "pending_items", "withdrawn"},
    "pending_items": {"in_review", "declined", "withdrawn"},
    "approved": {"enrolled", "withdrawn"},
    "waitlisted": {"in_review", "withdrawn"},
    "enrolled": set(),
    "declined": set(),
    "withdrawn": set(),
}

ITEM_STATUSES = ["not_started", "in_progress", "submitted", "verified", "rejected", "waived"]

ITEM_TRANSITIONS: dict[str, set[str]] = {
    "not_started": {"in_progress", "submitted", "waived"},
    "in_progress": {"submitted", "waived"},
    "submitted": {"verified", "rejected", "waived"},
    "rejected": {"submitted", "waived"},
    "verified": set(),
    "waived": set(),
}


def _assert(table: dict[str, set[str]], kind: str, current: str, target: str) -> None:
    allowed = table.get(current)
    if allowed is None:
        raise HTTPException(409, {"error": f"Unknown {kind} status '{current}'", "allowed": []})
    if target not in allowed:
        raise HTTPException(409, {
            "error": f"Cannot move {kind} from '{current}' to '{target}'",
            "allowed": sorted(allowed),
        })


def assert_transition(current: str, target: str) -> None:
    _assert(ALLOWED_TRANSITIONS, "application", current, target)


def assert_item_transition(current: str, target: str) -> None:
    _assert(ITEM_TRANSITIONS, "item", current, target)
