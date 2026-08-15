# ApexFlow Chat Workflow Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat assistant drawer across all ApexFlow pages that builds workflows from scratch or from a template (create-draft proposal cards) and edits the open draft in the editor (patch proposal cards), with the AdminDash assistant's exact UI and streaming architecture.

**Architecture:** Port `admindash/backend/app/chat/` (pydantic-ai agent + SSE) into apexflow-backend behind `POST /api/workflows/{tenant_id}/chat`; port the drawer UI (`ChatPanel`/`QuickActions`/`Markdown`) into apexflow-frontend mounted on the app shell. Two write paths, both user-confirmed cards: `create_draft` proposals hit one new `POST /api/workflows/{tenant_id}/definitions` endpoint; `patch` proposals are applied client-side to `draftStore` by a pure `applyPatch` over the wire-shape `machine`/`steps`, and validation rides the existing autosave `PUT`.

**Tech Stack:** FastAPI, pydantic-ai (>=0.0.30, `anthropic:claude-haiku-4-5-20251001`), SSE over fetch streams, React 19 + TS + Vite, vitest, `idb`.

**Spec:** `docs/superpowers/specs/2026-08-14-apexflow-chat-workflow-builder-design.md`. One deliberate deviation, decided here: patch ops operate directly on the wire-shape `MachineDef`/`WorkflowStepDef[]` (what `draftStore` holds), NOT on the StageModel view — the stage editor re-derives its view from `draftStore` automatically, so direct ops are simpler and avoid a read→write round-trip per patch. The remove-stage cleanup and single-initial rules from `stageOps.ts` are preserved explicitly in `applyPatch` (Task 9).

## Global Constraints

- Backend env prefix is `APEXFLOW_`; settings live in `apexflow/backend/app/config.py`.
- The SSE event protocol is byte-compatible with AdminDash: `data: {json}\n\n` frames, types exactly `token | tool | proposal | done | error`, always terminated by `done`.
- The model NEVER writes. Writes happen only when the user confirms a proposal card. System prompts must instruct the model to never claim it created or edited anything.
- Every new user-facing string goes in `apexflow/frontend/src/i18n/translations.ts` for BOTH `en-US` and `zh-CN` (missing keys render raw). No hardcoded UI strings (do not copy AdminDash's `'Quick questions'`/`'Edit'` hardcoding — use the keys defined in Task 8).
- CSS: tokens only — no raw hex/px colors outside `styles/theme.css`. BEM-ish naming (`chat-panel__log`, `chat-msg--user`).
- Frontend API calls: native fetch, `Authorization: Bearer` from `localStorage['neoapex_token']`.
- Backend tests: `cd /Users/kennylee/Development/NeoApex/apexflow && uv run python -m pytest backend/tests/<file> -v`. Frontend: `cd /Users/kennylee/Development/NeoApex/apexflow/frontend && npm test` (vitest), `npm run build`, `npm run lint`.
- Python tests never call the real model: `models.ALLOW_MODEL_REQUESTS = False` + `FunctionModel` (pattern: `admindash/backend/tests/test_chat_endpoint.py`).
- Match `app/api/designer.py`'s existing imports for DataCore/definitions helpers (`from app.workflows import datacore as dc`, `definitions as defs` — read the file's import block and copy it exactly).
- Commit after every task; message style `feat(apexflow): …` / `test(apexflow): …`.

## File Structure

**Backend (create unless noted):**
- `apexflow/backend/app/chat/__init__.py` — empty
- `apexflow/backend/app/chat/deps.py` — `ChatDeps` dataclass
- `apexflow/backend/app/chat/agent.py` — `build_chat_agent`, `to_message_history`, system prompt + primitives rendering
- `apexflow/backend/app/chat/stream.py` — `sse_chat` (verbatim port)
- `apexflow/backend/app/chat/tools.py` — read tools + `propose_create_draft` + `propose_patch`
- `apexflow/backend/app/chat/patch_ops.py` — `PatchOp` discriminated union + `validate_ops`
- `apexflow/backend/app/chat/context.py` — `load_editor_context`
- `apexflow/backend/app/api/chat.py` — `POST /api/workflows/{tenant_id}/chat`
- Modify: `apexflow/backend/app/api/designer.py` — add `POST /{tenant_id}/definitions`
- Modify: `apexflow/backend/app/workflows/definitions.py` — add `create_definition`
- Modify: `apexflow/backend/app/config.py`, `apexflow/backend/app/main.py`, `apexflow/pyproject.toml`
- Tests: `apexflow/backend/tests/test_create_definition.py`, `test_chat_endpoint.py`, `test_chat_tools.py`, `test_chat_patch_ops.py`

**Frontend (create unless noted):**
- `apexflow/frontend/src/api/chat.ts` — `streamChat`, event/proposal types
- `apexflow/frontend/src/chat/quickActions.ts` — defaults + idb persistence
- `apexflow/frontend/src/chat/patchOps.ts` — `PatchOp` TS types
- `apexflow/frontend/src/chat/applyPatch.ts` — pure patch application
- `apexflow/frontend/src/chat/editorBridge.ts` — module-level bridge EditorPage registers
- `apexflow/frontend/src/components/chat/Markdown.tsx` — port
- `apexflow/frontend/src/components/chat/QuickActions.tsx` + `.css` — port
- `apexflow/frontend/src/components/chat/ChatPanel.tsx` + `.css` — port, extended with cards
- `apexflow/frontend/src/components/chat/AssistantDrawer.tsx` + `.css` — drawer shell + toggle
- `apexflow/frontend/src/components/chat/CreateDraftCard.tsx` — create proposal card
- `apexflow/frontend/src/components/chat/PatchCard.tsx` — patch proposal card
- Modify: `apexflow/frontend/src/App.tsx`, `src/styles/theme.css` (add `--assistant-w`), `src/i18n/translations.ts`, `src/api/designer.ts` (add `createDefinition`), `src/pages/DefinitionsPage.tsx`, `src/pages/TemplatesPage.tsx`, `src/pages/EditorPage.tsx` (bridge), `frontend/package.json` (`idb`)
- Tests: `src/chat/__tests__/applyPatch.test.ts`, `src/chat/__tests__/sse.test.ts`

## Drift checks (run at every task review)

The reviewer of each task re-reads the spec's **Decisions** section and confirms: (1) no code path lets the model write without a confirmed card; (2) SSE protocol shape unchanged; (3) strings are i18n'd in both locales; (4) validation still rides the save (no new validate-on-type paths); (5) from-scratch AND template creation both work through `propose_create_draft`.

---

### Task 1: Backend create-definition endpoint

**Files:**
- Modify: `apexflow/backend/app/workflows/definitions.py` (add `create_definition` near `new_draft_definition`, ~line 409)
- Modify: `apexflow/backend/app/api/designer.py` (new route + request model, after `save_definition_route`)
- Test: `apexflow/backend/tests/test_create_definition.py`

**Interfaces:**
- Consumes: `defs.save_definition` internals as reference; `dc.create_entity` (read `definitions.py` for the exact creator the module already uses — mirror `save_definition`'s row-write style).
- Produces: `create_definition(tenant_id, name, machine: dict, steps: list[dict], channel_access: str, token) -> dict` returning `{"row": {...}, "errors": [...], "health": "..."}` and route `POST /api/workflows/{tenant_id}/definitions` (201). 422 `{"parse_error": ...}` when machine/steps don't validate against `schema.py`.

- [ ] **Step 1: Write the failing tests**

Mirror the respx/datacore mocking style of `apexflow/backend/tests/test_designer_api.py` (read its fixtures/helpers first and reuse them — it already fakes DataCore rows):

```python
# apexflow/backend/tests/test_create_definition.py
SKELETON_MACHINE = {
    "states": [
        {"state_id": "draft", "name": "Draft", "kind": "initial"},
        {"state_id": "done", "name": "Done", "kind": "terminal"},
    ],
    "transitions": [
        {"transition_id": "submit", "from": "draft", "to": "done",
         "action": "submit", "actor": "family", "guards": [], "effects": []},
    ],
}

def test_create_definition_returns_row_errors_health(...):
    # POST /api/workflows/t1/definitions with
    # {"name": "Fall Registration", "machine": SKELETON_MACHINE, "steps": [],
    #  "channel_access": "family"}
    # -> 201; body has row (status draft, version 1, lineage_status active,
    #    definition_id startswith "fall-registration-"), errors == [], health.
    # Assert the DataCore create call captured by respx carried machine/steps
    # as JSON STRINGS (json.loads round-trips), never dicts.

def test_create_definition_rejects_unparseable_machine(...):
    # machine = {"states": "nope"} -> 422 with {"parse_error": ...};
    # assert NO DataCore create call was made.

def test_create_definition_requires_matching_tenant(...):
    # token for tenant t2 posting to t1 -> 403 (whatever require_staff_tenant
    # returns for mismatch in test_designer_api.py — copy its assertion).
```

Write them as real tests (full client + respx), not the sketches above.

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest backend/tests/test_create_definition.py -v` → FAIL (404 / missing function).

- [ ] **Step 3: Implement `create_definition`**

In `app/workflows/definitions.py`:

```python
def create_definition(tenant_id: str, name: str, machine: dict, steps: list,
                      channel_access: str, token: str | None) -> dict:
    """Create a v1 draft row from a parsed definition object. The chat
    assistant's create-draft proposal and the designer's blank/template
    creation both land here, so JSON-encoding happens server-side in exactly
    one place (same contract as save_definition)."""
    machine_def = MachineDef.model_validate(machine)          # raises ValidationError -> route 422s
    step_defs = [StepDef.model_validate(s) for s in steps]
    definition_id = _new_definition_id(name)                  # slug + short random suffix
    row = dc.create_entity(tenant_id, "workflow_definition", {
        "definition_id": definition_id,
        "name": name,
        "version": 1,
        "status": "draft",
        "lineage_status": "active",
        "channel_access": channel_access,
        "machine": json.dumps(machine_def.model_dump(by_alias=True)),
        "steps": json.dumps([s.model_dump(by_alias=True) for s in step_defs]),
    }, token)
    models = fetch_models(tenant_id, referenced_entity_models(step_defs), token)
    errors = validate_definition(machine_def, step_defs, models)
    health = definition_health(machine_def, step_defs, models)
    return {"row": row, "errors": errors, "health": health}
```

Reality-check every helper name against the module before writing (`dc.create_entity`'s real signature, how `save_definition` computes errors/health) and match them — the module is the authority, this block is the shape. `_new_definition_id`: lowercase, non-alnum → `-`, plus `uuid4().hex[:6]` suffix.

- [ ] **Step 4: Add the route**

In `app/api/designer.py`:

```python
class CreateDefinitionRequest(BaseModel):
    name: str
    machine: dict[str, Any]
    steps: list[dict[str, Any]] = []
    channel_access: str = "staff_only"

@router.post("/{tenant_id}/definitions", status_code=201)
def create_definition_route(tenant_id: str, body: CreateDefinitionRequest,
                            user: dict = Depends(require_staff_tenant)):
    try:
        return defs.create_definition(tenant_id, body.name, body.machine,
                                      body.steps, body.channel_access,
                                      user.get("_token"))
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail={"parse_error": str(exc)}) from exc
```

- [ ] **Step 5: Run tests to verify pass**, then run the whole backend suite: `uv run python -m pytest backend/tests/ -v` → all green.
- [ ] **Step 6: Mutation check** — temporarily make `create_definition` skip `MachineDef.model_validate`; the 422 test must fail; revert.
- [ ] **Step 7: Commit** — `feat(apexflow): create-draft-from-definition endpoint`

---

### Task 2: Frontend creation paths use the new endpoint

**Files:**
- Modify: `apexflow/frontend/src/api/designer.ts` (add `createDefinition`)
- Modify: `apexflow/frontend/src/pages/DefinitionsPage.tsx:230-282` (`submitNewWorkflow`)
- Modify: `apexflow/frontend/src/pages/TemplatesPage.tsx:132-144` (template instantiation)

**Interfaces:**
- Consumes: Task 1's route.
- Produces: `createDefinition(tenantId, body: {name; machine: unknown; steps: unknown[]; channel_access?: string}): Promise<SaveDefinitionResult & {row: {entity_id: string}}>` — Tasks 10 uses this exact function.

- [ ] **Step 1: Add `createDefinition` to `api/designer.ts`**

```ts
/** POST /api/workflows/{tenant_id}/definitions — server-side draft creation.
 * Replaces the generic-entities create: machine/steps go up PARSED and the
 * backend does the JSON-encoding + id/version seeding (Task 1). */
export async function createDefinition(
  tenantId: string,
  body: { name: string; machine: unknown; steps: unknown[]; channel_access?: string },
): Promise<{ row: Record<string, unknown> & { entity_id: string }; errors: string[]; health: DefinitionHealth }> {
  const resp = await fetch(`${API_BASE}/api/workflows/${tenantId}/definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  return parseOrThrow(resp);
}
```

- [ ] **Step 2: Rewire `submitNewWorkflow`** — delete the `createEntity` call, the client-side `definitionId` minting, and the `JSON.stringify` wrapping; keep the same skeleton machine object but pass it parsed:

```ts
const result = await createDefinition(tenantId, {
  name,
  machine: { /* the existing skeleton object, unchanged, WITHOUT JSON.stringify */ },
  steps: [],
  channel_access: 'staff_only',
});
navigate(`/definitions/${result.row.entity_id}`);
```

Keep the explanatory "SMALLEST VALID machine" comment with the skeleton. Remove now-unused imports (`createEntity`, `slugify`/`uniqueSuffix` if unused elsewhere in the file).

- [ ] **Step 3: Rewire `TemplatesPage`** the same way — pass the catalog entry's `definition.machine`/`definition.steps`/`definition.channel_access` parsed, navigate to `result.row.entity_id`.
- [ ] **Step 4: Verify** — `npm run build && npm run lint && npm test` green. Then live-check: start datacore + apexflow backend + frontend (`./start-services.sh`), create a blank workflow and a template workflow in the browser (or via curl against the running backend) and confirm both open in the editor with zero errors.
- [ ] **Step 5: Commit** — `refactor(apexflow): route designer creation through the create-definition endpoint`

---

### Task 3: Chat backend scaffolding (deps, agent, stream, route)

**Files:**
- Modify: `apexflow/pyproject.toml` (add `"pydantic-ai>=0.0.30"`; then `uv sync --extra dev`)
- Modify: `apexflow/backend/app/config.py` (chat settings)
- Create: `apexflow/backend/app/chat/__init__.py`, `deps.py`, `agent.py`, `stream.py`
- Create: `apexflow/backend/app/api/chat.py`; Modify: `app/main.py` (mount)
- Test: `apexflow/backend/tests/test_chat_endpoint.py`

**Interfaces:**
- Produces: `ChatDeps` (below) — every later backend task consumes it. `build_chat_agent(model=None) -> Agent`, `to_message_history(turns, limit)`, `sse_chat(agent, deps, message, history)`. Route `POST /api/workflows/{tenant_id}/chat` with body `{message, history: [{role, content}], message_count, context: {page, entity_id?}}`.

- [ ] **Step 1: Write failing endpoint tests** — copy `admindash/backend/tests/test_chat_endpoint.py` (read it: it is the whole pattern) into `apexflow/backend/tests/test_chat_endpoint.py`, adjusting: URL `/api/workflows/t1/chat`, auth mocking to whatever `test_designer_api.py` uses for `require_staff_tenant`, body includes `"context": {"page": "list"}`. Tests: streams tokens + done; 429 over cap; history trimming.
- [ ] **Step 2: Run** → FAIL (import errors / 404).
- [ ] **Step 3: Config** — append to `Settings`:

```python
    # Chat assistant (Plan 4 / chat workflow builder). Mirrors admindash's
    # chat settings; max_tokens is higher because create-draft proposals
    # carry a full machine+steps JSON in tool arguments.
    chat_model: str = "anthropic:claude-haiku-4-5-20251001"
    chat_max_tokens: int = 4096
    chat_history_turns: int = 8
    chat_session_message_cap: int = 40
```

- [ ] **Step 4: `deps.py`**

```python
from dataclasses import dataclass, field


@dataclass
class ChatDeps:
    tenant_id: str
    token: str | None
    page: str  # 'list' | 'templates' | 'editor'
    entity_id: str | None = None
    editor_context: str | None = None  # set by the route when page == 'editor' (Task 6)
    pending_proposals: list[dict] = field(default_factory=list)
```

- [ ] **Step 5: `stream.py`** — copy `admindash/backend/app/chat/stream.py` verbatim, changing only the import to `from app.chat.deps import ChatDeps`.
- [ ] **Step 6: `agent.py`**

```python
from pydantic_ai import Agent, ModelRequest, ModelResponse, RunContext, TextPart, UserPromptPart

from app.chat.deps import ChatDeps
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
    "To CREATE a workflow: prefer starting from a template (list_templates / "
    "get_template) and applying the admin's changes; if none fits, start from "
    "the minimal skeleton (initial 'draft' -> submit -> terminal 'done') and "
    "build it out. Ask at most one or two clarifying questions, then call "
    "propose_create_draft. To CHANGE the open draft (editor context present), "
    "call propose_patch with targeted ops. Proposals open a confirmation card "
    "the admin must approve — never claim you created or edited anything "
    "yourself; say the card is ready. Keep answers short and specific."
)


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

    register_read_tools(agent)      # Task 4 (add the import then)
    register_proposal_tools(agent)  # Tasks 5-6 (add the import then)
    return agent


def to_message_history(turns: list[dict], limit: int) -> list:
    msgs: list = []
    for t in turns[-limit:]:
        if t.get("role") == "user":
            msgs.append(ModelRequest(parts=[UserPromptPart(content=t.get("content", ""))]))
        else:
            msgs.append(ModelResponse(parts=[TextPart(content=t.get("content", ""))]))
    return msgs
```

For THIS task, `primitives_text()` is real (not a stub): render from the backend catalog —

```python
def primitives_text() -> str:
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
```

Before writing, open `app/workflows/validate.py:471` and `primitives.py:314,645` to confirm `PARAM_SPECS` is keyed by primitive name and `GUARDS`/`EFFECTS` iterate to names; adjust the two lookups to the real shapes if not. Until Task 4 lands, define `register_read_tools`/`register_proposal_tools` as no-op module-level functions in `tools.py` (empty body, docstring "filled in by Tasks 4-6") so the agent builds.

- [ ] **Step 7: Route `app/api/chat.py`**

```python
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import require_staff_tenant   # match designer.py's actual import path
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
```

Mount in `main.py` next to the other routers: `app.include_router(chat_api.router)`.

- [ ] **Step 8: Run tests** → PASS; whole backend suite green.
- [ ] **Step 9: Commit** — `feat(apexflow): chat assistant backend scaffolding (agent, SSE, route)`

---

### Task 4: Backend read tools

**Files:**
- Modify: `apexflow/backend/app/chat/tools.py` (replace the no-op `register_read_tools`)
- Test: `apexflow/backend/tests/test_chat_tools.py`

**Interfaces:**
- Consumes: `ChatDeps`; `dc`/`defs` helpers exactly as `app/api/designer.py` imports them; `app/templates/catalog.py::template_catalog`.
- Produces: agent tools `list_workflows()`, `get_workflow(entity_id)`, `list_templates()`, `get_template(template_id)` — all return strings.

- [ ] **Step 1: Write failing tests.** Use `FunctionModel` with a `call_tools`-style function that invokes each tool (see pydantic-ai `FunctionModel` docs; the AdminDash suite `admindash/backend/tests/test_chat_tools.py` shows the working pattern — read it first and mirror its structure), with respx faking the DataCore endpoints `test_designer_api.py` already fakes. Cases:
  - `list_workflows` returns one line per row containing name, status, version.
  - `get_workflow` on a parseable row returns full `machine`/`steps` JSON plus the validation errors; on a corrupt row returns a "does not parse" message, not an exception.
  - `list_templates` includes `template_id` + name; `get_template` returns the full definition JSON for a known id and an error string for an unknown id.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```python
import json

from pydantic_ai import Agent, RunContext

from app.chat.deps import ChatDeps
from app.templates.catalog import template_catalog
from app.workflows import datacore as dc          # ← match designer.py exactly
from app.workflows import definitions as defs
from app.workflows.validate import validate_definition


def register_read_tools(agent: Agent) -> None:
    @agent.tool
    def list_workflows(ctx: RunContext[ChatDeps]) -> str:
        """List this tenant's workflow definitions (every version row):
        name, status, version, entity_id, definition_id."""
        rows = dc.list_entities(ctx.deps.tenant_id, "workflow_definition", "",
                                ctx.deps.token)
        if not rows:
            return "No workflow definitions exist yet."
        return "\n".join(
            f"- {r.get('name')} (v{r.get('version')}, {r.get('status')}, "
            f"entity_id={r.get('entity_id')}, lineage={r.get('definition_id')})"
            for r in rows
        )

    @agent.tool
    def get_workflow(ctx: RunContext[ChatDeps], entity_id: str) -> str:
        """Full definition of one workflow row: machine, steps, channel, and
        current validation errors. Use before proposing changes."""
        row = defs.require_definition_row(ctx.deps.tenant_id, entity_id,
                                          ctx.deps.token)
        try:
            machine, steps = defs.parse_machine_steps(row)
        except Exception as exc:  # noqa: BLE001 — surface to the model
            return f"This row's stored definition does not parse: {exc}"
        models = defs.fetch_models(ctx.deps.tenant_id,
                                   defs.referenced_entity_models(steps),
                                   ctx.deps.token)
        errors = validate_definition(machine, steps, models)
        return json.dumps({
            "name": row.get("name"), "status": row.get("status"),
            "channel_access": row.get("channel_access"),
            "machine": machine.model_dump(by_alias=True),
            "steps": [s.model_dump(by_alias=True) for s in steps],
            "validation_errors": errors,
        })

    @agent.tool
    def list_templates(ctx: RunContext[ChatDeps]) -> str:
        """List available workflow templates (template_id, name, description)."""
        return "\n".join(
            f"- {t['template_id']}: {t['name']} — {t['description']}"
            for t in template_catalog()
        )

    @agent.tool
    def get_template(ctx: RunContext[ChatDeps], template_id: str) -> str:
        """Full machine/steps/channel_access of one template — the base for a
        create-draft proposal."""
        for t in template_catalog():
            if t["template_id"] == template_id:
                return json.dumps(t["definition"])
        return f"No template named {template_id}. Call list_templates."
```

(`require_definition_row` may raise an HTTPException for missing rows — if the test shows that propagating, wrap it and return a "not found" string; tools must return strings, not 500 the stream.)

- [ ] **Step 4: Run tests** → PASS; suite green. Commit — `feat(apexflow): chat read tools (workflows, templates)`

---

### Task 5: `propose_create_draft` tool

**Files:**
- Modify: `apexflow/backend/app/chat/tools.py` (start `register_proposal_tools`)
- Test: `apexflow/backend/tests/test_chat_tools.py` (extend)

**Interfaces:**
- Produces: proposal dict `{"action": "create_draft", "name": str, "template_id": str|None, "machine": dict, "steps": list, "channel_access": str, "summary": list[str]}` — the wire contract Task 10's `CreateDraftCard` renders and posts.

- [ ] **Step 1: Failing tests:** (a) valid machine/steps → tool returns a "card is ready" string and `deps.pending_proposals` holds exactly the dict above with `machine` as a parsed dict (aliases: `from` not `from_`); (b) unparseable machine → returns a string containing `does not parse`, queue stays empty; (c) endpoint-level: a `FunctionModel` that calls the tool then answers → SSE output contains a `{"type": "proposal"}` frame (extend `test_chat_endpoint.py`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```python
from pydantic import ValidationError

from app.workflows.schema import MachineDef, StepDef


def register_proposal_tools(agent: Agent) -> None:
    @agent.tool
    def propose_create_draft(
        ctx: RunContext[ChatDeps],
        name: str,
        machine: dict,
        steps: list[dict],
        channel_access: str = "staff_only",
        template_id: str | None = None,
        summary: list[str] | None = None,
    ) -> str:
        """Open a create-draft confirmation card. Call for ANY request to
        create/build a new workflow, passing the COMPLETE machine and steps
        (start from a template via get_template, or from the minimal skeleton
        for scratch builds) and a short human-readable summary of what you
        set up. Do NOT create the draft yourself — the admin confirms."""
        try:
            m = MachineDef.model_validate(machine)
            s = [StepDef.model_validate(x) for x in steps]
        except ValidationError as exc:
            return (f"Proposal rejected — the definition does not parse: {exc}. "
                    "Fix the payload and call propose_create_draft again.")
        if channel_access not in ("staff_only", "family"):
            return "channel_access must be 'staff_only' or 'family'."
        ctx.deps.pending_proposals.append({
            "action": "create_draft",
            "name": name,
            "template_id": template_id,
            "machine": m.model_dump(by_alias=True),
            "steps": [x.model_dump(by_alias=True) for x in s],
            "channel_access": channel_access,
            "summary": summary or [],
        })
        return ("Create-draft card is ready for the admin to confirm. Tell them "
                "to review and click Create draft — do not claim it exists yet.")
```

- [ ] **Step 4: Run tests** → PASS; suite green. Mutation check: drop the `model_validate` calls → test (b) fails; revert. Commit — `feat(apexflow): create-draft proposal tool`

---

### Task 6: Editor context + patch ops + `propose_patch`

**Files:**
- Create: `apexflow/backend/app/chat/patch_ops.py`, `apexflow/backend/app/chat/context.py`
- Modify: `app/chat/tools.py` (add `propose_patch`), `app/api/chat.py` (load editor context)
- Test: `apexflow/backend/tests/test_chat_patch_ops.py`; extend `test_chat_endpoint.py`

**Interfaces:**
- Produces: `PatchOp` union + `validate_ops(ops: list[dict]) -> list[dict]` (returns by-alias dumps, raises `ValidationError`); proposal dict `{"action": "patch", "ops": [...], "summary": [...]}`; `load_editor_context(tenant_id, entity_id, token) -> str`. Task 9's TS types and Task 11's card consume the op shapes verbatim.

- [ ] **Step 1: Failing tests:**
  - `validate_ops` accepts one of each op type (14 total, below) and round-trips `from` alias; rejects unknown `op` and a `remove_stage` missing `stage_id`.
  - `propose_patch` with `deps.page == "editor"` queues the proposal; with `page == "list"` returns a refusal string and queues nothing.
  - Endpoint: request with `context: {page: "editor", entity_id: "..."}` → the agent's system prompt contains the draft's machine JSON (assert via `FunctionModel`'s received messages) — this is the editor-context wiring test.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: `patch_ops.py`** — pydantic v2 discriminated union. The FULL vocabulary (14 ops):

```python
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Op(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class AddStage(_Op):
    op: Literal["add_stage"]
    stage_id: str
    name: str
    kind: Literal["initial", "active", "terminal"] = "active"

class RenameStage(_Op):
    op: Literal["rename_stage"]; stage_id: str; name: str

class SetStageKind(_Op):
    op: Literal["set_stage_kind"]; stage_id: str
    kind: Literal["initial", "active", "terminal"]

class RemoveStage(_Op):
    op: Literal["remove_stage"]; stage_id: str

class AddMove(_Op):
    op: Literal["add_move"]
    transition_id: str
    from_: str = Field(alias="from")
    to: str
    action: str
    actor: Literal["family", "staff", "system"] = "staff"
    guards: list[dict] = []
    effects: list[dict] = []

class UpdateMove(_Op):
    op: Literal["update_move"]; transition_id: str
    patch: dict[str, Any]  # subset of TransitionDef fields (to/action/actor/guards/effects)

class RemoveMove(_Op):
    op: Literal["remove_move"]; transition_id: str

class AddStep(_Op):
    op: Literal["add_step"]
    step: dict[str, Any]        # full StepDef shape (validated on apply via schema)
    position: int | None = None  # None = append

class UpdateStep(_Op):
    op: Literal["update_step"]; step_id: str; patch: dict[str, Any]

class RemoveStep(_Op):
    op: Literal["remove_step"]; step_id: str

class AddSection(_Op):
    op: Literal["add_section"]; step_id: str; section: dict[str, Any]

class UpdateSection(_Op):
    op: Literal["update_section"]; step_id: str; section_id: str
    patch: dict[str, Any]

class RemoveSection(_Op):
    op: Literal["remove_section"]; step_id: str; section_id: str

class SetChannelAccess(_Op):
    op: Literal["set_channel_access"]; value: Literal["staff_only", "family"]


PatchOp = Annotated[
    Union[AddStage, RenameStage, SetStageKind, RemoveStage, AddMove, UpdateMove,
          RemoveMove, AddStep, UpdateStep, RemoveStep, AddSection, UpdateSection,
          RemoveSection, SetChannelAccess],
    Field(discriminator="op"),
]
_ops_adapter = TypeAdapter(list[PatchOp])


def validate_ops(ops: list[dict]) -> list[dict]:
    """Structural validation only — semantic validation rides the save PUT."""
    return [o.model_dump(by_alias=True) for o in _ops_adapter.validate_python(ops)]
```

(`set_show_if` from the spec is covered by `update_step` with `patch: {"show_if": ...}` — one less op, same power; note this in the module docstring.) `AddStep.step` additionally validates against `StepDef` inside `propose_patch` so a malformed step bounces to the model, not to the UI.

- [ ] **Step 4: `context.py`**

```python
import json

from app.workflows import definitions as defs
from app.workflows.validate import validate_definition


def load_editor_context(tenant_id: str, entity_id: str, token: str | None) -> str:
    """Condensed truth about the open draft, injected as a system prompt block.
    Loaded server-side from the row (client-claimed context is not trusted)."""
    row = defs.require_definition_row(tenant_id, entity_id, token)
    try:
        machine, steps = defs.parse_machine_steps(row)
    except Exception as exc:  # noqa: BLE001
        return (f"The open definition '{row.get('name')}' is corrupt and cannot "
                f"be patched: {exc}")
    models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps), token)
    errors = validate_definition(machine, steps, models)
    model_fields = {k: sorted((v.get("fields") or {}))
                    if isinstance(v, dict) else str(v) for k, v in models.items()}
    return json.dumps({
        "name": row.get("name"), "status": row.get("status"),
        "read_only": row.get("status") != "draft",
        "channel_access": row.get("channel_access"),
        "machine": machine.model_dump(by_alias=True),
        "steps": [s.model_dump(by_alias=True) for s in steps],
        "entity_model_fields": model_fields,
        "validation_errors": errors,
    })
```

Check `fetch_models`'s real return shape (bundle route line `models = defs.fetch_models(...)` returns what the frontend types as `EntityModelsMap`) and make `model_fields` list actual field names from it.

- [ ] **Step 5: Route wiring** — in `app/api/chat.py` after building deps:

```python
    if body.context.page == "editor" and body.context.entity_id:
        deps.editor_context = load_editor_context(tenant_id, body.context.entity_id,
                                                  deps.token)
```

- [ ] **Step 6: `propose_patch`** in `register_proposal_tools`:

```python
    @agent.tool
    def propose_patch(ctx: RunContext[ChatDeps], ops: list[dict],
                      summary: list[str]) -> str:
        """Open a patch confirmation card changing the OPEN DRAFT. Only valid
        in editor context. ops is a list of operations (add_stage, rename_stage,
        set_stage_kind, remove_stage, add_move, update_move, remove_move,
        add_step, update_step, remove_step, add_section, update_section,
        remove_section, set_channel_access) using ids from the editor context.
        summary: short human-readable bullet per meaningful change. Do NOT
        apply changes yourself — the admin confirms."""
        if ctx.deps.page != "editor":
            return ("No draft is open. Patching works only in the editor — for a "
                    "new workflow use propose_create_draft instead.")
        try:
            validated = validate_ops(ops)
            for o in validated:
                if o["op"] == "add_step":
                    StepDef.model_validate(o["step"])
        except ValidationError as exc:
            return f"Proposal rejected — invalid ops: {exc}. Fix and retry."
        ctx.deps.pending_proposals.append(
            {"action": "patch", "ops": validated, "summary": summary})
        return ("Patch card is ready for the admin to review and Apply. Do not "
                "claim the change is applied yet.")
```

- [ ] **Step 7: Run all backend tests** → green. Mutation check: make `propose_patch` skip the page guard → context test fails; revert. Commit — `feat(apexflow): editor context and patch proposal tool`

---

### Task 7: Frontend chat client + quick actions + Markdown

**Files:**
- Create: `src/api/chat.ts`, `src/chat/quickActions.ts`, `src/chat/patchOps.ts`, `src/components/chat/Markdown.tsx`
- Modify: `frontend/package.json` (add `"idb": "^8.0.3"`, then `npm install`)
- Test: `src/chat/__tests__/sse.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 8/10/11):

```ts
// src/chat/patchOps.ts — mirror backend patch_ops.py EXACTLY (14 ops)
export type PatchOp =
  | { op: 'add_stage'; stage_id: string; name: string; kind: 'initial' | 'active' | 'terminal' }
  | { op: 'rename_stage'; stage_id: string; name: string }
  | { op: 'set_stage_kind'; stage_id: string; kind: 'initial' | 'active' | 'terminal' }
  | { op: 'remove_stage'; stage_id: string }
  | { op: 'add_move'; transition_id: string; from: string; to: string; action: string;
      actor: 'family' | 'staff' | 'system'; guards: unknown[]; effects: unknown[] }
  | { op: 'update_move'; transition_id: string; patch: Record<string, unknown> }
  | { op: 'remove_move'; transition_id: string }
  | { op: 'add_step'; step: WorkflowStepDef; position?: number | null }
  | { op: 'update_step'; step_id: string; patch: Record<string, unknown> }
  | { op: 'remove_step'; step_id: string }
  | { op: 'add_section'; step_id: string; section: WorkflowSectionDef }
  | { op: 'update_section'; step_id: string; section_id: string; patch: Record<string, unknown> }
  | { op: 'remove_section'; step_id: string; section_id: string }
  | { op: 'set_channel_access'; value: 'staff_only' | 'family' };

// src/api/chat.ts
export type ChatPage = 'list' | 'templates' | 'editor';
export interface ChatContext { page: ChatPage; entity_id?: string }
export type Proposal =
  | { action: 'create_draft'; name: string; template_id: string | null;
      machine: unknown; steps: unknown[]; channel_access: string; summary: string[] }
  | { action: 'patch'; ops: PatchOp[]; summary: string[] };
export type ChatEvent =
  | { type: 'token'; text: string } | { type: 'tool'; name: string }
  | { type: 'proposal'; proposal: Proposal } | { type: 'done' }
  | { type: 'error'; message: string };
export async function* streamChat(tenantId: string, message: string,
  history: ChatTurn[], messageCount: number, context: ChatContext,
  signal: AbortSignal): AsyncGenerator<ChatEvent>
```

- [ ] **Step 1: Failing SSE parser test** — extract the frame parser into an exported pure helper so it is testable without fetch:

```ts
// in src/api/chat.ts
export function parseSseChunks(buffer: string): { events: ChatEvent[]; rest: string }
```

`sse.test.ts`: split frames across chunk boundaries, ignore malformed JSON, parse `token`/`proposal`/`done`. Run `npm test` → FAIL.
- [ ] **Step 2: Implement `src/api/chat.ts`** — port `admindash/frontend/src/api/chat.ts` with: URL `` `${APEXFLOW_API_URL}/api/workflows/${tenantId}/chat` ``, body `{ message, history, message_count: messageCount, context }`, the new `Proposal` union, and the loop refactored through `parseSseChunks`. Keep the 429 special-case message (i18n'd at the call site, Task 8).
- [ ] **Step 3: `src/chat/quickActions.ts`** — port with `DB = 'apexflow-chat'` and defaults:

```ts
export const DEFAULT_QUICK_ACTIONS: string[] = [
  'Start a registration workflow from a template',
  'Build a simple signup workflow from scratch',
  'Add a document upload step to this draft',
  'Add a staff approval stage to this draft',
  'Explain this draft\'s validation errors',
  'What workflow templates are available?',
];
```

- [ ] **Step 4: `Markdown.tsx`** — copy `admindash/frontend/src/components/Markdown.tsx` (and its CSS if separate) unchanged apart from import paths. It never uses `dangerouslySetInnerHTML`; keep it that way.
- [ ] **Step 5: `npm test && npm run build && npm run lint`** → green. Commit — `feat(apexflow): chat client, quick actions, markdown renderer`

---

### Task 8: AssistantDrawer + ChatPanel on the app shell

**Files:**
- Create: `src/components/chat/ChatPanel.tsx` + `.css`, `QuickActions.tsx` + `.css`, `AssistantDrawer.tsx` + `.css`
- Modify: `src/App.tsx`, `src/styles/theme.css`, `src/i18n/translations.ts`, `src/contexts/AuthContext.tsx` (clear transcript on logout)

**Interfaces:**
- Consumes: Task 7's `streamChat`/`Proposal`; `useAuth().user.tenant_id`; react-router `useLocation`/`matchPath`.
- Produces: `<AssistantDrawer />` self-contained (own open state); `ChatPanel` renders proposals via a `renderProposal(p: Proposal, appendSystem)` slot that Tasks 10/11 fill with the two cards (until then it renders nothing for proposals).

- [ ] **Step 1: Port `ChatPanel`** from `admindash/frontend/src/components/ChatPanel.tsx` + `ChatPanel.css` with these changes:
  - `sessionStorage` key `apexflow_chat_history`; same strip-proposals-on-persist rule (keep the comment).
  - Context per send: derive from the router — `const loc = useLocation(); const m = matchPath('/definitions/:entityId', loc.pathname); const context: ChatContext = m ? { page: 'editor', entity_id: m.params.entityId } : loc.pathname.startsWith('/templates') ? { page: 'templates' } : { page: 'list' };`
  - `streamChat(tenantId, q, history, msgs.length, context, ac.signal)`.
  - Message keys: `key={\`${i}-${m.role}\`}` is still index-based; acceptable, but do NOT reuse plain `key={i}` — derive a monotonically increasing id per message instead (`const idRef = useRef(0)`; assign `id: idRef.current++` on append; `key={m.id}`).
  - All strings through `t('assistant.*')` (keys in Step 4).
  - Proposals render via the card components once they exist: `{m.proposals?.map((p, j) => renderProposalCard(p, j, appendSystem))}` where `renderProposalCard` lives in `ChatPanel.tsx` and for now returns `null` for both actions with a `// Tasks 10/11 fill these in` comment.
- [ ] **Step 2: Port `QuickActions`** + css; head label uses `t('assistant.quickQuestions')`, edit toggle `t('assistant.edit')`/`t('assistant.done')`, add button `t('assistant.addQuick')`.
- [ ] **Step 3: `AssistantDrawer.tsx`** — the shell AdminDash keeps in `HomePage`, extracted:

```tsx
const OPEN_KEY = 'apexflow_assistant_open';

export function AssistantDrawer() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => sessionStorage.getItem(OPEN_KEY) === '1');
  useEffect(() => {
    document.body.classList.toggle('assistant-open', open);
    try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* ignore */ }
    return () => document.body.classList.remove('assistant-open');
  }, [open]);
  return (
    <>
      <button className="assistant-toggle" onClick={() => setOpen(o => !o)}
              aria-expanded={open}>
        {open ? t('assistant.hide') : t('assistant.show')}
      </button>
      <aside className={`assistant-drawer ${open ? 'is-open' : ''}`}
             aria-hidden={!open}>
        <ChatPanel />
      </aside>
    </>
  );
}
```

CSS: port `admindash/frontend/src/pages/HomePage.css:345-401` (`.home-chat-drawer` → `.assistant-drawer`, `.home-chat-toggle` → `.assistant-toggle`, `body.assistant-open .app-main { padding-right: calc(var(--assistant-w) + var(--space-4)); }`, the `[aria-hidden='true'] { visibility: hidden; }` rule, and both media queries). Default is CLOSED (spec decision — ApexFlow's editor is dense). Add to `theme.css`: `--assistant-w: 380px;` (next to the other layout tokens, ~line 130).
- [ ] **Step 4: i18n** — add to BOTH locales in `translations.ts` (zh-CN values shown):

```
assistant.title 助手 | assistant.empty 问我如何创建或修改工作流。 |
assistant.placeholder 询问工作流… | assistant.inputLabel 消息 |
assistant.send 发送 | assistant.stop 停止 | assistant.clear 清除 |
assistant.quickQuestions 快捷问题 | assistant.edit 编辑 | assistant.done 完成 |
assistant.addQuick 添加 | assistant.show ‹ 助手 | assistant.hide 隐藏助手 › |
assistant.limitReached 对话已达上限，请开始新对话。 |
assistant.createDraft 创建草稿 | assistant.adjust 调整 | assistant.apply 应用 |
assistant.dismiss 忽略 | assistant.applied 已应用 ✓ |
assistant.createFailed 创建失败 | assistant.applyFailed 无法应用 |
assistant.readOnly 此版本为只读 — 请先创建新草稿
```

(English values: natural equivalents — "Assistant", "Ask me to build or change a workflow.", "Ask about workflows…", "Message", "Send", "Stop", "Clear", "Quick questions", "Edit", "Done", "+ Add", "‹ Assistant", "Hide assistant ›", "Conversation limit reached. Start a new chat.", "Create draft", "Adjust…", "Apply", "Dismiss", "Applied ✓", "Create failed", "Could not apply", "This version is read-only — open a new draft first".)
- [ ] **Step 5: Mount in `App.tsx`** — inside the authed `app-shell` div, before `<main>`: `<AssistantDrawer />`. Clear transcript + open flag on logout in `AuthContext` (mirror `admindash/frontend/src/contexts/AuthContext.tsx:62`).
- [ ] **Step 6: Verify live** — `npm run build && npm run lint && npm test` green; then run the stack and check in the browser: drawer opens on all three pages, chips send, a plain question streams an answer (requires `ANTHROPIC_API_KEY` in env — `source ~/.zshrc`), content reflows rather than being overlapped, closed drawer is out of tab order.
- [ ] **Step 7: Commit** — `feat(apexflow): assistant drawer on the app shell`

---

### Task 9: `applyPatch` pure module

**Files:**
- Create: `src/chat/applyPatch.ts`
- Test: `src/chat/__tests__/applyPatch.test.ts`

**Interfaces:**
- Consumes: `PatchOp` (Task 7), `MachineDef`/`WorkflowStepDef` from `src/types/designer.ts`.
- Produces: `applyPatch(machine: MachineDef, steps: WorkflowStepDef[], ops: PatchOp[]): { machine: MachineDef; steps: WorkflowStepDef[]; channelAccess?: 'staff_only' | 'family' }` — throws `PatchApplyError` with a human message on any bad ref; never mutates inputs; all-or-nothing (throws before returning anything partial).

- [ ] **Step 1: Write the failing test suite FIRST** — one test per rule:
  - each of the 14 ops applies (add_stage appends a StateDef; add_move appends a TransitionDef with `from` key; add_step at `position`/append; section ops operate on `step.config.sections`…)
  - `add_stage`/`set_stage_kind` with `kind: 'initial'` demotes an existing initial to `active` (single-initial rule from `stageOps.ts::setStageKind`)
  - `remove_stage` removes the state, every transition whose `from` OR `to` is the stage, and strips the id from every step's `available_in` (the `stageOps.ts::removeStage` contract)
  - `update_step` merging `{"show_if": {...}}` and `{"title": "..."}`; `update_move` merging `{"to": "..."}`
  - unknown ids (`rename_stage` on missing stage, `remove_move` on missing transition, `update_section` on missing section) throw `PatchApplyError` naming the id
  - inputs are not mutated (deep-freeze the fixtures)
  - duplicate `add_stage` stage_id throws
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — a `switch` per op over immutably-copied `machine`/`steps`; helpers `mustFindState`, `mustFindStep`, `mustFindSection`, `sectionsOf(step)` (reads `step.config.sections ?? []`). ~150 lines, no React, no imports from `editor/` (keep the chat layer dependency-free of the editor internals; the semantics are re-stated here and pinned by tests).
- [ ] **Step 4: Run** → PASS; `npm test` green. Mutation check: break `remove_stage`'s `to`-side cleanup → its test fails; revert. Commit — `feat(apexflow): pure patch application for chat proposals`

---

### Task 10: CreateDraftCard

**Files:**
- Create: `src/components/chat/CreateDraftCard.tsx` (+ styles in `ChatPanel.css`)
- Modify: `src/components/chat/ChatPanel.tsx` (`renderProposalCard` for `create_draft`)

**Interfaces:**
- Consumes: `createDefinition` (Task 2), `Proposal` create variant, `useNavigate`.
- Produces: card with summary bullets + **Create draft** / **Adjust** buttons; on success appends a synthetic assistant message (via the `appendSystem` prop the ChatPanel already has) and navigates to `/definitions/{entity_id}`.

- [ ] **Step 1: Implement**

```tsx
export function CreateDraftCard({ proposal, tenantId, onDone }: {
  proposal: Extract<Proposal, { action: 'create_draft' }>;
  tenantId: string;
  onDone: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const result = await createDefinition(tenantId, {
        name: proposal.name,
        machine: proposal.machine,
        steps: proposal.steps,
        channel_access: proposal.channel_access,
      });
      setCreated(true);
      onDone(t('assistant.draftCreatedMsg').replace('{name}', proposal.name));
      navigate(`/definitions/${result.row.entity_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="chat-card">
      <div className="chat-card__title">{t('assistant.createDraft')} · {proposal.name}</div>
      <ul className="chat-card__summary">
        {proposal.summary.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      {error && <p className="chat-card__error">{t('assistant.createFailed')}: {error}</p>}
      {!created && (
        <div className="chat-card__actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            {t('assistant.createDraft')}
          </button>
          <button className="btn" disabled={busy}
                  onClick={() => document.getElementById('chat-panel-input')?.focus()}>
            {t('assistant.adjust')}
          </button>
        </div>
      )}
    </div>
  );
}
```

Add i18n key `assistant.draftCreatedMsg` (en: `Draft "{name}" created — you're in the editor now; I can keep refining it here.`, zh: `草稿“{name}”已创建 — 已打开编辑器，可以继续在这里完善。`). Card CSS in `ChatPanel.css`: `.chat-card` bordered `var(--accent)` on `var(--bg-primary)`, radius `var(--radius-md)` (match the mockup: accent-bordered card inside the assistant bubble).
- [ ] **Step 2: Wire into `renderProposalCard`** for `action === 'create_draft'`.
- [ ] **Step 3: Verify live** — with the stack running, ask the assistant to "build a simple signup workflow from scratch"; confirm the card renders, Create lands you in the editor on a real draft, transcript survives navigation, and the synthetic message appears. Also verify a failure path (stop apexflow backend, click Create → inline error, card still actionable).
- [ ] **Step 4: `npm run build && npm run lint && npm test` green. Commit** — `feat(apexflow): create-draft proposal card`

---

### Task 11: PatchCard + editor bridge

**Files:**
- Create: `src/chat/editorBridge.ts`, `src/components/chat/PatchCard.tsx`
- Modify: `src/pages/EditorPage.tsx` (register bridge), `src/components/chat/ChatPanel.tsx` (`renderProposalCard` for `patch`)

**Interfaces:**
- Consumes: `applyPatch` (Task 9), `useDraftStore` via EditorPage's instance.
- Produces:

```ts
// editorBridge.ts — module-level registry, same pattern as admindash's paletteBus
export interface EditorBridge {
  entityId: string;
  readOnly: boolean;
  /** Applies ops to the live draft. Returns null on success, or a
   *  human-readable error (PatchApplyError message) — all-or-nothing. */
  apply: (ops: PatchOp[]) => string | null;
}
export function registerEditorBridge(b: EditorBridge): void
export function unregisterEditorBridge(id: string): void
export function getEditorBridge(): EditorBridge | null
```

- [ ] **Step 1: Implement `editorBridge.ts`** (a `let current: EditorBridge | null` module; `unregisterEditorBridge` clears only if `current?.entityId === id`).
- [ ] **Step 2: Register in `EditorPage`** — an effect that re-registers whenever the live values change, so `apply` never closes over stale state:

```tsx
useEffect(() => {
  if (!store.definition) return;
  registerEditorBridge({
    entityId,
    readOnly: store.readOnly,
    apply: (ops) => {
      try {
        const next = applyPatch(store.machine, store.steps, ops);
        store.setMachine(next.machine);
        store.setSteps(next.steps);
        if (next.channelAccess) store.setChannelAccess(next.channelAccess);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  });
  return () => unregisterEditorBridge(entityId);
}, [entityId, store.definition, store.readOnly, store.machine, store.steps]);
```

- [ ] **Step 3: `PatchCard.tsx`** — summary bullets + op count; **Apply** disabled (with `t('assistant.readOnly')` note) when `getEditorBridge()?.readOnly !== false` or the bridge's `entityId` doesn't match the current route; on Apply: `const err = bridge.apply(proposal.ops)`; success → replace actions with `t('assistant.applied')` and `onDone(t('assistant.patchAppliedMsg'))`; failure → inline `t('assistant.applyFailed')`: message, card stays actionable. **Dismiss** hides the actions. i18n `assistant.patchAppliedMsg` (en: `Applied — the editor and validation rail are updated. Anything else?`, zh: `已应用 — 编辑器与校验栏已更新。还需要修改吗？`).
- [ ] **Step 4: Wire into `renderProposalCard`** for `action === 'patch'`.
- [ ] **Step 5: Verify live (the load-bearing loop)** — in the editor on a draft: ask "add a staff approval stage between submission and completion"; Apply; confirm the stage editor shows the new stage without reload, autosave fires (save indicator), and validation errors (if any) appear on the rail; then ask a follow-up ("why is there an error?") and confirm the assistant sees the fresh errors (server-side context reload per request). Verify read-only: open a published row, patch card must be disabled with the read-only note.
- [ ] **Step 6: `npm run build && npm run lint && npm test` green. Commit** — `feat(apexflow): patch proposal card wired to the editor draft store`

---

### Task 12: Full verification pass

**Files:** none new (fixes only, if found)

- [ ] **Step 1: Full suites** — apexflow backend (`uv run python -m pytest backend/tests/ -v`), apexflow frontend (`npm test && npm run build && npm run lint`). Also run datacore, admindash, familyhub suites to prove no cross-service regression (Task 2 touched shared creation paths only within apexflow, but the suites are cheap insurance).
- [ ] **Step 2: `workflow-forms` CI trap check** — apexflow frontend build depends on the symlinked package; confirm `.github/workflows/deploy.yml`'s apexflow job still runs `npm ci` in `workflow-forms` first (no change expected; verify, don't assume).
- [ ] **Step 3: End-to-end walkthrough** (real `ANTHROPIC_API_KEY`): (a) from the Workflows list, chip → "Start a registration workflow from a template" → card → Create → editor; (b) refine via chat: add a documents step, add an approval stage, set family channel; (c) publish through the existing dialog; (d) from-scratch path: "build a 2-stage feedback workflow from scratch" → card → Create → valid draft. Record what broke and fix before proceeding.
- [ ] **Step 4: Mutation spot-checks** (per `feedback_verify_by_mutation`): break `validate_ops`'s discriminator handling → backend op tests fail; break `applyPatch`'s all-or-nothing (return partial on throw) → frontend test fails. Revert both.
- [ ] **Step 5: Docs** — add a `## Chat assistant` section to root `CLAUDE.md`'s apexflow bullet (one sentence: drawer, proposal cards, no direct writes) and mark the spec's status line `Implemented`.
- [ ] **Step 6: Commit** — `docs(apexflow): chat workflow builder shipped`
