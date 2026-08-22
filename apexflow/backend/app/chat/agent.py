# apexflow/backend/app/chat/agent.py
"""The chat workflow builder's agent: system prompt, primitive catalog, and
the message-history adapter.

`primitives_text()` is GENERATED from the same two registries the designer's
`/primitives` route reads (`app.workflows.primitives`'s GUARDS/EFFECTS and
`app.workflows.validate`'s PARAM_SPECS) — never a hand-written second copy.
A primitive added to the engine therefore reaches the model automatically,
and a prompt that names a guard the engine does not implement is impossible.
"""
from pydantic_ai import (
    Agent,
    ModelRequest,
    ModelResponse,
    RunContext,
    TextPart,
    UserPromptPart,
)

from app.chat.deps import ChatDeps
from app.chat.tools import (
    register_proposal_tools,
    register_read_tools,
    register_view_tools,
)
from app.config import settings

SYSTEM_PROMPT = (
    "You are the ApexFlow assistant for a school administrator building "
    "operational workflows (registration, signup, ...). A workflow definition "
    "is a state machine (states with kind initial/active/terminal; transitions "
    "with action, actor family/staff/system, guards, effects) plus ordered "
    "steps (type form/documents/message) whose availability is per-state "
    "(available_in). Form steps hold sections (config.sections) bound to "
    "entity models; documents steps hold config.docs; message steps hold "
    "config.body.\n"
    "Form sections bind to THIS TENANT'S entity models, which you must read "
    "rather than assume: before proposing any section, call list_entity_models "
    "and get_entity_model, then bind the section to a model that exists and "
    "fill its fields with real field names ([{name, required}]). Never leave a "
    "section's fields empty (the form would render blank) and never name a "
    "model or field the tenant does not have.\n"
    "The proposal tools repair what they safely can before the card is built: "
    "a near-miss model name is bound to the real model (students -> student), "
    "field names the model does not have are dropped, and a section left with "
    "no fields is filled from the model's own fields. Every repair is listed "
    "back to you and appears in the card's summary — read it and describe what "
    "will actually be created, not what you asked for. This is a safety net, "
    "not the workflow: reading the models first is still how you get the form "
    "the admin asked for, and a model name that resembles nothing this tenant "
    "has is still refused outright.\n"
    "To CREATE a workflow: prefer starting from a template (list_templates / "
    "get_template) and applying the admin's changes; if none fits, start from "
    "the minimal skeleton (initial 'draft' -> submit -> terminal 'done') and "
    "build it out. Ask at most one or two clarifying questions, then call "
    "propose_create_draft. To CHANGE the open draft (editor context present), "
    "call propose_patch with targeted ops. Proposals open a confirmation card "
    "the admin must approve — never claim you created or edited anything "
    "yourself; say the card is ready. Keep answers short and specific.\n"
    "You are writing into a chat panel about 380px wide — roughly 45 "
    "characters. NEVER draw diagrams: no ASCII art, no box-drawing "
    "characters, no arrows arranged into a picture. They do not fit and they "
    "arrive unreadable. To describe a workflow's shape, write one short line "
    "per stage naming the moves out of it and who performs each, like:\n"
    "  Draft — submit (family) -> Confirmed if there is room, else Waitlisted\n"
    "  Waitlisted — offer_spot (staff) -> Spot Offered\n"
    "Mention any exits (moves to a terminal stage) separately, as a rule: "
    "'drop, from any stage, by family or staff -> Dropped'.\n"
    "Better still, call show_flow — it puts a diagram card in the chat with a "
    "button that opens the editor's Flow view, which draws the whole machine "
    "properly. Whenever the admin asks to see, show, draw, visualise or "
    "explain the shape of a workflow, call show_flow and keep your own answer "
    "to a sentence or two about what it does."
)


def primitives_text() -> str:
    """Render the guard/effect catalog for the system prompt.

    Shapes (verified against the modules, which are the authority):
      * `GUARDS`/`EFFECTS` are `dict[str, Callable]` keyed by primitive name,
        so iterating them yields names.
      * `PARAM_SPECS` is `dict[str, list[ParamSpec]]` keyed by the same names;
        `ParamSpec` is a NamedTuple with `.name`, `.kind`, `.required` (plus
        `.enum`/`.constraint`, which are omitted here to keep the prompt short
        — the designer's `/primitives` route is the surface that renders them).
      * A primitive with no PARAM_SPECS entry (`all_blocking_items_complete`,
        `issue_link`) takes no validated params and renders as `name()`.
    """
    from app.workflows.primitives import EFFECTS, GUARDS
    from app.workflows.validate import PARAM_SPECS

    def render(names) -> str:
        lines = []
        for name in sorted(names):
            specs = PARAM_SPECS.get(name, [])
            params = ", ".join(
                f"{p.name}:{p.kind}" + ("" if p.required else "?") for p in specs
            )
            lines.append(f"  - {name}({params})")
        return "\n".join(lines)

    return "Guards:\n" + render(GUARDS) + "\nEffects:\n" + render(EFFECTS)


def build_chat_agent(model=None) -> Agent:
    agent = Agent(
        model or settings.chat_model,
        deps_type=ChatDeps,
        system_prompt=SYSTEM_PROMPT + "\n\nPrimitive catalog:\n" + primitives_text(),
        model_settings={"max_tokens": settings.chat_max_tokens},
    )

    @agent.system_prompt
    def _page_context(ctx: RunContext[ChatDeps]) -> str:
        if ctx.deps.editor_context:
            return "Current editor context:\n" + ctx.deps.editor_context
        return f"The admin is on the {ctx.deps.page} page (no draft is open)."

    register_read_tools(agent)      # Task 4
    register_proposal_tools(agent)  # Tasks 5-6
    register_view_tools(agent)      # show_flow — a card that shows, never writes
    return agent


def to_message_history(turns: list[dict], limit: int) -> list:
    msgs: list = []
    for t in turns[-limit:]:
        if t.get("role") == "user":
            msgs.append(ModelRequest(parts=[UserPromptPart(content=t.get("content", ""))]))
        else:
            msgs.append(ModelResponse(parts=[TextPart(content=t.get("content", ""))]))
    return msgs
