import json
from typing import AsyncIterator

from pydantic_ai import Agent, TextPart
from pydantic_ai import (
    FunctionToolCallEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPartDelta,
)

from app.chat.datacore import ChatDeps


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def sse_chat(
    agent: Agent, deps: ChatDeps, message: str, history: list
) -> AsyncIterator[str]:
    try:
        async with agent.iter(message, deps=deps, message_history=history) as run:
            async for node in run:
                if Agent.is_model_request_node(node):
                    async with node.stream(run.ctx) as stream:
                        async for event in stream:
                            if isinstance(event, PartDeltaEvent) and isinstance(
                                event.delta, TextPartDelta
                            ):
                                delta = event.delta.content_delta
                                if delta:
                                    yield _sse({"type": "token", "text": delta})
                            elif isinstance(event, PartStartEvent) and isinstance(
                                event.part, TextPart
                            ):
                                if event.part.content:
                                    yield _sse({"type": "token", "text": event.part.content})
                elif Agent.is_call_tools_node(node):
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
