# apexflow/backend/app/workflows/shared.py
"""Leaf module for helpers reused across `app/workflows/*` that would
otherwise force a circular import.

Why this module exists (code-review follow-up to Task 7): `validate.py`
imports `primitives.py` (to derive `GUARD_PRIMITIVES`/`EFFECT_PRIMITIVES`
from the real registries — see that module's docstring), and both
`engine.py` and `definitions.py` import `validate.py` (for
`definition_health`/`validate_definition`). That means `primitives.py`
cannot import `engine.py` or `definitions.py` directly — either would close
the cycle `primitives -> engine -> validate -> primitives` (or via
`definitions`). Task 7 worked around this by hand-duplicating the handful
of helpers it needed from those two modules; this module replaces those
duplicates with one shared source of truth that `engine.py`, `definitions.py`,
and `primitives.py` all import from.

This module only imports `schema.py`, `conditions.py`, and stdlib — neither
of which imports `validate.py` (directly or transitively) — so it is safe
for every other `workflows` module, including `validate.py` itself, to
depend on without risk of a cycle.

`engine.py` re-exports `is_family_actor`, `applicable_items`, and
`ITEM_DONE_STATUSES` (`from app.workflows.shared import ...`) rather than
just using them internally, since earlier tasks' briefs (Task 8-10) were
told to import these from `engine` — existing `from app.workflows.engine
import is_family_actor` / `engine.applicable_items(...)` call sites keep
working unchanged.
"""
from typing import Any

from app.workflows.conditions import evaluate_condition
from app.workflows.schema import StepDef

# Truthy string forms a DataCore-flattened bool column can read back as
# (interface map Gotcha C: a flattened query row's bool field arrives as
# the STRING "true"/"false", which is truthy in bare Python).
_TRUTHY_STRINGS = {"true", "1", "yes"}

# Statuses treated as "done" for blocking-completeness checks (mirrors
# enrollx's ITEM_DONE_STATUSES).
ITEM_DONE_STATUSES = frozenset({"submitted", "verified", "waived"})

# Flattened-row columns that are never part of base_data.
SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector", "_tenant"}


def is_family_actor(actor: str) -> bool:
    """`actor` strings are exactly `"family"` or `"family:{...}"` on the
    family channel, a staff `user_id` otherwise (task-6-brief's binding
    convention) — BINDING name, Task 8's actor-gating and Task 10's internal
    routes both call this.

    Exact-prefix match on `"family:"` (plus the bare `"family"` channel
    literal), NOT a bare `startswith("family")` — the latter misclassifies
    a staff user_id that happens to start with those letters
    (`"familyhub-svc"`, `"family_advocate_007"`) as a family actor, which
    would let it dodge every staff-only gate (coordinator review finding)."""
    return actor == "family" or actor.startswith("family:")


def as_bool(v: Any) -> bool:
    """Coerce a DataCore-flattened value to a real bool — a bool `False`
    reads back from a flattened query row as the STRING "false", which is
    truthy in bare Python (interface map Gotcha C)."""
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in _TRUTHY_STRINGS


def entity_base_data(row: dict) -> dict:
    """Flattened entity row -> base_data dict for a full-replace PUT.

    Drops system columns (`entity_id`/`entity_type`/`base_data`/
    `custom_fields`/`vector`/`_tenant`), every other `_`-prefixed column,
    and `None` values. No boolean-field coercion here — callers whose row
    carries a bool-typed field (e.g. `workflow_item.blocking`) must coerce
    it themselves before/after calling this (see engine.py's
    `_item_base_data` for the load-bearing example)."""
    return {k: v for k, v in row.items()
            if k not in SYSTEM_COLS and not k.startswith("_") and v is not None}


def condition_data(draft_data: dict, context: dict) -> dict[str, Any]:
    """Flatten `draft_data`/`context` into the `"{section_id}.{field}"` /
    `"context.{key}"` lookup keys `evaluate_condition` expects.

    Repeat sections contribute NOTHING here: their staged answer is a LIST
    (one dict per entry), not a `{field: value}` dict, and `show_if`'s
    expression language has no "which entry" concept. The
    `isinstance(fields, dict)` guard below is what skips them (a list fails
    it and is silently dropped), so a `show_if`/`data_condition` that names
    a field of a repeat section always evaluates as if that source were
    absent."""
    data: dict[str, Any] = {}
    for section_id, fields in (draft_data or {}).items():
        if not isinstance(fields, dict):
            continue
        for field, value in fields.items():
            data[f"{section_id}.{field}"] = value
    for key, value in (context or {}).items():
        data[f"context.{key}"] = value
    return data


def derived_document_sensitive(ctx, item_id: str | None) -> bool:
    """Server-derived `sensitive` flag for a document upload -- the pinned
    definition decides this, never the client (Plan 3 Task 4). Hoisted here
    (final-review fix wave, finding I1) so BOTH document-create routes --
    the token-scoped family surface (`app/api/internal.py`) and the staff
    surface (`app/api/documents.py`) -- share one derivation instead of two
    copies drifting apart.

    Resolves `item_id` (a `workflow_item` entity_id) to its `workflow_item`
    row's `step_id`, then to that step in `ctx.definition["steps"]` (the
    PINNED steps -- both callers build `ctx` via `build_eval_context`, so
    this is always the instance's pinned version, never the currently-
    published row), then to the `config.docs` entry whose `name` equals the
    item's `title` (`engine.py::_derive_item_specs` stamps `title =
    doc["name"]` at creation, so this is an exact match, not a fuzzy one).
    Returns `False` -- never raises -- when `item_id` is absent/`None` (a
    free-standing upload with no item) or doesn't resolve to a
    documents-kind item with a matching `docs` entry.

    `ctx` is untyped here (not `EvalContext`) deliberately: this module is a
    leaf `app/workflows/*` cannot import `primitives.py` (which imports THIS
    module) without closing an import cycle -- see module docstring. Both
    callers pass a real `machine.EvalContext`; only `.items` and
    `.definition["steps"]` are read via duck typing.
    """
    if not item_id:
        return False
    item = next((i for i in ctx.items if i.get("entity_id") == item_id), None)
    if item is None:
        return False
    step = next((s for s in ctx.definition["steps"] if s.step_id == item.get("step_id")), None)
    if step is None or step.type != "documents":
        return False
    title = item.get("title")
    for doc in step.config.get("docs", []) or []:
        if doc.get("name") == title:
            return bool(doc.get("sensitive", False))
    return False


def applicable_items(definition_steps: list[StepDef], items: list[dict], draft_data: dict,
                     context: dict) -> list[dict]:
    """Filter `items` to those whose owning step is currently applicable:
    steps without a `show_if` are always included; steps with one are
    included iff it evaluates true against the flat
    `{section.field: value} | {context.key: value}` view of `draft_data`/
    `context` (spec §3: "computed dynamically from current draft data —
    items are not mutated as answers change"). Purely a read-time filter;
    never writes anything. See `condition_data` for how repeat-section
    answers (list-shaped) are handled — they never contribute condition
    data."""
    data = condition_data(draft_data, context)
    steps_by_id = {s.step_id: s for s in definition_steps}
    result = []
    for item in items:
        step = steps_by_id.get(item.get("step_id"))
        if step is None or step.show_if is None:
            result.append(item)
            continue
        if evaluate_condition(step.show_if, data):
            result.append(item)
    return result
