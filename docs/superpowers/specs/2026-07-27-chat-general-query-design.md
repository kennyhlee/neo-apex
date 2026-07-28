# Chat General Query via Read-Only DataCore Endpoint — Design

**Date:** 2026-07-27
**Status:** Approved (ready for implementation plan)
**Scope:** DataCore (new read-only query endpoint + engine hardening) and AdminDash
chat tools (replace specific read tools with a general query + schema tool).

## 1. Overview

The AdminDash chat assistant currently answers reads through a growing set of
hardcoded, per-pattern tools (`find_student`, `count_students`, `list_*`). That
never generalizes to questions no one pre-listed. This change replaces them with a
**general read-query capability**: the LLM composes read-only SQL against the
tenant's data through a **new, guarded DataCore endpoint**.

Principles (from review):
- The chat interface may only **read** via query. Writes (create student / program /
  lead) continue through the confirm-form flow and the existing entity-create
  endpoints — never through query.
- Keep the existing `POST /api/query` as the **internal, unrestricted** access point.
- Add a **new external read-only endpoint** that acts as a guardrail and **reuses**
  the existing query engine (no duplicated execution logic).

## 2. Architecture

```
Chat (admindash) ──run_query(sql)──▶ admindash backend
   │  describe_schema()                    │ (tenant_id from JWT, never from LLM)
   │                                       ▼
   │                         POST /api/query/readonly  (NEW, DataCore)
   │                            • read-only SQL validation (guardrail)
   │                            • result cap (LIMIT)
   │                            • QueryEngine.query(..., external=True)
   │                                       │  reuse, hardened connection
   │                                       ▼
   │                            QueryEngine (existing) → DuckDB (in-memory,
   │                              tenant's Arrow table registered as `data`)
   └── create student/lead/program ──▶ existing /api/entities/... (unchanged)
```

Tenant isolation and non-persistence are already guaranteed by the engine (loads
only the tenant's rows into a fresh in-memory DuckDB and closes it per query), so the
new endpoint only needs to add read-only enforcement and resource caps.

## 3. DataCore changes

### 3.1 `QueryEngine.query(...)` — add a hardened mode (reuse, don't duplicate)
Add an optional `external: bool = False` parameter to the existing
`QueryEngine.query()` (`datacore/src/datacore/query.py`). When `external=True`, before
executing, configure the DuckDB connection defensively:
- `SET enable_external_access=false;` (blocks `read_csv`, `COPY … TO`, `ATTACH`,
  `INSTALL/LOAD`, httpfs, etc. — file/host escape prevention).
- A query timeout if the installed DuckDB supports it; otherwise rely on the row cap.

When `external=False` (default) behavior is unchanged, so the internal `/api/query`
path is untouched. All query execution stays in this one method — the endpoint below
does not reimplement it.

### 3.2 New endpoint `POST /api/query/readonly`
New route (e.g. `datacore/src/datacore/api/readonly_query.py`, registered like the
others). Same request/response contract as `/api/query`:
`{tenant_id, table, sql}` → `{data, total}`.

Behavior, in order:
1. **Validate read-only** (`_validate_readonly_sql`) — reject with HTTP 400 if the SQL
   is not a single read statement:
   - exactly one statement (no `;` chaining; a lone trailing `;` is allowed/stripped);
   - the statement's first keyword is `SELECT` or `WITH`;
   - a denylist of write/DDL/escape tokens is absent (word-boundary, case-insensitive):
     statement keywords `INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, DETACH,
     COPY, INSTALL, LOAD, PRAGMA, EXPORT, IMPORT, CALL`; and specific DuckDB
     file/external **function names** — `read_csv, read_parquet, read_json, read_text,
     read_blob, write_*` and `system(` — matched as function calls so a legitimately
     named column (e.g. `read_receipts`) is not false-rejected.
   The denylist is defense-in-depth on top of the engine hardening; `enable_external_
   access=false` is the real backstop.
2. **Cap results** — bound the row count by wrapping the user SQL in a subquery with a
   LIMIT (e.g. `SELECT * FROM (<sql>) AS _q`, then the engine's `limit=` applies), so a
   cap composes safely even if the user SQL already contains its own `LIMIT`.
3. **Execute via** `QueryEngine.query(tenant_id, table_type, wrapped_sql, limit=CAP,
   external=True)` and return `{data, total}` (same normalization as `/api/query`).
4. On engine SQL errors, return HTTP 400 with the DuckDB message (same as `/api/query`)
   so the caller (LLM) can self-correct.

Row cap constant (e.g. `READONLY_MAX_ROWS = 200`) lives in the new module.

## 4. AdminDash chat changes

### 4.1 `app/chat/datacore.py`
- `dc_query(deps, sql, table="entities")` now targets **`/api/query/readonly`** (add a
  `table` parameter, default `entities`). Tenant/token still forwarded from `ChatDeps`.
- `dc_create` / `dc_duplicate_check` unchanged (they use entity endpoints, not query).

### 4.2 `app/chat/tools.py` — replace read tools
- **Remove** `find_student`, `get_student`, `count_students`, `list_programs`,
  `list_students_in_program`, `list_leads`, and now-unused helpers (`_fmt_students`,
  the `_ACTIVE` usages folded into the prompt/schema guidance as needed).
- **Add** two read tools in `register_read_tools`:
  - `run_query(sql: str) -> str` — runs read-only SQL via `dc_query`; formats up to N
    rows compactly (and reports the total/omitted count); on a downstream 400 returns
    the SQL error text verbatim so the model fixes its query.
  - `describe_schema(entity_type: str | None = None) -> str` — returns the entity types
    and their fields (names + types, base and custom) from the tenant's model
    definitions (queried via `dc_query(..., table="models")`), plus a one-line note on
    the `data` table conventions. With no argument, lists entity types; with one, lists
    that type's fields.
- Write-proposal tools (`register_write_tools`) unchanged.

### 4.3 `app/chat/agent.py` — system prompt
Add a short "how to query" section: single table alias `data`; filter by
`entity_type` (`student`, `program`, `lead`, `enrollment`, `family`, …); current
records have `_status = 'active'`; selection fields are stored JSON-encoded
(`["Aunt"]`); use `run_query` for any lookup/aggregate and `describe_schema` first when
unsure of field names; SELECT-only. Keep the existing create-form guidance.

## 5. Error handling
- Non-read SQL → 400 from the readonly endpoint before execution; the tool surfaces a
  short "read-only queries only" message to the model.
- DuckDB SQL/parse/binder errors → 400 with the message; `run_query` returns it so the
  model retries.
- Unreachable DataCore / 5xx → `dc_query` raises; the tool returns a clean "couldn't
  run the query" message; `sse_chat` still emits a `done`.
- Result cap reached → the tool notes "showing first N of M".

## 6. Testing
- **DataCore** (`datacore/tests/test_readonly_query.py`): `_validate_readonly_sql`
  accepts `SELECT`/`WITH`, rejects `INSERT/UPDATE/DELETE/DROP/ATTACH/COPY/;`-chaining
  and `read_csv(...)`; the endpoint returns rows for a valid SELECT and 400 for a write;
  `external=True` sets `enable_external_access=false` (a `read_csv('/etc/hosts')` query
  fails). Existing `/api/query` tests still pass (behavior unchanged).
- **AdminDash** (`backend/tests/test_chat_tools.py`): rewrite for the new tools —
  `run_query` calls `/api/query/readonly` and formats rows; `describe_schema` queries
  `table="models"` and lists fields; removed-tool tests deleted. `respx` mocks DataCore;
  no live LLM (`FunctionModel`). Full admindash + datacore suites green.

## 7. Deployment
Two modules change, so two releases, **DataCore first** (the endpoint must exist before
AdminDash calls it):
1. `datacore-v*` — new read-only endpoint + engine flag.
2. `admindash-v*` — chat tools using it.
Both via the normal release-tag pipeline with the production gate. AdminDash memory
stays at 1 GB.

## 8. Out of scope (YAGNI)
- Making `/api/query/readonly` internet-public (DataCore stays on Fly's private network).
- Semantic/vector search integration (`/api/search`) — possible later complement.
- A structured filter DSL — the LLM writes SQL directly.
- Cross-`table` joins in one call (entities vs models) — the model issues multiple
  queries if needed.
