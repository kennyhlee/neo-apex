# apexflow/backend/app/workflows/conditions.py
"""evaluate_condition — the pure evaluator for the ConditionGroup/Condition
expression language declared in app/workflows/schema.py. Used by `show_if`
(step applicability) and the `data_condition` guard primitive (§4 of the
spec) — both share this exact schema and evaluator.

No I/O: given a group and a flat `data` dict (keys `"{section_id}.{field}"`
or `"context.{key}"`), returns a bool. Callers are responsible for building
`data` from draft_data/context/subject_refs as appropriate to the call site;
this module has no opinion on where the dict comes from.
"""
from typing import Any

from app.workflows.schema import Condition, ConditionGroup

# Sentinel distinguishing "key present with value None" from "key absent"
# while walking `data` — the two cases evaluate differently for empty/
# not_empty/truthy (see _eval_leaf) even though both look like "no value".
_MISSING = object()

# Values treated as "empty" for the empty/not_empty ops, for a *present*
# source. Deliberately excludes 0/False: a present-but-falsy scalar is not
# the same thing as an empty string/list/dict, and truthy already covers the
# falsy-value case.
_EMPTY_VALUES = (None, "", [], {})


def _lookup(source: str, data: dict[str, Any]) -> Any:
    return data.get(source, _MISSING)


def _eval_leaf(cond: Condition, data: dict[str, Any]) -> bool:
    raw = _lookup(cond.source, data)
    missing = raw is _MISSING
    op = cond.op

    if op == "empty":
        if missing:
            return True
        return raw in _EMPTY_VALUES
    if op == "not_empty":
        if missing:
            return False
        return raw not in _EMPTY_VALUES
    if op == "truthy":
        if missing:
            return False
        return bool(raw)

    # eq/ne/in: missing source evaluates as if the value were None.
    value = None if missing else raw
    if op == "eq":
        return value == cond.value
    if op == "ne":
        return value != cond.value
    if op == "in":
        return value in cond.value

    raise ValueError(f"unknown condition op: {op!r}")  # pragma: no cover — schema enum guards this


def _eval_item(item: Condition | ConditionGroup, data: dict[str, Any]) -> bool:
    if isinstance(item, ConditionGroup):
        return evaluate_condition(item, data)
    return _eval_leaf(item, data)


def evaluate_condition(group: ConditionGroup, data: dict[str, Any]) -> bool:
    """Evaluate a ConditionGroup against `data`.

    - `all`: True iff every item is true (vacuously True for an empty list).
    - `any`: True iff at least one item is true (vacuously False for an
      empty list).
    - `not`: list-shaped like `all`/`any` rather than a single operand (the
      spec gives all three keys the same `[...]` shape) — True iff *none* of
      the items are true (the negation of `any`; vacuously True for an empty
      list). This reading is a design decision made in this task since the
      spec does not spell out `not`'s aggregation over >1 item explicitly;
      flagged in task-3-report.md.

    ConditionGroup's own model validator guarantees exactly one of
    all_/any_/not_ is set, so the final branch is unreachable in practice
    and only guards against constructing a group via
    `model_construct`/mutation that bypasses validation.
    """
    if group.all_ is not None:
        return all(_eval_item(item, data) for item in group.all_)
    if group.any_ is not None:
        return any(_eval_item(item, data) for item in group.any_)
    if group.not_ is not None:
        return not any(_eval_item(item, data) for item in group.not_)
    raise ValueError("ConditionGroup has none of all/any/not set")  # pragma: no cover
