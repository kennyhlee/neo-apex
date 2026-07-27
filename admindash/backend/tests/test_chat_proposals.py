import httpx
import pytest
import respx

from pydantic_ai import Agent, models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart

from app.chat.tools import ChatDeps, register_read_tools, register_write_tools

models.ALLOW_MODEL_REQUESTS = False
pytestmark = pytest.mark.anyio
DATACORE = "http://datacore.test"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _agent_calling(tool: str, args: dict) -> Agent:
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool, args)])
        return ModelResponse(parts=[TextPart("please confirm")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_read_tools(agent)
    register_write_tools(agent)
    return agent


async def test_propose_create_student_does_not_write():
    agent = _agent_calling("propose_create_student",
                           {"first_name": "Ada", "last_name": "Lovelace"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        dup = respx.post(
            f"{DATACORE}/api/entities/t1/student/duplicate-check"
        ).mock(return_value=httpx.Response(200, json={"duplicates": []}))
        create = respx.post(f"{DATACORE}/api/entities/t1/student").mock(
            return_value=httpx.Response(200, json={"entity_id": "stu_9"}))
        await agent.run("add student", deps=deps)
    assert dup.called
    assert not create.called          # write must NOT happen from the tool
    assert len(deps.pending_proposals) == 1
    p = deps.pending_proposals[0]
    assert p["action"] == "create_student"
    assert p["fields"]["first_name"] == "Ada"
