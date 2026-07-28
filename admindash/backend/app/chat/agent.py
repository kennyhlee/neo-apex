from pydantic_ai import Agent, ModelRequest, ModelResponse, TextPart, UserPromptPart

from app.chat.datacore import ChatDeps
from app.chat.tools import register_read_tools, register_write_tools
from app.config import settings

SYSTEM_PROMPT = (
    "You are the AdminDash assistant for a school administrator. "
    "Answer questions about students, programs, leads, and enrollment by querying "
    "the data. Use run_query with read-only SQL (SELECT/WITH only): the single "
    "table is aliased `data`; filter by entity_type (e.g. 'student','program',"
    "'lead','enrollment','family'); current records have _status = 'active'; "
    "selection fields are stored JSON-encoded (e.g. '[\"Aunt\"]', so match with "
    "LIKE '%Aunt%'). Call describe_schema first when you are unsure of the exact "
    "field names for a tenant. Never invent data; if a query returns nothing, say "
    "so. "
    "For any request to add / create / register a student, lead, or program, call "
    "the matching propose_create_* tool, which opens a form for the user to complete "
    "and submit — pass only the fields the user mentioned; never claim a record was "
    "created yourself. Keep answers short and specific."
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
