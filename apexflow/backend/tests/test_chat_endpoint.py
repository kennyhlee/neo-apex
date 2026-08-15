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
from pydantic_ai.models.function import FunctionModel

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


def test_chat_endpoint_streams_history_without_error(client, monkeypatch):
    """A non-empty history must round-trip through to_message_history into a
    real run — a malformed history would surface as an `error` event."""
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
