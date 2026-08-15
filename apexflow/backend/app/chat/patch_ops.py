# apexflow/backend/app/chat/patch_ops.py
"""The patch vocabulary: the complete set of edits the assistant may propose
against an open draft.

This is a WIRE CONTRACT, not an internal helper. The dicts `validate_ops`
returns are queued on `ChatDeps.pending_proposals`, emitted verbatim as a
`proposal` SSE frame, typed in the frontend (Task 9) and applied by the patch
card (Task 11) against the editor's in-memory definition, which is then saved
through the ordinary `PUT .../definitions/{entity_id}` every hand-edit uses.
So field names and alias spellings here are load-bearing on three sides.

STRUCTURAL VALIDATION ONLY. `validate_ops` answers "is this a well-formed
op", never "does this op make sense against the open draft". Whether
`stage_id` exists, whether removing it strands a transition, whether the
result has a terminal state — those are `validate_definition`'s questions,
and they are asked where they are already asked: on the save PUT the Apply
click triggers. Re-asking them here would mean a second definition-coherence
implementation drifting against the first, and would also refuse legitimate
multi-op patches whose intermediate states are incoherent (add a move, then
the stage it points at).

Two naming notes:

* STAGE vs STATE. The ops say `stage_id`; `schema.py` says `state_id`. The
  editor is stage-centric (its Machine tab was deleted when the stage editor
  landed) and the admin reading the patch card sees stages, so the model
  speaks the product's word. The translation to `machine.states[].state_id`
  happens in one place, the card's apply function.
* `set_show_if` from the spec has no op of its own. `update_step` with
  `patch: {"show_if": ...}` is the same power with one less thing for the
  model to get wrong — `show_if` is an ordinary StepDef field, and a patch
  dict already reaches it.
"""
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Op(BaseModel):
    """`extra="forbid"` on purpose: an invented key (`stage_name` for `name`)
    would otherwise be silently dropped on the way to a card the admin then
    applies, producing a patch that quietly does less than the summary claims.
    `populate_by_name` lets `AddMove` accept either `from` or `from_`."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# --- stages (machine.states) -------------------------------------------------


class AddStage(_Op):
    op: Literal["add_stage"]
    stage_id: str
    name: str
    kind: Literal["initial", "active", "terminal"] = "active"


class RenameStage(_Op):
    op: Literal["rename_stage"]
    stage_id: str
    name: str


class SetStageKind(_Op):
    op: Literal["set_stage_kind"]
    stage_id: str
    kind: Literal["initial", "active", "terminal"]


class RemoveStage(_Op):
    op: Literal["remove_stage"]
    stage_id: str


# --- moves (machine.transitions) ---------------------------------------------


class AddMove(_Op):
    op: Literal["add_move"]
    transition_id: str
    # `from` is a Python keyword; the alias is the wire key, matching
    # `schema.TransitionDef.from_`'s own alias so the card can hand the op
    # straight into a TransitionDef.
    from_: str = Field(alias="from")
    to: str
    action: str
    actor: Literal["family", "staff", "system"] = "staff"
    guards: list[dict] = []
    effects: list[dict] = []


class UpdateMove(_Op):
    op: Literal["update_move"]
    transition_id: str
    # A free-form subset of TransitionDef's fields (to/action/actor/guards/
    # effects). Typed as a dict rather than a partial model because a partial
    # of a model is not expressible in pydantic without duplicating every
    # field as optional — and the merged result is validated as a full
    # TransitionDef on the save PUT anyway.
    patch: dict[str, Any]


class RemoveMove(_Op):
    op: Literal["remove_move"]
    transition_id: str


# --- steps -------------------------------------------------------------------


class AddStep(_Op):
    op: Literal["add_step"]
    # A full StepDef shape. Left untyped HERE and parsed against `StepDef` in
    # `propose_patch` instead: making this field a StepDef would drag the
    # definition schema into the op vocabulary (and would report the failure
    # as "invalid op" rather than "this step does not parse"), while leaving
    # it unchecked entirely would let a malformed step reach the admin's
    # Apply button.
    step: dict[str, Any]
    position: int | None = None  # None = append


class UpdateStep(_Op):
    op: Literal["update_step"]
    step_id: str
    patch: dict[str, Any]


class RemoveStep(_Op):
    op: Literal["remove_step"]
    step_id: str


# --- sections (step.config.sections) -----------------------------------------


class AddSection(_Op):
    op: Literal["add_section"]
    step_id: str
    section: dict[str, Any]


class UpdateSection(_Op):
    op: Literal["update_section"]
    step_id: str
    section_id: str
    patch: dict[str, Any]


class RemoveSection(_Op):
    op: Literal["remove_section"]
    step_id: str
    section_id: str


# --- definition-level --------------------------------------------------------


class SetChannelAccess(_Op):
    op: Literal["set_channel_access"]
    value: Literal["staff_only", "family"]


PatchOp = Annotated[
    Union[AddStage, RenameStage, SetStageKind, RemoveStage, AddMove, UpdateMove,
          RemoveMove, AddStep, UpdateStep, RemoveStep, AddSection, UpdateSection,
          RemoveSection, SetChannelAccess],
    Field(discriminator="op"),
]
_ops_adapter = TypeAdapter(list[PatchOp])


def validate_ops(ops: list[dict]) -> list[dict]:
    """Parse a model-authored op list; return it dumped by ALIAS.

    Raises `pydantic.ValidationError` on anything malformed — including a
    non-list, since the discriminated-union adapter rejects that too rather
    than raising TypeError while iterating. Callers turn it into text for the
    model (a raise out of a tool ends the SSE stream in `error`).

    By-alias dumps are what make the round trip honest: `from`, never `from_`,
    is the key the card reads and the key `TransitionDef` parses. Defaults are
    materialized here as well (`actor: "staff"`, `kind: "active"`,
    `position: null`) so the card never has to re-derive them.
    """
    return [o.model_dump(by_alias=True) for o in _ops_adapter.validate_python(ops)]
