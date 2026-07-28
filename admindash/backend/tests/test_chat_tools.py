import httpx
import pytest
import respx

from pydantic_ai import Agent, models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.messages import ToolReturnPart

from app.chat.tools import ChatDeps, register_read_tools

models.ALLOW_MODEL_REQUESTS = False
pytestmark = pytest.mark.anyio
DATACORE = "http://datacore.test"


def _agent_that_calls(tool_name: str, args: dict) -> Agent:
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool_name, args)])
        last = messages[-1]
        for part in getattr(last, "parts", []):
            if isinstance(part, ToolReturnPart):
                return ModelResponse(parts=[TextPart(part.content)])
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_read_tools(agent)
    return agent


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_run_query_returns_rows():
    agent = _agent_that_calls("run_query", {"sql": "SELECT first_name FROM data"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json={
                "data": [{"entity_id": "s1", "first_name": "Ada"}], "total": 1}))
        result = await agent.run("query", deps=deps)
    assert route.called
    assert "Ada" in result.output


async def test_run_query_surfaces_400_for_self_correction():
    agent = _agent_that_calls("run_query", {"sql": "DELETE FROM data"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(400, json={"detail": "Only SELECT/WITH read queries are allowed."}))
        result = await agent.run("bad query", deps=deps)
    assert "SELECT" in result.output  # error text fed back for the model to fix


async def test_describe_schema_lists_fields():
    agent = _agent_that_calls("describe_schema", {"entity_type": "student"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    models_row = {"data": [{
        "entity_type": "student", "_status": "active", "_version": 2,
        "model_definition": {
            "base_fields": [{"name": "first_name", "type": "str"}],
            "custom_fields": [{"name": "preferred_pickup", "type": "selection"}],
        }}], "total": 1}
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json=models_row))
        result = await agent.run("fields", deps=deps)
    import json as _json
    assert _json.loads(route.calls.last.request.content)["table"] == "models"
    assert "first_name" in result.output
    assert "preferred_pickup" in result.output
