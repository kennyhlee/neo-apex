# AdminDash Home Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible LLM chat panel to the left of the AdminDash home page that answers questions and runs (confirmed) write actions by calling the existing AdminDash APIs as tools.

**Architecture:** A Pydantic-AI agent runs in-process in the admindash FastAPI backend behind a new `POST /api/chat` SSE endpoint. Tools are Python functions that call DataCore (query, entity CRUD, duplicate-check) forwarding the caller's JWT; the tenant is derived server-side from the authenticated user, never from the model. Reads execute immediately; writes are returned as *proposals* that the frontend confirms before calling the existing create endpoints. The frontend is a custom React panel streaming over SSE, styled with `ui-tokens` — no AG-UI/CopilotKit dependency (Pydantic-AI keeps the AG-UI upgrade path open).

**Tech Stack:** Python 3.11 / FastAPI / httpx / pydantic-ai (backend); React 19 / TypeScript / Vite / `idb` / CSS variables (frontend). Backend tests: pytest + pytest-asyncio + respx + pydantic-ai `FunctionModel`.

## Global Constraints

- Backend package: `admindash-backend`; run from `admindash/` with `uv run ... --app-dir backend`. Tests: `uv run pytest backend/tests/ -v`.
- New dependency: `pydantic-ai>=0.0.30` added to `admindash/pyproject.toml` `dependencies`.
- All backend settings use `env_prefix="ADMINDASH_"`, `case_sensitive=False` (see `app/config.py`).
- Tenant scope MUST come from the authenticated user object returned by `require_authenticated_user` (its `tenant_id`), never from a model/tool argument or request body.
- The authenticated user's JWT header is available as `user["_token"]` (full `"Bearer …"` string). Forward it verbatim to DataCore.
- DataCore query contract: `POST {datacore_url}/api/query` with `{"tenant_id","table","sql"}` → `{"data":[...],"total":N}`; the table alias inside `sql` is `data`; active rows have `_status = 'active'`.
- LLM must never be called in tests: set `pydantic_ai.models.ALLOW_MODEL_REQUESTS = False` and override with `FunctionModel`.
- Frontend base URL + `authHeaders()` come from existing `src/config.ts` and `src/api/client.ts`; token key is `neoapex_token`.
- Default chat model: `anthropic:claude-haiku-4-5-20251001`, overridable via `ADMINDASH_CHAT_MODEL`.
- Frontend has no test runner; frontend tasks are verified by `npm run build` (tsc) + `npm run lint` and manual check.
- Commit after every task. Use SSH remotes. Do not push or open PRs unless asked.

---

## File Structure

Backend (`admindash/backend/app/`):
- `config.py` — *modify*: add chat settings.
- `chat/__init__.py` — *create*: empty package marker.
- `chat/datacore.py` — *create*: thin async DataCore query/create/duplicate-check helpers + SQL literal escaping.
- `chat/tools.py` — *create*: `ChatDeps` dataclass + read tools + write-proposal tools registered on the agent.
- `chat/agent.py` — *create*: agent construction, system prompt, model selection, history conversion.
- `chat/stream.py` — *create*: SSE event dataclasses/serialization + the async generator that runs `agent.iter()` and yields SSE lines.
- `api/chat.py` — *create*: `POST /api/chat` route.
- `main.py` — *modify*: include the chat router.

Backend tests (`admindash/backend/tests/`):
- `test_chat_config.py`, `test_chat_tools.py`, `test_chat_proposals.py`, `test_chat_endpoint.py` — *create*.

Frontend (`admindash/frontend/src/`):
- `api/chat.ts` — *create*: SSE client + types.
- `components/ChatPanel.tsx` / `ChatPanel.css` — *create*.
- `components/QuickActions.tsx` / `QuickActions.css` — *create*.
- `components/ProposalCard.tsx` / `ProposalCard.css` — *create*.
- `chat/quickActions.ts` — *create*: default chips + `idb` persistence.
- `pages/HomePage.tsx` / `HomePage.css` — *modify*: two-column layout.

**Schema assumption (verify during Task 3/manual test):** "students in a program" resolves via `programs` (match `name`/`program_name`) → `enrollment` entities filtered by `program_id` → `student` entities by `student_id`. Field names are tenant-defined; unit tests mock DataCore responses, so field-name accuracy is confirmed in manual verification and the SQL adjusted if the tenant model differs.

---

### Task 1: Chat configuration + dependency

**Files:**
- Modify: `admindash/pyproject.toml` (dependencies)
- Modify: `admindash/backend/app/config.py`
- Create: `admindash/backend/tests/test_chat_config.py`

**Interfaces:**
- Produces: `Settings` gains `chat_model: str`, `chat_max_tokens: int`, `chat_history_turns: int`, `chat_session_message_cap: int`. Read via the existing module-level `settings` object.

- [ ] **Step 1: Add the dependency**

In `admindash/pyproject.toml`, add to the `[project].dependencies` array (keep existing entries):

```toml
    "pydantic-ai>=0.0.30",
```

Then run: `cd admindash && uv sync --extra dev`
Expected: resolves and installs `pydantic-ai`.

- [ ] **Step 2: Write the failing test**

Create `admindash/backend/tests/test_chat_config.py`:

```python
from app.config import Settings


def test_chat_defaults():
    s = Settings()
    assert s.chat_model == "anthropic:claude-haiku-4-5-20251001"
    assert s.chat_max_tokens == 1024
    assert s.chat_history_turns == 8
    assert s.chat_session_message_cap == 30


def test_chat_model_env_override(monkeypatch):
    monkeypatch.setenv("ADMINDASH_CHAT_MODEL", "ollama:llama3.2")
    assert Settings().chat_model == "ollama:llama3.2"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_chat_config.py -v`
Expected: FAIL (`AttributeError`/validation — fields don't exist yet).

- [ ] **Step 4: Add the settings fields**

In `admindash/backend/app/config.py`, inside the `Settings` class body (alongside the existing fields), add:

```python
    chat_model: str = "anthropic:claude-haiku-4-5-20251001"
    chat_max_tokens: int = 1024
    chat_history_turns: int = 8
    chat_session_message_cap: int = 30
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd admindash && uv run pytest backend/tests/test_chat_config.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add admindash/pyproject.toml admindash/uv.lock admindash/backend/app/config.py admindash/backend/tests/test_chat_config.py
git commit -m "feat(admindash): add chat config settings + pydantic-ai dep"
```

---

### Task 2: DataCore helpers + read tools

**Files:**
- Create: `admindash/backend/app/chat/__init__.py`
- Create: `admindash/backend/app/chat/datacore.py`
- Create: `admindash/backend/app/chat/tools.py`
- Create: `admindash/backend/tests/test_chat_tools.py`

**Interfaces:**
- Produces:
  - `ChatDeps` dataclass: `tenant_id: str`, `token: str`, `datacore_url: str`, `pending_proposals: list[dict]` (default empty).
  - `sql_literal(value: str) -> str` — returns a single-quoted, escaped SQL string literal.
  - `async def dc_query(deps: ChatDeps, sql: str) -> list[dict]` — POSTs to DataCore query, returns `data`.
  - `build_read_agent()` is NOT here; tools are registered onto the agent created in Task 4 via `register_tools(agent)`. This task defines `register_read_tools(agent)`.
- Consumes: `Settings` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `admindash/backend/tests/test_chat_tools.py`:

```python
import httpx
import pytest
import respx

from pydantic_ai import Agent
from pydantic_ai import models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart

from app.chat.tools import ChatDeps, register_read_tools
from app.chat.datacore import sql_literal

models.ALLOW_MODEL_REQUESTS = False
pytestmark = pytest.mark.anyio

DATACORE = "http://datacore.test"


def test_sql_literal_escapes_quotes():
    assert sql_literal("O'Brien") == "'O''Brien'"


def _agent_that_calls(tool_name: str, args: dict) -> Agent:
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool_name, args)])
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_read_tools(agent)
    return agent


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_find_student_queries_datacore():
    agent = _agent_that_calls("find_student", {"last_name": "Lovelace"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE,
                    pending_proposals=[])
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query").mock(
            return_value=httpx.Response(
                200, json={"data": [{"entity_id": "stu_1", "first_name": "Ada",
                                     "last_name": "Lovelace"}], "total": 1})
        )
        result = await agent.run("find Lovelace", deps=deps)
    assert route.called
    sent = route.calls.last.request
    assert b"entity_type = 'student'" in sent.content
    assert b"'Lovelace'" in sent.content
    assert "Ada" in result.output
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_chat_tools.py -v`
Expected: FAIL (`ModuleNotFoundError: app.chat`).

- [ ] **Step 3: Create the package marker**

Create `admindash/backend/app/chat/__init__.py` (empty file).

- [ ] **Step 4: Implement the DataCore helpers**

Create `admindash/backend/app/chat/datacore.py`:

```python
from dataclasses import dataclass, field

import httpx


@dataclass
class ChatDeps:
    tenant_id: str
    token: str
    datacore_url: str
    pending_proposals: list[dict] = field(default_factory=list)


def sql_literal(value: str) -> str:
    """Return a safe single-quoted SQL string literal."""
    return "'" + str(value).replace("'", "''") + "'"


async def dc_query(deps: ChatDeps, sql: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/query",
            json={"tenant_id": deps.tenant_id, "table": "entities", "sql": sql},
            headers={"Authorization": deps.token},
        )
    resp.raise_for_status()
    return resp.json().get("data", [])


async def dc_create(deps: ChatDeps, entity_type: str, base_data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/entities/{deps.tenant_id}/{entity_type}",
            json={"base_data": base_data, "custom_fields": {}},
            headers={"Authorization": deps.token},
        )
    resp.raise_for_status()
    return resp.json()


async def dc_duplicate_check(deps: ChatDeps, entity_type: str, fields: dict) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/entities/{deps.tenant_id}/{entity_type}/duplicate-check",
            json=fields,
            headers={"Authorization": deps.token},
        )
    if resp.status_code != 200:
        return []
    return resp.json().get("duplicates", [])
```

- [ ] **Step 5: Implement the read tools**

Create `admindash/backend/app/chat/tools.py`:

```python
from pydantic_ai import Agent, RunContext

from app.chat.datacore import (
    ChatDeps,
    dc_create,
    dc_duplicate_check,
    dc_query,
    sql_literal,
)

_ACTIVE = "_status = 'active'"


def _fmt_students(rows: list[dict]) -> str:
    if not rows:
        return "No matching students found."
    lines = []
    for r in rows[:25]:
        lines.append(
            f"- {r.get('first_name','')} {r.get('last_name','')} "
            f"(id={r.get('entity_id','?')}, status={r.get('status','?')})"
        )
    more = "" if len(rows) <= 25 else f"\n…and {len(rows) - 25} more."
    return "\n".join(lines) + more


def register_read_tools(agent: Agent) -> None:
    @agent.tool
    async def find_student(
        ctx: RunContext[ChatDeps],
        first_name: str | None = None,
        last_name: str | None = None,
    ) -> str:
        """Find students by first and/or last name (case-insensitive contains)."""
        where = [f"entity_type = 'student'", _ACTIVE]
        if first_name:
            where.append(f"LOWER(first_name) LIKE LOWER({sql_literal('%' + first_name + '%')})")
        if last_name:
            where.append(f"LOWER(last_name) LIKE LOWER({sql_literal('%' + last_name + '%')})")
        rows = await dc_query(ctx.deps, f"SELECT * FROM data WHERE {' AND '.join(where)}")
        return _fmt_students(rows)

    @agent.tool
    async def get_student(ctx: RunContext[ChatDeps], student_id: str) -> str:
        """Get a single student by entity id."""
        rows = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'student' "
            f"AND entity_id = {sql_literal(student_id)} AND {_ACTIVE}",
        )
        return _fmt_students(rows)

    @agent.tool
    async def count_students(ctx: RunContext[ChatDeps], status: str | None = None) -> str:
        """Count students, optionally filtered by status (e.g. 'Enrolled')."""
        where = ["entity_type = 'student'", _ACTIVE]
        if status:
            where.append(f"status = {sql_literal(status)}")
        rows = await dc_query(ctx.deps, f"SELECT entity_id FROM data WHERE {' AND '.join(where)}")
        label = f" with status {status!r}" if status else ""
        return f"{len(rows)} student(s){label}."

    @agent.tool
    async def list_programs(ctx: RunContext[ChatDeps]) -> str:
        """List all programs."""
        rows = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'program' AND {_ACTIVE}",
        )
        if not rows:
            return "No programs found."
        return "\n".join(
            f"- {r.get('name') or r.get('program_name','?')} (id={r.get('entity_id','?')})"
            for r in rows[:50]
        )

    @agent.tool
    async def list_students_in_program(ctx: RunContext[ChatDeps], program_name: str) -> str:
        """List students enrolled in a program, by program name."""
        progs = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'program' AND {_ACTIVE} "
            f"AND (LOWER(name) LIKE LOWER({sql_literal('%' + program_name + '%')}) "
            f"OR LOWER(program_name) LIKE LOWER({sql_literal('%' + program_name + '%')}))",
        )
        if not progs:
            return f"No program matching {program_name!r}."
        pid = progs[0].get("entity_id")
        enr = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'enrollment' AND {_ACTIVE} "
            f"AND program_id = {sql_literal(pid)}",
        )
        student_ids = [e.get("student_id") for e in enr if e.get("student_id")]
        if not student_ids:
            return f"No students enrolled in {program_name!r}."
        id_list = ", ".join(sql_literal(s) for s in student_ids)
        students = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'student' AND {_ACTIVE} "
            f"AND entity_id IN ({id_list})",
        )
        return _fmt_students(students)

    @agent.tool
    async def list_leads(ctx: RunContext[ChatDeps], stage: str | None = None) -> str:
        """List leads, optionally filtered by stage."""
        where = ["entity_type = 'lead'", _ACTIVE]
        if stage:
            where.append(f"stage = {sql_literal(stage)}")
        rows = await dc_query(ctx.deps, f"SELECT * FROM data WHERE {' AND '.join(where)}")
        if not rows:
            return "No matching leads found."
        return "\n".join(
            f"- {r.get('guardian_name','?')} "
            f"(student={r.get('student_first_name','')}, stage={r.get('stage','?')}, "
            f"id={r.get('entity_id','?')})"
            for r in rows[:25]
        )
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd admindash && uv run pytest backend/tests/test_chat_tools.py -v`
Expected: PASS (3 passed). If `anyio` backend errors appear, ensure `pytest-asyncio` picks `asyncio` (the `anyio_backend` fixture forces it).

- [ ] **Step 7: Commit**

```bash
git add admindash/backend/app/chat/ admindash/backend/tests/test_chat_tools.py
git commit -m "feat(admindash): chat read tools calling DataCore query"
```

---

### Task 3: Write-proposal tools

**Files:**
- Modify: `admindash/backend/app/chat/tools.py`
- Create: `admindash/backend/tests/test_chat_proposals.py`

**Interfaces:**
- Produces: `register_write_tools(agent)` adding `propose_create_student` and `propose_create_lead`. Each appends a proposal dict to `ctx.deps.pending_proposals` and returns a short instruction string; **neither writes to DataCore.** Proposal dict shape: `{"action": "create_student"|"create_lead", "entity_type": str, "fields": dict, "duplicates": list}`.

- [ ] **Step 1: Write the failing test**

Create `admindash/backend/tests/test_chat_proposals.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_chat_proposals.py -v`
Expected: FAIL (`ImportError: cannot import name 'register_write_tools'`).

- [ ] **Step 3: Implement the write-proposal tools**

Append to `admindash/backend/app/chat/tools.py`:

```python
def register_write_tools(agent: Agent) -> None:
    @agent.tool
    async def propose_create_student(
        ctx: RunContext[ChatDeps],
        first_name: str,
        last_name: str,
        grade_level: str | None = None,
    ) -> str:
        """Prepare (but do NOT execute) creation of a new student.
        The user must confirm before it is created."""
        fields = {"first_name": first_name, "last_name": last_name}
        if grade_level:
            fields["grade_level"] = grade_level
        dupes = await dc_duplicate_check(ctx.deps, "student", fields)
        ctx.deps.pending_proposals.append(
            {"action": "create_student", "entity_type": "student",
             "fields": fields, "duplicates": dupes}
        )
        note = " Possible duplicates were found." if dupes else ""
        return ("Prepared a new-student proposal awaiting the user's confirmation."
                + note + " Tell the user to review and confirm.")

    @agent.tool
    async def propose_create_lead(
        ctx: RunContext[ChatDeps],
        guardian_name: str,
        email: str | None = None,
        phone: str | None = None,
        student_first_name: str | None = None,
    ) -> str:
        """Prepare (but do NOT execute) creation of a new lead.
        The user must confirm before it is created."""
        fields = {"guardian_name": guardian_name}
        for k, v in (("email", email), ("phone", phone),
                     ("student_first_name", student_first_name)):
            if v:
                fields[k] = v
        ctx.deps.pending_proposals.append(
            {"action": "create_lead", "entity_type": "lead",
             "fields": fields, "duplicates": []}
        )
        return ("Prepared a new-lead proposal awaiting the user's confirmation. "
                "Tell the user to review and confirm.")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admindash && uv run pytest backend/tests/test_chat_proposals.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/chat/tools.py admindash/backend/tests/test_chat_proposals.py
git commit -m "feat(admindash): confirm-before-execute write proposal tools"
```

---

### Task 4: Agent, SSE stream, and `/api/chat` endpoint

**Files:**
- Create: `admindash/backend/app/chat/agent.py`
- Create: `admindash/backend/app/chat/stream.py`
- Create: `admindash/backend/app/api/chat.py`
- Modify: `admindash/backend/app/main.py`
- Create: `admindash/backend/tests/test_chat_endpoint.py`

**Interfaces:**
- Consumes: `ChatDeps`, `register_read_tools`, `register_write_tools` (Tasks 2–3); `require_authenticated_user` and `settings` (existing).
- Produces:
  - `build_chat_agent(model=None) -> Agent` — builds the agent with system prompt + all tools; `model` overrides config (used by tests to inject `FunctionModel`).
  - `to_message_history(turns: list[dict], limit: int) -> list` — converts `{"role","content"}` turns to pydantic-ai messages, keeping the last `limit`.
  - `sse_chat(agent, deps, message, history) -> AsyncIterator[str]` — yields `data: {json}\n\n` lines with events `{"type": "token"|"tool"|"proposal"|"done"|"error", ...}`.
  - Route `POST /api/chat` body: `{"message": str, "history": [{"role","content"}], "message_count": int}` → `text/event-stream`.

- [ ] **Step 1: Write the failing test**

Create `admindash/backend/tests/test_chat_endpoint.py`:

```python
import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from pydantic_ai import models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart

import app.api.chat as chat_api
from app.chat.agent import build_chat_agent, to_message_history
from app.main import app

models.ALLOW_MODEL_REQUESTS = False
DATACORE = "http://localhost:5800"


def test_to_message_history_trims():
    turns = [{"role": "user", "content": f"m{i}"} for i in range(20)]
    msgs = to_message_history(turns, limit=4)
    assert len(msgs) == 4


def _text_only_agent():
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart("Hello from the assistant.")])
    return build_chat_agent(model=FunctionModel(responder))


def test_chat_endpoint_streams_tokens(monkeypatch):
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    client = TestClient(app)
    with respx.mock:
        respx.get(f"{DATACORE}/auth/me").mock(
            return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"}))
        resp = client.post(
            "/api/chat",
            headers={"Authorization": "Bearer tok"},
            json={"message": "hi", "history": [], "message_count": 0},
        )
    assert resp.status_code == 200
    body = resp.text
    assert "text/event-stream" in resp.headers["content-type"]
    tokens = [json.loads(l[5:]) for l in body.splitlines() if l.startswith("data:")]
    assert any(t["type"] == "token" for t in tokens)
    assert any(t["type"] == "done" for t in tokens)
    assert "Hello" in "".join(t.get("text", "") for t in tokens if t["type"] == "token")


def test_chat_endpoint_rejects_over_cap(monkeypatch):
    monkeypatch.setattr(chat_api, "build_chat_agent", _text_only_agent)
    client = TestClient(app)
    with respx.mock:
        respx.get(f"{DATACORE}/auth/me").mock(
            return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"}))
        resp = client.post(
            "/api/chat",
            headers={"Authorization": "Bearer tok"},
            json={"message": "hi", "history": [], "message_count": 999},
        )
    assert resp.status_code == 429
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_chat_endpoint.py -v`
Expected: FAIL (`ModuleNotFoundError: app.chat.agent`).

- [ ] **Step 3: Implement the agent builder**

Create `admindash/backend/app/chat/agent.py`:

```python
from pydantic_ai import Agent, ModelRequest, ModelResponse, TextPart, UserPromptPart

from app.chat.datacore import ChatDeps
from app.chat.tools import register_read_tools, register_write_tools
from app.config import settings

SYSTEM_PROMPT = (
    "You are the AdminDash assistant for a school administrator. "
    "Answer questions about students, programs, and leads by calling the provided tools. "
    "Never invent data; if a tool returns nothing, say so. "
    "For any create/add action, call the matching propose_* tool and then ask the user "
    "to review and confirm — never claim a record was created yourself. "
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
```

- [ ] **Step 4: Implement the SSE stream generator**

Create `admindash/backend/app/chat/stream.py`:

```python
import json
from typing import AsyncIterator

from pydantic_ai import Agent
from pydantic_ai import (
    FunctionToolCallEvent,
    PartDeltaEvent,
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
```

- [ ] **Step 5: Implement the route**

Create `admindash/backend/app/api/chat.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import require_authenticated_user
from app.chat.agent import build_chat_agent, to_message_history
from app.chat.datacore import ChatDeps
from app.chat.stream import sse_chat
from app.config import settings

router = APIRouter(prefix="/api", tags=["chat"])


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
```

- [ ] **Step 6: Register the router**

In `admindash/backend/app/main.py`, add near the other `include_router` calls (mirror the existing import style):

```python
from app.api import chat as chat_router  # add with the other api imports
...
app.include_router(chat_router.router)   # add with the other include_router calls
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd admindash && uv run pytest backend/tests/test_chat_endpoint.py -v`
Expected: PASS (3 passed). Then run the full suite: `uv run pytest backend/tests/ -v` — all prior tests still pass.

- [ ] **Step 8: Commit**

```bash
git add admindash/backend/app/chat/agent.py admindash/backend/app/chat/stream.py admindash/backend/app/api/chat.py admindash/backend/app/main.py admindash/backend/tests/test_chat_endpoint.py
git commit -m "feat(admindash): /api/chat SSE endpoint with pydantic-ai agent"
```

---

### Task 5: Frontend SSE chat client

**Files:**
- Create: `admindash/frontend/src/api/chat.ts`

**Interfaces:**
- Consumes: `API_BASE_URL` from `src/config.ts` and the `authHeaders()`/token pattern from `src/api/client.ts` (read that file first and reuse its exact export).
- Produces:
  - Types `ChatTurn`, `Proposal`, `ChatEvent`.
  - `async function* streamChat(message, history, messageCount, signal): AsyncGenerator<ChatEvent>`.

- [ ] **Step 1: Read the existing client for exact patterns**

Read `admindash/frontend/src/api/client.ts` and `admindash/frontend/src/config.ts`. Note the exact name of the base-URL export (referred to below as `API_BASE_URL`) and the auth-header helper; use those exact names.

- [ ] **Step 2: Implement the SSE client**

Create `admindash/frontend/src/api/chat.ts`:

```typescript
import { API_BASE_URL } from '../config';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export interface Proposal {
  action: 'create_student' | 'create_lead';
  entity_type: string;
  fields: Record<string, string>;
  duplicates: Array<Record<string, unknown>>;
}

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'done' }
  | { type: 'error'; message: string };

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('neoapex_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function* streamChat(
  message: string,
  history: ChatTurn[],
  messageCount: number,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const resp = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ message, history, message_count: messageCount }),
    signal,
  });
  if (resp.status === 429) { yield { type: 'error', message: 'Conversation limit reached. Start a new chat.' }; return; }
  if (!resp.ok || !resp.body) { yield { type: 'error', message: `Request failed (${resp.status})` }; return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { yield JSON.parse(line.slice(5).trim()) as ChatEvent; } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd admindash/frontend && npm run build`
Expected: TypeScript passes (if `API_BASE_URL` has a different export name, fix the import to match Step 1).

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/api/chat.ts
git commit -m "feat(admindash): frontend SSE chat client"
```

---

### Task 6: Quick-actions storage + component

**Files:**
- Create: `admindash/frontend/src/chat/quickActions.ts`
- Create: `admindash/frontend/src/components/QuickActions.tsx`
- Create: `admindash/frontend/src/components/QuickActions.css`

**Interfaces:**
- Produces:
  - `DEFAULT_QUICK_ACTIONS: string[]` (≤10 prompts).
  - `async function loadQuickActions(): Promise<string[]>` and `async function saveQuickActions(items: string[]): Promise<void>` using `idb`.
  - `QuickActions` component props: `{ onPick: (prompt: string) => void }`.

- [ ] **Step 1: Implement storage helpers**

Create `admindash/frontend/src/chat/quickActions.ts`:

```typescript
import { openDB } from 'idb';

const DB = 'admindash-chat';
const STORE = 'prefs';
const KEY = 'quickActions';
export const MAX_QUICK_ACTIONS = 10;

export const DEFAULT_QUICK_ACTIONS: string[] = [
  'Add a new student',
  'Find a student by name',
  'List students in a program',
  'How many students are enrolled?',
  'Show new leads',
  'Add a lead',
  'List programs',
];

async function db() {
  return openDB(DB, 1, { upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); } });
}

export async function loadQuickActions(): Promise<string[]> {
  const stored = (await (await db()).get(STORE, KEY)) as string[] | undefined;
  return stored?.length ? stored.slice(0, MAX_QUICK_ACTIONS) : DEFAULT_QUICK_ACTIONS;
}

export async function saveQuickActions(items: string[]): Promise<void> {
  await (await db()).put(STORE, items.slice(0, MAX_QUICK_ACTIONS), KEY);
}
```

- [ ] **Step 2: Implement the component**

Create `admindash/frontend/src/components/QuickActions.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  DEFAULT_QUICK_ACTIONS, MAX_QUICK_ACTIONS, loadQuickActions, saveQuickActions,
} from '../chat/quickActions';
import './QuickActions.css';

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  const [items, setItems] = useState<string[]>(DEFAULT_QUICK_ACTIONS);
  const [editing, setEditing] = useState(false);

  useEffect(() => { loadQuickActions().then(setItems); }, []);

  const update = (next: string[]) => { setItems(next); void saveQuickActions(next); };

  return (
    <div className="quick-actions">
      <div className="quick-actions__head">
        <span>Quick questions</span>
        <button className="quick-actions__edit" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="quick-actions__chips">
        {items.map((q, i) =>
          editing ? (
            <div className="quick-actions__row" key={i}>
              <input value={q} onChange={(e) => {
                const next = [...items]; next[i] = e.target.value; update(next);
              }} />
              <button onClick={() => update(items.filter((_, j) => j !== i))}>✕</button>
            </div>
          ) : (
            <button className="chip" key={i} onClick={() => onPick(q)}>{q}</button>
          ),
        )}
        {editing && items.length < MAX_QUICK_ACTIONS && (
          <button className="quick-actions__add" onClick={() => update([...items, 'New question'])}>
            + Add
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Style it**

Create `admindash/frontend/src/components/QuickActions.css`:

```css
.quick-actions { display: flex; flex-direction: column; gap: 0.5rem; }
.quick-actions__head { display: flex; justify-content: space-between; align-items: center;
  font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
.quick-actions__edit { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.75rem; }
.quick-actions__chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chip { background: var(--accent-muted); color: var(--accent); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); padding: 0.3rem 0.6rem; font-size: 0.8rem; cursor: pointer; }
.chip:hover { background: var(--accent); color: var(--text-inverse); }
.quick-actions__row { display: flex; gap: 0.25rem; width: 100%; }
.quick-actions__row input { flex: 1; padding: 0.3rem; border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm); font-size: 0.8rem; }
.quick-actions__add { background: none; border: 1px dashed var(--border-primary);
  border-radius: var(--radius-sm); padding: 0.3rem 0.6rem; cursor: pointer; color: var(--text-secondary); }
```

- [ ] **Step 4: Verify build**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/chat/quickActions.ts admindash/frontend/src/components/QuickActions.tsx admindash/frontend/src/components/QuickActions.css
git commit -m "feat(admindash): editable quick-action chips with idb persistence"
```

---

### Task 7: Proposal confirmation card

**Files:**
- Create: `admindash/frontend/src/components/ProposalCard.tsx`
- Create: `admindash/frontend/src/components/ProposalCard.css`

**Interfaces:**
- Consumes: `Proposal` type from `src/api/chat.ts`; the existing create call from `src/api/client.ts` (read it — reuse the exact entity-create export; referred to below as `createEntity(tenantId, entityType, baseData)`).
- Produces: `ProposalCard` props `{ proposal: Proposal; tenantId: string; onDone: (msg: string) => void }`.

- [ ] **Step 1: Confirm the create helper**

Read `admindash/frontend/src/api/client.ts`; find the exact entity-create function and its signature. Use that in Step 2 (adjust the call if the name/shape differs from `createEntity`).

- [ ] **Step 2: Implement the card**

Create `admindash/frontend/src/components/ProposalCard.tsx`:

```tsx
import { useState } from 'react';
import type { Proposal } from '../api/chat';
import { createEntity } from '../api/client';
import './ProposalCard.css';

export function ProposalCard(
  { proposal, tenantId, onDone }:
  { proposal: Proposal; tenantId: string; onDone: (msg: string) => void },
) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const confirm = async () => {
    setState('saving');
    try {
      await createEntity(tenantId, proposal.entity_type, proposal.fields);
      setState('saved');
      onDone(`Created ${proposal.entity_type}: ${Object.values(proposal.fields).join(' ')}`);
    } catch (e) {
      setState('idle');
      onDone(`Failed to create ${proposal.entity_type}.`);
    }
  };

  return (
    <div className="proposal-card">
      <div className="proposal-card__title">Confirm: create {proposal.entity_type}</div>
      <dl className="proposal-card__fields">
        {Object.entries(proposal.fields).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {proposal.duplicates.length > 0 && (
        <div className="proposal-card__warn">
          ⚠ {proposal.duplicates.length} possible duplicate(s) found.
        </div>
      )}
      {state === 'saved' ? (
        <div className="proposal-card__ok">✓ Created</div>
      ) : (
        <div className="proposal-card__actions">
          <button className="proposal-card__cancel" disabled={state === 'saving'}
            onClick={() => onDone('Cancelled.')}>Cancel</button>
          <button className="proposal-card__confirm" disabled={state === 'saving'}
            onClick={confirm}>{state === 'saving' ? 'Saving…' : 'Confirm'}</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Style it**

Create `admindash/frontend/src/components/ProposalCard.css`:

```css
.proposal-card { border: 1px solid var(--border-accent, var(--accent)); border-radius: var(--radius-md);
  background: var(--bg-secondary); padding: 0.75rem; margin: 0.5rem 0; box-shadow: var(--shadow-card); }
.proposal-card__title { font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem; }
.proposal-card__fields { display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.75rem; font-size: 0.85rem; }
.proposal-card__fields dt { color: var(--text-tertiary); }
.proposal-card__fields dd { color: var(--text-primary); margin: 0; }
.proposal-card__warn { color: var(--warning); font-size: 0.8rem; margin-top: 0.5rem; }
.proposal-card__actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.75rem; }
.proposal-card__confirm { background: var(--accent); color: var(--text-inverse); border: none;
  border-radius: var(--radius-sm); padding: 0.4rem 0.8rem; cursor: pointer; }
.proposal-card__cancel { background: none; border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm); padding: 0.4rem 0.8rem; cursor: pointer; }
.proposal-card__ok { color: var(--success); font-weight: 600; margin-top: 0.5rem; }
```

- [ ] **Step 4: Verify build**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/components/ProposalCard.tsx admindash/frontend/src/components/ProposalCard.css
git commit -m "feat(admindash): proposal confirmation card for chat writes"
```

---

### Task 8: ChatPanel component

**Files:**
- Create: `admindash/frontend/src/components/ChatPanel.tsx`
- Create: `admindash/frontend/src/components/ChatPanel.css`

**Interfaces:**
- Consumes: `streamChat`, `ChatTurn`, `Proposal` (Task 5); `QuickActions` (Task 6); `ProposalCard` (Task 7); `useAuth()` for `user.tenant_id`.
- Produces: `ChatPanel` component (no required props); manages transcript, streaming, quick-action pick, proposals, and message-count cap.

- [ ] **Step 1: Implement the panel**

Create `admindash/frontend/src/components/ChatPanel.tsx`:

```tsx
import { useRef, useState } from 'react';
import { streamChat, type ChatTurn, type Proposal } from '../api/chat';
import { useAuth } from '../contexts/AuthContext';
import { QuickActions } from './QuickActions';
import { ProposalCard } from './ProposalCard';
import './ChatPanel.css';

interface Msg { role: 'user' | 'assistant'; content: string; proposals?: Proposal[]; }

export function ChatPanel() {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const proposals: Proposal[] = [];
    try {
      for await (const ev of streamChat(q, history, msgs.length, ac.signal)) {
        if (ev.type === 'token') {
          setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
            ...c[c.length - 1], content: c[c.length - 1].content + ev.text }; return c; });
        } else if (ev.type === 'proposal') {
          proposals.push(ev.proposal);
        } else if (ev.type === 'error') {
          setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
            ...c[c.length - 1], content: c[c.length - 1].content + `\n⚠ ${ev.message}` }; return c; });
        }
      }
    } finally {
      if (proposals.length) {
        setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
          ...c[c.length - 1], proposals }; return c; });
      }
      setBusy(false);
    }
  };

  const appendSystem = (content: string) =>
    setMsgs((m) => [...m, { role: 'assistant', content }]);

  return (
    <aside className="chat-panel">
      <div className="chat-panel__header">Assistant</div>
      <div className="chat-panel__log">
        {msgs.length === 0 && (
          <p className="chat-panel__empty">Ask about students, programs, or leads.</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            <div className="chat-msg__text">{m.content || (busy && i === msgs.length - 1 ? '…' : '')}</div>
            {m.proposals?.map((p, j) => (
              <ProposalCard key={j} proposal={p} tenantId={user?.tenant_id ?? ''}
                onDone={appendSystem} />
            ))}
          </div>
        ))}
      </div>
      <QuickActions onPick={send} />
      <form className="chat-panel__input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input value={input} placeholder="Ask a question…" disabled={busy}
          onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Style it**

Create `admindash/frontend/src/components/ChatPanel.css`:

```css
.chat-panel { display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--bg-secondary); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); overflow: hidden; }
.chat-panel__header { padding: 0.75rem 1rem; font-weight: 600; color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle); }
.chat-panel__log { flex: 1; overflow-y: auto; padding: 0.75rem; display: flex;
  flex-direction: column; gap: 0.5rem; }
.chat-panel__empty { color: var(--text-tertiary); font-size: 0.85rem; }
.chat-msg { display: flex; flex-direction: column; }
.chat-msg--user .chat-msg__text { align-self: flex-end; background: var(--accent);
  color: var(--text-inverse); }
.chat-msg--assistant .chat-msg__text { align-self: flex-start; background: var(--bg-tertiary);
  color: var(--text-primary); }
.chat-msg__text { padding: 0.5rem 0.75rem; border-radius: var(--radius-md);
  max-width: 90%; white-space: pre-wrap; font-size: 0.9rem; }
.chat-panel__input { display: flex; gap: 0.5rem; padding: 0.75rem;
  border-top: 1px solid var(--border-subtle); }
.chat-panel__input input { flex: 1; padding: 0.5rem; border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm); }
.chat-panel__input button { background: var(--accent); color: var(--text-inverse);
  border: none; border-radius: var(--radius-sm); padding: 0.5rem 0.9rem; cursor: pointer; }
.chat-panel__input button:disabled { opacity: 0.5; cursor: default; }
.quick-actions { padding: 0 0.75rem 0.5rem; }
```

- [ ] **Step 3: Verify build**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both pass. (If `useAuth`'s user shape differs, adjust `user?.tenant_id` to match the real type from `contexts/AuthContext`.)

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/components/ChatPanel.tsx admindash/frontend/src/components/ChatPanel.css
git commit -m "feat(admindash): ChatPanel with streaming, quick actions, proposals"
```

---

### Task 9: Home page two-column layout

**Files:**
- Modify: `admindash/frontend/src/pages/HomePage.tsx`
- Modify: `admindash/frontend/src/pages/HomePage.css`

**Interfaces:**
- Consumes: `ChatPanel` (Task 8).
- Produces: home page renders a collapsible left chat column beside existing content.

- [ ] **Step 1: Read the current home page**

Read `admindash/frontend/src/pages/HomePage.tsx` to find the top-level wrapper element (the `.home-page` div) and its return structure.

- [ ] **Step 2: Wrap content in a two-column layout**

In `HomePage.tsx`: import the panel and collapse state at the top:

```tsx
import { useState } from 'react';
import { ChatPanel } from '../components/ChatPanel';
```

Wrap the existing returned JSX. Replace the outermost `return ( <div className="home-page"> … </div> )` with:

```tsx
  const [chatOpen, setChatOpen] = useState(true);
  return (
    <div className={`home-layout ${chatOpen ? 'home-layout--chat-open' : ''}`}>
      <div className="home-chat-col">
        <button className="home-chat-toggle" onClick={() => setChatOpen((o) => !o)}>
          {chatOpen ? '‹ Hide assistant' : '› Assistant'}
        </button>
        {chatOpen && <ChatPanel />}
      </div>
      <div className="home-page">
        {/* existing home-page content stays here unchanged */}
      </div>
    </div>
  );
```

(Move the existing children of `.home-page` inside the inner `.home-page` div; do not otherwise change them. If the component uses early returns for loading states, leave those untouched.)

- [ ] **Step 3: Add layout CSS**

Append to `admindash/frontend/src/pages/HomePage.css`:

```css
.home-layout { display: grid; grid-template-columns: 1fr; gap: 1.25rem; align-items: start; }
.home-layout--chat-open { grid-template-columns: 360px 1fr; }
.home-chat-col { position: sticky; top: 72px; height: calc(100vh - 96px); display: flex;
  flex-direction: column; gap: 0.5rem; }
.home-chat-toggle { align-self: flex-start; background: none; border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm); padding: 0.3rem 0.6rem; cursor: pointer; color: var(--text-secondary);
  font-size: 0.8rem; }
@media (max-width: 992px) {
  .home-layout--chat-open { grid-template-columns: 1fr; }
  .home-chat-col { position: static; height: auto; }
}
```

- [ ] **Step 4: Verify build**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Manual verification**

Start the stack (`./start-services.sh`), log into AdminDash (port 5600), open Home. Confirm: chat panel on the left; quick-action chip sends a message; a read question ("how many students are enrolled?") streams an answer; "add a new student named Ada Lovelace" produces a proposal card that only writes on Confirm; Hide/Show toggle works; narrow window collapses to one column.

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/pages/HomePage.tsx admindash/frontend/src/pages/HomePage.css
git commit -m "feat(admindash): mount chat panel on home page (two-column layout)"
```

---

## Self-Review Notes

- **Spec coverage:** left-side panel (Task 9), ≤10 editable quick questions (Task 6), add-student / find-student / list-students-in-program + leads (Tasks 2–3), existing APIs as tools via in-process agent (Tasks 2–4), cost control — Haiku default + `max_tokens` + history trim + session cap + env-swappable/Ollama (Tasks 1, 4), AG-UI deferred (documented in spec; Pydantic-AI chosen to keep the path open), pros/cons (in the committed design spec).
- **Schema caveat:** `list_students_in_program` and program/lead field names are tenant-defined; unit tests mock DataCore, and Task 9 Step 5 manual check is where real field names are confirmed and SQL adjusted if needed.
- **Deferred (YAGNI):** AG-UI/generative UI, server-side conversation persistence, MCP facade, Ollama-as-default.
