# Chat General Query (Read-Only DataCore Endpoint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AdminDash chat answer arbitrary read questions by composing read-only SQL through a new guarded DataCore endpoint, replacing the hardcoded per-pattern read tools.

**Architecture:** Add `POST /api/query/readonly` to DataCore that validates SQL is read-only, caps rows, and calls the existing `QueryEngine.query()` with a hardened DuckDB connection (`enable_external_access=false`) — reuse, not duplicate. AdminDash chat gets two tools — `run_query(sql)` and `describe_schema()` — that use the read-only endpoint; the specific read tools are removed. Writes are unchanged (confirm-form → entity endpoints).

**Tech Stack:** Python, FastAPI, DuckDB + PyArrow (DataCore); FastAPI + httpx + pydantic-ai (AdminDash). Tests: pytest; AdminDash uses respx + pydantic-ai `FunctionModel`.

## Global Constraints

- Existing `POST /api/query` (`datacore/src/datacore/api/unified_routes.py`) stays unchanged — it is the internal/unrestricted path.
- The new endpoint's request/response contract matches `/api/query`: `{tenant_id, table, sql}` → `{data, total}`.
- Read-only validation rejects with HTTP 400 before execution: single statement (no `;`-chaining, a lone trailing `;` is stripped), first keyword `SELECT` or `WITH`, and a denylist of write/DDL keywords + DuckDB file/external function calls.
- Row cap `READONLY_MAX_ROWS = 200`, applied by wrapping the user SQL in a subquery so it composes with any inner `LIMIT`.
- `QueryEngine.query(..., external=True)` sets `SET enable_external_access=false` on the connection; `external=False` (default) leaves current behavior unchanged.
- Tenant scope always comes from the authenticated user server-side (AdminDash `ChatDeps.tenant_id`), never from the model.
- The readonly endpoint strips the `vector` column from returned rows (avoid huge embedding payloads).
- No live LLM in tests (`pydantic_ai.models.ALLOW_MODEL_REQUESTS = False`, `FunctionModel`).
- DataCore run dir: `datacore/`, tests `uv run python -m pytest tests/ -v`. AdminDash: `admindash/`, tests `uv run pytest backend/tests/ -v`.
- Deploy order: **DataCore release first**, then AdminDash (AdminDash calls the new endpoint).
- Commit after each task. Branch off main; do not push/PR unless asked.

## File Structure

DataCore:
- `src/datacore/query.py` — *modify*: add `external` param to `query()`.
- `src/datacore/api/readonly_query.py` — *create*: validation + `POST /api/query/readonly` + `register_readonly_query_routes`.
- `src/datacore/api/__init__.py` — *modify*: register the new routes in `create_app`.
- `tests/test_query_external.py`, `tests/test_readonly_query.py` — *create*.

AdminDash:
- `backend/app/chat/datacore.py` — *modify*: `dc_query` → `/api/query/readonly` + `table` param.
- `backend/app/chat/tools.py` — *modify*: remove specific read tools; add `run_query`, `describe_schema`.
- `backend/app/chat/agent.py` — *modify*: system prompt query guidance.
- `backend/tests/test_chat_tools.py` — *modify*: replace read-tool tests.

---

### Task 1: DataCore — `QueryEngine.query()` hardened mode

**Files:**
- Modify: `datacore/src/datacore/query.py`
- Test: `datacore/tests/test_query_external.py`

**Interfaces:**
- Produces: `QueryEngine.query(tenant_id, table_type, sql, limit=None, offset=None, external=False)`. When `external=True`, the DuckDB connection has `enable_external_access=false`. Return shape unchanged (`{"rows","total"}`).

- [ ] **Step 1: Write the failing test**

Create `datacore/tests/test_query_external.py`:

```python
"""External (hardened) query mode blocks filesystem access."""
import pytest


def test_external_mode_still_returns_rows(seeded_engine):
    r = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE entity_type = 'student'",
        external=True,
    )
    assert r["total"] == 3


def test_external_mode_blocks_file_functions(seeded_engine):
    with pytest.raises(Exception):
        seeded_engine.query(
            tenant_id="t1", table_type="entities",
            sql="SELECT * FROM read_csv('/etc/hosts')",
            external=True,
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && uv run python -m pytest tests/test_query_external.py -v`
Expected: FAIL — `query()` has no `external` kwarg (TypeError), or the read_csv test doesn't raise.

- [ ] **Step 3: Implement the flag**

In `datacore/src/datacore/query.py`, change the `query` signature and the connect block. Signature (add `external`):

```python
    def query(
        self,
        tenant_id: str,
        table_type: str,
        sql: str,
        limit: int | None = None,
        offset: int | None = None,
        external: bool = False,
    ) -> dict:
```

Right after `con = duckdb.connect()` add:

```python
        con = duckdb.connect()
        if external:
            # Untrusted (e.g. LLM-authored) SQL: block filesystem/network escape.
            con.execute("SET enable_external_access=false")
```

Leave the rest of the method unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd datacore && uv run python -m pytest tests/test_query_external.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/query.py datacore/tests/test_query_external.py
git commit -m "feat(datacore): add hardened external mode to QueryEngine.query"
```

---

### Task 2: DataCore — read-only query endpoint

**Files:**
- Create: `datacore/src/datacore/api/readonly_query.py`
- Modify: `datacore/src/datacore/api/__init__.py`
- Test: `datacore/tests/test_readonly_query.py`

**Interfaces:**
- Consumes: `QueryEngine.query(..., external=True)` (Task 1); `Store`.
- Produces:
  - `validate_readonly_sql(sql: str) -> str` — returns cleaned single-statement SQL or raises `ValueError`.
  - `POST /api/query/readonly` with body `{tenant_id, table, sql}` → `{data, total}` (rows have no `vector`).
  - `register_readonly_query_routes(app, store)`.
  - `READONLY_MAX_ROWS = 200`.

- [ ] **Step 1: Write the failing test**

Create `datacore/tests/test_readonly_query.py`:

```python
import pytest
from fastapi import HTTPException

from datacore.api import readonly_query as rq


def test_validate_accepts_select_and_with():
    assert rq.validate_readonly_sql("SELECT * FROM data") == "SELECT * FROM data"
    assert rq.validate_readonly_sql(
        "  WITH x AS (SELECT 1 AS n) SELECT * FROM x ;").startswith("WITH")


@pytest.mark.parametrize("bad", [
    "",
    "INSERT INTO data VALUES (1)",
    "UPDATE data SET x = 1",
    "DELETE FROM data",
    "DROP TABLE data",
    "SELECT 1; DROP TABLE data",
    "SELECT * FROM read_csv('/etc/hosts')",
    "ATTACH 'x.db' AS y",
    "COPY data TO '/tmp/x.csv'",
    "PRAGMA database_list",
])
def test_validate_rejects_non_readonly(bad):
    with pytest.raises(ValueError):
        rq.validate_readonly_sql(bad)


def test_validate_allows_column_named_like_function():
    # 'read_receipts' is a column, not the read_csv/read_* function call.
    assert "read_receipts" in rq.validate_readonly_sql(
        "SELECT read_receipts FROM data")


def test_endpoint_returns_rows_without_vector(seeded_store):
    rq._store = seeded_store
    out = rq.readonly_query(rq.ReadOnlyQueryRequest(
        tenant_id="t1", table="entities",
        sql="SELECT * FROM data WHERE entity_type = 'student'"))
    assert out["total"] == 3
    assert len(out["data"]) == 3
    assert all("vector" not in row for row in out["data"])


def test_endpoint_rejects_write(seeded_store):
    rq._store = seeded_store
    with pytest.raises(HTTPException) as ei:
        rq.readonly_query(rq.ReadOnlyQueryRequest(
            tenant_id="t1", table="entities", sql="DELETE FROM data"))
    assert ei.value.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && uv run python -m pytest tests/test_readonly_query.py -v`
Expected: FAIL — `datacore.api.readonly_query` doesn't exist.

- [ ] **Step 3: Create the endpoint module**

Create `datacore/src/datacore/api/readonly_query.py`:

```python
"""Read-only external query endpoint.

A guardrail over the shared QueryEngine for untrusted (e.g. LLM-authored) SQL.
Validates the SQL is a single read statement, caps rows, and runs it through the
existing engine with filesystem access disabled. Does NOT reimplement execution.
"""
import re
from enum import Enum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datacore.query import QueryEngine, TableNotFoundError
from datacore.store import Store

router = APIRouter(tags=["readonly-query"])
_store: Store | None = None

READONLY_MAX_ROWS = 200

# Write/DDL statement keywords, plus DuckDB file/external FUNCTION calls (matched
# as `name(` so a column named e.g. read_receipts is not rejected).
_DENY = re.compile(
    r"\b(insert|update|delete|drop|alter|create|attach|detach|copy|install|load|"
    r"pragma|export|import|call)\b"
    r"|\b(read_csv|read_parquet|read_json|read_text|read_blob)\s*\("
    r"|\bwrite_\w*\s*\("
    r"|\bsystem\s*\(",
    re.IGNORECASE,
)


class TableName(str, Enum):
    entities = "entities"
    models = "models"
    tenants = "tenants"


class ReadOnlyQueryRequest(BaseModel):
    tenant_id: str
    table: TableName
    sql: str


def validate_readonly_sql(sql: str) -> str:
    """Return cleaned single-statement read SQL, or raise ValueError."""
    s = sql.strip()
    while s.endswith(";"):
        s = s[:-1].strip()
    if not s:
        raise ValueError("Empty query.")
    if ";" in s:
        raise ValueError("Only a single statement is allowed.")
    first = s.split(None, 1)[0].lower()
    if first not in ("select", "with"):
        raise ValueError("Only SELECT/WITH read queries are allowed.")
    if _DENY.search(s):
        raise ValueError("Query contains a disallowed keyword or function.")
    return s


def register_readonly_query_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


@router.post("/api/query/readonly")
def readonly_query(req: ReadOnlyQueryRequest):
    """Execute a validated read-only SQL query against a tenant's data."""
    try:
        clean = validate_readonly_sql(req.sql)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    table_type = "entities" if req.table == TableName.tenants else req.table.value
    wrapped = f"SELECT * FROM ({clean}) AS _q"
    qe = QueryEngine(_store)
    try:
        result = qe.query(
            tenant_id=req.tenant_id, table_type=table_type,
            sql=wrapped, limit=READONLY_MAX_ROWS, external=True,
        )
    except TableNotFoundError:
        return {"data": [], "total": 0}
    except Exception as e:
        msg = str(e)
        if "Catalog Error" in msg or "Parser Error" in msg or "Binder Error" in msg:
            raise HTTPException(status_code=400, detail=f"SQL error: {msg}")
        raise HTTPException(status_code=500, detail=f"Query failed: {msg}")

    for row in result["rows"]:
        row.pop("vector", None)
    return {"data": result["rows"], "total": result["total"]}
```

- [ ] **Step 4: Register the routes**

In `datacore/src/datacore/api/__init__.py`, add the import near the other route imports:

```python
from datacore.api.readonly_query import register_readonly_query_routes
```

and inside `create_app`, next to the other `register_*(app, store)` calls:

```python
    register_readonly_query_routes(app, store)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd datacore && uv run python -m pytest tests/test_readonly_query.py -v`
Expected: PASS (all cases). Then `uv run python -m pytest tests/ -q` — the whole DataCore suite stays green.

- [ ] **Step 6: Commit**

```bash
git add datacore/src/datacore/api/readonly_query.py datacore/src/datacore/api/__init__.py datacore/tests/test_readonly_query.py
git commit -m "feat(datacore): add POST /api/query/readonly guarded read-only endpoint"
```

---

### Task 3: AdminDash — point chat queries at the read-only endpoint

**Files:**
- Modify: `admindash/backend/app/chat/datacore.py`
- Test: `admindash/backend/tests/test_chat_datacore.py`

**Interfaces:**
- Produces: `dc_query(deps, sql, table="entities") -> list[dict]` posting to `/api/query/readonly`. Raises `httpx.HTTPStatusError` on non-2xx (callers handle 400).

- [ ] **Step 1: Write the failing test**

Create `admindash/backend/tests/test_chat_datacore.py`:

```python
import httpx
import pytest
import respx

from app.chat.datacore import ChatDeps, dc_query

pytestmark = pytest.mark.anyio
DATACORE = "http://datacore.test"


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_dc_query_hits_readonly_endpoint():
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json={"data": [{"entity_id": "s1"}], "total": 1}))
        rows = await dc_query(deps, "SELECT * FROM data", table="models")
    assert route.called
    import json as _json
    body = _json.loads(route.calls.last.request.content)
    assert body["table"] == "models"
    assert rows == [{"entity_id": "s1"}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_chat_datacore.py -v`
Expected: FAIL — `dc_query` posts to `/api/query` (route not called) and/or has no `table` param.

- [ ] **Step 3: Update `dc_query`**

In `admindash/backend/app/chat/datacore.py`, replace the `dc_query` function:

```python
async def dc_query(deps: ChatDeps, sql: str, table: str = "entities") -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/query/readonly",
            json={"tenant_id": deps.tenant_id, "table": table, "sql": sql},
            headers={"Authorization": deps.token},
        )
    resp.raise_for_status()
    return resp.json().get("data", [])
```

Leave `dc_create` / `dc_duplicate_check` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admindash && uv run pytest backend/tests/test_chat_datacore.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add admindash/backend/app/chat/datacore.py admindash/backend/tests/test_chat_datacore.py
git commit -m "feat(admindash): chat queries use DataCore read-only endpoint"
```

---

### Task 4: AdminDash — replace read tools with `run_query` + `describe_schema`

**Files:**
- Modify: `admindash/backend/app/chat/tools.py`
- Modify: `admindash/backend/app/chat/agent.py`
- Test: `admindash/backend/tests/test_chat_tools.py`

**Interfaces:**
- Consumes: `dc_query(deps, sql, table="entities")` (Task 3); `ChatDeps`.
- Produces: `register_read_tools(agent)` now registers exactly two tools — `run_query(sql)` and `describe_schema(entity_type=None)`. `register_write_tools` unchanged.

- [ ] **Step 1: Write the failing test**

Replace the body of `admindash/backend/tests/test_chat_tools.py` with:

```python
import httpx
import pytest
import respx

from pydantic_ai import Agent, models
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.messages import ToolReturnPart

from app.chat.tools import ChatDeps, register_read_tools

models.ALLOW_MODEL_REQUESTS = False
pytestmark = pytest.mark.anyio
DATACORE = "http://datacore.test"


def _agent_that_calls(tool_name: str, args: dict) -> Agent:
    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart(tool_name, args)])
        last = messages[-1]
        for part in getattr(last, "parts", []):
            if isinstance(part, ToolReturnPart):
                return ModelResponse(parts=[TextPart(part.content)])
        return ModelResponse(parts=[TextPart("done")])

    agent = Agent(FunctionModel(responder), deps_type=ChatDeps)
    register_read_tools(agent)
    return agent


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_run_query_returns_rows():
    agent = _agent_that_calls("run_query", {"sql": "SELECT first_name FROM data"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json={
                "data": [{"entity_id": "s1", "first_name": "Ada"}], "total": 1}))
        result = await agent.run("query", deps=deps)
    assert route.called
    assert "Ada" in result.output


async def test_run_query_surfaces_400_for_self_correction():
    agent = _agent_that_calls("run_query", {"sql": "DELETE FROM data"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(400, json={"detail": "Only SELECT/WITH read queries are allowed."}))
        result = await agent.run("bad query", deps=deps)
    assert "SELECT" in result.output  # error text fed back for the model to fix


async def test_describe_schema_lists_fields():
    agent = _agent_that_calls("describe_schema", {"entity_type": "student"})
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    models_row = {"data": [{
        "entity_type": "student", "_status": "active", "_version": 2,
        "model_definition": {
            "base_fields": [{"name": "first_name", "type": "str"}],
            "custom_fields": [{"name": "preferred_pickup", "type": "selection"}],
        }}], "total": 1}
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json=models_row))
        result = await agent.run("fields", deps=deps)
    import json as _json
    assert _json.loads(route.calls.last.request.content)["table"] == "models"
    assert "first_name" in result.output
    assert "preferred_pickup" in result.output
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_chat_tools.py -v`
Expected: FAIL — `run_query` / `describe_schema` not registered.

- [ ] **Step 3: Replace the read tools**

In `admindash/backend/app/chat/tools.py`, replace the imports and the ENTIRE `register_read_tools` function (delete `_fmt_students`, `_ACTIVE`, and all `find_student`/`get_student`/`count_students`/`list_programs`/`list_students_in_program`/`list_leads` tools). Keep `register_write_tools` as-is.

New top-of-file + `register_read_tools`:

```python
import json

import httpx
from pydantic_ai import Agent, RunContext

from app.chat.datacore import (
    ChatDeps,
    dc_create,
    dc_duplicate_check,
    dc_query,
    sql_literal,
)

_ROW_LIMIT_SHOWN = 30


def register_read_tools(agent: Agent) -> None:
    @agent.tool
    async def describe_schema(
        ctx: RunContext[ChatDeps], entity_type: str | None = None
    ) -> str:
        """List entity types and their fields so you can write correct queries.
        With no argument, lists entity types. With an entity_type, lists that
        type's fields as name:type (base and custom)."""
        rows = await dc_query(
            ctx.deps, "SELECT * FROM data WHERE _status = 'active'", table="models"
        )
        types: dict[str, tuple[int, list[tuple[str, str]]]] = {}
        for r in rows:
            et = r.get("entity_type")
            if not et:
                continue
            md = r.get("model_definition") or {}
            if isinstance(md, str):
                try:
                    md = json.loads(md)
                except ValueError:
                    md = {}
            fields = (md.get("base_fields") or []) + (md.get("custom_fields") or [])
            ver = int(r.get("_version") or 0)
            if et not in types or ver > types[et][0]:
                types[et] = (ver, [(f.get("name"), f.get("type")) for f in fields])
        if not types:
            return "No models are defined for this tenant yet."
        if entity_type:
            key = entity_type.strip().lower()
            if key not in types:
                return (f"No model for {entity_type!r}. Entity types: "
                        + ", ".join(sorted(types)))
            pairs = types[key][1]
            return f"Fields for {key}: " + ", ".join(
                f"{n}:{t}" for n, t in pairs if n)
        return "Entity types: " + ", ".join(sorted(types))

    @agent.tool
    async def run_query(ctx: RunContext[ChatDeps], sql: str) -> str:
        """Run a READ-ONLY SQL query (SELECT/WITH only) against this tenant's data
        to answer any lookup, count, or aggregation. The single table is aliased
        `data`; filter by entity_type ('student','program','lead','enrollment',
        'family', ...); current records have _status='active'; selection fields are
        JSON-encoded (e.g. '["Aunt"]'). Call describe_schema first if unsure of
        field names. Only SELECT/WITH is permitted."""
        try:
            rows = await dc_query(ctx.deps, sql)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                try:
                    detail = e.response.json().get("detail", "invalid query")
                except ValueError:
                    detail = "invalid query"
                return (f"Query rejected: {detail} "
                        "Revise the SQL (SELECT/WITH only) and try again.")
            return "The query could not be run right now."
        except httpx.HTTPError:
            return "The query could not be run right now."
        if not rows:
            return "No rows matched."
        shown = rows[:_ROW_LIMIT_SHOWN]
        lines = [
            json.dumps(
                {k: v for k, v in r.items() if not str(k).startswith("_")},
                default=str,
            )
            for r in shown
        ]
        more = "" if len(rows) <= _ROW_LIMIT_SHOWN else (
            f"\n…and {len(rows) - _ROW_LIMIT_SHOWN} more row(s).")
        return f"{len(rows)} row(s):\n" + "\n".join(lines) + more
```

Note: `sql_literal`, `dc_create`, `dc_duplicate_check` stay imported because `register_write_tools` (unchanged, below in the same file) uses `dc_duplicate_check`; `sql_literal`/`dc_create` may now be unused — if `ruff`/lint flags them, drop the unused names from the import. Verify with the lint/test run in Step 4.

- [ ] **Step 4: Update the system prompt**

In `admindash/backend/app/chat/agent.py`, replace the `SYSTEM_PROMPT` string with:

```python
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
```

- [ ] **Step 5: Run tests + full suite + lint**

Run: `cd admindash && uv run pytest backend/tests/test_chat_tools.py -v`
Expected: PASS (3 passed). Then `uv run pytest backend/tests/ -q` — full suite green. (If unused-import lint appears for `sql_literal`/`dc_create`, remove those names from the `app.chat.datacore` import and re-run.)

- [ ] **Step 6: Commit**

```bash
git add admindash/backend/app/chat/tools.py admindash/backend/app/chat/agent.py admindash/backend/tests/test_chat_tools.py
git commit -m "feat(admindash): general chat query via run_query + describe_schema"
```

---

## Deployment (after all tasks reviewed & merged)

Not TDD steps — ops, done once the branch is merged to main:

1. **DataCore first:** cut `datacore-v<next>` release → approve the production gate → verify `datacore` deploys and `POST /api/query/readonly` exists (the app is private; verify via the deploy job success + AdminDash chat once its release lands).
2. **AdminDash next:** cut `admindash-v<next>` release → approve gate → verify `admindash-api` healthy (still 1 GB) and a chat read query works.

Do not deploy AdminDash before DataCore — the chat calls the new endpoint.

## Self-Review Notes

- **Spec coverage:** read-only endpoint + validation + row cap + `external` hardening (Tasks 1–2); `/api/query` untouched (Global Constraints); chat uses readonly endpoint (Task 3); specific read tools removed + `run_query`/`describe_schema` added + prompt (Task 4); writes unchanged (not touched); deploy order (Deployment §).
- **Vector stripping** handled in the endpoint (Task 2 Step 3) so `run_query` never returns embeddings.
- **Deferred (YAGNI):** semantic-search integration, structured DSL, making the endpoint internet-public — none in scope.
