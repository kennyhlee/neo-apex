# apexflow/backend/app/workflows/rows.py
"""Runtime row models.

Distinct from `schema.py`, which models AUTHORED definition artifacts
(machine/steps). These model rows as DataCore returns them: flattened, sparse
(every column in the tenant's table appears, not just the ones this entity
type owns), and with every scalar stringified on the wire.

Importing only `shared.py` keeps this module a leaf alongside it — see
`shared.py`'s docstring for the import-cycle constraint that shapes
`app/workflows/*`.
"""
from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    field_validator,
    model_validator,
)

from app.workflows.shared import ItemStatus, as_bool


class WorkflowItem(BaseModel):
    """One `workflow_item` row.

    MUTABLE by design (no `frozen=True`): `primitives._effect_start_due_clocks`
    updates `due_at` and `version` in place so later guards/effects in the
    SAME action observe the change without a re-fetch — EvalContext's
    documented contract.

    `raw` (a private attr, never serialized) holds the flattened row this
    model was parsed from. The write path builds a full-replace PUT body via
    `shared.entity_base_data`, so it must see every column the stored row
    actually carries — narrowing that to the typed field set would silently
    drop the row's other columns on the next write. Reads go through the
    typed fields; only base_data construction touches `raw`.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    entity_id: str
    item_id: str = ""
    instance_id: str = ""
    step_id: str = ""
    kind: str = "form"
    title: str = ""
    status: ItemStatus = ItemStatus.NOT_STARTED
    blocking: bool = False
    payload_ref: str | None = None
    due_at: str | None = None
    completed_by: str | None = None
    # Leading underscores are private attrs in pydantic v2 -> alias.
    version: int | None = Field(default=None, alias="_version")

    _raw: dict = PrivateAttr(default_factory=dict)

    @field_validator("blocking", mode="before")
    @classmethod
    def _coerce_blocking(cls, v: object) -> bool:
        return as_bool(v)

    @field_validator("version", mode="before")
    @classmethod
    def _coerce_version(cls, v: object) -> int | None:
        if v in (None, ""):
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    @model_validator(mode="wrap")
    @classmethod
    def _capture_raw(cls, data: Any, handler: Any) -> "WorkflowItem":
        item = handler(data)
        if isinstance(data, dict):
            item._raw = dict(data)
        return item

    @property
    def raw(self) -> dict:
        """The flattened row this model was parsed from (empty when the model
        was built directly rather than via `from_row`)."""
        return self._raw
