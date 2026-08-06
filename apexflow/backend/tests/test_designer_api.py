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

    # no-param primitives (GUARDS/EFFECTS membership only, no PARAM_SPECS entry)
    assert by_name["all_blocking_items_complete"]["params"] == []
    assert by_name["issue_link"]["params"] == []


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

GUARD_PRIMITIVE_NAMES = {"items_in_status", "capacity_available", "data_condition", "actor_role"}
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
