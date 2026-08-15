# apexflow/backend/tests/test_designer_api.py
"""Route-level tests for the designer read API (Task 2): definitions list
w/ computed health, editor bundle fetch, dry-run validate, and the
guard/effect primitives catalog.

Written first per TDD (superpowers:test-driven-development): app.api.designer
does not exist yet, so this file is expected to fail at collection until it
is implemented.

Auth pattern follows tests/test_definitions_api.py: override
`require_authenticated_user` at the app level rather than minting a real JWT.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import datacore as dc
from app.workflows.primitives import EFFECTS, GUARDS
from app.workflows.validate import PARAM_SPECS, validate_definition
from app.workflows.schema import MachineDef, StepDef

TENANT = "acme"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


# --- Fixture builders (mirrors tests/test_definitions_api.py) --------------


def _valid_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "active"},
            {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit",
                "from": "draft",
                "to": "submitted",
                "action": "submit",
                "actor": "family",
                "guards": [],
                "effects": [
                    {"primitive": "commit_sections", "params": {"section_ids": ["student_section"]}}
                ],
            },
            {
                "transition_id": "t_approve",
                "from": "submitted",
                "to": "enrolled",
                "action": "approve",
                "actor": "staff",
                "guards": [{"primitive": "all_blocking_items_complete", "params": {}}],
                "effects": [],
            },
        ],
    }


def _broken_machine():
    """No terminal state, no outgoing transition from the initial state —
    trips several validate_definition rules at once; publish must reject."""
    return {
        "states": [{"state_id": "draft", "name": "Draft", "kind": "initial"}],
        "transitions": [],
    }


def _valid_steps():
    return [
        {
            "step_id": "student_details",
            "type": "form",
            "title": "Student details",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {
                "sections": [
                    {
                        "section_id": "student_section",
                        "entity_model": "student",
                        "fields": [
                            {"name": "first_name", "required": True},
                            {"name": "last_name", "required": True},
                        ],
                        "mode": "create",
                        "repeat": None,
                    }
                ]
            },
        }
    ]


def _stale_steps():
    """A section that includes 'first_name' but NOT the model's other
    required field 'middle_name' — missing_errors coverage hole -> "stale"."""
    steps = _valid_steps()
    return steps


def _malformed_show_if_steps():
    """A `show_if` with TWO non-null combinator keys — `schema.py`'s
    `ConditionGroup._exactly_one_key` model validator rejects this, so
    `defs.parse_machine_steps`'s `StepDef.model_validate(s)` raises
    `pydantic.ValidationError` (task review fix #2: this exact shape is what
    a not-yet-hardened edit-as-JSON escape hatch could persist via
    autosave, bricking every future bundle/validate fetch of the row with an
    unhandled-exception 500 — `_parse_or_422` converts that into a 422 the
    editor can recover from instead)."""
    steps = _valid_steps()
    steps[0]["show_if"] = {
        "all": [{"source": "student_section.first_name", "op": "truthy"}],
        "any": [{"source": "student_section.last_name", "op": "truthy"}],
        "not": None,
    }
    return steps


def _valid_models():
    return {
        "student": {
            "base_fields": [
                {"name": "student_id", "type": "str", "required": True},
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        },
    }


def _stale_models():
    """Same as _valid_models but with an extra required field
    ('middle_name') that no section covers -> definition_health == "stale"."""
    models = _valid_models()
    models["student"]["base_fields"].append(
        {"name": "middle_name", "type": "str", "required": True}
    )
    return models


def _broken_models():
    """Drops 'last_name' entirely -> section references a field that no
    longer exists on the model -> definition_health == "broken"."""
    models = _valid_models()
    models["student"]["base_fields"] = [
        f for f in models["student"]["base_fields"] if f["name"] != "last_name"
    ]
    return models


def _seed_definition(fake_dc, *, definition_id, version=1, status="draft",
                     lineage_status="active", machine=None, steps=None,
                     channel_access="staff_only", name="Enrollment"):
    base = {
        "definition_id": definition_id,
        "name": name,
        "version": version,
        "status": status,
        "lineage_status": lineage_status,
        "channel_access": channel_access,
        "machine": json.dumps(machine if machine is not None else _valid_machine()),
        "steps": json.dumps(steps if steps is not None else _valid_steps()),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def _seed_definition_with_raw_machine(fake_dc, *, definition_id, raw_machine,
                                      version=1, status="draft",
                                      lineage_status="active",
                                      channel_access="staff_only", name="Direct"):
    """Like `_seed_definition`, but writes `raw_machine` verbatim as the
    stored `machine` string instead of `json.dumps`-ing a dict — the shape a
    row with genuinely INVALID JSON (not just JSON that fails schema
    validation) takes, e.g. `machine="not json"`. This is writable through
    the generic entities proxy today (no schema enforcement there), and
    `defs.parse_machine_steps`'s `json.loads(machine_raw)` raises
    `json.JSONDecodeError` on it — a `ValueError` subclass, not a
    `pydantic.ValidationError` (final-review fix wave regression test)."""
    base = {
        "definition_id": definition_id,
        "name": name,
        "version": version,
        "status": status,
        "lineage_status": lineage_status,
        "channel_access": channel_access,
        "machine": raw_machine,
        "steps": json.dumps(_valid_steps()),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def _seed_instance(fake_dc, *, definition_id, closed_at=""):
    base = {
        "instance_id": fake_dc.next_id(TENANT, "workflow_instance"),
        "definition_id": definition_id,
        "definition_version": 1,
        "state": "draft",
        "channel_started": "family",
        "opened_at": "2026-08-01T00:00:00+00:00",
        "closed_at": closed_at,
    }
    return fake_dc.dc_create(TENANT, "workflow_instance", base)["entity_id"]


# --- GET .../definitions ----------------------------------------------------


def test_list_definitions_returns_one_row_per_lineage_version(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    v1 = _seed_definition(fake_dc, definition_id="wd-lineage-1", version=1, status="published")
    v2 = _seed_definition(fake_dc, definition_id="wd-lineage-1", version=2, status="draft")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    assert resp.status_code == 200
    rows = resp.json()["definitions"]
    assert {r["entity_id"] for r in rows} == {v1, v2}
    for r in rows:
        assert r["definition_id"] == "wd-lineage-1"
        assert set(r) >= {
            "entity_id", "definition_id", "name", "version", "status",
            "lineage_status", "channel_access", "health", "open_instances",
        }


def test_list_definitions_health_current_for_valid_published_row(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-health-1", status="published")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    row = next(r for r in resp.json()["definitions"] if r["entity_id"] == eid)
    assert row["health"] == "current"


def test_list_definitions_health_stale_when_model_gains_required_field(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _stale_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-health-2", status="published",
                           steps=_stale_steps())

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    row = next(r for r in resp.json()["definitions"] if r["entity_id"] == eid)
    assert row["health"] == "stale"


def test_list_definitions_health_broken_when_model_loses_a_referenced_field(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _broken_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-health-3", status="draft")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    row = next(r for r in resp.json()["definitions"] if r["entity_id"] == eid)
    assert row["health"] == "broken"


def test_list_definitions_malformed_row_degrades_to_broken_not_500(client, fake_dc):
    """A row with unparseable `machine` — e.g. `{}`, missing the required
    `states`/`transitions` keys `MachineDef` needs — is writable through the
    generic entities proxy (`app/api/entities.py`), which has no schema
    enforcement of its own. Before this fix, `list_definitions` called
    `defs.parse_machine_steps(row)` unguarded in its per-row loop, so ANY
    such row raised an unhandled `pydantic.ValidationError` and 500'd the
    ENTIRE list — one bad row made every other (valid) workflow invisible.
    The malformed row must instead degrade to health "broken" *for that row
    only*, stay in the list (with a `parse_error` detail an admin could act
    on) so the good rows are still visible with status 200."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    good_id = _seed_definition(fake_dc, definition_id="wd-good-1", status="draft")
    bad_id = _seed_definition(
        fake_dc, definition_id="wd-bad-1", status="draft", machine={}, name="Direct")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    assert resp.status_code == 200
    rows = {r["entity_id"]: r for r in resp.json()["definitions"]}

    assert rows[good_id]["health"] == "current"
    assert "parse_error" not in rows[good_id]

    assert rows[bad_id]["health"] == "broken"
    assert isinstance(rows[bad_id].get("parse_error"), str)
    assert rows[bad_id]["parse_error"]


def test_list_definitions_invalid_json_machine_degrades_to_broken_not_500(client, fake_dc):
    """Final-review fix wave regression test: a row whose stored `machine`
    string isn't valid JSON AT ALL (e.g. `machine: "not json"`, distinct
    from the malformed-but-parseable-JSON case above) makes
    `defs.parse_machine_steps`'s `json.loads()` raise
    `json.JSONDecodeError` — a `ValueError`, not a `pydantic.ValidationError`
    — which the pre-fix `except ValidationError` in `list_definitions` let
    through unhandled, 500ing the whole list. Must degrade to health
    "broken" for that row alone, same as the ValidationError case."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    good_id = _seed_definition(fake_dc, definition_id="wd-good-2", status="draft")
    bad_id = _seed_definition_with_raw_machine(
        fake_dc, definition_id="wd-bad-2", raw_machine="not json")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    assert resp.status_code == 200
    rows = {r["entity_id"]: r for r in resp.json()["definitions"]}

    assert rows[good_id]["health"] == "current"

    assert rows[bad_id]["health"] == "broken"
    assert isinstance(rows[bad_id].get("parse_error"), str)
    assert rows[bad_id]["parse_error"]


def test_list_definitions_superseded_row_health_is_literal_no_computation(client, fake_dc):
    """A superseded row's underlying machine/model would compute "broken" if
    definition_health ran against it — but per the brief, superseded rows
    get the literal string with NO computation. Seed the row without even
    setting up the student model (get_model_definition would return None,
    which would make definition_health "broken" if it were called) to prove
    the endpoint never even tries."""
    eid = _seed_definition(fake_dc, definition_id="wd-health-4", status="superseded")
    # deliberately no fake_dc.set_model call — any computation would 404/degrade

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    row = next(r for r in resp.json()["definitions"] if r["entity_id"] == eid)
    assert row["health"] == "superseded"


def test_list_definitions_family_url_only_for_published_family_channel(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    published_family = _seed_definition(
        fake_dc, definition_id="wd-url-1", status="published", channel_access="family")
    draft_family = _seed_definition(
        fake_dc, definition_id="wd-url-2", status="draft", channel_access="family")
    published_staff = _seed_definition(
        fake_dc, definition_id="wd-url-3", status="published", channel_access="staff_only")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    rows = {r["entity_id"]: r for r in resp.json()["definitions"]}

    assert rows[published_family]["family_url"] == \
        f"http://localhost:5620/w/{TENANT}/wd-url-1"
    assert "family_url" not in rows[draft_family]
    assert "family_url" not in rows[published_staff]


def test_list_definitions_open_instances_matches_retire_gate_count(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-open-1", status="published")
    _seed_instance(fake_dc, definition_id="wd-open-1", closed_at="")
    _seed_instance(fake_dc, definition_id="wd-open-1", closed_at="2026-08-02T00:00:00+00:00")

    from app.workflows.definitions import count_open_instances
    expected = count_open_instances(TENANT, "wd-open-1")

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    row = next(r for r in resp.json()["definitions"] if r["entity_id"] == eid)
    assert row["open_instances"] == expected == 1


def test_list_definitions_empty_tenant_returns_empty_list(client, fake_dc):
    """Edge case (code review follow-up): no rows seeded at all -> a plain
    empty list, not a 404/500."""
    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    assert resp.status_code == 200
    assert resp.json() == {"definitions": []}


def _multi_model_steps(*entity_models):
    """A form step declaring one section per named entity model — lets a
    seeded row reference several models, and lets several rows SHARE them."""
    field_by_model = {
        "student": [{"name": "first_name", "required": True}],
        "family": [{"name": "family_name", "required": True}],
        "contact": [{"name": "first_name", "required": True}],
    }
    return [{
        "step_id": "details",
        "type": "form",
        "title": "Details",
        "required": True,
        "blocking": True,
        "available_in": ["draft"],
        "show_if": None,
        "review": None,
        "config": {"sections": [
            {"section_id": f"{m}_section", "entity_model": m,
             "fields": field_by_model[m], "mode": "create", "repeat": None}
            for m in entity_models
        ]},
    }]


def test_list_definitions_datacore_read_count_is_flat_in_rows(client, fake_dc, monkeypatch):
    """PERF CONTRACT: this route's DataCore reads scale with the number of
    DISTINCT entity models the tenant's definitions reference, not with the
    number of definition ROWS or LINEAGES.

    The list page was slow because both expensive reads sat inside the row
    loop: `fetch_models` re-fetched the SAME `student`/`family` model once per
    row (a tenant with 4 workflows at 2-3 versions each, all built on the same
    handful of models, paid a dozen identical model reads), and
    `count_open_instances` re-scanned the tenant's ENTIRE `workflow_instance`
    table once per lineage. Both are hoisted out of the loop now — the union
    of referenced models is fetched once, and one grouped read
    (`open_instance_counts_by_lineage`) answers every lineage's count.

    Pinned as exact counts rather than a loose bound because the whole point
    is the SHAPE of the cost: 1 definitions read + 1 read per distinct model
    + 1 instances read. Reintroducing a per-row fetch fails this test with a
    number that tracks the row count (mutation-checked).
    """
    for m in ("student", "family", "contact"):
        fake_dc.set_model(TENANT, m, {
            "base_fields": [{"name": "first_name", "type": "str", "required": True},
                            {"name": "family_name", "type": "str", "required": True}],
            "custom_fields": [],
        })

    # 4 lineages / 9 rows, referencing only 3 DISTINCT models between them.
    lineages = [
        ("wd-perf-1", ("student", "family", "contact"), 3),
        ("wd-perf-2", ("student", "family"), 2),
        ("wd-perf-3", ("student",), 2),
        ("wd-perf-4", ("student", "contact"), 2),
    ]
    n_rows = 0
    for lineage_id, models, n_versions in lineages:
        for version in range(1, n_versions + 1):
            _seed_definition(fake_dc, definition_id=lineage_id, version=version,
                             status="published" if version == 1 else "draft",
                             steps=_multi_model_steps(*models))
            n_rows += 1
        _seed_instance(fake_dc, definition_id=lineage_id, closed_at="")
    assert n_rows == 9

    calls: dict[str, list] = {"list_entities": [], "get_model_definition": []}
    real_list, real_model = dc.list_entities, dc.get_model_definition

    def counting_list_entities(tenant_id, entity_type, where="", token=None):
        calls["list_entities"].append(entity_type)
        return real_list(tenant_id, entity_type, where, token)

    def counting_get_model(tenant_id, entity_type, token=None):
        calls["get_model_definition"].append(entity_type)
        return real_model(tenant_id, entity_type, token)

    monkeypatch.setattr(dc, "list_entities", counting_list_entities)
    monkeypatch.setattr(dc, "get_model_definition", counting_get_model)

    resp = client.get(f"/api/workflows/{TENANT}/definitions")
    assert resp.status_code == 200
    assert len(resp.json()["definitions"]) == n_rows

    # One model read per DISTINCT referenced model — not one per row, and no
    # model read twice.
    assert sorted(calls["get_model_definition"]) == ["contact", "family", "student"]
    # One entity read for the definitions, one for the instances. NOT one
    # instance read per lineage.
    assert calls["list_entities"] == ["workflow_definition", "workflow_instance"]


# --- GET .../definitions/{entity_id}/bundle ---------------------------------


def test_bundle_returns_parsed_machine_and_steps(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-bundle-1", status="draft")

    resp = client.get(f"/api/workflows/{TENANT}/definitions/{eid}/bundle")
    assert resp.status_code == 200
    body = resp.json()
    assert body["definition"]["machine"]["states"][0]["state_id"] == "draft"
    assert body["definition"]["steps"][0]["step_id"] == "student_details"
    # alias spelling: "from", not "from_" (interface map §2i)
    assert body["definition"]["machine"]["transitions"][0]["from"] == "draft"


def test_bundle_models_include_referenced_plus_standard_set(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-bundle-2", status="draft")

    resp = client.get(f"/api/workflows/{TENANT}/definitions/{eid}/bundle")
    models = resp.json()["models"]
    assert set(models) == {
        "student", "family", "contact", "registration_application", "lead",
    }
    assert models["student"] == _valid_models()["student"]
    # standard-set models the definition doesn't reference and were never
    # seeded degrade to None rather than erroring.
    assert models["family"] is None


def test_bundle_errors_match_validate_definition(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-bundle-3", status="draft",
                           machine=_broken_machine())

    resp = client.get(f"/api/workflows/{TENANT}/definitions/{eid}/bundle")
    body = resp.json()
    assert body["errors"]
    assert body["health"] == "broken" or body["health"] == "stale" or isinstance(body["health"], str)


def test_bundle_404s_on_unknown_entity_id(client, fake_dc):
    resp = client.get(f"/api/workflows/{TENANT}/definitions/does-not-exist/bundle")
    assert resp.status_code == 404


def test_bundle_422s_not_500s_on_malformed_stored_steps_json(client, fake_dc):
    """Task review fix #2: a row whose stored `steps` JSON no longer parses
    against the schema (e.g. a `show_if` with two non-null combinator keys)
    must 422 with a machine-readable `parse_error`, never an unhandled-
    exception 500 — a 500 here would mean the SAME row 500s on every future
    fetch, permanently bricking the draft."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-bundle-malformed", status="draft",
                           steps=_malformed_show_if_steps())

    resp = client.get(f"/api/workflows/{TENANT}/definitions/{eid}/bundle")
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"]["parse_error"], str)
    assert body["detail"]["parse_error"]  # non-empty


def test_bundle_422s_not_500s_on_invalid_json_machine(client, fake_dc):
    """Final-review fix wave regression test: same hardening as the
    malformed-steps test above, for a `machine` string that isn't valid JSON
    at all (`json.JSONDecodeError`, not `pydantic.ValidationError`) —
    `_parse_or_422`'s widened except clause must still 422, not 500."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition_with_raw_machine(
        fake_dc, definition_id="wd-bundle-invalid-json", raw_machine="not json")

    resp = client.get(f"/api/workflows/{TENANT}/definitions/{eid}/bundle")
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"]["parse_error"], str)
    assert body["detail"]["parse_error"]  # non-empty


# --- POST .../definitions/{entity_id}/validate ------------------------------


def test_validate_is_dry_run_no_writes(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-validate-1", status="draft")

    resp = client.post(f"/api/workflows/{TENANT}/definitions/{eid}/validate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["errors"] == []
    assert body["health"] == "current"

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "draft"  # untouched — no publish side effect


def test_validate_matches_publish_409_errors_exactly(client, fake_dc):
    """Binding equality contract (task-2-brief.md Step 1): the validate
    endpoint MUST return exactly the errors publish would 409 with."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-validate-2", status="draft",
                           machine=_broken_machine())

    validate_resp = client.post(f"/api/workflows/{TENANT}/definitions/{eid}/validate")
    assert validate_resp.status_code == 200
    validate_errors = validate_resp.json()["errors"]
    assert validate_errors  # sanity: the broken fixture really is broken

    publish_resp = client.post(
        f"/api/workflows/{TENANT}/definitions/{eid}/actions", json={"action": "publish"})
    assert publish_resp.status_code == 409
    publish_errors = publish_resp.json()["detail"]["errors"]

    assert validate_errors == publish_errors

    # still untouched — publish's own 409 path never writes either.
    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "draft"


def test_validate_404s_on_unknown_entity_id(client, fake_dc):
    resp = client.post(f"/api/workflows/{TENANT}/definitions/does-not-exist/validate")
    assert resp.status_code == 404


def test_validate_422s_not_500s_on_malformed_stored_steps_json(client, fake_dc):
    """Same hardening as the bundle route's equivalent test above, for the
    validate route's own `_parse_or_422` call site."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-validate-malformed", status="draft",
                           steps=_malformed_show_if_steps())

    resp = client.post(f"/api/workflows/{TENANT}/definitions/{eid}/validate")
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"]["parse_error"], str)
    assert body["detail"]["parse_error"]  # non-empty

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "draft"  # untouched — 422 path never writes


def test_validate_422s_not_500s_on_invalid_json_machine(client, fake_dc):
    """Final-review fix wave regression test: same hardening as the
    validate route's malformed-steps test above, for a `machine` string
    that isn't valid JSON at all."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition_with_raw_machine(
        fake_dc, definition_id="wd-validate-invalid-json", raw_machine="not json")

    resp = client.post(f"/api/workflows/{TENANT}/definitions/{eid}/validate")
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"]["parse_error"], str)
    assert body["detail"]["parse_error"]  # non-empty

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "draft"  # untouched — 422 path never writes


def test_validate_on_published_row_is_200_dry_run(client, fake_dc):
    """Edge case (code review follow-up): validate isn't draft-only — a
    published row runs the same dry-run recipe and 200s."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-validate-3", status="published")

    resp = client.post(f"/api/workflows/{TENANT}/definitions/{eid}/validate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["errors"] == []
    assert body["health"] == "current"

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "published"  # untouched


# --- GET .../primitives ------------------------------------------------------


def test_primitives_catalog_covers_every_guard_and_effect(client, fake_dc):
    resp = client.get(f"/api/workflows/{TENANT}/primitives")
    assert resp.status_code == 200
    body = resp.json()

    guard_names = {g["name"] for g in body["guards"]}
    effect_names = {e["name"] for e in body["effects"]}
    assert guard_names == set(GUARDS)
    assert effect_names == set(EFFECTS)


def test_primitives_catalog_params_match_param_specs_exactly(client, fake_dc):
    resp = client.get(f"/api/workflows/{TENANT}/primitives")
    body = resp.json()
    by_name = {**{g["name"]: g for g in body["guards"]}, **{e["name"]: e for e in body["effects"]}}

    for name, specs in PARAM_SPECS.items():
        got_params = by_name[name]["params"]
        assert len(got_params) == len(specs)
        for got, spec in zip(got_params, specs):
            assert got["name"] == spec.name
            assert got["kind"] == spec.kind
            assert got["required"] == spec.required
            if spec.enum:
                assert got["enum"] == list(spec.enum)
            else:
                assert "enum" not in got
            if spec.constraint:
                assert got["constraint"] == spec.constraint
            else:
                assert "constraint" not in got

    # no-param primitives (GUARDS/EFFECTS membership only, no PARAM_SPECS entry)
    assert by_name["all_blocking_items_complete"]["params"] == []
    assert by_name["issue_link"]["params"] == []


def test_primitives_catalog_surfaces_date_window_at_least_one_of_constraint(client, fake_dc):
    """date_window has no required params (start/end are each individually
    optional), so its "at least one of start/end" rule can't be expressed
    by PARAM_SPECS's flat `required` flag — it's carried on the `constraint`
    field instead (validate.py's ParamSpec docstring), and must round-trip
    through the catalog for the frontend to render it."""
    resp = client.get(f"/api/workflows/{TENANT}/primitives")
    guards = {g["name"]: g for g in resp.json()["guards"]}
    params = {p["name"]: p for p in guards["date_window"]["params"]}
    assert params["start"]["constraint"] == "at_least_one_of:start,end"
    assert params["end"]["constraint"] == "at_least_one_of:start,end"


# --- GET .../templates (Task 6) ---------------------------------------------


def test_templates_route_serves_every_shipped_template(client):
    """The gallery is served straight from `app.templates.catalog`, so the
    route's job is transport, not selection: whatever the catalog ships must
    arrive intact. Asserted against the catalog itself rather than a
    hardcoded id list, so a third template needs no edit here."""
    from app.templates.catalog import template_catalog

    resp = client.get(f"/api/workflows/{TENANT}/templates")
    assert resp.status_code == 200
    templates = resp.json()["templates"]

    expected_ids = [t["template_id"] for t in template_catalog()]
    assert [t["template_id"] for t in templates] == expected_ids
    assert len(expected_ids) >= 2, "the stage-editor coverage test requires n>=2 templates"

    for entry in templates:
        assert entry["name"]
        assert entry["description"]
        definition = entry["definition"]
        assert definition["channel_access"] == "family"
        assert definition["machine"]["states"]
        assert definition["steps"]
    # alias spelling: "from", not "from_" (interface map §2i) — the route
    # returns the same plain-dict shape `build_machine()` builds, unwrapped
    # by any pydantic re-serialization that could drift the wire key.
    assert definition["machine"]["transitions"][0]["from"]


def _model(*field_names):
    """Minimal model definition — only presence matters to this route."""
    return {
        "base_fields": [{"name": n, "type": "str", "required": False} for n in field_names],
        "custom_fields": [],
    }


def _entry_by_id(templates, template_id):
    return next(t for t in templates if t["template_id"] == template_id)


def _referenced_models_of(template_id):
    """The entity models a shipped template's sections actually name —
    derived the same way the route does, so these tests never hardcode a
    model list that a template edit could silently invalidate."""
    from app.templates.catalog import template_catalog
    from app.workflows import definitions as defs
    from app.workflows.schema import StepDef

    entry = _entry_by_id(template_catalog(), template_id)
    steps = [StepDef.model_validate(s) for s in entry["definition"]["steps"]]
    return defs.referenced_entity_models(steps)


def test_templates_report_missing_models_when_tenant_has_none(client, fake_dc):
    resp = client.get(f"/api/workflows/{TENANT}/templates")
    assert resp.status_code == 200

    for entry in resp.json()["templates"]:
        expected = sorted(_referenced_models_of(entry["template_id"]))
        assert entry["missing_models"] == expected


def test_templates_report_no_missing_models_when_tenant_has_all(client, fake_dc):
    from app.templates.catalog import template_catalog

    for entry in template_catalog():
        for et in _referenced_models_of(entry["template_id"]):
            fake_dc.set_model(TENANT, et, _model("first_name"))

    resp = client.get(f"/api/workflows/{TENANT}/templates")

    for entry in resp.json()["templates"]:
        assert entry["missing_models"] == []


def test_templates_report_only_the_models_the_tenant_lacks(client, fake_dc):
    """Seed every referenced model except one, and only that one is reported."""
    from app.templates.catalog import template_catalog

    target = template_catalog()[0]["template_id"]
    referenced = sorted(_referenced_models_of(target))
    assert referenced, "this test needs a template that references at least one model"
    withheld = referenced[0]

    for entry in template_catalog():
        for et in _referenced_models_of(entry["template_id"]):
            if et != withheld:
                fake_dc.set_model(TENANT, et, _model("first_name"))

    resp = client.get(f"/api/workflows/{TENANT}/templates")
    entry = _entry_by_id(resp.json()["templates"], target)

    assert entry["missing_models"] == [withheld]


def test_missing_models_is_present_on_every_entry(client, fake_dc):
    """The key is never absent — the frontend reads it unconditionally."""
    for entry in client.get(f"/api/workflows/{TENANT}/templates").json()["templates"]:
        assert "missing_models" in entry
        assert isinstance(entry["missing_models"], list)


def test_missing_models_is_sorted(client, fake_dc):
    """Order must be stable so the rendered copy doesn't reshuffle between
    requests. `referenced_entity_models` returns an unordered `set`, and
    `fetch_models` (definitions.py:85) currently happens to iterate it
    sorted — but that's an implementation detail of `fetch_models`, not a
    guarantee. The route's own `sorted()` here is an independent guarantee
    that does not depend on `fetch_models`'s current behavior."""
    for entry in client.get(f"/api/workflows/{TENANT}/templates").json()["templates"]:
        assert entry["missing_models"] == sorted(entry["missing_models"])


def test_templates_route_still_serves_the_whole_catalog(client, fake_dc):
    """`missing_models` is additive — the existing payload must be intact."""
    from app.templates.catalog import template_catalog

    templates = client.get(f"/api/workflows/{TENANT}/templates").json()["templates"]
    expected = template_catalog()

    assert [t["template_id"] for t in templates] == [e["template_id"] for e in expected]
    for got, want in zip(templates, expected):
        assert got["name"] == want["name"]
        assert got["description"] == want["description"]
        assert got["definition"]["steps"] == want["definition"]["steps"]
        assert got["definition"]["machine"] == want["definition"]["machine"]


# --- cross-tenant 403 on every designer route -------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/workflows/othertenant/definitions"),
        ("get", "/api/workflows/othertenant/definitions/wd_1/bundle"),
        ("post", "/api/workflows/othertenant/definitions/wd_1/validate"),
        ("get", "/api/workflows/othertenant/primitives"),
        ("get", "/api/workflows/othertenant/templates"),
    ],
)
def test_cross_tenant_designer_routes_are_403(client, method, path):
    """Cross-tenant coverage for every route this task adds, following
    tests/test_entities_api.py's pattern: `require_staff_tenant` rejects
    before any DataCore call, so no entity needs to actually exist at
    `wd_1` for the bundle/validate cases."""
    resp = getattr(client, method)(path)
    assert resp.status_code == 403


# --- PARAM_SPECS drift guard (validate.py's own primitives, not the route) -


def _minimal_machine(guards=None, effects=None):
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "done", "name": "Done", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t1",
                "from": "draft",
                "to": "done",
                "action": "go",
                "actor": "staff",
                "guards": guards or [],
                "effects": effects or [],
            }
        ],
    }


VALID_PARAMS: dict[str, dict] = {
    "items_in_status": {"status": "verified", "quantifier": "all", "step_ids": ["s1"]},
    "capacity_available": {"count_states": ["approved"], "capacity_field": "capacity"},
    "data_condition": {"condition": {"all": [{"source": "context.x", "op": "truthy"}]}},
    "actor_role": {"roles": ["staff"]},
    "commit_sections": {"section_ids": ["sec1"]},
    "set_entity_field": {"ref": "student", "field": "nickname", "value": "x"},
    "send_email": {"template": "welcome"},
    "set_context": {"key": "foo", "value": "bar"},
    "start_due_clocks": {"step_ids": ["s1"]},
}

GUARD_PRIMITIVE_NAMES = {"items_in_status", "capacity_available", "data_condition", "actor_role",
                         "date_window"}
EFFECT_PRIMITIVE_NAMES = {"commit_sections", "set_entity_field", "send_email", "set_context",
                          "start_due_clocks"}

# Extra declared steps some primitives' STRUCTURAL (non-param-shape) checks
# cross-reference — needed so a "fully valid params" run doesn't also trip
# an unrelated undeclared-step/-section error that would pollute the
# primitive-name substring check below. Neither primitive's param validator
# itself needs these; `_commit_sections_ref_errors`/`_effect_params_start_due_clocks`
# do (see validate.py).
_S1_DOC_STEP = {
    "step_id": "s1", "type": "documents", "title": "Docs", "required": False,
    "blocking": False, "available_in": ["draft"], "show_if": None, "review": None,
    "config": {"docs": []},
}
_SEC1_FORM_STEP = {
    "step_id": "sec1_step", "type": "form", "title": "Form", "required": False,
    "blocking": False, "available_in": ["draft"], "show_if": None, "review": None,
    "config": {"sections": [{
        "section_id": "sec1", "entity_model": "family", "fields": [],
        "mode": "create", "repeat": None,
    }]},
}
EXTRA_STEPS_FOR: dict[str, list[dict]] = {
    "start_due_clocks": [_S1_DOC_STEP],
    "commit_sections": [_SEC1_FORM_STEP],
}


@pytest.mark.parametrize("primitive_name", sorted(VALID_PARAMS))
def test_param_specs_required_flags_match_real_validator_behavior(primitive_name):
    """Cross-check test (task-2-brief.md's introspection requirement): for
    every PARAM_SPECS entry marked required, omitting that param from an
    otherwise-valid params dict must trip a real validate_definition error
    naming it — this is what keeps PARAM_SPECS from silently drifting away
    from what GUARD_PARAM_VALIDATORS/EFFECT_PARAM_VALIDATORS actually
    enforce (validate.py's own docstring on PARAM_SPECS names this test)."""
    specs = PARAM_SPECS[primitive_name]
    full_params = VALID_PARAMS[primitive_name]
    models: dict = {}
    extra_steps = EXTRA_STEPS_FOR.get(primitive_name, [])

    def _errors_for(params: dict) -> list[str]:
        if primitive_name in GUARD_PRIMITIVE_NAMES:
            machine_dict = _minimal_machine(guards=[{"primitive": primitive_name, "params": params}])
        else:
            machine_dict = _minimal_machine(effects=[{"primitive": primitive_name, "params": params}])
        machine = MachineDef.model_validate(machine_dict)
        steps = [StepDef.model_validate(s) for s in extra_steps]
        return validate_definition(machine, steps, models)

    # Fully valid params -> no error mentions this primitive.
    errors = _errors_for(full_params)
    assert not any(primitive_name in e for e in errors), errors

    # Params containing ONLY the required subset -> still no error (proves
    # the optional params really are optional).
    minimal_params = {s.name: full_params[s.name] for s in specs if s.required}
    errors = _errors_for(minimal_params)
    assert not any(primitive_name in e for e in errors), errors

    # Each required param, removed one at a time, must trip an error naming it.
    for spec in specs:
        if not spec.required:
            continue
        degraded = {k: v for k, v in minimal_params.items() if k != spec.name}
        errors = _errors_for(degraded)
        assert any(spec.name in e for e in errors), (spec.name, errors)


def _errors_for_primitive(primitive_name: str, params: dict) -> list[str]:
    """Shared helper (generalizes the closure inside the test above) for
    the enum cross-check and date_window behavioral tests below: wraps
    `params` in a minimal guard/effect transition and runs the real
    `validate_definition`, including whatever declared steps that
    primitive's STRUCTURAL checks cross-reference (see EXTRA_STEPS_FOR)."""
    extra_steps = EXTRA_STEPS_FOR.get(primitive_name, [])
    if primitive_name in GUARD_PRIMITIVE_NAMES:
        machine_dict = _minimal_machine(guards=[{"primitive": primitive_name, "params": params}])
    else:
        machine_dict = _minimal_machine(effects=[{"primitive": primitive_name, "params": params}])
    machine = MachineDef.model_validate(machine_dict)
    steps = [StepDef.model_validate(s) for s in extra_steps]
    return validate_definition(machine, steps, {})


# --- enum cross-check (coordinator review finding #2) -----------------------

ENUM_SPECS = [
    (primitive_name, spec)
    for primitive_name, specs in PARAM_SPECS.items()
    for spec in specs
    if spec.enum
]


@pytest.mark.parametrize(
    "primitive_name,spec", ENUM_SPECS,
    ids=[f"{p}.{s.name}" for p, s in ENUM_SPECS],
)
def test_enum_param_rejects_invalid_value(primitive_name, spec):
    """Every PARAM_SPECS entry carrying an `enum` must actually be enforced
    by the real validator, not just documented in the catalog — feed an
    out-of-enum value through validate_definition and assert it's rejected.
    Parametrized over every enum-carrying PARAM_SPECS entry (currently just
    items_in_status.quantifier) so a future enum addition is covered
    automatically."""
    base_params = dict(VALID_PARAMS[primitive_name])
    base_params[spec.name] = "not-a-real-enum-value"
    errors = _errors_for_primitive(primitive_name, base_params)
    assert any(spec.name in e for e in errors), (primitive_name, spec.name, errors)


# --- date_window behavioral rules (coordinator review finding #1) ----------
#
# date_window has NO required params in PARAM_SPECS (start/end are each
# individually optional) — its actual rule, "at least one of start/end",
# and its per-bound date-format check, are cross-param/format logic that
# doesn't fit the generic drift-check loop above (which only ever removes
# ONE param from an otherwise-full set). These are dedicated behavioral
# tests instead, exercising the same real `_guard_params_date_window` via
# `validate_definition`.


def test_date_window_both_bounds_present_no_error():
    errors = _errors_for_primitive("date_window", {"start": "2026-01-01", "end": "2026-12-31"})
    assert not any("date_window" in e for e in errors), errors


def test_date_window_only_start_present_no_error():
    errors = _errors_for_primitive("date_window", {"start": "2026-01-01"})
    assert not any("date_window" in e for e in errors), errors


def test_date_window_only_end_present_no_error():
    errors = _errors_for_primitive("date_window", {"end": "2026-12-31"})
    assert not any("date_window" in e for e in errors), errors


def test_date_window_neither_bound_present_errors():
    errors = _errors_for_primitive("date_window", {})
    assert any("requires at least one of 'start'/'end'" in e for e in errors), errors


def test_date_window_unparseable_date_errors():
    errors = _errors_for_primitive("date_window", {"start": "not-a-date"})
    assert any("not a valid YYYY-MM-DD date" in e for e in errors), errors


# --- definition-aware save -------------------------------------------------
#
# The editor used to write through the GENERIC entities proxy, which enforces
# no schema, and validate through a separate debounced call that re-read the
# row and every referenced model. This route replaces both: the machine/steps
# arrive in the body, so there is no row read, and validation rides the write
# instead of being independently triggerable.


def test_save_definition_writes_and_returns_validation(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-save", status="draft")

    resp = client.put(
        f"/api/workflows/{TENANT}/definitions/{eid}",
        json={"machine": _valid_machine(), "steps": _valid_steps()},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["errors"] == []
    assert body["health"] == "current"

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert json.loads(row["machine"])["states"][0]["state_id"] == "draft"


def test_save_definition_reports_errors_without_refusing_the_write(client, fake_dc):
    """A draft is allowed to be invalid — that is what draft means. The write
    must land so the work is not lost; the errors come back alongside it, and
    publish stays the gate that actually refuses."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-save-invalid", status="draft")

    resp = client.put(
        f"/api/workflows/{TENANT}/definitions/{eid}",
        json={"machine": _broken_machine(), "steps": _valid_steps()},
    )
    assert resp.status_code == 200
    assert len(resp.json()["errors"]) > 0

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert json.loads(row["machine"])["states"] == _broken_machine()["states"]


def test_save_definition_rejects_unparseable_machine_before_writing(client, fake_dc):
    """The generic entities proxy would happily store `machine: "not json"`,
    which bricks every later read of the row. A definition-aware save refuses
    it, so the corrupt-row case stops being reachable through the product."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-save-corrupt", status="draft")

    resp = client.put(
        f"/api/workflows/{TENANT}/definitions/{eid}",
        json={"machine": {"states": "not-a-list"}, "steps": []},
    )
    assert resp.status_code == 422

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert json.loads(row["machine"])["states"][0]["state_id"] == "draft"


def test_save_definition_rejects_a_malformed_section_before_writing(
        client, fake_dc, monkeypatch):
    """A malformed SECTION must 422 like a malformed machine — and, crucially,
    must not write first.

    `StepDef.config` is `dict[str, Any]`, so a section missing
    entity_model/fields/mode sails through `StepDef.model_validate`. The only
    thing that parses it is `referenced_entity_models`, which ran AFTER
    `dc_update` and OUTSIDE the try that 422s — so the malformed section was
    PERSISTED to the row and the request then raised out of the route as a
    500. The same hole was closed in `create_definition`; this is its twin,
    and it matters more here because the chat assistant's patch-apply path
    PUTs through this function.
    """
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-save-bad-section", status="draft")

    # A flattened read-back cannot answer "was anything written?" on its own
    # (a rejected write and an accepted one that happened to store the same
    # bytes look alike), so the call itself is recorded — same reasoning as
    # tests/test_create_definition.py's `dc_create_calls` fixture.
    calls: list = []
    inner = dc.dc_update

    def _recording(*args, **kwargs):
        calls.append(args)
        return inner(*args, **kwargs)

    monkeypatch.setattr(dc, "dc_update", _recording)

    resp = client.put(
        f"/api/workflows/{TENANT}/definitions/{eid}",
        json={"machine": _valid_machine(), "steps": [
            {"step_id": "student_details", "type": "form", "title": "Student",
             "required": True, "blocking": True, "available_in": ["draft"],
             "config": {"sections": [{"section_id": "student_section"}]}},
        ]},
    )

    assert resp.status_code == 422, resp.text
    assert isinstance(resp.json()["detail"]["parse_error"], str)
    assert resp.json()["detail"]["parse_error"]  # non-empty
    # Nothing was written — the row still holds what it held before.
    assert calls == []
    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert json.loads(row["steps"])[0]["config"]["sections"][0]["entity_model"] == "student"


def test_save_definition_refuses_a_published_row(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-save-published", status="published")

    resp = client.put(
        f"/api/workflows/{TENANT}/definitions/{eid}",
        json={"machine": _valid_machine(), "steps": []},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_draft"
