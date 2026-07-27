import httpx
import pytest
import respx

from pydantic_ai import Agent
from pydantic_ai import models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.messages import ToolReturnPart

from app.chat.tools import ChatDeps, register_read_tools, _resolve_field, _norm_value
from app.chat.datacore import sql_literal

models.ALLOW_MODEL_REQUESTS = False
pytestmark = pytest.mark.anyio

DATACORE = "http://datacore.test"


def test_sql_literal_escapes_quotes():
    assert sql_literal("O'Brien") == "'O''Brien'"


def _agent_that_calls(tool_name: str, args: dict) -> Agent:
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool_name, args)])
        # After tool execution, extract tool result from messages
        if len(messages) > 1:
            last_msg = messages[-1]
            if hasattr(last_msg, 'parts') and last_msg.parts:
                for part in last_msg.parts:
                    # Extract content from ToolReturnPart only
                    if isinstance(part, ToolReturnPart):
                        return ModelResponse(parts=[TextPart(part.content)])
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_read_tools(agent)
    return agent


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_find_student_queries_datacore():
    agent = _agent_that_calls("find_student", {"last_name": "Lovelace"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE,
                    pending_proposals=[])
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query").mock(
            return_value=httpx.Response(
                200, json={"data": [{"entity_id": "stu_1", "first_name": "Ada",
                                     "last_name": "Lovelace"}], "total": 1})
        )
        result = await agent.run("find Lovelace", deps=deps)
    assert route.called
    sent = route.calls.last.request
    assert b"entity_type = 'student'" in sent.content
    assert b"'%Lovelace%'" in sent.content
    assert "Ada" in result.output


def test_resolve_field_maps_phrase_to_field():
    fields = {"preferred_pickup", "medical_conditions", "school"}
    assert _resolve_field("Preferred Pickup", fields) == "preferred_pickup"
    assert _resolve_field("school", fields) == "school"
    assert _resolve_field("pickup", fields) == "preferred_pickup"  # partial
    assert _resolve_field("nonexistent", fields) is None


def test_norm_value_decodes_selection_array():
    assert _norm_value('["Aunt"]') == "Aunt"
    assert _norm_value('["Aunt", "Mom"]') == "Aunt, Mom"
    assert _norm_value("Cherrywood") == "Cherrywood"
    assert _norm_value(None) == ""


_STUDENTS = {
    "data": [
        {"entity_id": "s1", "first_name": "Ann", "last_name": "Lee",
         "preferred_pickup": '["Aunt"]', "school": "Cherrywood"},
        {"entity_id": "s2", "first_name": "Bob", "last_name": "Ng",
         "preferred_pickup": "", "school": "Oakdale"},
        {"entity_id": "s3", "first_name": "Cy", "last_name": "Fox",
         "preferred_pickup": '["Mom"]', "school": "Cherrywood"},
    ],
    "total": 3,
}


async def test_search_students_contains_custom_field():
    agent = _agent_that_calls(
        "search_students", {"field": "preferred pickup", "value": "Aunt", "match": "contains"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query").mock(
            return_value=httpx.Response(200, json=_STUDENTS))
        result = await agent.run("who has Aunt pickup", deps=deps)
    # SELECT excludes the embedding vector
    assert b"EXCLUDE (vector)" in route.calls.last.request.content
    assert "Ann" in result.output          # preferred_pickup ["Aunt"] matches
    assert "Bob" not in result.output      # empty pickup
    assert "Cy" not in result.output       # ["Mom"] doesn't contain Aunt


async def test_search_students_set_matches_non_empty():
    agent = _agent_that_calls(
        "search_students", {"field": "preferred_pickup", "match": "set"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        respx.post(f"{DATACORE}/api/query").mock(
            return_value=httpx.Response(200, json=_STUDENTS))
        result = await agent.run("who has pickup set", deps=deps)
    assert "Ann" in result.output          # has pickup
    assert "Cy" in result.output           # has pickup
    assert "Bob" not in result.output      # empty pickup
