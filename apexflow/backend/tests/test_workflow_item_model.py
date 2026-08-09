"""`WorkflowItem` — the typed read boundary for `workflow_item` rows.

Covers the three properties the port must not lose: the model parses a
flattened, sparse, all-strings DataCore row; it stays MUTABLE so
`start_due_clocks`' in-place update is visible to later guards in the SAME
action; and `_version` survives the round-trip so CAS preconditions keep
firing (dropping it would silently re-open the lost-update race).
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.workflows import datacore as dc
from app.workflows import engine
from app.workflows.primitives import EFFECTS, EvalContext
from app.workflows.rows import WorkflowItem
from app.workflows.schema import MachineDef, StateDef, StepDef
from app.workflows.shared import ItemStatus

TENANT = "acme"


def _row(**over):
    row = {
        "entity_id": "it-1", "item_id": "ACM-WT1", "instance_id": "inst-1",
        "step_id": "application_form", "kind": "form", "title": "Application",
        "status": "not_started", "blocking": "true", "_version": "3",
        # a wide sparse row: DataCore returns every column in the tenant table
        "tuition_fall_semester_K": "", "chinese_track": "", "accreditation": "",
    }
    row.update(over)
    return row


def test_parses_flattened_row_and_types_status():
    item = WorkflowItem.model_validate(_row())
    assert item.status is ItemStatus.NOT_STARTED
    assert item.blocking is True          # "true" string -> bool
    assert item.version == 3              # "_version" alias, string -> int


def test_unrelated_sparse_columns_are_dropped():
    item = WorkflowItem.model_validate(_row())
    assert not hasattr(item, "tuition_fall_semester_K")
    assert "chinese_track" not in item.model_dump()


def test_is_mutable_for_same_action_effects():
    """primitives.start_due_clocks mutates in place so later guards in the
    SAME action see it without a re-fetch."""
    item = WorkflowItem.model_validate(_row())
    item.due_at = "2026-09-01T00:00:00+00:00"
    item.version = 4
    assert item.due_at == "2026-09-01T00:00:00+00:00"
    assert item.version == 4


def test_version_round_trips_for_cas():
    """row_version feeds expected_version; losing it silently disables CAS."""
    item = WorkflowItem.model_validate(_row(_version="7"))
    assert item.version == 7
    assert item.model_dump(by_alias=True)["_version"] == 7


def test_unknown_status_is_rejected():
    with pytest.raises(Exception):
        WorkflowItem.model_validate(_row(status="verifyed"))


# --- CAS preconditions survive the dict -> model port -----------------------


def _spy_expected_version(monkeypatch, seen: dict):
    real = dc.dc_update

    def spy(tenant_id, entity_type, entity_id, base, token=None, **kw):
        seen.setdefault(entity_type, []).append(kw.get("expected_version"))
        return real(tenant_id, entity_type, entity_id, base, token, **kw)

    monkeypatch.setattr(dc, "dc_update", spy)


def test_item_update_still_sends_expected_version(fake_dc, monkeypatch):
    """`verify_item`'s write must be preconditioned on the item's version."""
    instance = fake_dc.dc_create(TENANT, "workflow_instance", {"instance_id": "i-1"})
    instance_row = fake_dc.get_entity(TENANT, "workflow_instance", instance["entity_id"])
    created = fake_dc.dc_create(TENANT, "workflow_item", {
        "instance_id": instance_row["entity_id"], "step_id": "s1", "kind": "form",
        "title": "Application", "status": ItemStatus.SUBMITTED, "blocking": True,
    })
    # bump to version 3 so a dropped precondition can't coincidentally match
    fake_dc.force_bump_version(TENANT, "workflow_item", created["entity_id"])
    fake_dc.force_bump_version(TENANT, "workflow_item", created["entity_id"])

    seen: dict = {}
    _spy_expected_version(monkeypatch, seen)
    engine.verify_item(TENANT, instance_row, created["entity_id"], "staff-1")

    assert seen["workflow_item"] == [3]


def _documents_step():
    return StepDef(
        step_id="doc_step", type="documents", title="Docs", required=True, blocking=True,
        available_in=["draft"],
        config={"docs": [{"name": "Immunization Record", "description": "",
                          "sensitive": True, "blocking": True,
                          "due_days_after_state": 14}]},
    )


def _ctx(items, now):
    return EvalContext(
        tenant_id=TENANT,
        instance={"entity_id": "inst-1", "subject_refs": "{}", "applicant_email": ""},
        items=items,
        definition={
            "machine": MachineDef(
                states=[StateDef(state_id="draft", name="Draft", kind="initial")],
                transitions=[],
            ),
            "steps": [_documents_step()],
            "definition_id": "wf-1",
            "version": 1,
        },
        draft={}, context={}, models={}, actor="family", now=now, token=None,
    )


def test_start_due_clocks_sends_expected_version_and_mutates_in_place(fake_dc, monkeypatch):
    """The one CAS precondition the dict -> model port actually moves: this
    effect reads `_version` off a ctx.items entry, which is now a model."""
    created = fake_dc.dc_create(TENANT, "workflow_item", {
        "instance_id": "inst-1", "step_id": "doc_step", "kind": "documents",
        "title": "Immunization Record", "status": ItemStatus.NOT_STARTED,
    })
    fake_dc.force_bump_version(TENANT, "workflow_item", created["entity_id"])
    row = fake_dc.get_entity(TENANT, "workflow_item", created["entity_id"])
    item = WorkflowItem.model_validate(row)
    assert item.version == 2

    now = datetime(2026, 8, 5, tzinfo=timezone.utc)
    seen: dict = {}
    _spy_expected_version(monkeypatch, seen)
    ctx = _ctx([item], now)
    EFFECTS["start_due_clocks"](ctx, {"step_ids": ["doc_step"]})

    assert seen["workflow_item"] == [2]
    expected_due = (now + timedelta(days=14)).isoformat()
    # in-place, so a later guard in the SAME action sees it with no re-fetch
    assert ctx.items[0].due_at == expected_due
    assert ctx.items[0].version == 3


def test_start_due_clocks_preserves_unrelated_row_fields(fake_dc):
    """The write is a full-replace PUT built from the row, so narrowing the
    read model must not quietly drop columns the item actually owns."""
    created = fake_dc.dc_create(TENANT, "workflow_item", {
        "instance_id": "inst-1", "step_id": "doc_step", "kind": "documents",
        "title": "Immunization Record", "status": ItemStatus.NOT_STARTED,
        "workflow_item_id": "ACM-WT1",
    })
    row = fake_dc.get_entity(TENANT, "workflow_item", created["entity_id"])
    ctx = _ctx([WorkflowItem.model_validate(row)], datetime(2026, 8, 5, tzinfo=timezone.utc))

    EFFECTS["start_due_clocks"](ctx, {"step_ids": ["doc_step"]})

    after = fake_dc.get_entity(TENANT, "workflow_item", created["entity_id"])
    assert after["workflow_item_id"] == "ACM-WT1"
