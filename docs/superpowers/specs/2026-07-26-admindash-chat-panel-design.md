# AdminDash Home Chat Panel — Design

**Date:** 2026-07-26
**Status:** Draft (awaiting review)
**Scope:** AdminDash only (`admindash/frontend`, `admindash/backend`)

## 1. Overview

Add a collapsible chat panel to the left of the AdminDash home page. School
administrators can ask natural-language questions ("find the student named Ada
Lovelace", "how many students are enrolled?", "list everyone in the Robotics
program") and run write actions ("add a new student"). An LLM answers by calling
the AdminDash backend's existing APIs as tools. The panel also offers up to 10
user-editable **quick-action** chips.

Design priorities, in order:

1. **Reuse what exists** — the backend already exposes every operation the chat
   needs (query, entity CRUD, leads); the repo already uses Pydantic-AI for LLM
   calls. Build on both.
2. **Cost control** — cheap default model, structural token limits, and a
   one-config-change path to a local model.
3. **Safety** — writes are confirmed by the user; tenant scope is enforced
   server-side, never trusted from the model.
4. **Minimal dependencies** — match the repo's no-state-library, no-component-
   library, CSS-variables ethos.

## 2. Key decisions & rationale

### 2.1 UI framework: defer AG-UI, build lightweight custom (with an AG-UI-ready backend)

AG-UI (CopilotKit's Agent-User Interaction protocol) is a standard event stream
between an agent and the UI: text deltas, tool-call events, shared-state patches,
and "generative UI" (the agent renders React components into the chat).

**Pros of adopting AG-UI now**
- Generative/dynamic UI out of the box.
- Standard event schema; ready-made React chat components; shared state; interrupts.

**Cons**
- Heavy new frontend dependency (CopilotKit ecosystem) in a repo that avoids big
  deps, global-state libraries, and even a component library.
- Protocol is young and still evolving.
- Overkill for a v1 chat with ~10 quick actions.
- Bundle-size and React-19 compatibility risk.

**Decision:** Build a small custom React panel now, streaming over SSE. **But**
choose Pydantic-AI on the backend, which provides a native AG-UI adapter
(`Agent.to_ag_ui()`). If generative UI later becomes a real requirement, we can
expose the same agent over AG-UI and adopt CopilotKit on the frontend without
rebuilding the agent. Low commitment now, cheap upgrade later.

### 2.2 Tool architecture: in-process Pydantic-AI agent

The chat runs as a Pydantic-AI `Agent` **inside the admindash backend**. Each tool
is a Python function that calls the existing internal proxy path (query, entity
CRUD, leads), forwarding the authenticated user's JWT.

- **vs a dedicated MCP server:** MCP is valuable when tools must be shared with
  external clients (Claude Desktop, other agents). This is one in-app chat, so a
  separate MCP process + protocol layer is overhead. The tool *functions* are the
  reusable unit; an MCP facade can wrap them later if needed.
- **vs prompt-only (LLM writes raw SQL):** brittle and unsafe, especially for
  writes. Rejected.
- Pydantic-AI is already the repo's LLM stack (Papermite), supports
  `anthropic:` / `openai:` / `ollama:` models, and enables the AG-UI path above.

### 2.3 Model & cost control: Haiku default, structural limits, local path

**Default model:** `anthropic:claude-haiku-4-5-20251001` (Papermite's default;
cheap; adequate for tool-routing and field extraction).

Cost is controlled structurally, not just by model choice:

- **Configurable model** via `ADMINDASH_CHAT_MODEL` env var. Switching to
  `ollama:llama3.2` (the "localize later" goal) is a one-line config change — no
  code change, because Pydantic-AI abstracts the provider.
- **Capped `max_tokens`** per response.
- **Trimmed history window** — only the last N turns are sent to the model.
- **Truncated tool results** — large query results are summarised/capped before
  being fed back to the model.
- **Prompt caching** on the (static) system prompt for Anthropic models.
- **Per-session message cap** to bound runaway usage.
- **Token-usage logging** per request for cost visibility.

### 2.4 Write safety: confirm-before-execute

- **Reads** (find / list / count / get) execute immediately and stream the answer.
- **Writes** (create student, create lead) do **not** execute from the model. The
  tool returns a *proposal* (parsed fields + a duplicate-check result); the panel
  renders a confirmation card; the write fires only when the user clicks
  **Confirm**, via the existing entity/lead create endpoint.
- **Tenant scope** is always derived from the authenticated user (`/auth/me`),
  never from a model-supplied value. This also mitigates the known AdminDash
  tenant-match gap (proxy routes don't currently verify `user.tenant_id` against a
  path `tenant_id`).

## 3. Architecture & data flow

```
┌─ AdminDash Frontend (React 19) ──────────────────────────────┐
│  HomePage: [ ChatPanel (left, collapsible) | Home content ]  │
│  ChatPanel → fetch POST /api/chat  (SSE stream)              │
│            ← text deltas, tool-call events, proposal cards    │
└───────────────────────────────┬──────────────────────────────┘
                                 │ Authorization: Bearer <neoapex_token>
┌─ AdminDash Backend (FastAPI) ──▼──────────────────────────────┐
│  POST /api/chat  → Pydantic-AI Agent (model from env)         │
│    tools: find_student, list_students_in_program, count_*,    │
│           get_student, list_leads, propose_create_student,    │
│           propose_create_lead, list_programs                  │
│    each tool → existing internal proxy fn (query / entities / │
│                leads), forwarding the user's JWT + tenant_id   │
└───────────────────────────────┬──────────────────────────────┘
                                 │
                     DataCore (query, entities)  /  (leads logic local)
```

**Streaming:** `POST /api/chat` returns a `StreamingResponse` emitting SSE events:
`token` (text delta), `tool` (tool started/finished, for a "thinking" indicator),
`proposal` (a write awaiting confirmation), `done`, `error`. The frontend reads the
stream with `fetch` + `ReadableStream` and appends to the transcript. Confirming a
proposal is a normal (non-streaming) call to the existing create endpoint.

## 4. Components

### Backend (`admindash/backend`)

- `app/api/chat.py` — `POST /api/chat` route; builds the agent, runs it, streams SSE.
- `app/chat/agent.py` — Pydantic-AI `Agent` construction, model selection from
  config, system prompt (with tenant/user context injected), history trimming.
- `app/chat/tools.py` — tool functions wrapping existing proxy calls; read tools
  execute, write tools return proposals. Tenant derived from the authenticated user.
- `app/config.py` — add `chat_model`, `chat_max_tokens`, `chat_history_turns`,
  `chat_session_message_cap`.
- Depends on the authenticated-user dependency already in `app/auth.py`.
- Add `pydantic-ai>=0.0.30` to `admindash/pyproject.toml`.

### Frontend (`admindash/frontend`)

- `src/components/ChatPanel.tsx` (+ `.css`) — panel shell, collapse toggle,
  transcript, input box, streaming renderer, proposal/confirmation card.
- `src/components/QuickActions.tsx` — up to 10 editable quick-action chips;
  persisted client-side via `idb`.
- `src/api/chat.ts` — SSE client (`fetch` + `ReadableStream`) using the existing
  `authHeaders()` pattern and base URL from `config.ts`.
- `HomePage.tsx` / layout — two-column layout: ChatPanel left, existing content
  right; panel collapses on narrow viewports.

## 5. v1 tool set (maps to the quick actions)

Read (execute immediately):
1. `find_student(first_name?, last_name?)`
2. `get_student(student_id)`
3. `list_students_in_program(program_name)`
4. `count_students(status?)`
5. `list_leads(stage?)`
6. `list_programs()`

Write (confirm-before-execute):
7. `propose_create_student(first_name, last_name, grade_level?, ...)` — runs
   duplicate-check, returns a proposal.
8. `propose_create_lead(guardian_name, email?, phone?, student_first_name?, ...)`

Default quick-action chips (editable): *Add a new student*, *Find a student by
name*, *List students in a program*, *How many students are enrolled?*, *Show new
leads*, *Add a lead*, *List programs*.

## 6. Error handling

- Tool failures (downstream 4xx/5xx) are caught and returned to the model as a
  structured error so it can explain the failure conversationally; also surfaced as
  an `error` SSE event.
- Auth failure (401 from `/auth/me`) → panel prompts re-login (reuse existing flow).
- Model/provider errors → user-facing "assistant unavailable" message; logged.
- Session message cap reached → panel shows a "start a new conversation" notice.

## 7. Testing

- **Backend:** pytest with `respx` (existing pattern) — tool functions call the
  right downstream endpoints with the user's tenant/JWT; write tools never execute;
  history trimming and message cap enforced; SSE event shapes. Mock the LLM (no live
  API calls in tests).
- **Frontend:** no test framework configured today; verify manually against a
  running stack. (Adding Vitest is out of scope for v1.)

## 8. Out of scope for v1 (YAGNI)

- AG-UI / generative UI (kept as a documented future option).
- Server-side conversation persistence / history across sessions.
- MCP server facade.
- Voice, file upload in chat, multi-tenant admin chat.
- Local Ollama as the *default* (supported via config, but hosted Haiku is the v1
  default).

## 9. Open questions for reviewer

- Panel scope: home page only (as written), or a persistent app-wide panel?
- Should quick-actions be shared per-tenant (backend-stored) eventually, or is
  client-side per-user fine long-term?
- Any write actions beyond student/lead wanted in v1?
