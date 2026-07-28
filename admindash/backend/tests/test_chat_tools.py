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


async def test_describe_schema_lists_actual_columns_not_just_model():
    """A custom field present in the records but absent from the model definition
    must still be reported (data-driven), annotated with model types where known."""
    agent = _agent_that_calls("describe_schema", {"entity_type": "student"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        table = _json.loads(request.content).get("table")
        if table == "models":
            return httpx.Response(200, json={"data": [{
                "entity_type": "student", "_status": "active", "_version": 3,
                "model_definition": {
                    "base_fields": [{"name": "first_name", "type": "str"}],
                    "custom_fields": [],  # model does NOT declare 'school'
                }}], "total": 1})
        # entities sample row — 'school' is a live column absent from the model
        return httpx.Response(200, json={"data": [{
            "entity_id": "s1", "entity_type": "student", "_status": "active",
            "first_name": "Ada", "school": "Cherrywood", "vector": [0.0]}], "total": 1})

    with respx.mock:
        respx.post(f"{DATACORE}/api/query/readonly").mock(side_effect=handler)
        result = await agent.run("fields", deps=deps)
    assert "school" in result.output          # the fix: data column not in model
    assert "first_name:str" in result.output  # base field annotated from model
    assert "vector" not in result.output      # structural/raw column hidden


async def test_describe_schema_no_arg_lists_entity_types():
    agent = _agent_that_calls("describe_schema", {})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json={
                "data": [{"entity_type": "student"}, {"entity_type": "program"}],
                "total": 2}))
        result = await agent.run("types", deps=deps)
    assert "student" in result.output and "program" in result.output
