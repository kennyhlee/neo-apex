# apexflow/backend/app/api/chat.py
"""Chat assistant route (Plan 4 / Task 3).

`POST /api/workflows/{tenant_id}/chat` streams SSE
(token|tool|proposal|done|error). The tenant comes from the PATH, not the
token, and `require_staff_tenant` is what makes the two agree — same
dependency every other `/api/workflows/{tenant_id}/...` route uses.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import require_staff_tenant
from app.chat.agent import build_chat_agent, to_message_history
from app.chat.deps import ChatDeps
from app.chat.stream import sse_chat
from app.config import settings

router = APIRouter(prefix="/api/workflows", tags=["chat"])


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatContext(BaseModel):
    page: Literal["list", "templates", "editor"] = "list"
    entity_id: str | None = None


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []
    message_count: int = 0
    context: ChatContext = ChatContext()


@router.post("/{tenant_id}/chat")
async def chat(tenant_id: str, body: ChatRequest,
               user: dict = Depends(require_staff_tenant)):
    if body.message_count >= settings.chat_session_message_cap:
        raise HTTPException(status_code=429,
                            detail="Conversation limit reached; start a new chat.")
    deps = ChatDeps(tenant_id=tenant_id, token=user.get("_token"),
                    page=body.context.page, entity_id=body.context.entity_id)
    # Task 6 adds: editor_context loading when page == 'editor'.
    agent = build_chat_agent()
    history = to_message_history([t.model_dump() for t in body.history],
                                 settings.chat_history_turns)
    return StreamingResponse(
        sse_chat(agent, deps, body.message, history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
