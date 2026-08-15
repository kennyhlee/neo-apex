# apexflow/backend/tests/test_chat_endpoint.py
"""Route-level tests for the chat assistant endpoint (Plan 4 / Task 3).

Ported from admindash/backend/tests/test_chat_endpoint.py — same pattern:
`models.ALLOW_MODEL_REQUESTS = False` plus a `FunctionModel` so the suite
NEVER reaches a real provider, and `build_chat_agent` is monkeypatched on
the route module (not on app.chat.agent) because the route resolves it
through its own module globals.

Auth follows tests/test_designer_api.py: override `require_authenticated_user`
at the app level rather than minting a real JWT. The route's dependency is
`require_staff_tenant`, which is a thin role+tenant check layered on top of
`require_authenticated_user`, so overriding the inner dependency exercises
the real staff/tenant gate against the overridden identity.
"""
import json

import pytest
from fastapi.testclient import TestClient
from pydantic_ai import models
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

import app.api.chat as chat_api
from app.auth import require_authenticated_user
from app.chat.agent import build_chat_agent, to_message_history
from app.main import app

models.ALLOW_MODEL_REQUESTS = False

TENANT = "t1"
CHAT_URL = f"/api/workflows/{TENANT}/chat"


@pytest.fixture
def client():
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


async def _stream_text(messages, info):
    yield "Hello from the assistant."


def _text_only_agent():
    return build_chat_agent(model=FunctionModel(stream_function=_stream_text))


def _events(body: str) -> list[dict]:
    return [json.loads(line[5:]) for line in body.splitlines() if line.startswith("data:")]


# --- to_message_history ---------------------------------------------------


def test_to_message_history_trims():
    turns = [{"role": "user", "content": f"m{i}"} for i in range(20)]
    msgs = to_message_history(turns, limit=4)
    assert len(msgs) == 4


def test_to_message_history_keeps_the_most_recent_turns():
    """Trimming must drop the OLDEST turns — a trim that kept the first N
    would leave the model reasoning about a stale prefix of the chat."""
    turns = [{"role": "user", "content": f"m{i}"} for i in range(20)]
    msgs = to_message_history(turns, limit=3)
    contents = [p.content for m in msgs for p in m.parts]
    assert contents == ["m17", "m18", "m19"]


def test_to_message_history_maps_roles_to_request_and_response():
    from pydantic_ai import ModelRequest, ModelResponse

    msgs = to_message_history(
        [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}], limit=8
    )
    assert isinstance(msgs[0], ModelRequest)
    assert isinstance(msgs[1], ModelResponse)


# --- endpoint -------------------------------------------------------------


def test_chat_endpoint_streams_tokens(client, monkeypatch):
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    resp = client.post(
        CHAT_URL,
        json={"message": "hi", "history": [], "message_count": 0,
              "context": {"page": "list"}},
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _events(resp.text)
    assert any(e["type"] == "token" for e in events)
    assert events[-1]["type"] == "done"
    text = "".join(e.get("text", "") for e in events if e["type"] == "token")
    assert "Hello" in text


def test_chat_endpoint_streams_history_without_error(client, fake_dc, monkeypatch):
    """A non-empty history must round-trip through to_message_history into a
    real run — a malformed history would surface as an `error` event.

    `fake_dc` because this request claims `page: "editor"`: the route now loads
    the editor context server-side, and without the fake that read would try a
    real DataCore connection. `def_1` does not exist in the fake, which is the
    point — a stale entity_id degrades to prose inside `load_editor_context`
    and must not put an `error` frame on the wire."""
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    resp = client.post(
        CHAT_URL,
        json={
            "message": "and then?",
            "history": [
                {"role": "user", "content": "make a signup workflow"},
                {"role": "assistant", "content": "sure"},
            ],
            "message_count": 2,
            "context": {"page": "editor", "entity_id": "def_1"},
        },
    )
    assert resp.status_code == 200
    events = _events(resp.text)
    assert not [e for e in events if e["type"] == "error"], events
    assert events[-1]["type"] == "done"


def test_chat_endpoint_reports_model_failure_as_error_then_done(client, monkeypatch):
    """The SSE stream is ALWAYS terminated by `done`, including the failure
    path — the UI's reader loop only clears its pending state on `done`, so a
    stream that ends after `error` would leave the composer stuck."""
    async def _boom(messages, info):
        raise RuntimeError("model exploded")
        yield ""  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(
        chat_api, "build_chat_agent",
        lambda: build_chat_agent(model=FunctionModel(stream_function=_boom)),
    )
    resp = client.post(
        CHAT_URL,
        json={"message": "hi", "history": [], "message_count": 0,
              "context": {"page": "list"}},
    )
    assert resp.status_code == 200
    events = _events(resp.text)
    assert [e["type"] for e in events][-2:] == ["error", "done"]
    assert "model exploded" in events[-2]["message"]


def test_chat_endpoint_reports_agent_construction_failure_as_error_then_done(
    client, monkeypatch
):
    """Agent construction happens INSIDE the stream, not before it.

    `build_chat_agent()` resolves the `"anthropic:..."` model string eagerly,
    so an unset ANTHROPIC_API_KEY raises `UserError` at construction. If that
    ran before `StreamingResponse` the client would get a bare 500 with zero
    `data:` frames — violating the plan's global constraint that the stream is
    ALWAYS terminated by `done`. The UI's reader clears its pending state only
    on `done`, so that 500 leaves the composer stuck.
    """
    def _explode():
        raise RuntimeError("Set the `ANTHROPIC_API_KEY` environment variable")

    monkeypatch.setattr(chat_api, "build_chat_agent", _explode)
    resp = client.post(
        CHAT_URL,
        json={"message": "hi", "history": [], "message_count": 0,
              "context": {"page": "list"}},
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _events(resp.text)
    assert [e["type"] for e in events] == ["error", "done"]
    assert "ANTHROPIC_API_KEY" in events[0]["message"]


def test_chat_endpoint_reports_history_failure_as_error_then_done(client, monkeypatch):
    """Same guarantee for the other pre-run step inside the wrapper."""
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)

    def _bad_history(turns, limit):
        raise ValueError("history is malformed")

    monkeypatch.setattr(chat_api, "to_message_history", _bad_history)
    resp = client.post(
        CHAT_URL,
        json={"message": "hi", "history": [{"role": "user", "content": "x"}],
              "message_count": 0, "context": {"page": "list"}},
    )
    assert resp.status_code == 200
    events = _events(resp.text)
    assert [e["type"] for e in events] == ["error", "done"]
    assert "history is malformed" in events[0]["message"]


def test_chat_endpoint_rejects_over_cap(client, monkeypatch):
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    resp = client.post(
        CHAT_URL,
        json={"message": "hi", "history": [], "message_count": 999,
              "context": {"page": "list"}},
    )
    assert resp.status_code == 429


def test_chat_endpoint_rejects_tenant_mismatch(client, monkeypatch):
    """require_staff_tenant, not merely require_authenticated_user: the
    overridden identity is scoped to TENANT, so another tenant's path 403s."""
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    resp = client.post(
        "/api/workflows/other-tenant/chat",
        json={"message": "hi", "history": [], "message_count": 0,
              "context": {"page": "list"}},
    )
    assert resp.status_code == 403


# --- proposals over the wire ----------------------------------------------
#
# `sse_chat` drains `deps.pending_proposals` after the run, so a proposal tool
# only reaches the UI if the route builds deps the tool can append to AND the
# stream emits them. These tests drive the REAL `build_chat_agent` (proposal
# tools included) with a streaming FunctionModel that calls the tool, so the
# route -> deps -> tool -> queue -> SSE path is exercised end to end.

_SKELETON_MACHINE = {
    "states": [
        {"state_id": "draft", "name": "Draft", "kind": "initial"},
        {"state_id": "done", "name": "Done", "kind": "terminal"},
    ],
    "transitions": [
        {"transition_id": "t_submit", "from": "draft", "to": "done",
         "action": "submit", "actor": "family", "guards": [], "effects": []},
    ],
}


def _agent_that_proposes(**over):
    args = {"name": "Signup", "machine": _SKELETON_MACHINE, "steps": [],
            "summary": ["Draft -> submit -> done"]}
    args.update(over)

    async def _stream(messages, info):
        if len(messages) == 1:
            yield {0: DeltaToolCall(name="propose_create_draft",
                                    json_args=json.dumps(args))}
        else:
            yield "The create-draft card is ready — review it and confirm."

    return lambda: build_chat_agent(model=FunctionModel(stream_function=_stream))


def test_chat_endpoint_emits_a_proposal_frame_when_the_model_proposes(
    client, monkeypatch
):
    monkeypatch.setattr(chat_api, "build_chat_agent", _agent_that_proposes())
    resp = client.post(
        CHAT_URL,
        json={"message": "build me a signup workflow", "history": [],
              "message_count": 0, "context": {"page": "list"}},
    )
    assert resp.status_code == 200
    events = _events(resp.text)
    assert not [e for e in events if e["type"] == "error"], events
    proposals = [e for e in events if e["type"] == "proposal"]
    assert len(proposals) == 1, events
    p = proposals[0]["proposal"]
    assert p["action"] == "create_draft"
    assert p["name"] == "Signup"
    assert p["channel_access"] == "staff_only"
    # by_alias survives the round trip to the browser: `from`, not `from_`.
    assert p["machine"]["transitions"][0]["from"] == "draft"
    # The proposal must land BEFORE `done` — the UI renders the card off the
    # frame and clears its pending state on `done`.
    types = [e["type"] for e in events]
    assert types.index("proposal") < types.index("done")
    assert types[-1] == "done"


def test_chat_endpoint_emits_no_proposal_frame_when_the_tool_rejects(
    client, monkeypatch
):
    """A rejected payload comes back to the model as text; nothing is queued,
    so the admin is never shown a card for a definition that would not parse."""
    monkeypatch.setattr(chat_api, "build_chat_agent",
                        _agent_that_proposes(channel_access="public"))
    resp = client.post(
        CHAT_URL,
        json={"message": "build me a signup workflow", "history": [],
              "message_count": 0, "context": {"page": "list"}},
    )
    assert resp.status_code == 200
    events = _events(resp.text)
    assert not [e for e in events if e["type"] == "proposal"], events
    assert not [e for e in events if e["type"] == "error"], events
    assert events[-1]["type"] == "done"


# --- editor context -------------------------------------------------------
#
# The client sends only `{page, entity_id}`. Everything the model is told about
# the open draft is loaded SERVER-SIDE from the row, so a client cannot dictate
# what the assistant believes it is editing (and cannot name another tenant's
# row into the prompt — the read is tenant-scoped).


def _seed_editor_definition(fake_dc, name="Enrollment", status="draft"):
    fake_dc.set_model(TENANT, "student", {
        "base_fields": [{"name": "first_name", "type": "str", "required": True}],
        "custom_fields": [],
    })
    return fake_dc.dc_create(TENANT, "workflow_definition", {
        "definition_id": "wd-editor", "name": name, "version": 1, "status": status,
        "lineage_status": "active", "channel_access": "staff_only",
        "machine": json.dumps({
            "states": [{"state_id": "draft", "name": "Draft", "kind": "initial"},
                       {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"}],
            "transitions": [{"transition_id": "t_submit", "from": "draft",
                             "to": "enrolled", "action": "submit", "actor": "family",
                             "guards": [], "effects": []}],
        }),
        "steps": json.dumps([{
            "step_id": "student_details", "type": "form", "title": "Student details",
            "required": True, "blocking": True, "available_in": ["draft"],
            "config": {"sections": [{
                "section_id": "student_section", "entity_model": "student",
                "fields": [{"name": "first_name", "required": True}],
                "mode": "create",
            }]},
        }]),
    })["entity_id"]


def _capturing_agent(seen: list):
    async def _stream(messages, info):
        seen.append(messages)
        yield "ok"

    return lambda: build_chat_agent(model=FunctionModel(stream_function=_stream))


def _system_text(messages) -> str:
    from pydantic_ai.messages import SystemPromptPart

    return "\n".join(p.content for m in messages for p in getattr(m, "parts", [])
                     if isinstance(p, SystemPromptPart))


def test_chat_endpoint_puts_the_open_drafts_machine_in_the_system_prompt(
    client, fake_dc, monkeypatch
):
    """The editor-context wiring test: `page: "editor"` + an entity_id means
    the model is handed the draft's machine, steps, model fields and current
    validation errors BEFORE it answers — that is what makes `propose_patch`'s
    ids real rather than guessed."""
    eid = _seed_editor_definition(fake_dc)
    seen: list = []
    monkeypatch.setattr(chat_api, "build_chat_agent", _capturing_agent(seen))

    resp = client.post(
        CHAT_URL,
        json={"message": "add a review stage", "history": [], "message_count": 0,
              "context": {"page": "editor", "entity_id": eid}},
    )

    assert resp.status_code == 200
    assert not [e for e in _events(resp.text) if e["type"] == "error"], resp.text
    prompt = _system_text(seen[0])
    assert "Current editor context" in prompt
    assert '"name": "Enrollment"' in prompt
    assert '"read_only": false' in prompt
    assert "student_details" in prompt          # steps
    assert "enrolled" in prompt                 # machine states
    assert '"from": "draft"' in prompt          # alias, not from_
    assert "first_name" in prompt               # entity_model_fields


def test_chat_endpoint_omits_editor_context_off_the_editor_page(
    client, fake_dc, monkeypatch
):
    """`page: "list"` must not load a definition at all — even if the client
    sends an entity_id alongside it, the assistant is told no draft is open."""
    eid = _seed_editor_definition(fake_dc)
    seen: list = []
    monkeypatch.setattr(chat_api, "build_chat_agent", _capturing_agent(seen))

    client.post(
        CHAT_URL,
        json={"message": "hi", "history": [], "message_count": 0,
              "context": {"page": "list", "entity_id": eid}},
    )

    prompt = _system_text(seen[0])
    assert "Current editor context" not in prompt
    assert "no draft is open" in prompt


def test_chat_endpoint_reports_editor_context_failure_as_error_then_done(
    client, fake_dc, monkeypatch
):
    """The context load does I/O, so it happens INSIDE `_guarded_sse_chat`.

    Done in the handler body it would raise before `StreamingResponse` and the
    client would get a bare 500 with zero `data:` frames — the UI clears its
    pending state only on `done`, so the composer would hang. Same guarantee as
    agent construction and history mapping.
    """
    eid = _seed_editor_definition(fake_dc)

    def _explode(*a, **kw):
        raise RuntimeError("editor context exploded")

    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    monkeypatch.setattr(chat_api, "load_editor_context", _explode)

    resp = client.post(
        CHAT_URL,
        json={"message": "hi", "history": [], "message_count": 0,
              "context": {"page": "editor", "entity_id": eid}},
    )

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _events(resp.text)
    assert [e["type"] for e in events] == ["error", "done"]
    assert "editor context exploded" in events[0]["message"]


def test_chat_endpoint_emits_a_patch_proposal_frame_from_the_editor(
    client, fake_dc, monkeypatch
):
    """End to end: route -> editor deps -> propose_patch -> queue -> SSE."""
    eid = _seed_editor_definition(fake_dc)

    async def _stream(messages, info):
        if len(messages) == 1:
            yield {0: DeltaToolCall(name="propose_patch", json_args=json.dumps({
                "ops": [{"op": "add_stage", "stage_id": "review", "name": "Review"}],
                "summary": ["Added a Review stage"],
            }))}
        else:
            yield "The patch card is ready — review it and apply."

    monkeypatch.setattr(
        chat_api, "build_chat_agent",
        lambda: build_chat_agent(model=FunctionModel(stream_function=_stream)))

    resp = client.post(
        CHAT_URL,
        json={"message": "add a review stage", "history": [], "message_count": 0,
              "context": {"page": "editor", "entity_id": eid}},
    )

    assert resp.status_code == 200
    events = _events(resp.text)
    assert not [e for e in events if e["type"] == "error"], events
    proposals = [e for e in events if e["type"] == "proposal"]
    assert len(proposals) == 1, events
    p = proposals[0]["proposal"]
    assert p["action"] == "patch"
    assert p["ops"][0] == {"op": "add_stage", "stage_id": "review",
                           "name": "Review", "kind": "active"}
    types = [e["type"] for e in events]
    assert types.index("proposal") < types.index("done")
    assert types[-1] == "done"


def test_chat_endpoint_refuses_a_patch_against_a_read_only_version(
    client, fake_dc, monkeypatch
):
    """The route half of the read-only guard: a published row loads with
    `read_only: true`, the route stashes that on the deps, and `propose_patch`
    refuses — so NO proposal frame reaches the browser.

    Without this the card renders on a published row, Apply writes into a
    draft store whose mutators no-op off-draft, and the admin is told the
    change was applied. The frontend disables Apply for exactly this case;
    this stops the offer being made at all.
    """
    eid = _seed_editor_definition(fake_dc, status="published")
    tool_output: list[str] = []

    async def _stream(messages, info):
        if len(messages) == 1:
            yield {0: DeltaToolCall(name="propose_patch", json_args=json.dumps({
                "ops": [{"op": "add_stage", "stage_id": "review", "name": "Review"}],
                "summary": ["Added a Review stage"],
            }))}
        else:
            from pydantic_ai.messages import ToolReturnPart

            tool_output.extend(
                str(p.content) for m in messages for p in getattr(m, "parts", [])
                if isinstance(p, ToolReturnPart)
            )
            yield "That version is read-only — create a new draft version first."

    monkeypatch.setattr(
        chat_api, "build_chat_agent",
        lambda: build_chat_agent(model=FunctionModel(stream_function=_stream)))

    resp = client.post(
        CHAT_URL,
        json={"message": "add a review stage", "history": [], "message_count": 0,
              "context": {"page": "editor", "entity_id": eid}},
    )

    assert resp.status_code == 200
    events = _events(resp.text)
    assert not [e for e in events if e["type"] == "error"], events
    assert not [e for e in events if e["type"] == "proposal"], events
    assert events[-1]["type"] == "done"
    # The model was told WHY, in terms it can act on.
    assert any("read-only" in out.lower() for out in tool_output), tool_output


def test_context_read_only_reads_the_flag_out_of_the_block():
    """`context_read_only` is the one place that knows the block's shape, so
    the prompt's `read_only` and the tool guard cannot disagree."""
    from app.chat.context import context_read_only

    assert context_read_only(json.dumps({"read_only": True})) is True
    assert context_read_only(json.dumps({"read_only": False})) is False
    # Degraded blocks are prose, not JSON — permissive, since they say nothing
    # about status and the save PUT 409s on a non-draft regardless.
    assert context_read_only("The open draft (abc) could not be loaded: boom") is False
    assert context_read_only(json.dumps({"name": "x"})) is False


# --- agent construction ---------------------------------------------------


def test_primitives_text_lists_every_guard_and_effect_with_params():
    from app.chat.agent import primitives_text
    from app.workflows.primitives import EFFECTS, GUARDS
    from app.workflows.validate import PARAM_SPECS

    text = primitives_text()
    for name in list(GUARDS) + list(EFFECTS):
        assert name in text, f"{name} missing from primitives catalog"
    # Param names and their optionality must render, or the model will invent
    # param shapes. `items_in_status` has one required and two optional params.
    assert "status:string_or_list" in text
    assert "quantifier:string?" in text
    # A primitive with no PARAM_SPECS entry renders with empty parens.
    assert "all_blocking_items_complete()" in text
    assert set(PARAM_SPECS) <= set(GUARDS) | set(EFFECTS)
