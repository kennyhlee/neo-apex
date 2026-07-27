import httpx
import pytest
import respx

from pydantic_ai import Agent
from pydantic_ai import models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.messages import ToolReturnPart

from app.chat.tools import ChatDeps, register_read_tools
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
