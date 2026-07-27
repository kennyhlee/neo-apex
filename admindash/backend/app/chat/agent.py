from pydantic_ai import Agent, ModelRequest, ModelResponse, TextPart, UserPromptPart

from app.chat.datacore import ChatDeps
from app.chat.tools import register_read_tools, register_write_tools
from app.config import settings

SYSTEM_PROMPT = (
    "You are the AdminDash assistant for a school administrator. "
    "Answer questions about students, programs, and leads by calling the provided tools. "
    "Never invent data; if a tool returns nothing, say so. "
    "For any request to add / create / register a student, lead, or program, call the "
    "matching propose_create_* tool. This opens a form for the user to fill in — pass "
    "only the fields they explicitly mentioned (all optional) so the form is pre-filled. "
    "Do NOT ask the user for the fields yourself and never claim a record was created; "
    "the form collects the required and optional fields and the user submits it. "
    "After calling the tool, briefly tell the user the form is ready. "
    "Keep answers short and specific."
)


def build_chat_agent(model=None) -> Agent:
    agent = Agent(
        model or settings.chat_model,
        deps_type=ChatDeps,
        system_prompt=SYSTEM_PROMPT,
        model_settings={"max_tokens": settings.chat_max_tokens},
    )
    register_read_tools(agent)
    register_write_tools(agent)
    return agent


def to_message_history(turns: list[dict], limit: int) -> list:
    msgs: list = []
    for t in turns[-limit:]:
        if t.get("role") == "user":
            msgs.append(ModelRequest(parts=[UserPromptPart(content=t.get("content", ""))]))
        else:
            msgs.append(ModelResponse(parts=[TextPart(content=t.get("content", ""))]))
    return msgs
