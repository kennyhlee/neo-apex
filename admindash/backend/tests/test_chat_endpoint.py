import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from pydantic_ai import models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart

import app.api.chat as chat_api
from app.chat.agent import build_chat_agent, to_message_history
from app.main import app

models.ALLOW_MODEL_REQUESTS = False
DATACORE = "http://localhost:5800"


def test_to_message_history_trims():
    turns = [{"role": "user", "content": f"m{i}"} for i in range(20)]
    msgs = to_message_history(turns, limit=4)
    assert len(msgs) == 4


def _text_only_agent():
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart("Hello from the assistant.")])
    return build_chat_agent(model=FunctionModel(responder))


def test_chat_endpoint_streams_tokens(monkeypatch):
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    client = TestClient(app)
    with respx.mock:
        respx.get(f"{DATACORE}/auth/me").mock(
            return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"}))
        resp = client.post(
            "/api/chat",
            headers={"Authorization": "Bearer tok"},
            json={"message": "hi", "history": [], "message_count": 0},
        )
    assert resp.status_code == 200
    body = resp.text
    assert "text/event-stream" in resp.headers["content-type"]
    tokens = [json.loads(l[5:]) for l in body.splitlines() if l.startswith("data:")]
    assert any(t["type"] == "token" for t in tokens)
    assert any(t["type"] == "done" for t in tokens)
    assert "Hello" in "".join(t.get("text", "") for t in tokens if t["type"] == "token")


def test_chat_endpoint_rejects_over_cap(monkeypatch):
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    client = TestClient(app)
    with respx.mock:
        respx.get(f"{DATACORE}/auth/me").mock(
            return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"}))
        resp = client.post(
            "/api/chat",
            headers={"Authorization": "Bearer tok"},
            json={"message": "hi", "history": [], "message_count": 999},
        )
    assert resp.status_code == 429
