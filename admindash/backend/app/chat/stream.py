import json
from typing import AsyncIterator

from pydantic_ai import Agent, TextPart
from pydantic_ai import (
    FunctionToolCallEvent,
    PartDeltaEvent,
    TextPartDelta,
)

from app.chat.datacore import ChatDeps


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _agent_can_stream(agent: Agent) -> bool:
    """Return True if the agent's model supports streaming (request_stream).

    FunctionModel without a stream_function cannot stream; all real LLM models can.
    This check avoids an AssertionError when node.stream() is called against a
    FunctionModel used only in tests.
    """
    m = agent.model
    if hasattr(m, "stream_function") and m.stream_function is None:
        return False
    return True


async def sse_chat(
    agent: Agent, deps: ChatDeps, message: str, history: list
) -> AsyncIterator[str]:
    can_stream = _agent_can_stream(agent)
    try:
        async with agent.iter(message, deps=deps, message_history=history) as run:
            async for node in run:
                if Agent.is_model_request_node(node):
                    if can_stream:
                        async with node.stream(run.ctx) as stream:
                            async for event in stream:
                                if isinstance(event, PartDeltaEvent) and isinstance(
                                    event.delta, TextPartDelta
                                ):
                                    delta = event.delta.content_delta
                                    if delta:
                                        yield _sse({"type": "token", "text": delta})
                    # else: non-streaming model — text will come from CallToolsNode below
                elif Agent.is_call_tools_node(node):
                    if not can_stream:
                        # Emit text parts from model response (non-streaming fallback)
                        for part in node.model_response.parts:
                            if isinstance(part, TextPart) and part.content:
                                yield _sse({"type": "token", "text": part.content})
                    async with node.stream(run.ctx) as stream:
                        async for event in stream:
                            if isinstance(event, FunctionToolCallEvent):
                                yield _sse({"type": "tool", "name": event.part.tool_name})
        for proposal in deps.pending_proposals:
            yield _sse({"type": "proposal", "proposal": proposal})
        yield _sse({"type": "done"})
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the UI
        yield _sse({"type": "error", "message": str(exc)})
        yield _sse({"type": "done"})
