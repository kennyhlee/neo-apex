# apexflow/backend/app/workflows/schema.py
"""Pure pydantic v2 schemas for `workflow_definition.machine`/`.steps`.

No I/O, no DataCore, no FastAPI — these models describe the shape of a
definition's authored content (state machine + steps/sections) and the
declarative condition-expression language used by `show_if` and the
`data_condition` guard primitive. Downstream tasks (publish validation,
engine execution, guard/effect registries) build on these; this module only
carries structure and the two self-enforcing invariants pydantic can check
without any external registry: "exactly one of all/any/not" on
ConditionGroup, and literal enums on kind/actor/mode/type/review fields.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§3 "State machine schema" / "Steps and declared sections" — spec wins over
task-3-brief.md on any conflict; see task-3-report.md for divergences noted
during implementation.

Naming: `from_`/`all_`/`any_`/`not_` trail an underscore because `from`,
`all`, `any`, and `not` are Python keywords or builtins and cannot be used as
bare field names; `populate_by_name=True` + `Field(alias=...)` lets each
model still be constructed with either the Python name or the JSON alias,
and `model_dump(by_alias=True)` emits the wire-format key.
"""
from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Engine-owned instance fields (Global Constraints list, verbatim from
# docs/superpowers/plans/2026-08-05-apexflow-plan1-foundations.md). A section
# that names any of these is rejected with 400 by the (later-task) write
# path — this module only exports the constant those checks are built on.
ENGINE_OWNED_FIELDS: frozenset[str] = frozenset(
    {
        "instance_id",
        "workflow_instance_id",
        "definition_id",
        "definition_version",
        "state",
        "subject_refs",
        "context",
        "channel_started",
        "applicant_email",
        "token_version",
        "draft_data",
        "opened_at",
        "closed_at",
    }
)


# --- Condition expression language -----------------------------------------


class Condition(BaseModel):
    """One leaf test: `{source, op, value?}`.

    `source` is `"{section_id}.{field}"` or `"context.{key}"` — a lookup key
    into the flat `data` dict evaluate_condition (app/workflows/conditions.py)
    is called with; this module does not validate the source string's shape
    since it is only meaningful relative to a definition's declared sections.
    """

    model_config = ConfigDict(populate_by_name=True)

    source: str
    op: Literal["eq", "ne", "in", "empty", "not_empty", "truthy"]
    value: Any = None

    @model_validator(mode="after")
    def _validate_in_value(self) -> "Condition":
        """`op="in"` requires a list `value`.

        Without this guard, evaluate_condition's `value in cond.value` either
        crashes (value=None -> `TypeError: argument of type 'NoneType' is
        not iterable`; value=5 -> not iterable) or silently does Python
        substring-membership when value is a str (`"K" in "K12"` -> True) —
        neither is the intended "member of an authored list" semantics.
        Rejecting non-list values here, at parse time, means evaluate_condition
        never has to defend against a malformed Condition.
        """
        if self.op == "in" and not isinstance(self.value, list):
            raise ValueError(
                "Condition op 'in' requires 'value' to be a list "
                f"(got {type(self.value).__name__}: {self.value!r})"
            )
        return self


# A group's list items may themselves be leaves or nested groups (spec's
# "nesting" example: `all` of `any`). The forward reference to ConditionGroup
# is resolved by the model_rebuild() call at the bottom of this section.
ConditionItem = Union[Condition, "ConditionGroup"]


class ConditionGroup(BaseModel):
    """`{all|any|not: [ConditionItem, ...]}` — exactly one key present.

    Field names carry a trailing underscore (all_/any_/not_) to dodge the
    `all`/`any`/`not` builtin-shadowing that a bare name would cause; the
    alias is the wire-format key from the spec.
    """

    model_config = ConfigDict(populate_by_name=True)

    all_: list[ConditionItem] | None = Field(default=None, alias="all")
    any_: list[ConditionItem] | None = Field(default=None, alias="any")
    not_: list[ConditionItem] | None = Field(default=None, alias="not")

    @model_validator(mode="after")
    def _exactly_one_key(self) -> "ConditionGroup":
        present = [g for g in (self.all_, self.any_, self.not_) if g is not None]
        if len(present) != 1:
            raise ValueError(
                "ConditionGroup requires exactly one of all/any/not to be set "
                f"(got {len(present)})"
            )
        return self


ConditionGroup.model_rebuild()


# --- State machine (`workflow_definition.machine`) --------------------------


class StateDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    state_id: str
    name: str
    kind: Literal["initial", "active", "terminal"]


class GuardRef(BaseModel):
    """`{primitive, params}` — resolved against the guard-primitive registry
    by a later task (Task 7); this module only carries the shape."""

    model_config = ConfigDict(populate_by_name=True)

    primitive: str
    params: dict[str, Any] = Field(default_factory=dict)


class EffectRef(BaseModel):
    """`{primitive, params}` — resolved against the effect-primitive
    registry by a later task; this module only carries the shape."""

    model_config = ConfigDict(populate_by_name=True)

    primitive: str
    params: dict[str, Any] = Field(default_factory=dict)


class TransitionDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    transition_id: str
    from_: str = Field(alias="from")
    to: str
    action: str
    actor: Literal["family", "staff", "system"]
    guards: list[GuardRef] = Field(default_factory=list)
    effects: list[EffectRef] = Field(default_factory=list)


class MachineDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    states: list[StateDef]
    transitions: list[TransitionDef]


# --- Steps and declared sections (`workflow_definition.steps`) --------------


class FieldPick(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    required: bool


class RepeatSpec(BaseModel):
    """`sections[].repeat` — renders the section as an add-another list
    (e.g. emergency contacts), producing one entity per instance at commit."""

    model_config = ConfigDict(populate_by_name=True)

    min: int
    max: int


class SectionDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    section_id: str
    entity_model: str
    fields: list[FieldPick]
    mode: Literal["create", "match_or_create"]
    repeat: RepeatSpec | None = None


class StepDef(BaseModel):
    """One entry in `workflow_definition.steps` (ordered).

    `review` defaults are semantic, not structural: `auto` for form/message,
    `staff` for documents (spec §"Steps and declared sections"). This model
    only carries the authored value — `None` means "use the type's semantic
    default" — applying that default is a later task's concern (per
    task-3-brief.md's Decisions), not this schema's.
    """

    model_config = ConfigDict(populate_by_name=True)

    step_id: str
    type: Literal["form", "documents", "message"]
    title: str
    required: bool
    blocking: bool
    available_in: list[str]
    show_if: ConditionGroup | None = None
    review: Literal["staff", "auto"] | None = None
    config: dict[str, Any] = Field(default_factory=dict)
