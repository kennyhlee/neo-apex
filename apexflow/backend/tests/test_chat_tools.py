# apexflow/backend/tests/test_chat_tools.py
"""Tool-level tests for the chat assistant's READ tools (Plan 4 / Task 4).

Pattern ported from admindash/backend/tests/test_chat_tools.py: a
`FunctionModel` whose responder emits ONE `ToolCallPart` on the first model
request and then echoes the resulting `ToolReturnPart` back as text, so
`result.output` IS the tool's return value verbatim. `models.ALLOW_MODEL_REQUESTS
= False` guarantees no test can reach a real provider.

Two deliberate divergences from the admindash source:

1. DataCore is faked through `tests/fakes.py`'s `FakeDataCore` (the `fake_dc`
   conftest fixture), not respx. apexflow's read tools go through
   `app.workflows.datacore`'s helper functions, which `install_fake_datacore`
   monkeypatches wholesale — respx would only intercept the HTTP layer those
   helpers no longer reach under the fake, and the rest of this suite
   (test_designer_api.py) already seeds definitions through the same fake.
2. `agent.run_sync`, not `await agent.run`. apexflow's suite configures no
   asyncio/anyio mode (no `[tool.pytest.ini_options]` anywhere), so an async
   test would silently no-op; `run_sync` keeps these tests plain functions.
"""
import json

from fastapi import HTTPException
from pydantic_ai import Agent, ModelMessage, ModelResponse, TextPart, ToolCallPart, models
from pydantic_ai.messages import ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.chat.deps import ChatDeps
from app.chat.tools import register_proposal_tools, register_read_tools
from app.workflows import datacore as dc
from app.workflows import definitions as defs

models.ALLOW_MODEL_REQUESTS = False

TENANT = "acme"


def _responder_for(tool_name: str, args: dict):
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool_name, args)])
        for part in getattr(messages[-1], "parts", []):
            if isinstance(part, ToolReturnPart):
                return ModelResponse(parts=[TextPart(str(part.content))])
        return ModelResponse(parts=[TextPart("no tool return")])

    return responder


def _agent_that_calls(tool_name: str, args: dict) -> Agent:
    agent = Agent(FunctionModel(_responder_for(tool_name, args)), deps_type=ChatDeps)
    register_read_tools(agent)
    return agent


def _deps(page: str = "list") -> ChatDeps:
    return ChatDeps(tenant_id=TENANT, token="Bearer test-token", page=page)


def _run(tool_name: str, args: dict | None = None, page: str = "list") -> str:
    agent = _agent_that_calls(tool_name, args or {})
    return agent.run_sync("go", deps=_deps(page)).output


# --- fixture builders (mirrors tests/test_designer_api.py) -----------------


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
                    {"primitive": "commit_sections",
                     "params": {"section_ids": ["student_section"]}}
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
    """No terminal state and no outgoing transition from the initial state —
    parses fine, but validate_definition reports two errors."""
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


def _family_model():
    """A second model, with a custom field — `_model_fields` merges
    base_fields and custom_fields, and the assistant must see both."""
    return {
        "base_fields": [
            {"name": "family_id", "type": "str", "required": True},
            {"name": "family_name", "type": "str", "required": True},
        ],
        "custom_fields": [
            {"name": "home_city", "type": "str", "required": False},
        ],
    }


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
    return fake_dc.dc_create(TENANT, "workflow_definition", base)["entity_id"]


def _seed_corrupt_definition(fake_dc, *, definition_id="wd-corrupt", name="Corrupt"):
    """`machine` that is not valid JSON at all — writable today through the
    generic entities proxy (no schema enforcement), and the shape
    `parse_machine_steps` raises `json.JSONDecodeError` on."""
    base = {
        "definition_id": definition_id,
        "name": name,
        "version": 1,
        "status": "draft",
        "lineage_status": "active",
        "channel_access": "staff_only",
        "machine": "not json",
        "steps": json.dumps(_valid_steps()),
    }
    return fake_dc.dc_create(TENANT, "workflow_definition", base)["entity_id"]


# --- list_workflows -------------------------------------------------------


def test_list_workflows_returns_a_line_per_row_with_name_status_version(fake_dc):
    v1 = _seed_definition(fake_dc, definition_id="wd-1", version=1, status="published",
                          name="Enrollment")
    v2 = _seed_definition(fake_dc, definition_id="wd-1", version=2, status="draft",
                          name="Enrollment")

    out = _run("list_workflows")

    lines = [ln for ln in out.splitlines() if ln.strip()]
    assert len(lines) == 2, out
    assert all("Enrollment" in ln for ln in lines)
    assert any("v1" in ln and "published" in ln for ln in lines)
    assert any("v2" in ln and "draft" in ln for ln in lines)
    # entity_id is what get_workflow / the proposal tools address a row by,
    # so it must be in the listing or the model cannot follow up.
    assert v1 in out and v2 in out
    assert "wd-1" in out  # lineage id


def test_list_workflows_scopes_to_the_deps_tenant(fake_dc):
    """The tool must read ctx.deps.tenant_id, not any tenant it finds a row
    for — another tenant's definition must not leak into the listing."""
    _seed_definition(fake_dc, definition_id="wd-mine", name="Mine")
    fake_dc.dc_create("other-tenant", "workflow_definition", {
        "definition_id": "wd-theirs", "name": "Theirs", "version": 1,
        "status": "draft", "lineage_status": "active", "channel_access": "staff_only",
        "machine": json.dumps(_valid_machine()), "steps": json.dumps(_valid_steps()),
    })

    out = _run("list_workflows")

    assert "Mine" in out
    assert "Theirs" not in out


def test_list_workflows_says_so_when_the_tenant_has_none(fake_dc):
    out = _run("list_workflows")
    assert "No workflow definitions" in out


# --- get_workflow ---------------------------------------------------------


def test_get_workflow_returns_full_machine_steps_and_validation_errors(fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-get", status="draft",
                           name="Enrollment")

    payload = json.loads(_run("get_workflow", {"entity_id": eid}))

    assert payload["name"] == "Enrollment"
    assert payload["status"] == "draft"
    assert payload["channel_access"] == "staff_only"
    # Full machine, not a summary: every state and transition round-trips,
    # and `from` keeps its alias (the wire name the schema declares).
    assert [s["state_id"] for s in payload["machine"]["states"]] == [
        "draft", "submitted", "enrolled"]
    assert payload["machine"]["transitions"][0]["from"] == "draft"
    assert payload["steps"][0]["step_id"] == "student_details"
    assert payload["steps"][0]["config"]["sections"][0]["entity_model"] == "student"
    assert payload["validation_errors"] == []


def test_get_workflow_reports_validation_errors_for_an_invalid_machine(fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-bad", machine=_broken_machine(),
                           steps=[])

    payload = json.loads(_run("get_workflow", {"entity_id": eid}))

    assert any("terminal" in e for e in payload["validation_errors"]), payload


def test_get_workflow_on_a_corrupt_row_says_it_does_not_parse(fake_dc):
    """A row whose stored `machine` is not JSON must come back as a string
    the model can read, NOT as an exception through the stream."""
    eid = _seed_corrupt_definition(fake_dc)

    out = _run("get_workflow", {"entity_id": eid})

    assert "does not parse" in out


def test_get_workflow_on_an_unknown_entity_id_returns_a_not_found_string(fake_dc):
    """`require_definition_row` raises HTTPException(404) — uncaught, that
    would propagate out of the agent run and 500 the SSE stream."""
    out = _run("get_workflow", {"entity_id": "no-such-row"})

    assert "not found" in out.lower()


def test_get_workflow_reports_a_datacore_outage_as_could_not_load_not_not_found(
        fake_dc, monkeypatch):
    """A 503 from DataCore must NOT be reported as "not found".

    `require_definition_row` raises HTTPException for far more than an absent
    row (`dc_query` re-raises DataCore's own status — outages, auth
    rejections). Calling those "no such workflow" would steer the model into
    propose_create_draft for a workflow that already exists, turning a
    transient outage into a duplicate draft."""
    def _boom(*a, **kw):
        raise HTTPException(503, "DataCore query failed: upstream unavailable")

    monkeypatch.setattr(defs, "require_definition_row", _boom)

    out = _run("get_workflow", {"entity_id": "wd-exists"})

    assert "not found" not in out.lower()
    assert "could not load" in out.lower()
    assert "503" in out and "upstream unavailable" in out


def test_get_workflow_reports_a_non_http_failure_as_could_not_load(fake_dc, monkeypatch):
    """Same guarantee for the non-HTTPException path (e.g. `dc._validate_id`'s
    ValueError on a malformed id, or any client-side failure): a string, still
    never "not found", and still never raised through the stream."""
    def _boom(*a, **kw):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(defs, "require_definition_row", _boom)

    out = _run("get_workflow", {"entity_id": "wd-exists"})

    assert "not found" not in out.lower()
    assert "could not load" in out.lower()
    assert "connection reset" in out


# --- list_templates / get_template ----------------------------------------


def test_list_templates_includes_every_catalog_id_and_name():
    from app.templates.catalog import template_catalog

    out = _run("list_templates", page="templates")

    for t in template_catalog():
        assert t["template_id"] in out
        assert t["name"] in out


def test_get_template_returns_the_full_definition_json():
    from app.templates.catalog import template_catalog

    entry = template_catalog()[0]
    payload = json.loads(_run("get_template", {"template_id": entry["template_id"]},
                              page="templates"))

    assert payload == entry["definition"]
    assert {"machine", "steps", "channel_access"} <= set(payload)


def test_get_template_unknown_id_returns_an_error_string():
    out = _run("get_template", {"template_id": "nope"}, page="templates")

    assert "nope" in out
    assert "list_templates" in out


# --- list_entity_models / get_entity_model --------------------------------
#
# The gap these close: outside the editor there is no `entity_model_fields`
# block in the prompt (that comes from `load_editor_context`), so a
# from-scratch build had NO way to learn which fields a tenant's models carry.
# The observed failure was a form step whose sections picked zero fields — a
# form that renders empty — and, in one run, a section bound to a model the
# tenant never had.


def test_list_entity_models_lists_each_model_with_its_field_names(fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    fake_dc.set_model(TENANT, "family", _family_model())

    out = _run("list_entity_models")

    student_line = next(ln for ln in out.splitlines() if ln.startswith("- student"))
    assert "first_name" in student_line and "last_name" in student_line
    family_line = next(ln for ln in out.splitlines() if ln.startswith("- family"))
    assert "family_name" in family_line
    # base_fields AND custom_fields — the same merge validation itself uses.
    assert "home_city" in family_line


def test_list_entity_models_includes_a_model_outside_the_standard_bundle(fake_dc):
    """The tenant's own types are enumerated from the models table, not read
    off a hardcoded list — a tenant-specific model must be offerable."""
    fake_dc.set_model(TENANT, "camp_session", {
        "base_fields": [{"name": "session_name", "type": "str", "required": True}],
        "custom_fields": [],
    })

    out = _run("list_entity_models")

    assert "camp_session" in out
    assert "session_name" in out


def test_list_entity_models_names_the_models_that_are_not_set_up(fake_dc):
    """A standard model the tenant never configured must be reported as
    ABSENT, not silently listed — a section bound to it fails validation, and
    the "invent a model" failure is exactly what this tool exists to stop."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])

    out = _run("list_entity_models")

    body, _, absent = out.partition("Not set up")
    assert "- student:" in body
    assert "contact" in absent and "lead" in absent
    assert "contact" not in body


def test_list_entity_models_scopes_to_the_deps_tenant(fake_dc):
    fake_dc.set_model("other-tenant", "camp_session", {
        "base_fields": [{"name": "session_name", "type": "str", "required": True}],
        "custom_fields": [],
    })

    out = _run("list_entity_models")

    assert "camp_session" not in out


def test_list_entity_models_says_so_when_the_tenant_has_none(fake_dc):
    out = _run("list_entity_models")

    assert "no entity models" in out.lower()


def test_get_entity_model_returns_fields_with_types_and_required_ness(fake_dc):
    fake_dc.set_model(TENANT, "family", _family_model())

    out = _run("get_entity_model", {"entity_type": "family"})

    assert "family_name" in out and "home_city" in out
    name_line = next(ln for ln in out.splitlines() if ln.startswith("- family_name"))
    assert "str" in name_line and "required" in name_line
    city_line = next(ln for ln in out.splitlines() if ln.startswith("- home_city"))
    assert "required" not in city_line
    # `{model}_id` fields are engine-supplied and rejected as section-writable
    # by validate_definition — the model must be told before it picks one.
    id_line = next(ln for ln in out.splitlines() if ln.startswith("- family_id"))
    assert "do not pick" in id_line.lower()


def test_get_entity_model_on_an_unknown_type_points_back_at_the_list(fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])

    out = _run("get_entity_model", {"entity_type": "feedback"})

    assert "feedback" in out
    assert "list_entity_models" in out


def test_get_entity_model_reports_a_datacore_failure_as_could_not_load(fake_dc,
                                                                      monkeypatch):
    """Same property every read tool here keeps: a string, never a raise, and
    an outage must not read as "this model does not exist"."""
    def _boom(*a, **kw):
        raise HTTPException(503, "DataCore query failed: upstream unavailable")

    monkeypatch.setattr(dc, "get_model_definition", _boom)

    out = _run("get_entity_model", {"entity_type": "student"})

    assert "could not load" in out.lower()
    assert "503" in out


# --- propose_create_draft -------------------------------------------------
#
# The model NEVER writes. `propose_create_draft` only QUEUES a dict on
# `deps.pending_proposals`; `sse_chat` emits it as a `proposal` frame and the
# admin's click on the resulting card is what actually creates the draft. So
# every test here asserts two things: the string handed back to the model, and
# the exact state of the queue.


def _run_proposal(args: dict, page: str = "list") -> tuple[str, ChatDeps]:
    """Like `_run`, but registers the PROPOSAL tools and hands back the deps
    so the queue itself can be inspected."""
    agent = Agent(FunctionModel(_responder_for("propose_create_draft", args)),
                  deps_type=ChatDeps)
    register_proposal_tools(agent)
    deps = _deps(page)
    return agent.run_sync("go", deps=deps).output, deps


def _draft_args(**over) -> dict:
    args = {"name": "Signup", "machine": _valid_machine(), "steps": _valid_steps()}
    args.update(over)
    return args


def test_propose_create_draft_queues_the_exact_wire_contract(fake_dc):
    out, deps = _run_proposal(_draft_args(
        channel_access="family",
        template_id="signup",
        summary=["Two states", "One form step"],
    ))

    assert "card is ready" in out.lower()
    assert len(deps.pending_proposals) == 1
    p = deps.pending_proposals[0]
    # Exactly the keys Task 10's CreateDraftCard reads — no more, no fewer.
    assert set(p) == {"action", "name", "template_id", "machine", "steps",
                      "channel_access", "summary"}
    assert p["action"] == "create_draft"
    assert p["name"] == "Signup"
    assert p["template_id"] == "signup"
    assert p["channel_access"] == "family"
    assert p["summary"] == ["Two states", "One form step"]
    # The COMPLETE machine/steps, dumped by_alias: the card posts this straight
    # to the create endpoint, which parses `from`, not `from_`.
    assert [s["state_id"] for s in p["machine"]["states"]] == [
        "draft", "submitted", "enrolled"]
    t = p["machine"]["transitions"][0]
    assert t["from"] == "draft"
    assert "from_" not in t
    assert p["steps"][0]["step_id"] == "student_details"
    assert p["steps"][0]["config"]["sections"][0]["entity_model"] == "student"
    # It rides the SSE wire verbatim (`json.dumps` in stream.py's `_sse`).
    json.dumps(p)


def test_propose_create_draft_writes_nothing(fake_dc):
    """The whole point of a proposal: no definition row exists afterwards."""
    _out, deps = _run_proposal(_draft_args())

    assert deps.pending_proposals  # it really did propose
    assert dc.list_entities(TENANT, "workflow_definition", "", "Bearer test-token") == []


def test_propose_create_draft_defaults_channel_template_and_summary(fake_dc):
    _out, deps = _run_proposal(_draft_args())

    p = deps.pending_proposals[0]
    assert p["channel_access"] == "staff_only"
    assert p["template_id"] is None
    assert p["summary"] == []


def test_propose_create_draft_rejects_an_unparseable_machine(fake_dc):
    """A machine the schema cannot parse must come back as a correctable
    string — never an exception through the stream, and never a queued
    proposal the card would post to a create endpoint that then 422s."""
    out, deps = _run_proposal(_draft_args(
        machine={"states": [{"state_id": "draft"}], "transitions": []}))

    assert "does not parse" in out
    assert "propose_create_draft" in out  # tells the model how to retry
    assert deps.pending_proposals == []


def test_propose_create_draft_rejects_unparseable_steps(fake_dc):
    out, deps = _run_proposal(_draft_args(steps=[{"step_id": "orphan"}]))

    assert "does not parse" in out
    assert deps.pending_proposals == []


def test_propose_create_draft_rejects_a_malformed_section(fake_dc):
    """`StepDef.config` is `dict[str, Any]`, so a form step whose section is
    missing entity_model/fields/mode passes StepDef validation untouched.

    The create endpoint parses sections too (`referenced_entity_models`), so a
    proposal like this would render a card whose confirm-click fails. Sections
    are therefore parsed HERE, inside the same try, and the model gets a
    correctable string instead of the admin getting a broken card."""
    bad_step = _valid_steps()[0]
    bad_step["config"]["sections"][0] = {"section_id": "student_section"}

    out, deps = _run_proposal(_draft_args(steps=[bad_step]))

    assert "does not parse" in out
    assert deps.pending_proposals == []


def test_propose_create_draft_rejects_a_non_list_sections_without_raising(fake_dc):
    """Same guard, non-ValidationError path. `config.sections` is entirely
    model-controlled and untyped: a scalar there makes
    `referenced_entity_models` raise TypeError while iterating, not
    ValidationError. It must STILL come back as a string — an exception here
    propagates out of `agent.run_stream` and ends the SSE stream in `error`."""
    bad_step = _valid_steps()[0]
    bad_step["config"]["sections"] = 5

    out, deps = _run_proposal(_draft_args(steps=[bad_step]))

    assert "does not parse" in out
    assert deps.pending_proposals == []


def test_propose_create_draft_rejects_a_section_that_picks_no_fields(fake_dc):
    """The reported bug. A section with `fields: []` PARSES — `FieldPick` is a
    list, and an empty list is a valid list — so every existing guard passes it
    through, the draft is created, and the form renders with nothing in it. The
    admin cannot tell from the card that the step is empty, so the refusal has
    to happen here, naming the tool that supplies the missing field names."""
    empty_step = _valid_steps()[0]
    empty_step["config"]["sections"][0]["fields"] = []

    out, deps = _run_proposal(_draft_args(steps=[empty_step]))

    assert "student_section" in out          # which section
    assert "get_entity_model" in out         # how to fix it
    assert "student" in out                  # which model to ask about
    assert deps.pending_proposals == []


def test_propose_create_draft_rejects_the_empty_section_among_good_ones(fake_dc):
    """One bad section is enough — a draft with three good steps and one empty
    form is still a workflow with an empty form in it."""
    good = _valid_steps()[0]
    empty = json.loads(json.dumps(good))
    empty["step_id"] = "family_details"
    empty["config"]["sections"][0]["section_id"] = "family_section"
    empty["config"]["sections"][0]["entity_model"] = "family"
    empty["config"]["sections"][0]["fields"] = []

    out, deps = _run_proposal(_draft_args(steps=[good, empty]))

    assert "family_section" in out
    assert deps.pending_proposals == []


def test_propose_create_draft_still_accepts_sections_that_pick_fields(fake_dc):
    """The gate must not touch the ordinary path."""
    out, deps = _run_proposal(_draft_args())

    assert "card is ready" in out.lower()
    assert len(deps.pending_proposals) == 1


def test_propose_create_draft_rejects_an_unknown_channel_access(fake_dc):
    """`channel_access` is a two-value enum on the definition row; anything
    else would be rejected downstream, so it is caught here instead."""
    out, deps = _run_proposal(_draft_args(channel_access="public"))

    assert out == "channel_access must be 'staff_only' or 'family'."
    assert deps.pending_proposals == []


def test_propose_create_draft_accepts_both_channel_values(fake_dc):
    for value in ("staff_only", "family"):
        _out, deps = _run_proposal(_draft_args(channel_access=value))
        assert deps.pending_proposals[0]["channel_access"] == value


# --- propose_patch --------------------------------------------------------
#
# Same contract as propose_create_draft — queue a dict, return a string, write
# nothing — with one addition: it is the EDITOR's tool, and the page guard is
# what stops it queueing a patch against a draft that is not open.


def _run_patch(args: dict, page: str = "editor",
               read_only: bool = False) -> tuple[str, ChatDeps]:
    agent = Agent(FunctionModel(_responder_for("propose_patch", args)),
                  deps_type=ChatDeps)
    register_proposal_tools(agent)
    deps = _deps(page)
    deps.editor_read_only = read_only
    return agent.run_sync("go", deps=deps).output, deps


def _patch_args(**over) -> dict:
    args = {"ops": [{"op": "add_stage", "stage_id": "review", "name": "Review"}],
            "summary": ["Added a Review stage"]}
    args.update(over)
    return args


def test_propose_patch_queues_the_exact_wire_contract(fake_dc):
    out, deps = _run_patch(_patch_args(ops=[
        {"op": "add_stage", "stage_id": "review", "name": "Review", "kind": "active"},
        {"op": "add_move", "transition_id": "t_review", "from": "draft",
         "to": "review", "action": "send_for_review"},
    ], summary=["Added a Review stage", "Draft -> Review on send_for_review"]))

    assert "card is ready" in out.lower()
    assert len(deps.pending_proposals) == 1
    p = deps.pending_proposals[0]
    # Exactly the keys Task 11's PatchCard reads — no more, no fewer.
    assert set(p) == {"action", "ops", "summary"}
    assert p["action"] == "patch"
    assert p["summary"] == ["Added a Review stage",
                            "Draft -> Review on send_for_review"]
    assert [o["op"] for o in p["ops"]] == ["add_stage", "add_move"]
    # by_alias survives to the browser: `from`, not `from_`.
    assert p["ops"][1]["from"] == "draft"
    assert "from_" not in p["ops"][1]
    # Defaults are materialized here, not left for the card to guess.
    assert p["ops"][1]["actor"] == "staff"
    json.dumps(p)  # it rides the SSE wire verbatim


def test_propose_patch_writes_nothing(fake_dc):
    _out, deps = _run_patch(_patch_args())

    assert deps.pending_proposals
    assert dc.list_entities(TENANT, "workflow_definition", "", "Bearer test-token") == []


def test_propose_patch_refuses_outside_the_editor(fake_dc):
    """The ops address ids in the OPEN DRAFT. On the list or templates page
    there is no open draft, so every id would be a guess — the refusal names
    the tool that does work there so the model can recover in one turn."""
    for page in ("list", "templates"):
        out, deps = _run_patch(_patch_args(), page=page)

        assert "no draft is open" in out.lower(), page
        assert "propose_create_draft" in out, page
        assert deps.pending_proposals == [], page


def test_propose_patch_refuses_a_read_only_version(fake_dc):
    """Only a draft can be saved, so a patch card for a published or
    superseded row is an offer that cannot be taken: Apply would write into
    the editor store, whose mutators silently no-op off-draft, and the admin
    would be told it worked. The queue must stay empty, and the refusal must
    point at the recovery (a new draft version) rather than inviting a retry."""
    out, deps = _run_patch(_patch_args(), read_only=True)

    assert deps.pending_proposals == []
    assert "read-only" in out.lower()
    assert "new draft" in out.lower()


def test_propose_patch_still_works_when_the_open_row_is_a_draft(fake_dc):
    """The guard keys off `editor_read_only`, not off being in the editor —
    the ordinary editor path must be untouched by it."""
    out, deps = _run_patch(_patch_args(), read_only=False)

    assert "card is ready" in out.lower()
    assert len(deps.pending_proposals) == 1


def test_propose_patch_rejects_an_unknown_op(fake_dc):
    out, deps = _run_patch(_patch_args(ops=[{"op": "delete_everything"}]))

    assert "rejected" in out.lower()
    assert deps.pending_proposals == []


def test_propose_patch_rejects_an_op_missing_a_required_field(fake_dc):
    out, deps = _run_patch(_patch_args(ops=[{"op": "remove_stage"}]))

    assert "rejected" in out.lower()
    assert deps.pending_proposals == []


def test_propose_patch_rejects_an_add_step_whose_step_is_not_a_step(fake_dc):
    """`AddStep.step` is `dict[str, Any]` in the op union — it has to be, since
    the union cannot import a step's whole shape without the op vocabulary
    becoming the schema. So the step is parsed against `StepDef` HERE, and a
    payload that would 422 at the save PUT bounces to the model instead of to
    the admin's Apply button."""
    out, deps = _run_patch(_patch_args(ops=[
        {"op": "add_step", "step": {"step_id": "orphan"}}]))

    assert "rejected" in out.lower()
    assert deps.pending_proposals == []


def test_propose_patch_rejects_an_add_step_with_a_malformed_section(fake_dc):
    """Same hole `propose_create_draft` closes: `StepDef.config` is
    `dict[str, Any]`, so a section missing entity_model/fields/mode validates
    as a StepDef and would reach a card whose Apply then fails."""
    bad = _valid_steps()[0]
    bad["config"]["sections"][0] = {"section_id": "student_section"}

    out, deps = _run_patch(_patch_args(ops=[{"op": "add_step", "step": bad}]))

    assert "rejected" in out.lower()
    assert deps.pending_proposals == []


def test_propose_patch_rejects_a_non_list_sections_without_raising(fake_dc):
    """Non-ValidationError path: a scalar `config.sections` makes
    `referenced_entity_models` raise TypeError while iterating. It must STILL
    come back as a string — a raise here ends the SSE stream in `error`."""
    bad = _valid_steps()[0]
    bad["config"]["sections"] = 5

    out, deps = _run_patch(_patch_args(ops=[{"op": "add_step", "step": bad}]))

    assert "rejected" in out.lower()
    assert deps.pending_proposals == []


def test_propose_patch_accepts_a_well_formed_add_step(fake_dc):
    out, deps = _run_patch(_patch_args(ops=[
        {"op": "add_step", "step": _valid_steps()[0], "position": 0}]))

    assert "card is ready" in out.lower()
    assert deps.pending_proposals[0]["ops"][0]["step"]["step_id"] == "student_details"


def test_propose_patch_rejects_an_add_step_whose_section_picks_no_fields(fake_dc):
    """The same empty-form bug, arriving through the editor instead of the
    list page."""
    empty = _valid_steps()[0]
    empty["config"]["sections"][0]["fields"] = []

    out, deps = _run_patch(_patch_args(ops=[{"op": "add_step", "step": empty}]))

    assert "student_section" in out
    assert "get_entity_model" in out
    assert deps.pending_proposals == []


def test_propose_patch_rejects_an_add_section_that_picks_no_fields(fake_dc):
    """`add_section` carries a whole SectionDef in an untyped dict, so it is
    the other door into the same bug — an empty section added to an existing
    step renders exactly as empty as one created with the draft."""
    out, deps = _run_patch(_patch_args(ops=[{
        "op": "add_section", "step_id": "student_details",
        "section": {"section_id": "family_section", "entity_model": "family",
                    "fields": [], "mode": "create", "repeat": None},
    }]))

    assert "family_section" in out
    assert "get_entity_model" in out
    assert "family" in out
    assert deps.pending_proposals == []


def test_propose_patch_rejects_a_malformed_add_section(fake_dc):
    """`AddSection.section` is `dict[str, Any]` — a section missing
    entity_model/mode must bounce to the model, not to the admin's Apply."""
    out, deps = _run_patch(_patch_args(ops=[{
        "op": "add_section", "step_id": "student_details",
        "section": {"section_id": "half_built"},
    }]))

    assert "rejected" in out.lower()
    assert deps.pending_proposals == []


def test_propose_patch_accepts_an_add_section_that_picks_fields(fake_dc):
    out, deps = _run_patch(_patch_args(ops=[{
        "op": "add_section", "step_id": "student_details",
        "section": {"section_id": "family_section", "entity_model": "family",
                    "fields": [{"name": "family_name", "required": True}],
                    "mode": "create", "repeat": None},
    }]))

    assert "card is ready" in out.lower()
    assert len(deps.pending_proposals) == 1


def test_propose_patch_does_not_reject_ops_it_cannot_semantically_check(fake_dc):
    """Structural validation only. `update_step.patch` is a free-form subset —
    whether `stage_9` exists is the save PUT's question (and the editor's own
    hand-edits go through exactly the same gate), so a plausible-but-unknown
    id must not be pre-refused here."""
    out, deps = _run_patch(_patch_args(ops=[
        {"op": "update_step", "step_id": "does_not_exist_yet",
         "patch": {"title": "New title"}}]))

    assert "card is ready" in out.lower()
    assert deps.pending_proposals


# --- registration ---------------------------------------------------------


def test_register_read_tools_offers_every_read_tool_to_the_model(fake_dc):
    """Asserted through `AgentInfo` — what the MODEL is actually offered on
    the wire — rather than by reaching into the agent's private toolset.
    Each tool must also carry a description (its docstring), or the model has
    only a bare name to choose from."""
    seen: dict[str, str | None] = {}

    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.update({t.name: t.description for t in info.function_tools})
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_read_tools(agent)
    agent.run_sync("go", deps=_deps())

    assert {"list_workflows", "get_workflow", "list_templates", "get_template",
            "list_entity_models", "get_entity_model"} <= set(seen)
    assert all(seen[n] for n in seen), seen
    # The docstrings are the only place the model learns WHEN to read a model:
    # before it authors a section, not after the fields come back empty.
    assert "section" in (seen["list_entity_models"] or "").lower()
    assert "section" in (seen["get_entity_model"] or "").lower()


def test_register_proposal_tools_offers_propose_create_draft_with_a_description(fake_dc):
    """Same `AgentInfo` check for the write-proposal side. The docstring is
    what steers the model to propose instead of claiming it created the
    workflow, so a bare name is not enough."""
    seen: dict[str, str | None] = {}

    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.update({t.name: t.description for t in info.function_tools})
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_proposal_tools(agent)
    agent.run_sync("go", deps=_deps())

    assert "propose_create_draft" in seen
    assert seen["propose_create_draft"]


def test_register_proposal_tools_offers_propose_patch_with_the_op_vocabulary(fake_dc):
    """The op names live in `propose_patch`'s docstring because that docstring
    IS the tool schema's description — the model has no other way to learn the
    vocabulary, and an op it invents is rejected."""
    seen: dict[str, str | None] = {}

    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.update({t.name: t.description for t in info.function_tools})
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_proposal_tools(agent)
    agent.run_sync("go", deps=_deps("editor"))

    assert "propose_patch" in seen
    description = seen["propose_patch"] or ""
    for op in ("add_stage", "rename_stage", "set_stage_kind", "remove_stage",
               "add_move", "update_move", "remove_move", "add_step",
               "update_step", "remove_step", "add_section", "update_section",
               "remove_section", "set_channel_access"):
        assert op in description, op
