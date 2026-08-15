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
from app.chat.tools import register_read_tools
from app.workflows import definitions as defs

models.ALLOW_MODEL_REQUESTS = False

TENANT = "acme"


def _agent_that_calls(tool_name: str, args: dict) -> Agent:
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool_name, args)])
        for part in getattr(messages[-1], "parts", []):
            if isinstance(part, ToolReturnPart):
                return ModelResponse(parts=[TextPart(str(part.content))])
        return ModelResponse(parts=[TextPart("no tool return")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
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


# --- registration ---------------------------------------------------------


def test_register_read_tools_offers_all_four_tools_to_the_model(fake_dc):
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

    assert {"list_workflows", "get_workflow", "list_templates", "get_template"} <= set(seen)
    assert all(seen[n] for n in seen), seen
