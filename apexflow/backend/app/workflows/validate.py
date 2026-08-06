# apexflow/backend/app/workflows/validate.py
"""Pure publish-time validation for a `workflow_definition`'s `machine` +
`steps` (Task 4). No I/O — `models` is supplied by the caller: a merged
model_definition dict per entity_type, exactly as stored in DataCore /
`base_model.json`: `{"base_fields": [...], "custom_fields": [...]}`, each
field dict shaped `{name, type, required, ...}` (`default`/`options`/etc.
optional per field).

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§3 "State machine schema" / "Steps and declared sections" / "Model
evolution", §4 primitive names — spec wins over task-4-brief.md on any
conflict (see the module-level note on `_committing_transition_set_fields`
for the one place this mattered).

`validate_definition` returns `[]` iff the definition may publish; every
error names the offending step/section/field/state/transition id
(actionable, not a generic message), per the brief. `definition_health`
reuses the same field-existence ("broken") and coverage ("stale") detectors
to classify an *already published* definition against the *current* models
— lazy validation, no stored reference index, per spec "Model evolution".
Both are consumed by later tasks (Task 5's model-impact endpoint, Task 6's
creation-time refusal); neither talks to DataCore itself.
"""
from typing import Any, Literal, NamedTuple

from app.workflows.primitives import EFFECTS, GUARDS
from app.workflows.schema import (
    ENGINE_OWNED_FIELDS,
    ConditionGroup,
    MachineDef,
    SectionDef,
    StepDef,
)

# Task 7 landed the real guard/effect primitive registries in
# app.workflows.primitives — these two constants are now DERIVED from the
# registries' own keys rather than a hand-maintained copy, so the two can
# never drift apart. `app.workflows.primitives` deliberately does not import
# this module (or engine.py/definitions.py, which do) — see primitives.py's
# module docstring for the import-cycle constraint that shapes that choice.
GUARD_PRIMITIVES: frozenset[str] = frozenset(GUARDS)

EFFECT_PRIMITIVES: frozenset[str] = frozenset(EFFECTS)


class _SectionEntry(NamedTuple):
    """One declared section, paired with the step that owns it — conditional
    sections are only meaningful relative to their step's `show_if`, and
    error messages need both the section_id and the step_id."""

    step: StepDef
    section: SectionDef


def _iter_sections(steps: list[StepDef]) -> list[_SectionEntry]:
    """Every declared section across `form` steps' `config["sections"]`."""
    entries: list[_SectionEntry] = []
    for step in steps:
        if step.type != "form":
            continue
        for raw in step.config.get("sections", []) or []:
            entries.append(_SectionEntry(step=step, section=SectionDef.model_validate(raw)))
    return entries


def _model_fields(model: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """name -> field-def dict, merged base_fields + custom_fields. Base and
    custom fields are validated identically (spec §3), so this simply
    overlays both into one lookup."""
    if not model:
        return {}
    fields: dict[str, dict[str, Any]] = {}
    for f in model.get("base_fields", []) or []:
        fields[f["name"]] = f
    for f in model.get("custom_fields", []) or []:
        fields[f["name"]] = f
    return fields


def _is_link_or_id_field(name: str) -> bool:
    """`{model}_id`-shaped fields are engine-supplied: a model's own primary
    id (e.g. `student_id` on `student`) and the link fields the engine
    stamps at commit via link-field injection (e.g. `family_id` on
    `student`/`contact`; `student_id`/`family_id` on
    `registration_application`) share this exact naming convention (spec §3
    "Steps and declared sections"). Both classes are exempt from
    required-field coverage and are never section-writable in practice."""
    return name.endswith("_id")


def _committing_transition_set_fields(
    machine: MachineDef, section_id: str, entity_model: str
) -> set[str]:
    """Field names exempted from `section_id`'s coverage by a
    `set_entity_field` effect on *the committing transition* — the
    transition whose own `commit_sections` effect lists `section_id` (spec
    §3: "...or provided by a set_entity_field effect on the committing
    transition"). task-4-brief.md's Step 1 paraphrases this more loosely as
    "on a transition" (any transition) — the spec is authoritative per this
    task's instructions, so the exemption is scoped to the committing
    transition here, not any transition that happens to set the field.

    # ADJUST(bindings): `set_entity_field.params` is `{ref, field, value}`
    (spec §4). Task 7 (app.workflows.primitives._effect_set_entity_field)
    confirmed this reading: `ref == "instance"` targets the workflow_instance
    row itself; any other `ref` names an entity_model directly and is
    resolved against the instance's `subject_refs[f"{ref}_id"]` (a DataCore
    entity_id — see primitives.py's module docstring, decision 1, for why
    entity_id rather than the business id). This function's existing
    treatment of an absent/None `ref` as "applies regardless of model" is
    unaffected by that — it was never one of the two real forms.
    """
    exempt: set[str] = set()
    for t in machine.transitions:
        commits: set[str] = set()
        set_pairs: list[tuple[Any, str]] = []
        for eff in t.effects:
            if eff.primitive == "commit_sections":
                commits.update(eff.params.get("section_ids", []) or [])
            elif eff.primitive == "set_entity_field":
                field = eff.params.get("field")
                if field:
                    set_pairs.append((eff.params.get("ref"), field))
        if section_id in commits:
            for ref, field in set_pairs:
                if ref is None or ref == entity_model:
                    exempt.add(field)
    return exempt


def _is_exempt_field(
    field_name: str, field_def: dict[str, Any], machine: MachineDef, section_id: str, entity_model: str
) -> bool:
    if _is_link_or_id_field(field_name):
        return True
    if "default" in field_def:
        return True
    return field_name in _committing_transition_set_fields(machine, section_id, entity_model)


def _condition_sources(group: ConditionGroup):
    """Recursively yield every leaf `Condition.source` under a group
    (handles the `all` of `any` nesting the schema allows)."""
    for items in (group.all_, group.any_, group.not_):
        if not items:
            continue
        for item in items:
            if isinstance(item, ConditionGroup):
                yield from _condition_sources(item)
            else:
                yield item.source


def _condition_source_field_errors(
    group: ConditionGroup | None,
    section_map: dict[str, SectionDef],
    models: dict[str, Any],
    context_label: str,
) -> list[str]:
    """Dangling field refs inside a `show_if`/`data_condition` expression:
    a source shaped `"{section_id}.{field}"` where `section_id` is a
    declared section but `field` no longer exists on that section's bound
    model. `"context.{key}"` sources and sources whose prefix isn't a known
    section_id are out of scope here (not a "section field reference")."""
    if group is None:
        return []
    errors: list[str] = []
    for source in _condition_sources(group):
        prefix, sep, field = source.partition(".")
        if not sep or prefix == "context":
            continue
        section = section_map.get(prefix)
        if section is None:
            continue
        fields = _model_fields(models.get(section.entity_model))
        if field not in fields:
            errors.append(
                f"{context_label} references '{source}' — field '{field}' does not exist "
                f"on section '{prefix}' (model '{section.entity_model}')"
            )
    return errors


def _data_condition_groups(machine: MachineDef):
    """Yield (context_label, ConditionGroup) for every `data_condition`
    guard's `params.condition` that parses cleanly."""
    for t in machine.transitions:
        for g in t.guards:
            if g.primitive != "data_condition":
                continue
            raw = g.params.get("condition")
            if not raw:
                continue
            try:
                group = ConditionGroup.model_validate(raw)
            except Exception:
                continue
            yield f"transition '{t.transition_id}' guard", group


def _prepare(steps: list[StepDef]):
    section_entries = _iter_sections(steps)
    section_map = {entry.section.section_id: entry.section for entry in section_entries}
    declared_section_ids = set(section_map.keys())
    return section_entries, section_map, declared_section_ids


# --- Machine structure -------------------------------------------------------


def _state_errors(machine: MachineDef) -> list[str]:
    errors: list[str] = []
    initial = [s.state_id for s in machine.states if s.kind == "initial"]
    terminal = [s.state_id for s in machine.states if s.kind == "terminal"]
    if len(initial) == 0:
        errors.append("machine has no initial state; expected exactly 1")
    elif len(initial) > 1:
        errors.append(
            f"machine has {len(initial)} initial states {sorted(initial)}; expected exactly 1"
        )
    if len(terminal) == 0:
        errors.append("machine has no terminal state; expected at least 1")
    return errors


def _reachability_errors(machine: MachineDef) -> list[str]:
    """BFS over transitions (structural — guard evaluation is irrelevant to
    reachability, per spec: "every state reachable from initial")."""
    state_ids = {s.state_id for s in machine.states}
    initial = [s.state_id for s in machine.states if s.kind == "initial"]
    if not initial:
        return []  # already reported by _state_errors; avoid noisy duplicates
    adjacency: dict[str, list[str]] = {}
    for t in machine.transitions:
        adjacency.setdefault(t.from_, []).append(t.to)
    seen = set(initial)
    queue = list(initial)
    while queue:
        current = queue.pop(0)
        for nxt in adjacency.get(current, []):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    unreached = sorted(state_ids - seen)
    return [f"state '{sid}' is unreachable from the initial state" for sid in unreached]


def _outgoing_transition_errors(machine: MachineDef) -> list[str]:
    has_outgoing = {t.from_ for t in machine.transitions}
    return [
        f"state '{s.state_id}' is non-terminal but has no outgoing transition"
        for s in machine.states
        if s.kind != "terminal" and s.state_id not in has_outgoing
    ]


def _unguarded_branch_errors(machine: MachineDef) -> list[str]:
    """Per (from, action): at most one unguarded transition, and if present
    it must be the last one declared (spec §3 "Branching")."""
    errors: list[str] = []
    groups: dict[tuple[str, str], list] = {}
    for t in machine.transitions:
        groups.setdefault((t.from_, t.action), []).append(t)
    for (from_, action), group in groups.items():
        unguarded_idx = [i for i, t in enumerate(group) if not t.guards]
        if len(unguarded_idx) > 1:
            extra_ids = [group[i].transition_id for i in unguarded_idx]
            errors.append(
                f"transitions {extra_ids} are all unguarded for (from='{from_}', "
                f"action='{action}'); at most one unguarded transition is allowed"
            )
        elif len(unguarded_idx) == 1 and unguarded_idx[0] != len(group) - 1:
            tid = group[unguarded_idx[0]].transition_id
            errors.append(
                f"unguarded transition '{tid}' for (from='{from_}', action='{action}') "
                "must be declared last among its group"
            )
    return errors


def _guard_effect_ref_errors(machine: MachineDef) -> list[str]:
    errors: list[str] = []
    for t in machine.transitions:
        for g in t.guards:
            if g.primitive not in GUARD_PRIMITIVES:
                errors.append(
                    f"transition '{t.transition_id}' guard references unknown primitive '{g.primitive}'"
                )
        for e in t.effects:
            if e.primitive not in EFFECT_PRIMITIVES:
                errors.append(
                    f"transition '{t.transition_id}' effect references unknown primitive '{e.primitive}'"
                )
    return errors


def _commit_sections_ref_errors(machine: MachineDef, declared_section_ids: set[str]) -> list[str]:
    errors: list[str] = []
    for t in machine.transitions:
        for e in t.effects:
            if e.primitive != "commit_sections":
                continue
            for sid in e.params.get("section_ids", []) or []:
                if sid not in declared_section_ids:
                    errors.append(
                        f"transition '{t.transition_id}' commit_sections references undeclared section '{sid}'"
                    )
    return errors


def _state_ref_errors(machine: MachineDef, steps: list[StepDef]) -> list[str]:
    errors: list[str] = []
    state_ids = {s.state_id for s in machine.states}
    for t in machine.transitions:
        if t.from_ not in state_ids:
            errors.append(f"transition '{t.transition_id}' from references undeclared state '{t.from_}'")
        if t.to not in state_ids:
            errors.append(f"transition '{t.transition_id}' to references undeclared state '{t.to}'")
    for step in steps:
        for sid in step.available_in:
            if sid not in state_ids:
                errors.append(f"step '{step.step_id}' available_in references undeclared state '{sid}'")
    return errors


# --- Section content ----------------------------------------------------------


def _engine_owned_field_errors(section_entries: list[_SectionEntry]) -> list[str]:
    return [
        f"section '{entry.section.section_id}' (step '{entry.step.step_id}') names engine-owned "
        f"field '{pick.name}', which cannot be section-writable"
        for entry in section_entries
        for pick in entry.section.fields
        if pick.name in ENGINE_OWNED_FIELDS
    ]


def _section_field_existence_errors(
    section_entries: list[_SectionEntry], models: dict[str, Any]
) -> list[str]:
    """Dangling field refs (and unknown entity_model refs) in section field
    picks — the "broken" trigger, and (per this module's design) also
    rejected at publish time: a section can never validly name a field that
    isn't on its bound model, whether that's from hand-authored JSON or a
    model that changed out from under a draft."""
    errors: list[str] = []
    for entry in section_entries:
        section = entry.section
        model = models.get(section.entity_model)
        if model is None:
            errors.append(
                f"section '{section.section_id}' (step '{entry.step.step_id}') references "
                f"unknown entity model '{section.entity_model}'"
            )
            continue
        fields = _model_fields(model)
        for pick in section.fields:
            if pick.name not in fields:
                errors.append(
                    f"section '{section.section_id}' (step '{entry.step.step_id}') field "
                    f"'{pick.name}' does not exist on model '{section.entity_model}'"
                )
    return errors


def _broken_errors(
    machine: MachineDef,
    steps: list[StepDef],
    section_entries: list[_SectionEntry],
    section_map: dict[str, SectionDef],
    models: dict[str, Any],
) -> list[str]:
    """Every dangling-field-reference signal: section field picks, and
    show_if/data_condition sources naming a section field (spec "Model
    evolution": "broken = dangling field reference")."""
    errors = list(_section_field_existence_errors(section_entries, models))
    for step in steps:
        errors += _condition_source_field_errors(
            step.show_if, section_map, models, f"step '{step.step_id}' show_if"
        )
    for context_label, group in _data_condition_groups(machine):
        errors += _condition_source_field_errors(group, section_map, models, context_label)
    return errors


def _coverage_errors(
    section_entries: list[_SectionEntry], models: dict[str, Any], machine: MachineDef
) -> tuple[list[str], list[str]]:
    """(missing_from_unconditional_errors, conditional_required_field_errors)
    — the two coverage rules (spec §3 "Required-field coverage" / §"Steps
    and declared sections" "Coverage rule"). Both feed `definition_health`'s
    "stale" classification (spec "Model evolution": optional -> required is
    the model-evolution trigger for exactly this coverage hole, regardless
    of which of the two shapes it takes)."""
    missing_errors: list[str] = []
    conditional_errors: list[str] = []

    # entity_model -> field names included AND required=True by some
    # unconditional section (step.show_if is None).
    covered_by_model: dict[str, set[str]] = {}
    for entry in section_entries:
        if entry.step.show_if is not None:
            continue
        covered = covered_by_model.setdefault(entry.section.entity_model, set())
        for pick in entry.section.fields:
            if pick.required:
                covered.add(pick.name)

    entity_models = {entry.section.entity_model for entry in section_entries}
    for entity_model in sorted(entity_models):
        fields = _model_fields(models.get(entity_model))
        required_field_names = sorted(name for name, fdef in fields.items() if fdef.get("required"))
        model_sections = [e for e in section_entries if e.section.entity_model == entity_model]
        for field_name in required_field_names:
            fdef = fields[field_name]
            exempt = _is_link_or_id_field(field_name) or "default" in fdef
            if not exempt:
                exempt = any(
                    field_name
                    in _committing_transition_set_fields(machine, e.section.section_id, entity_model)
                    for e in model_sections
                )
            if exempt:
                continue
            if field_name not in covered_by_model.get(entity_model, set()):
                missing_errors.append(
                    f"model '{entity_model}' required field '{field_name}' is not "
                    "included+required by any unconditional section"
                )

    for entry in section_entries:
        if entry.step.show_if is None:
            continue
        section = entry.section
        fields = _model_fields(models.get(section.entity_model))
        for pick in section.fields:
            fdef = fields.get(pick.name)
            if not fdef or not fdef.get("required"):
                continue
            if _is_exempt_field(pick.name, fdef, machine, section.section_id, section.entity_model):
                continue
            conditional_errors.append(
                f"section '{section.section_id}' (step '{entry.step.step_id}', conditional) "
                f"includes model-required field '{pick.name}' — conditional sections may only "
                "include model-optional fields"
            )

    return missing_errors, conditional_errors


# --- Public API ----------------------------------------------------------------


def validate_definition(
    machine: MachineDef, steps: list[StepDef], models: dict[str, dict[str, Any]]
) -> list[str]:
    """Publish-time validation. Empty list iff the definition may publish."""
    section_entries, section_map, declared_section_ids = _prepare(steps)

    errors: list[str] = []
    errors += _state_errors(machine)
    errors += _reachability_errors(machine)
    errors += _outgoing_transition_errors(machine)
    errors += _unguarded_branch_errors(machine)
    errors += _guard_effect_ref_errors(machine)
    errors += _commit_sections_ref_errors(machine, declared_section_ids)
    errors += _state_ref_errors(machine, steps)
    errors += _engine_owned_field_errors(section_entries)
    errors += _broken_errors(machine, steps, section_entries, section_map, models)

    missing_errors, conditional_errors = _coverage_errors(section_entries, models, machine)
    errors += missing_errors
    errors += conditional_errors

    return errors


def definition_health(
    machine: MachineDef, steps: list[StepDef], models: dict[str, dict[str, Any]]
) -> Literal["current", "stale", "broken"]:
    """Lazy model-coherence classification against *current* `models`, for
    an already-published definition (spec "Model evolution"). Priority:
    any dangling field reference makes it "broken" outright, regardless of
    whether a coverage hole also exists; otherwise a coverage hole makes it
    "stale"; otherwise "current"."""
    section_entries, section_map, _ = _prepare(steps)

    if _broken_errors(machine, steps, section_entries, section_map, models):
        return "broken"

    missing_errors, conditional_errors = _coverage_errors(section_entries, models, machine)
    if missing_errors or conditional_errors:
        return "stale"

    return "current"
