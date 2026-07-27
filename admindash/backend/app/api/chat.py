from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import require_authenticated_user
from app.chat.agent import build_chat_agent, to_message_history
from app.chat.datacore import ChatDeps
from app.chat.stream import sse_chat
from app.config import settings

router = APIRouter()


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []
    message_count: int = 0


@router.post("/chat")
async def chat(body: ChatRequest, user=Depends(require_authenticated_user)):
    if body.message_count >= settings.chat_session_message_cap:
        raise HTTPException(status_code=429, detail="Conversation limit reached; start a new chat.")
    deps = ChatDeps(
        tenant_id=user["tenant_id"],
        token=user["_token"],
        datacore_url=settings.datacore_url,
    )
    agent = build_chat_agent()
    history = to_message_history(
        [t.model_dump() for t in body.history], settings.chat_history_turns
    )
    return StreamingResponse(
        sse_chat(agent, deps, body.message, history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
