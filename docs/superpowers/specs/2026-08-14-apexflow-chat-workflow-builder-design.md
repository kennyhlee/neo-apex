# ApexFlow chat workflow builder — design

**Date:** 2026-08-14
**Status:** Implemented (Option C — suite assistant); see `docs/superpowers/plans/2026-08-14-apexflow-chat-workflow-builder.md`
**Predecessors:** `2026-08-05-apexflow-workflow-platform-design.md` (§9 AI authoring, Plan 4), `2026-08-10-stage-centric-workflow-editor-design.md`, AdminDash chat assistant (`admindash/backend/app/chat/`, `admindash/frontend/src/components/ChatPanel.tsx`)
**Mockups:** claude.ai/code/artifact/a881ac64-c207-409a-9d14-a70c738783f4 (Option C, refined per discussion)

## Goal

An admin builds and edits ApexFlow workflows through a chat assistant that is visually and architecturally the AdminDash assistant transplanted: one persistent right-edge drawer across all ApexFlow pages, prefilled prompt chips, SSE streaming, and the propose-don't-execute write pattern. The assistant creates drafts from templates and edits open drafts via patch cards; publish remains human-gated in the existing designer.

## Decisions (settled in brainstorming — do not relitigate)

1. **Option C direct, single plan.** No A→C release phasing. Internal build order still lands the create path before the edit path, because it exercises the full pipe (drawer → agent → tools → proposal card → write endpoint) with low model risk.
2. **Minimize time-to-draft.** Chat on the list/templates pages exists to pick a starting point, not to build. The agent asks at most 1–2 shaping questions, proposes a create-draft card, and on confirm navigates to the editor. All refinement happens there, against a real draft, visible live in the real stage editor.
3. **No pre-draft outline renderer.** The proposal card summarizes in text; the live visualization is the editor. No read-only shadow renderer (rejected Option B component — drift risk against the stage editor).
4. **AI has no special write powers** (platform spec §9). Every write is a user-confirmed card: create-draft card → one new create endpoint; patch card → existing `draftStore` mutation + autosave `PUT`. The model itself never writes.
5. **Template-first.** The create tool takes a template as its base whenever one fits; from-scratch is supported but not optimized (stage-editor decision table).
6. **UI parity is literal.** Drawer geometry (380px, transform slide, content reflow), bubble styles, chip styles, and the SSE event protocol `{type: token|tool|proposal|done|error}` match AdminDash exactly.

## Architecture

### Backend (`apexflow/backend/app/chat/`, new)

Mirror of `admindash/backend/app/chat/` — same module layout, same libraries:

- **`agent.py`** — pydantic-ai `Agent`, `deps_type=ChatDeps`, injectable model for tests (`FunctionModel`). New dependency: `pydantic-ai>=0.0.30` in `apexflow/pyproject.toml`. Settings (env prefix `APEXFLOW_`): `chat_model` (default `anthropic:claude-haiku-4-5-20251001`), `chat_max_tokens`, `chat_history_turns`, `chat_session_message_cap` — same defaults as AdminDash. `ANTHROPIC_API_KEY` from env, as provisioned for the suite.
- **`stream.py`** — SSE framing, byte-for-byte the AdminDash protocol so a shared client can be factored out later (three-strikes rule; not extracted now).
- **`tools.py`** — see Tool surface below.
- **`deps.py`** — `ChatDeps { tenant_id, token, apexflow context }` where context is supplied per request by the client: `{ page: 'list' | 'templates' | 'editor', entity_id?: str }`. For `editor`, the backend loads the bundle server-side (machine, steps, models, current validation errors) rather than trusting a client-supplied definition.

**Route:** `POST /api/workflows/{tenant_id}/chat` behind `require_staff_tenant`. Stateless; client-supplied history (last N turns), message-count soft cap → 429, `StreamingResponse` SSE. Same request shape as AdminDash plus the `context` object.

### Tool surface

**Read (registered always):**
- `list_workflows()` — one row per lineage: name, status, health, open instances. Backed by the existing list query.
- `get_workflow(entity_id)` — condensed bundle: stages (via the stage-model read view), steps/sections, channel, validation errors. Uses `stage/phrases.py`-style plain-language rendering of guards/effects (a small server-side condensation; exact format decided at implementation).
- `list_templates()` — the template catalog incl. per-tenant `missing_models`.
- The primitives catalog (`GUARDS`/`EFFECTS` + `PARAM_SPECS`) is baked into the system prompt, not a tool — it is small and static per deploy.

**Write-proposal (never write directly):**
- `propose_create_draft(name, template_id | None, machine, steps, channel_access, summary: list[str])` — queues a proposal `{action: 'create_draft', ...}`. The agent starts from the named template's definition and applies the admin's described modifications; `summary` is the human-readable change list shown on the card. Backend validates the payload parses against `schema.py` before queuing (a malformed proposal becomes a tool error the model must repair, not a broken card).
- `propose_patch(ops: list[PatchOp], summary: list[str])` — editor context only. Queues `{action: 'patch', ops, summary}`.

**Patch vocabulary (`PatchOp`):** a small, closed set of stage-model operations mirroring the frontend's existing pure helpers (`stageOps.ts`, `stage/write.ts`) so apply logic is not new machinery:
`add_stage`, `rename_stage`, `remove_stage`, `add_step(stage_id, step)`, `update_step(step_id, patch)`, `remove_step`, `add_section(step_id, section)`, `update_section`, `remove_section`, `add_move(group)`, `update_move(key, patch)`, `remove_move`, `set_show_if(step_id, condition)`, `set_channel_access`.
Ops are validated structurally server-side (shape only); semantic validation happens where it already lives — the save `PUT` returns `{errors, health}` after apply.

**Repair loop:** after a patch is applied, the client's next chat request includes the fresh validation errors in `context`; the system prompt instructs the agent to acknowledge and offer a follow-up patch when its change introduced errors. No agent-side auto-apply, ever.

### New endpoint: create draft from definition

`POST /api/workflows/{tenant_id}/definitions` with body `{ name, machine, steps, channel_access, template_id?: str }` → creates a draft row (server does the JSON-string encoding, seeds lineage fields the same way `DefinitionsPage.submitNewWorkflow` / template instantiation do today), returns `{row, errors, health}` like save does. This closes the existing gap where creation goes through the generic entities proxy with client-side stringification; `DefinitionsPage` and `TemplatesPage` migrate to it in this plan (small, keeps one creation path).

### Frontend (`apexflow/frontend/src/`)

- **`components/AssistantDrawer.tsx` + chat components** — ported from AdminDash (`ChatPanel`, `QuickActions`, `Markdown`, SSE client), not extracted to a shared package yet (two consumers; note for future extraction). Port fixes rather than copies AdminDash's known warts: hardcoded strings go through i18n, message `key={i}` fixed, stale AbortController comment dropped.
- **Mounting:** on the app shell in `App.tsx`, visible on all authenticated routes. Add `--assistant-w: 380px` to `styles/theme.css` (the one missing token). Reflow via `body.assistant-open` padding, same breakpoints as AdminDash. Default closed (unlike AdminDash home — ApexFlow's editor is denser); open state remembered in `sessionStorage`.
- **Transcript:** `sessionStorage` key `apexflow_chat_history`, `{role, content}` only (proposals stripped on persist, so stale cards are never re-actionable — AdminDash pattern). Cleared on logout. One transcript across route navigation.
- **Context:** each send includes `{ page, entity_id }` derived from the current route. In the editor, applied-patch acknowledgment and current validation errors ride along.
- **Quick-action chips:** same editable-chips mechanism (IndexedDB via `idb`, cap 10). Defaults are context-independent v1: e.g. "Start a registration workflow", "Add a document upload step to this draft", "Explain this draft's validation errors", "What's still open across workflows?". (Context-*aware* chip swapping is an enhancement, not v1.)
- **Proposal cards (in-bubble):**
  - `CreateDraftCard` — name, base template, summary bullets; **Create draft** → new endpoint → navigate to `/definitions/{entity_id}`; **Adjust…** focuses the input. After navigation the transcript continues; a synthetic assistant message confirms creation.
  - `PatchCard` — summary bullets + op count; **Apply** → ops applied to `draftStore` via the existing stage-model helpers → debounced autosave `PUT` → validation rail updates; **Dismiss**. Apply is disabled when `store.readOnly` (non-draft) — the agent is also told the row is read-only and should propose `new_draft` instead.
  - Ghost-preview of pending patches in the canvas (dashed stage/step highlights, as mocked) is an **enhancement**, not v1. V1 behavior: Apply mutates immediately; the editor's existing save/cancel affordances are the undo.

### Error handling

- SSE `error` events append inline to the assistant bubble (AdminDash pattern); stream always terminates with `done`.
- Patch ops that fail to apply client-side (e.g. stale `step_id` after a manual edit mid-conversation) mark the card failed with the reason and feed it back as context on the next turn — never partially applied: ops within one card apply all-or-nothing against a snapshot of `draftStore`.
- 409 `not_draft` on save after Apply surfaces as a card failure (row changed status mid-conversation).
- Create endpoint failure keeps the card actionable with the error inline.

### Security & limits

Staff-only (`require_staff_tenant`), tenant-scoped throughout; the user's bearer token is forwarded for all DataCore-bound reads. Message cap + history truncation as in AdminDash (client-reported soft cost guard, not a security boundary). The model's only writes are user-confirmed cards; publish/lifecycle actions are not tools — the agent directs the admin to the existing dialogs.

## Testing

- **Backend:** mirror `test_chat_{endpoint,tools,stream}.py` with `FunctionModel`; tool tests assert proposal payloads parse against `schema.py`; create-endpoint tests (happy path, invalid machine 422, tenant mismatch); patch-op structural validation tests.
- **Frontend:** patch-apply unit tests reusing the `stageOps`/`stage/write` test fixtures — every `PatchOp` round-trips through `readStageModel`/`writeMachine` (extends `roundTrip.test.ts`); card render/act tests; SSE client parser test.
- **Loop test (the load-bearing one):** scripted agent proposes a patch that introduces a validation error → apply → `PUT` returns the error → next-turn context contains it. Verified by mutation per project convention (break the op appliers, prove tests bite).

## Out of scope

- Document/handbook upload intake (platform spec §9) — plugs into `propose_create_draft` later as a new input, not a new UI.
- Ghost-preview of pending patches in the canvas (enhancement).
- Context-aware chip swapping per route (enhancement).
- Extracting a shared `@neoapex/chat-ui` package (wait for a third consumer or real divergence pain).
- Ops analytics / instance-mutation tools (cancel etc.) — the assistant answers questions about instances read-only; actions stay in AdminDash/ApexFlow UI.
- Any change to AdminDash's assistant.
