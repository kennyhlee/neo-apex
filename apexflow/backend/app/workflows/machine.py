# apexflow/backend/app/workflows/machine.py
"""Machine execution (Task 8): the single action dispatcher, guarded
transition branching, system auto-advance, and the staff-only
`cancel_instance` built-in.

No FastAPI/route concerns live here (that's `app/api/instances.py`) — same
split as `engine.py`/`definitions.py`. This module is the layer ABOVE
`primitives.py` (guards/effects) and `engine.py` (item built-ins): it owns
resolving "what should happen for this instance given this action name" and
turning that into effect execution + a state write + an activity row.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§4 "Engine semantics" (the action endpoint bullet, item-level-actions bullet,
system-transitions bullet) and §3 ("Branching" paragraph, `cancel_instance`
in "Definition lifecycle").

DECISIONS this task makes (surfaced in task-8-report.md for Task 9/10):

1. **`build_eval_context`'s pinned-definition lookup filters status IN
   (published, superseded)**, not "any status" — task-8-brief.md's own
   Read-first block calls this out explicitly ("pinned instances must run
   on superseded versions"). This is INTENTIONALLY a different (stricter)
   filter than `engine.py`'s own `_pinned_definition_row` (used by item ops
   for section/field lookups, where a draft row would also be harmless) —
   this module keeps its own copy rather than relaxing engine.py's, since a
   machine-execution context running against a `draft` row (never
   published) would be a real bug, not just cosmetic.

2. **`run_system_transitions` is called exactly once per `execute_action`
   call, at the very end**, after item built-ins, `cancel_instance`, OR a
   winning transition — not once inside the item-builtin path AND again
   inside the transition path. One call site keeps "called after every item
   mutation and action" (brief) trivially true without a double-evaluation
   on the transition path (where the explicit transition's own effects
   already ran via `_apply_transition`, and a second immediate
   `run_system_transitions` call would just re-confirm no new system
   transition fires — harmless but wasteful). `cancel_instance` lands on
   the synthetic `"cancelled"` state, which no authored `system` transition
   can reference (it's never a declared `state_id`), so calling
   `run_system_transitions` after it is a guaranteed no-op — included
   anyway for uniformity rather than special-cased away.

3. **Effect-failure handling is ONE shared helper (`_apply_transition`)
   used by both the explicit-action path and the system-auto-advance
   loop.** The spec's effect-atomicity language ("if ANY effect raises,
   propagate WITHOUT writing the state change" per task-8-brief.md's Step 4)
   isn't scoped to user-invoked transitions only; there's no principled
   reason a system transition's effect should fail differently. Concretely:
   if `run_system_transitions` (called after a successful item mutation)
   hits a failing system-transition effect, the exception propagates all
   the way out of `execute_action` — the ALREADY-persisted item mutation
   stays committed (it was written and activity-logged before
   `run_system_transitions` ever ran), but the caller sees the exception
   from the auto-advance attempt. This is deliberate: silently swallowing
   an auto-advance failure would hide a broken machine from staff.

4. **Item built-ins are blocked once the instance is terminal or
   `"cancelled"`** (`_is_terminal_state` check in `_run_item_builtin`) —
   spec §4: "available in any non-terminal state." `engine.py`'s own
   `save_draft`/`complete_item`/etc. (Task 6) don't check instance state at
   all (they only know about item statuses) since they have no `machine` in
   scope; this module is where that state check actually becomes
   enforceable, since `build_eval_context` is what resolves the pinned
   machine.

5. **`closed_at` is set whenever ANY transition (explicit or system) lands
   on a `kind: "terminal"` state**, not just via `cancel_instance`. Nothing
   in this task's own Produces block says so explicitly, but
   `definitions.py`'s `count_open_instances` docstring (Task 5) states the
   open-instance query works "since a diligently-maintained engine (Task
   6/8) only ever leaves closed_at empty while an instance is genuinely
   open" — i.e. Task 8 is where that promise gets kept. Without this, every
   instance that reaches a natural terminal state (e.g. `enrolled`,
   `declined`) would count as permanently "open" against `retire`'s
   open-instance gate.

6. **`EvalContext.item_result`** (added to `primitives.py`'s dataclass by
   this task) is a side-channel mirroring `issued_link`: `execute_action`
   keeps returning just the instance row (per its own Produces contract),
   and `api/instances.py`'s route reads `ctx.item_result` off the SAME ctx
   object to build the `{"item": ...}` response key when an item built-in
   (other than `save_draft`) ran. `None` for every non-item-mutating action.

7. **`retire_definition`'s bulk-cancel is wired via a caller-supplied
   `cancel_instance_fn` callback**, not a direct import of this module into
   `definitions.py`. `machine.py` imports `definitions.py` (for
   `_parse_machine_steps`/`_fetch_models`/`_referenced_entity_models`/
   `_as_int`) — a `definitions.py -> machine.py` import back would close a
   cycle. `app/api/definitions.py` (which already imports both) supplies
   the callback (`build_eval_context` + `cancel_instance`), keeping
   `definitions.py` itself free of any machine-execution import.

8. **The "capacity_available negated" mechanism the enrollment template
   needs (spec §7: "submit → waitlisted guarded by capacity-full
   (capacity_available negated ...)") is NOT resolved by this task.** The
   guard/effect schema (Task 3's `GuardRef`) has no negation operator, and
   `primitives.GUARDS` has no `capacity_full` primitive — only
   `capacity_available` (true when there IS room). This task's own
   guarded-alternative-ordering test uses a `data_condition` guard instead
   (deliberately independent of that open question, per this task's brief:
   "use a small 2-transition fixture, not the full enrollment machine").
   Flagged for Task 9, which owns the real enrollment template: either
   reorder the two `submit` transitions (guard `capacity_available` on the
   `submitted` branch, unguarded `waitlisted` last) to get the same
   behavior without negation, or add a negation mechanism.

9. **`run_system_transitions`'s cycle guard stops BEFORE applying a
   transition whose target state was already visited this call** (not
   after). A two-state `A -> B -> A` system loop (both guards always
   passing) therefore executes exactly one hop (`A -> B`) and then halts
   with the instance in `B` — not zero hops, and not an infinite bounce.
   `visited` starts as `{starting_state}`.

10. **403 vs. 409 on the transition path is a real distinction, not both
    folded into "no match".** `_run_transition_action` first collects every
    NON-system transition from the current state whose `action` matches —
    if that set is empty (no such action at all, OR the only matches are
    `actor: system`, which spec says must "treat as no-match"), it's a 409
    with the honest `allowed` list. Only once at least one real candidate
    exists does actor gating apply: if none of THOSE are fireable by
    `ctx.actor`, that's a 403 (the action exists, this actor may not fire
    it) — e.g. family attempting a `actor: staff`-only transition. If
    actor-gated candidates exist but none guard-pass, that's a 409 again
    (actor-permitted but not yet satisfiable reads the same as "no match").
"""
import json
from datetime import datetime, timezone
from typing import Callable

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows import engine
from app.workflows.primitives import EFFECTS, GUARDS, EvalContext
from app.workflows.schema import TransitionDef
from app.workflows.shared import entity_base_data, is_family_actor

# --- item built-ins ----------------------------------------------------

_ITEM_OP_FNS: dict[str, Callable[..., dict]] = {
    "complete_item": engine.complete_item,
    "verify_item": engine.verify_item,
    "reject_item": engine.reject_item,
    "waive_item": engine.waive_item,
}

# Declaration order matters for `_allowed_actions`'s honest listing (brief:
# "['save_draft','complete_item'] for family; all five for staff").
_ITEM_BUILTINS_ALL: list[str] = ["save_draft", "complete_item", "verify_item", "reject_item", "waive_item"]
_ITEM_BUILTINS_FAMILY: list[str] = ["save_draft", "complete_item"]
ITEM_BUILTIN_ACTIONS: frozenset[str] = frozenset(_ITEM_BUILTINS_ALL)

# Definition-row statuses `build_eval_context` will pin an instance to — see
# module docstring, decision 1.
_PINNED_STATUSES = ("published", "superseded")


def _parse_json(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _log_activity(ctx: EvalContext, type_: str, from_value: str, to_value: str) -> dict:
    """Local duplicate of engine._log_activity's / primitives._log_activity's
    write shape — see primitives.py's module docstring for why each module
    in this package keeps its own copy instead of importing across the
    engine/definitions/validate import-cycle boundary."""
    activity_id = dc.next_id(ctx.tenant_id, "workflow_activity", ctx.token)
    return dc.dc_create(ctx.tenant_id, "workflow_activity", {
        "activity_id": activity_id,
        "workflow_activity_id": activity_id,
        "instance_id": ctx.instance.get("entity_id"),
        "type": type_,
        "from_value": from_value or "",
        "to_value": to_value or "",
        "actor": ctx.actor,
        "at": ctx.now.isoformat(),
    }, ctx.token)


# --- build_eval_context --------------------------------------------------


def _pinned_definition_row(tenant_id: str, instance_row: dict, token: str | None) -> dict:
    """The workflow_definition row this instance is pinned to: lineage
    `definition_id` AND `version` match, status published OR superseded
    (see module docstring, decision 1)."""
    lineage_id = instance_row.get("definition_id")
    version = instance_row.get("definition_version")
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_id)
            and str(r.get("version", "")) == str(version)
            and r.get("status") in _PINNED_STATUSES]
    if not rows:
        raise HTTPException(404, "Pinned workflow_definition version not found for this instance")
    return rows[0]


def build_eval_context(tenant_id: str, instance_row: dict, *, actor: str,
                       token: str | None = None, now: datetime | None = None) -> EvalContext:
    """Assemble the `EvalContext` machine execution runs against: the pinned
    machine/steps, this instance's current items, and its parsed
    `draft_data`/`context`. `instance_row` must be the FLATTENED shape
    (`dc.get_entity`/`list_entities`'s return value) — see engine.py's row-
    shape convention note; a fresh copy is taken so effects mutating
    `ctx.instance` in place never touch the caller's own reference.
    """
    now = now or datetime.now(timezone.utc)
    instance_entity_id = instance_row["entity_id"]

    def_row = _pinned_definition_row(tenant_id, instance_row, token)
    machine_def, steps = defs._parse_machine_steps(def_row)

    items = dc.list_entities(
        tenant_id, "workflow_item",
        f"instance_id = {dc.sql_literal(instance_entity_id)}", token,
    )

    models = defs._fetch_models(tenant_id, defs._referenced_entity_models(steps), token)

    definition = {
        "machine": machine_def,
        "steps": steps,
        "definition_id": def_row.get("definition_id"),
        "version": defs._as_int(def_row.get("version")),
    }

    return EvalContext(
        tenant_id=tenant_id,
        instance=dict(instance_row),
        items=items,
        definition=definition,
        draft=_parse_json(instance_row.get("draft_data")),
        context=_parse_json(instance_row.get("context")),
        models=models,
        actor=actor,
        now=now,
        token=token,
    )


# --- shared small helpers -------------------------------------------------


def _refresh_items(ctx: EvalContext) -> None:
    ctx.items = dc.list_entities(
        ctx.tenant_id, "workflow_item",
        f"instance_id = {dc.sql_literal(ctx.instance['entity_id'])}", ctx.token,
    )


def _is_terminal_state(ctx: EvalContext) -> bool:
    """True for the synthetic `"cancelled"` state (never a declared
    `state_id`, spec: "always terminal-legal") or any declared state whose
    `kind == "terminal"`."""
    current = ctx.instance.get("state")
    if current == "cancelled":
        return True
    state_def = next((s for s in ctx.definition["machine"].states if s.state_id == current), None)
    return state_def is not None and state_def.kind == "terminal"


def _guards_pass(ctx: EvalContext, transition: TransitionDef) -> bool:
    return all(GUARDS[g.primitive](ctx, g.params) for g in transition.guards)


def _write_state(ctx: EvalContext, to_state: str) -> None:
    """Persist `ctx.instance`'s state (plus every other in-memory field an
    effect already mutated onto `ctx.instance` this call — full-replace PUT,
    per `entity_base_data`), and `closed_at` if `to_state` is terminal-kind
    (module docstring, decision 5)."""
    state_def = next((s for s in ctx.definition["machine"].states if s.state_id == to_state), None)
    base = entity_base_data(ctx.instance)
    base["state"] = to_state
    if state_def is not None and state_def.kind == "terminal":
        base["closed_at"] = ctx.now.isoformat()
    dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base, ctx.token)
    ctx.instance["state"] = to_state
    if "closed_at" in base:
        ctx.instance["closed_at"] = base["closed_at"]


def _apply_transition(ctx: EvalContext, transition: TransitionDef) -> None:
    """Run one transition's effects (declaration order), then persist state
    + a `state_change` activity. On ANY effect exception: log a `note`
    activity (`from_value` = the state BEFORE this transition, `to_value` =
    `"action_failed:{transition.action}"`) and re-raise WITHOUT writing the
    state change — shared by the explicit-action path and the system
    auto-advance loop (module docstring, decision 3)."""
    from_state = ctx.instance.get("state")
    try:
        for eff in transition.effects:
            EFFECTS[eff.primitive](ctx, eff.params)
    except Exception:
        _log_activity(ctx, "note", from_state, f"action_failed:{transition.action}")
        raise
    _write_state(ctx, transition.to)
    _log_activity(ctx, "state_change", from_state, transition.to)


# --- allowed-actions listing (409 body) -----------------------------------


def _allowed_actions(ctx: EvalContext) -> list[str]:
    """Currently-satisfiable NON-system actions for `ctx.actor` from the
    current state: guard-passing transition action names (declaration
    order, deduped), plus the actor-appropriate item built-in names — empty
    when the instance is terminal/cancelled (built-ins aren't satisfiable
    there either, per `_is_terminal_state`'s use in `_run_item_builtin`)."""
    if _is_terminal_state(ctx):
        return []

    current_state = ctx.instance.get("state")
    family = is_family_actor(ctx.actor)
    allowed: list[str] = []
    for t in ctx.definition["machine"].transitions:
        if t.from_ != current_state or t.actor == "system":
            continue
        if family:
            if t.actor != "family":
                continue
        elif t.actor not in ("staff", "family"):
            continue
        if t.action in allowed:
            continue
        if _guards_pass(ctx, t):
            allowed.append(t.action)

    allowed += _ITEM_BUILTINS_FAMILY if family else _ITEM_BUILTINS_ALL
    return allowed


# --- item built-in dispatch ------------------------------------------------


def _run_item_builtin(ctx: EvalContext, action_name: str, params: dict) -> None:
    """`save_draft`/`complete_item`/`verify_item`/`reject_item`/`waive_item`
    dispatch to their `engine.py` functions. Family actors may only
    `save_draft`/`complete_item` — checked HERE, before engine.py's own
    per-function staff-only guard would ever run (spec/brief: "family
    actors may only save_draft/complete_item (others 403 even before
    engine's own check)"). Blocked outright once the instance is terminal
    (module docstring, decision 4)."""
    if is_family_actor(ctx.actor) and action_name not in _ITEM_BUILTINS_FAMILY:
        raise HTTPException(403, "family actor may not perform this action")
    if _is_terminal_state(ctx):
        raise HTTPException(409, {
            "error": "cannot operate on items of a terminal instance",
            "state": ctx.instance.get("state"),
        })

    if action_name == "save_draft":
        section_answers = params.get("section_answers") or {}
        engine.save_draft(ctx.tenant_id, ctx.instance, section_answers, ctx.actor,
                          token=ctx.token, now=ctx.now)
        ctx.instance = dc.get_entity(ctx.tenant_id, "workflow_instance",
                                     ctx.instance["entity_id"], ctx.token)
        ctx.draft = _parse_json(ctx.instance.get("draft_data"))
        ctx.item_result = None
    else:
        item_entity_id = params.get("item_id")
        if not item_entity_id:
            raise HTTPException(400, {"error": "item_id is required"})
        fn = _ITEM_OP_FNS[action_name]
        ctx.item_result = fn(ctx.tenant_id, ctx.instance, item_entity_id, ctx.actor,
                             token=ctx.token, now=ctx.now)

    _refresh_items(ctx)


# --- transition dispatch ---------------------------------------------------


def _run_transition_action(ctx: EvalContext, action_name: str, params: dict) -> None:
    """Resolve `action_name` against `ctx.definition["machine"].transitions`
    from the current state, declaration order, first guards-all-pass wins.

    Two distinct failure modes (brief: actor gating -> 403; no match -> 409):

    - **409** `{"allowed": [...]}` when NO non-system transition from the
      current state names this action at all — this is what "unknown
      action" and "the only candidates are `actor: system`" both look like
      (spec: `actor: system` transitions are "NEVER fireable by explicit
      action call ... if the only candidates are system ones, treat as
      no-match" — achieved here by excluding `actor == "system"` from
      `action_candidates` up front, so a system-only match never reaches the
      actor-gating step below at all).
    - **403** when at least one non-system transition names this action
      from this state, but NONE of them are fireable by `ctx.actor` (family
      firing a staff-only transition). Staff may fire `actor: staff` OR
      `actor: family` transitions ("staff can act on behalf"); family may
      fire only `actor: family` ones.
    - Falls back to **409** `{"allowed": [...]}` once more if actor-gated
      candidates exist but none of their guards all pass — an
      actor-permitted-but-not-yet-satisfiable action reads the same as "no
      match" to the caller, per spec.
    """
    current_state = ctx.instance.get("state")
    action_candidates = [
        t for t in ctx.definition["machine"].transitions
        if t.from_ == current_state and t.action == action_name and t.actor != "system"
    ]
    if not action_candidates:
        raise HTTPException(409, {"allowed": _allowed_actions(ctx)})

    if is_family_actor(ctx.actor):
        gated = [t for t in action_candidates if t.actor == "family"]
    else:
        gated = action_candidates  # staff: system already excluded above; staff+family both fireable

    if not gated:
        raise HTTPException(403, "actor not permitted to fire this transition")

    winner = next((t for t in gated if _guards_pass(ctx, t)), None)
    if winner is None:
        raise HTTPException(409, {"allowed": _allowed_actions(ctx)})
    _apply_transition(ctx, winner)


# --- system auto-advance ---------------------------------------------------


def run_system_transitions(ctx: EvalContext) -> dict:
    """From the current state, repeatedly take the first `actor: system`
    transition (declaration order) whose guards all pass, applying its
    effects + state write + activity, until no further system transition
    fires OR the next hop's target state was already visited this call
    (cycle guard — module docstring, decision 9). Called after every item
    built-in, `cancel_instance`, and explicit transition via
    `execute_action`'s single call site; also exposed here for any
    item-mutation call site outside `execute_action` (per brief)."""
    visited = {ctx.instance.get("state")}
    while True:
        current_state = ctx.instance.get("state")
        candidates = [t for t in ctx.definition["machine"].transitions
                     if t.from_ == current_state and t.actor == "system"]
        winner = next((t for t in candidates if _guards_pass(ctx, t)), None)
        if winner is None or winner.to in visited:
            break
        _apply_transition(ctx, winner)
        visited.add(winner.to)
    return ctx.instance


# --- cancel_instance --------------------------------------------------------


def cancel_instance(ctx: EvalContext) -> dict:
    """Staff-only (403 for family) built-in: bypasses the machine entirely
    to the synthetic `"cancelled"` state from any non-terminal state (409 if
    already terminal/cancelled). Sets `closed_at`, increments
    `token_version` (revokes any outstanding magic link), logs a
    `state_change` activity."""
    if is_family_actor(ctx.actor):
        raise HTTPException(403, "family actor may not cancel an instance")
    if _is_terminal_state(ctx):
        raise HTTPException(409, {
            "error": "instance is already terminal",
            "state": ctx.instance.get("state"),
        })

    from_state = ctx.instance.get("state")
    try:
        token_version = int(ctx.instance.get("token_version") or 1)
    except (TypeError, ValueError):
        token_version = 1

    base = entity_base_data(ctx.instance)
    base["state"] = "cancelled"
    base["closed_at"] = ctx.now.isoformat()
    base["token_version"] = token_version + 1
    dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base, ctx.token)
    ctx.instance["state"] = "cancelled"
    ctx.instance["closed_at"] = base["closed_at"]
    ctx.instance["token_version"] = base["token_version"]

    _log_activity(ctx, "state_change", from_state, "cancelled")
    return ctx.instance


# --- the single action dispatcher ------------------------------------------


def execute_action(ctx: EvalContext, action_name: str, params: dict) -> dict:
    """Resolve `action_name`: item built-ins first (`save_draft`,
    `complete_item`, `verify_item`, `reject_item`, `waive_item`), then
    `cancel_instance`, else a machine transition. Runs
    `run_system_transitions` exactly once at the end on any successful
    dispatch (module docstring, decision 2). Returns the (possibly
    multiply-advanced) instance row; callers wanting an item built-in's
    updated item read `ctx.item_result` off the same `ctx` afterward
    (decision 6). Resets `ctx.item_result` to `None` up front so a `ctx`
    reused across more than one `execute_action` call (unusual, but not
    prevented by the type) never leaks a PRIOR call's item result into a
    later transition/cancel response."""
    ctx.item_result = None
    if action_name in ITEM_BUILTIN_ACTIONS:
        _run_item_builtin(ctx, action_name, params)
    elif action_name == "cancel_instance":
        cancel_instance(ctx)
    else:
        _run_transition_action(ctx, action_name, params)

    run_system_transitions(ctx)
    return ctx.instance
