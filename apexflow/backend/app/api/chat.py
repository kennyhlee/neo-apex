# apexflow/backend/app/api/chat.py
"""Chat assistant route (Plan 4 / Task 3).

`POST /api/workflows/{tenant_id}/chat` streams SSE
(token|tool|proposal|done|error). The tenant comes from the PATH, not the
token, and `require_staff_tenant` is what makes the two agree — same
dependency every other `/api/workflows/{tenant_id}/...` route uses.

Agent construction and the editor-context load happen INSIDE the stream
(`_guarded_sse_chat`), not in the handler body — see that function for why.

The request's `context` carries only `{page, entity_id}`. Everything the model
is told about the open draft is read server-side from the row
(`app/chat/context.py`), tenant-scoped by the already-verified path tenant.
"""
from typing import AsyncIterator, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import require_staff_tenant
from app.chat.agent import build_chat_agent, to_message_history
from app.chat.context import context_read_only, load_editor_context
from app.chat.deps import ChatDeps
# `_sse` is imported rather than re-implemented so this module cannot drift
# from the wire format `sse_chat` emits: one formatter, one protocol. The
# leading underscore is respected in the sense that matters — stream.py stays
# a verbatim port of admindash's, and the wrapper below lives here, not there.
from app.chat.stream import _sse, sse_chat
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


async def _guarded_sse_chat(
    deps: ChatDeps, message: str, turns: list[dict]
) -> AsyncIterator[str]:
    """Load the editor context and build the agent and message history INSIDE
    the stream, so that a failure in any of them is reported as `error` +
    `done` rather than as a bare 500 with no SSE frames at all.

    This is not hypothetical: `build_chat_agent()` resolves the
    `"anthropic:..."` model string eagerly, so a deploy missing
    ANTHROPIC_API_KEY raises `UserError` at construction. Done in the handler
    body, that raise happens BEFORE `StreamingResponse` is returned and the
    client sees a 500 carrying zero `data:` frames — the UI's reader clears
    its pending state only on `done`, so the composer would hang. The plan's
    global constraint ("the stream is always terminated by `done`") governs,
    so construction moved in here.

    `load_editor_context` is here for exactly the same reason and is the
    stronger case: it does real I/O (a DataCore row read, plus a model read
    per referenced entity model), so it can fail on any request from the
    editor page, not only on a misconfigured deploy. It degrades internally
    for the failures it can name (see its docstring); this is the backstop for
    the rest.

    The wrapper lives in this module, not in `app/chat/stream.py`: that file
    is a verbatim port of admindash's transport and stays that way.
    """
    try:
        # Server-side, from the row: the client sends only `{page, entity_id}`,
        # never a definition, so it cannot dictate what the assistant believes
        # it is editing. The read is tenant-scoped by `deps.tenant_id`, which
        # `require_staff_tenant` has already matched against the token.
        if deps.page == "editor" and deps.entity_id:
            deps.editor_context = load_editor_context(
                deps.tenant_id, deps.entity_id, deps.token)
            # Read back out of the block the model is shown rather than from a
            # second row read: one load, one source of truth for "is the open
            # row editable", used by the prompt and by `propose_patch`'s guard.
            deps.editor_read_only = context_read_only(deps.editor_context)
        agent = build_chat_agent()
        history = to_message_history(turns, settings.chat_history_turns)
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the UI
        yield _sse({"type": "error", "message": str(exc)})
        yield _sse({"type": "done"})
        return
    # sse_chat has the same error+done guarantee for everything from here on.
    async for chunk in sse_chat(agent, deps, message, history):
        yield chunk


@router.post("/{tenant_id}/chat")
async def chat(tenant_id: str, body: ChatRequest,
               user: dict = Depends(require_staff_tenant)):
    if body.message_count >= settings.chat_session_message_cap:
        raise HTTPException(status_code=429,
                            detail="Conversation limit reached; start a new chat.")
    deps = ChatDeps(tenant_id=tenant_id, token=user.get("_token"),
                    page=body.context.page, entity_id=body.context.entity_id)
    return StreamingResponse(
        _guarded_sse_chat(deps, body.message,
                          [t.model_dump() for t in body.history]),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
