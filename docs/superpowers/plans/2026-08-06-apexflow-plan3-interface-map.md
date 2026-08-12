# ApexFlow Plan 3 — Interface Map (Channels)

Authoritative binding map for ApexFlow Plan 3 (wiring familyhub as the
family-facing channel and admindash as the staff-assisted channel onto
apexflow's workflow platform). Every task in Plan 3 cites this file rather
than writing signatures from memory.

**Provenance discipline (repeated from Plan 2's interface map, still true):**
every fact below was re-read from the file on disk during this map's own
creation, on branch `feat/apexflow-plan3-channels`, AFTER Plan 2's merge
(`506957f`). `docs/superpowers/plans/2026-08-06-apexflow-plan2-interface-map.md`
was consulted ONLY as a structural template (which sections to write, what
level of verbatim-ness to aim for) — every line number and code excerpt
below was independently re-verified against the current file, not copied
from that map. Where the Plan 2 map's own citations still matched on
re-read, that is noted as "no drift"; where they didn't, the actual current
file:line is used and the drift is called out explicitly in §10.

---

## 1. apexflow-backend surface

All paths relative to `apexflow/backend/app/` unless stated otherwise.
Files present: `api/{designer,definitions,instances,documents,internal,entities,query,auth_proxy}.py`,
`workflows/{conditions,datacore,definitions,emails,engine,machine,primitives,schema,shared,tokens,validate}.py`.

### 1a. `api/designer.py` (full file, 279 lines)

Pure read surface layered on `app.workflows.definitions`'s helpers. Router:
`APIRouter(prefix="/api/workflows")` (`:49`).

```python
STANDARD_BUNDLE_MODELS = ("student", "family", "contact",
                          "registration_application", "lead")            # :55

@router.get("/{tenant_id}/definitions")                                  # :122
def list_definitions(tenant_id, user=Depends(require_staff_tenant)): ... # :123
    # -> {"definitions": [...]}, one entry per lineage-version row, each
    # with computed "health" (via _health_for_row -> definition_health,
    # superseded rows short-circuit to "superseded"), "open_instances"
    # count, optional "parse_error"/"family_url".

@router.get("/{tenant_id}/definitions/{entity_id}/bundle")               # :192
def get_bundle(tenant_id, entity_id, user=Depends(require_staff_tenant)): ...  # :193
    # -> {"definition": {...machine/steps by_alias...}, "models": {...},
    #     "health": str, "errors": [...]}

@router.post("/{tenant_id}/definitions/{entity_id}/validate")            # :225
def validate_definition_route(tenant_id, entity_id, user=Depends(require_staff_tenant)): ...  # :226
    # dry-run; MUST return exactly the errors publish_definition would 409 with.

@router.get("/{tenant_id}/primitives")                                   # :256
def primitives_catalog(tenant_id, user=Depends(require_staff_tenant)): ...  # :257
    # -> {"guards": [...], "effects": [...]}, generated from validate.PARAM_SPECS.

@router.get("/{tenant_id}/templates")                                    # :270
def templates_route(tenant_id, user=Depends(require_staff_tenant)): ...  # :271
    # -> {"templates": template_catalog()} — platform-wide, not tenant data.
```

`_parse_or_422` (`:68-105`): every read route wraps `defs.parse_machine_steps`
and degrades `ValidationError | ValueError | TypeError` (the last two catch
`json.JSONDecodeError` on a corrupt stored `machine`/`steps` string) to a
`422 {"parse_error": ...}` rather than a 500. `_family_url` (`:108-119`):
only for `status == "published" and channel_access == "family"` rows —
`f"{settings.familyhub_base_url}/w/{tenant_id}/{row.get('definition_id')}"`.

### 1b. `api/entities.py` — generic entity proxy (full file, 171 lines)

`_proxy_to_datacore` (`:41-80`) uses `httpx.AsyncClient(timeout=30.0)`
**awaited** inside `async def` handlers (fixed from a prior sync-blocking
bug — see module docstring and commit `dd1ee6d`). Routes, in registration
order (specific-suffix routes before the generic catch-all, same as
admindash's porting source): `POST /entities/{tenant_id}/{entity_type}`
(`:83`), `POST .../archive` (`:96`), `POST .../restore` (`:111`),
`GET .../next-id` (`:126`), `POST .../duplicate-check` (`:141`),
`PUT .../{entity_id}` (`:157`, registered last). All gated by
`Depends(require_staff_tenant)`.

### 1c. `api/query.py` — generic SQL query proxy (full file, 76 lines)

`POST /query` (`:35`), gated by `Depends(require_authenticated_user)` (no
`{tenant_id}` path param — tenant match is checked against the BODY via
`assert_query_tenant_match(payload.get("tenant_id"), user)` at `:53`, plus
`assert_sql_is_safe_read(payload.get("sql", ""))` at `:54`, both imported
from `app.tenancy`). Also uses awaited `httpx.AsyncClient` (fixed in the
same final-review wave as `entities.py`, per the module's own docstring).

### 1d. `api/auth_proxy.py` — login/me proxy (full file, 81 lines)

The only router needing no auth dependency of its own. `POST /login`
(`:28`) and `GET /me` (`:55`) both use plain (unawaited) `httpx.post`/`get`
inside plain `def` handlers — safe because FastAPI dispatches sync `def`
routes through its threadpool automatically (this module's own routes are
NOT `async def`, unlike `entities.py`/`query.py`, so there is no
event-loop-blocking concern here despite the sync call).

### 1e. `workflows/machine.py` — action dispatcher (full file, 533 lines)

```python
def build_eval_context(tenant_id, instance_row, *, actor,
                       token=None, now=None) -> EvalContext: ...          # :226
def run_system_transitions(ctx: EvalContext) -> dict: ...                 # :450
def _allowed_actions(ctx: EvalContext) -> list[str]: ...                  # :331
def execute_action(ctx: EvalContext, action_name: str, params: dict) -> dict: ...  # :511
```
The two 409 `{"allowed": [...]}` raise sites in `_run_transition_action`:
`:431` (no non-system candidate at all) and `:443` (actor-gated candidates
exist but none guard-pass). Wire shape confirmed verbatim both places:
`raise HTTPException(409, {"allowed": _allowed_actions(ctx)})`.
`_write_state` lives in `machine.py:294` (not `engine.py` — the Plan 3 brief
text names it generically; this module owns the state-write side effect).
**No drift**: every line number in the Plan 3 task brief's own citations
for this file (`:331`, `:511`, `:226`, `:450`, `:431`, `:443`, `:294`)
matched on fresh re-read.

### 1f. `workflows/engine.py` — instance creation + item ops (full file, 542 lines)

```python
def create_instance(tenant_id, lineage_definition_id, context, channel,
                    applicant_email=None, *, token=None, now=None) -> dict: ...  # :159
def save_draft(tenant_id, instance_row, section_answers, actor, *,
               token=None, now=None) -> dict: ...                          # :276
def complete_item(tenant_id, instance_row, item_entity_id, actor, *,
                  token=None, now=None) -> dict: ...                       # :435
def verify_item(tenant_id, instance_row, item_entity_id, actor, *,
                token=None, now=None) -> dict: ...                         # :497
def reject_item(tenant_id, instance_row, item_entity_id, actor, *,
                token=None, now=None) -> dict: ...                         # :514
def waive_item(tenant_id, instance_row, item_entity_id, actor, *,
               token=None, now=None) -> dict: ...                         # :524
def _update_item(tenant_id, instance_row, item_row, changes, actor,
                 token, now) -> dict: ...                                  # :369
```
**No drift**: every line number the Plan 3 brief cites for `engine.py`
(`:159`, `:276`, `:435`, `:497`, `:514`, `:524`, `:369`) matched exactly on
fresh re-read.

**`complete_item`'s per-kind validation is load-bearing for the channels
work**: for a `documents`-kind item, `complete_item` 409s
`{"reason": "payload_ref_missing"}` (`engine.py:483-484`) unless
`item.get("payload_ref")` is already truthy — but **no production code path
anywhere in this repo ever writes `payload_ref` onto a `workflow_item`
row**. See §10, finding 2 — this is a real gap, not a documentation-only
observation.

### 1g. `api/internal.py` — token-scoped family surface (full file, 443 lines)

Every route gated by `Depends(require_internal_key)` at the router level
(`:84`). No JWT anywhere in this module.

```python
BLOCKED_TOKEN_ACTIONS = frozenset({"cancel_instance", "verify_item",
                                   "reject_item", "waive_item"})          # :90
```
`workflow_config` route: `:273-290` (`GET
/internal/workflows/{tenant_id}/{definition_id}/config`) — returns
`{"definition": {definition_id, name, version, machine (by_alias), steps
(by_alias)}, "tenant": {...}, "capacity": {...}}`. `_capacity_summary`:
`:249-270`. `_require_family_channel_definition`: `:162-175` (404, never
403, if the lineage has no published `channel_access == "family"` row —
existence-oracle avoidance). **No drift**: all four line citations from the
Plan 3 brief matched exactly.

Other routes: `POST .../start` (`:202`, mints instance + magic link),
`POST .../request-link` (`:293`, always `{}`), `GET
/internal/instance-by-token/{token}` (`:314`), `POST .../actions` (`:330`,
403s `BLOCKED_TOKEN_ACTIONS` before ever calling `machine.execute_action`),
`GET .../documents` (`:346`), `POST .../documents` (`:383`, `uploaded_by`
derived server-side as `f"family:{instance_entity_id}"`, never
client-supplied), `GET .../documents/{document_id}/url` (`:406`).

### 1h. `workflows/definitions.py` — lineage lifecycle (full file, 366 lines)

`parse_machine_steps` (`:40-50`), `referenced_entity_models` (`:53-64`),
`fetch_models` (`:67-68`), `get_published_definition` (`:83-97`),
`publish_definition` (`:100-134`), `count_open_instances` (`:188-201`),
`retire_definition` (`:204-249`, `cancel_instance_fn` dependency-injected
by the caller to avoid a `definitions.py -> machine.py` import cycle),
`model_impact` (`:282-365`).

### 1i. `api/instances.py` / `api/documents.py`

`POST /api/workflows/{tenant_id}/definitions/{definition_id}/instances`
(`instances.py:57`, `{definition_id}` is the LINEAGE id, not a row
`entity_id`) and `POST
/api/workflows/{tenant_id}/instances/{instance_entity_id}/actions`
(`:114`, here `{instance_entity_id}` IS a real DataCore `entity_id`) —
both staff-authenticated (`require_staff_tenant`), both re-run
`machine.run_system_transitions` once after their own primary operation
(creation-time auto-advance fix). `api/documents.py`'s staff-facing blob
proxy forwards DataCore's real status code but masks the body (`:82-86`,
`:94-98`) — deliberately different from `internal.py`'s family-facing
masked-502 convention (Gotcha E).

---

## 2. DataCore write/version surface

### 2a. `store.py::put_entity` (full method, `store.py:307-386`)

```python
def put_entity(self, tenant_id, entity_type, entity_id, base_data,
               custom_fields=None, change_id=None) -> dict:               # :307
```
Archive-then-insert flow, verbatim structure: raises `ValueError` on
base_data/custom_fields key conflicts (`:324-330`); computes
`next_version = self._get_max_version(table, where) + 1` (`:341-342`,
`_get_max_version` at `:150-154`: `max(r["_version"] for r in rows)` over
rows matching `where`, `0` if none); archives the CURRENT active row(s) by
deleting them and re-inserting with `_status = "archived"` (`:344-355`);
inserts a new row with `_status = "active"`, the incremented `_version`,
`base_data`/`custom_fields` TOON-encoded (`:365-378`); trims old versions
(`:381`); returns the record with `base_data`/`custom_fields` restored to
native dict form and `vector` dropped (`:383-386`).

### 2b. `api/routes.py::update_entity` (full route, `routes.py:294-308`)

```python
@app.put("/api/entities/{tenant_id}/{entity_type}/{entity_id}")           # :294
def update_entity(tenant_id, entity_type, entity_id, body: CreateEntityRequest): ...  # :295-297
    # calls store.put_entity(..., custom_fields=body.custom_fields); 400 on ValueError.
```
**No drift**: matches the Plan 2 map's citation exactly on fresh re-read.

### 2c. `_version`/`_status` on flattened `/api/query` rows

`_version` and `_status` are NOT derived by the query-flattening step —
they are native columns on the stored Arrow/LanceDB schema, written
directly by `put_entity` (`store.py:372-373`: `"_version": next_version,
"_status": "active"`) and `put_model` (`store.py:208-209`, same shape).
`query.py::QueryEngine.query` (`query.py:39-104`) registers the table as-is
via `con.register("data", arrow_table)` (`:85`) and runs the caller's SQL
verbatim — it does **not** auto-filter to `_status = 'active'`; that
filter is the CALLER's responsibility. Confirmed two call sites that do
filter: `datacore/src/datacore/query.py:142` (`semantic_search`'s
hardcoded `where_clauses = ["_status = 'active'"]`) and
`apexflow/backend/app/workflows/datacore.py:153` (`list_entities`'s
`SELECT * FROM data WHERE entity_type = ... AND _status = 'active'`). So
"`_status='active'` is latest-only" is true only because every reader in
this codebase's engine layer builds its SQL that way — it is a convention
enforced by callers, not a query-engine guarantee.

`_scalar_to_str` (the string-flattening function `apexflow/backend/tests/fakes.py`
mirrors) lives at `datacore/src/datacore/query.py:12-21` — bool checked
before numeric (bool is an `int` subclass), dict/list JSON-encoded,
everything else `str()`.

### 2d. Test module + fixtures for `put_entity`

No single dedicated `test_put_entity.py` file exists. `put_entity` is
exercised directly (not just indirectly via the API) in
`datacore/tests/conftest.py` (`store` fixture, `:22-30`; `_setup_tenant`
helper, `:38-49`; `seeded_store` fixture, `:52-97`, which calls
`store.put_entity` for a tenant row + three student rows with custom
fields) and in `datacore/tests/test_api.py`'s `app_client` fixture
(`:12-26`, calls `store.put_entity` once to seed a `tenant` row before
building the `TestClient`). Both fixture patterns build a `Store` with a
`MagicMock` embedder (`embed.return_value = [0.0] * 1024`) over a
`tempfile.TemporaryDirectory()`. `test_archive_api.py` (`:19-31`) and
`test_query_basic.py`/`test_query_custom_fields.py`/
`test_query_bool_flatten.py`/`test_semantic_search.py` each call
`store.put_entity` directly to seed rows for their own scenarios, reusing
the same `store`/`seeded_store` fixtures from `conftest.py`.

---

## 3. apexflow DataCore client

Source: `apexflow/backend/app/workflows/datacore.py` (full file, 205 lines).

```python
def dc_create(tenant_id, entity_type, base_data, token=None) -> dict: ...  # :80
def dc_update(tenant_id, entity_type, entity_id, base_data, token=None,
             custom_fields=None) -> dict: ...                              # :90-91
def dc_query(tenant_id, sql, token=None, table="entities") -> list[dict]: ...  # :109
def list_entities(tenant_id, entity_type, where="", token=None) -> list[dict]: ...  # :136-137
def get_entity(tenant_id, entity_type, entity_id, token=None) -> dict | None: ...  # :159-160
def get_model_definition(tenant_id, entity_type, token=None) -> dict | None: ...  # :176-177
```
`dc_update` (`:90-106`) is a full-replace PUT; `custom_fields` defaults to
`{}` (erases previously-stored custom fields unless the caller passes them
back explicitly). `sql_literal` (`:53-61`) single-quote-doubling escaper.
`_ID_RE = re.compile(r"[A-Za-z0-9_-]+")` (`:39`) strict allow-list for
`tenant_id`/`entity_type`/`entity_id`.

### 3a. `tests/fakes.py::FakeDataCore` (full file, 224 lines)

`dc_update` signature: `dc_update(self, tenant_id, entity_type, entity_id,
base_data, token=None, custom_fields=None)` (`:140-141`) — matches the real
client's signature (this is the Plan-3-relevant fix: enrollx's original
fake lacked the `custom_fields` param). `_store_row` (`:111-127`) merges
`base_data`/`custom_fields` onto the same flattened row and stringifies via
a local `_scalar_to_str` mirror (`:91-100`, verbatim copy of
`datacore/src/datacore/query.py::_scalar_to_str`). `install_fake_datacore`
(`:218-224`) monkeypatches `dc_create`, `dc_update`, `next_id`,
`list_entities`, `get_entity`, `get_model_definition` onto
`app.workflows.datacore`, and routes `dc_query` to `_no_raw_query`
(`:187-190`) which raises `AssertionError` — engine code must go through
`list_entities`/`get_entity`, never call `dc_query` directly. Known
divergences from real DataCore, all documented in the module docstring
(`:33-63`): `TT-`-prefixed ids (not tenant-derived), no `_status`/`_version`
system columns on fake rows, `dc_update` raises on an unknown `entity_id`
(real DataCore upserts silently).

---

## 4. workflow-forms — draft key scheme (Section 4's highest-value finding)

Source: `workflow-forms/src/StepRenderer.tsx` (full file, 540 lines).

### 4a. Exact key scheme `SectionRenderer`/`FieldControl` read/write

`WorkflowDraft = Record<string, unknown>` (`:161`), a **flat** map, not
nested per-section objects:

- **Non-repeat section field**: key `` `${section.section_id}.${field.name}` ``
  — read at `StepRenderer.tsx:361`, written via `setField` at `:354-356`
  (`onDraftChange({ ...draft, [\`${section.section_id}.${name}\`]: value })`).
  This dotted key is ALSO exactly the key `buildConditionData` (`:201-217`)
  reads for `show_if` evaluation — no separate reshaping between form state
  and condition data for non-repeat fields.
- **Repeat section** (`section.repeat` set): the WHOLE row array lives at
  the BARE `section_id` key (no dotting) — read at `:372`
  (`draft[section.section_id]`), written via `setRows` at `:377-379`
  (`onDraftChange({ ...draft, [section.section_id]: next })`). Each row is
  a plain `{field_name: value}` object (`:380-382`,
  `rows.map((row, i) => i === index ? {...row, [name]: value} : row)`).
  Repeat rows contribute NOTHING to `show_if` condition data
  (`buildConditionData:206`, `if (section.repeat) continue; // Plan 1
  rule.`) — a bare non-dotted key would be ambiguous with a dotted one
  anyway, so this is also a parse-safety property, not just a design
  choice.
- **Message step acknowledgement**: key `` `${step.step_id}.ack` `` — read/
  written at `MessageStep`, `:442-451` (`draft[ackKey] === true`,
  `onDraftChange({ ...draft, [ackKey]: e.target.checked })`). This key is
  NOT a section — no `SectionDef` owns it — so it can never be committed
  via `save_draft` (see 4b: `save_draft` 400s any `section_id` the pinned
  definition doesn't declare as a section).
- **Host-seeded context**: keys prefixed `context.` (e.g. `context.foo`)
  pass through `buildConditionData` untouched (`:213-215`,
  `for (const key of Object.keys(draft)) { if (key.startsWith('context.'))
  data[key] = draft[key]; }`) for `show_if` evaluation only — `context` has
  no write path through `save_draft` either (engine.py explicitly rejects
  it, see 4b).

### 4b. `engine.py::save_draft`'s `section_answers` shape (`engine.py:276-355`)

```python
def save_draft(tenant_id, instance_row, section_answers: dict, actor, *,
               token=None, now=None) -> dict:                              # :276
```
Expects a **nested, per-section-id dict**, not the flat dotted-key shape
`WorkflowDraft` uses:

- Non-repeat section: `section_answers[section_id]` must be a `dict`
  (`{field_name: value}`) — shallow-merged into whatever's already staged
  (`:349-351`, `existing = draft.setdefault(section_id, {});
  existing.update(answer)`). A list-shaped answer here is rejected with 400
  (`:316-320`).
- Repeat section: `section_answers[section_id]` must be a `list` of
  `dict`s — REPLACE-list semantics, no per-entry merge (`:347-348`,
  `draft[section_id] = answer`). A dict-shaped answer here is rejected with
  400 (`:328-332`).
- `"context"` as a top-level key in `section_answers` is rejected with 400
  outright (`:300-303`) — creation-time only, never section-writable.
- Any `section_id` not present in `_section_map(steps)` (built from every
  `form` step's declared sections, `engine.py:258-270`) is rejected with
  400 naming it (`:311-314`).
- Any field named in `ENGINE_OWNED_FIELDS` (schema.py, §1) appearing
  anywhere in an answer (including inside a repeat entry) is rejected with
  400 (`:335-339`).

### 4c. The mismatch, and the precise converter needed

**`WorkflowDraft` and `section_answers` are NOT the same shape — no
converter exists anywhere in this codebase today.** `grep -rn
"section_answers"` across `workflow-forms/`, `apexflow/frontend/`,
`familyhub/frontend/` returns zero matches outside test files and the
backend itself. A converter from `WorkflowDraft` to `section_answers`,
given the same `steps: WorkflowStepDef[]` `StepRenderer` already consumes,
is:

```
for each `form` step, for each declared section:
  if section.repeat is None:
    entry = {}
    for each field pick in section.fields:
      key = `${section_id}.${field.name}`
      if key in draft: entry[field.name] = draft[key]
    if entry is non-empty: section_answers[section_id] = entry   # dict
  else:
    if draft[section_id] is an array: section_answers[section_id] = draft[section_id]  # list, as-is

# NEVER include: any `context.*` key, any `{step_id}.ack` key (message steps —
# not a section at all; save_draft would 400 it as an undeclared section_id
# if the step_id happened to collide with a real section_id, and 400s it
# anyway as "not declared" in the general case).
```

This mapping is symmetric with the READ side too: hydrating a
`WorkflowDraft` from a fetched `instance.draft_data` (nested per-section
shape) into flat dotted keys is the literal inverse — for a non-repeat
section, spread `draft_data[section_id]`'s entries as
`` `${section_id}.${field}` `` keys; for a repeat section, copy
`draft_data[section_id]` straight across to the bare `section_id` key.

**No such hydration/flattening step exists in `workflow-forms` today either**
— `StepRenderer`'s `draft` prop is caller-supplied with no built-in loader.
Plan 3 tasks that wire `save_draft`/draft-hydration between apexflow and
either channel need to build BOTH directions of this converter; there is
no existing "just call this function" shortcut to point to.

### 4d. Other Section-4 facts

`evaluateCondition` — `StepRenderer.tsx:139-144` (pure port of
`conditions.py`; dispatches on `Array.isArray(group.all/any/not)`, not
`!== undefined`, because the backend's `model_dump(by_alias=True)` emits
all three keys with `null` on the unset ones). `index.ts` exports (full
file, `workflow-forms/src/index.ts:1-15`):
```ts
export * from './types';
export { FlowRenderer, type FlowRendererProps } from './FlowRenderer';
export { flowT, flowTWith, useFlowT, useFlowLocale, type Locale } from './i18n';
export { validateFlowField } from './validateField';
export {
  formFields, docsOf, plansOf, planAmounts, messageBody,
  resolvePlanKind, paymentAmountFor,
  defaultSchoolYear, hydratedFormFields, labelOf, type ModelFieldSource,
} from './blockConfig';
export { formatCents } from './money';
export { sectionFields } from './sectionFields';
export {
  StepRenderer, evaluateCondition, type StepRendererProps, type WorkflowDraft,
} from './StepRenderer';
```
(Grown since Plan 2's map: `labelOf`, `sectionFields`, and the whole
`StepRenderer`/`evaluateCondition`/`WorkflowDraft` group are new exports.)

`available_in` caller-side-filter contract: `StepRenderer` itself never
consults `available_in` (`StepRenderer.tsx:509-514` doc comment) — callers
with a state to preview against must pre-filter `steps` themselves.
PreviewPane's precedent, exact: `apexflow/frontend/src/editor/PreviewPane.tsx:101-104`
```ts
const visibleSteps = useMemo(
  () => steps.filter((step) => step.available_in.includes(selectedState)),
  [steps, selectedState],
);
```
Empty `available_in` means NO state (excluded), not every state —
`schema.py:213`'s `available_in: list[str]` has no default/`Optional`,
unlike the very next field `show_if: ConditionGroup | None = None`
(`:214`) whose `None` the engine treats as "always applicable." **No
runtime code anywhere in `apexflow-backend` currently reads
`available_in` at all** — `applicable_items` (`workflows/shared.py:107-124`)
only consults `show_if`; `_derive_item_specs` (`engine.py:105-144`) derives
an item for every step unconditionally. `available_in` is, as of this map,
a pure designer-time/authoring concept with zero runtime enforcement — any
Plan 3 task that needs a channel to hide a step by machine state must
either add that enforcement to the engine or replicate PreviewPane's
client-side pre-filter pattern in the channel's own renderer wiring.

---

## 5. familyhub backend

All paths relative to `familyhub/backend/app/` unless stated otherwise.
Route modules: `api/{application,documents,health,registration}.py`.

### 5a. `api/application.py` (full file, 124 lines) — token-scoped facade

```python
PARENT_ACTIONS = {"save_draft", "complete_item", "submit", "withdraw", "resubmit"}  # :54
```
Guard (`:75-86`, `if not isinstance(action, str) or action not in
PARENT_ACTIONS: raise HTTPException(403, ...)`) runs BEFORE any network
call — defense in depth alongside apexflow's own `BLOCKED_TOKEN_ACTIONS`.
Module docstring notes this list must be kept in sync BY HAND with
apexflow's `actor: "family"` transitions (currently `save_draft`,
`complete_item`, `submit`, `withdraw`, `resubmit` per the enrollment
template) — `withdraw`/`resubmit` were both a real prior regression here.
Routes: `GET /application/{token}` (`:57`), `PUT /application/{token}`
(`:67`, proxies the raw client payload UNCHANGED to apexflow's
`/internal/instance-by-token/{token}/actions` — see §10 finding 1 for why
this matters), `POST /application/request-link` (`:101`, rate-limited,
always `{"status": "ok"}`).

### 5b. `api/registration.py` (full file, 163 lines) — public facade

```python
def _config_bundle_from_apexflow(data: dict) -> dict: ...                 # :47-61
def _school_year_for_date(ref: datetime.date) -> str: ...                 # :102-112
def _application_view_from_instance(instance: dict) -> dict: ...          # :115-126
```
**No drift**: all three line ranges from the Plan 3 brief matched exactly
on fresh re-read. `_config_bundle_from_apexflow` ships `"blocks": []`
always — no steps/sections -> `FlowBlock[]` compiler exists yet (Phase 3,
explicitly out of scope). `_school_year_for_date` rolls over each July
(`start_year = ref.year if ref.month >= 7 else ref.year - 1`) — threaded
into apexflow's `start` body as `context.school_year`, which the
enrollment template's `capacity_available` guard scopes on; workflow-forms's
own `defaultSchoolYear()` must agree (not verified byte-identical here —
flag for a Plan 3 task if not already covered by a cross-service test).
`_application_view_from_instance` is a pure rename (`state` -> `status`),
not a translation — the two vocabularies are asserted identical sets.
Routes: `GET /registration/{tenant_id}/{definition_id}` (`:64`), `POST
.../start` (`:129`, rate-limited via `limit_start`).

### 5c. `upstream.py` (full file, 49 lines) — the one outbound seam

```python
def call_upstream(method, url, *, json_body=None, content=None,
                  headers=None) -> httpx.Response: ...                     # :15-22
def apexflow_headers() -> dict: return {"X-Internal-Key": settings.apexflow_internal_key}  # :39-40
def apexflow(path: str) -> str: return f"{settings.apexflow_url}{path}"    # :43-44
def datacore(path: str) -> str: return f"{settings.datacore_url}{path}"    # :47-48
```
Every outbound call in this service goes through `call_upstream` so tests
monkeypatch exactly one seam: `app.upstream.httpx.request`.
`httpx.RequestError` -> `HTTPException(502, "Upstream service unreachable")`.

### 5d. `relay.py` (full file, 49 lines) — shared error policy

```python
def relay(resp) -> Response: ...           # :30-38 — 4xx passed through verbatim, >=500 masked
def upstream_unavailable() -> Response: ... # :41-48 — the same masked 502, for shape-invalid responses
```
Originally in `registration.py`, promoted here once `application.py` needed
the identical policy (module docstring `:17-20`).

### 5e. `ratelimit.py` (full file, 104 lines)

```python
class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float): ...     # :36-39
    def check(self, key: str, now: float | None = None) -> None: ...      # :41-52

start_limiter = RateLimiter(max_requests=10, window_seconds=60.0)          # :55
request_link_limiter = RateLimiter(max_requests=10, window_seconds=60.0)   # :56
document_presign_limiter = RateLimiter(max_requests=20, window_seconds=60.0)  # :65

def limit_start(request: Request) -> None: ...            # :94-95
def limit_request_link(request: Request) -> None: ...     # :98-99
def limit_document_presign(request: Request) -> None: ...  # :102-103
```
Keyed on `_client_ip` (`:68-91`, trusts `CF-Connecting-IP` because
`CloudflareIPMiddleware` already gates every request in `app/main.py`),
never on request body content. Used as FastAPI route `dependencies=[Depends(...)]`
on `application.py:101`, `registration.py:131`, `documents.py:67`.

### 5f. `api/documents.py` (full file, 115 lines) — token-scoped document facade

Thin proxy: local validation only (content type allow-list `:42-48`, size
`0 < size <= 20MB` `:79-85`), no token verification of its own beyond
`parse_token`'s cheap shape check (`app/tokenutil.py`, decode-only, NOT a
credential check). `POST /application/{token}/documents` (`:66-67`,
rate-limited), `GET /application/{token}/documents/{document_id}/url`
(`:103-104`).

### 5g. Test fixture pattern

`familyhub/backend/tests/conftest.py` (full file, 16 lines): one autouse
fixture, `_bypass_cloudflare_middleware` (`:5-15`), sets `TRUST_ALL_IPS=1`
so `TestClient`'s non-Cloudflare source IP doesn't 403 every test. There is
no shared `FakeHTTP` in `conftest.py` — each test module that needs to
monkeypatch the upstream seam defines its own local `FakeResponse`/
`FakeHTTP` pair (confirmed in `test_registration_routes.py:20-52`) and a
`fake_http` fixture that does `monkeypatch.setattr("app.upstream.httpx.request",
fake.request)` (`:52-54`), plus a separate `internal_key` fixture
(`:59-61`) that sets `settings.apexflow_internal_key = "test-internal-key"`.

### 5h. apexflow integration status (already wired, not legacy)

`familyhub/backend/app/config.py` already has `apexflow_url` (`:21`,
default `http://localhost:5910`) and `apexflow_internal_key` (`:22`,
default `"dev-internal-key-change-in-prod"` — MUST equal apexflow's
`DEV_INTERNAL_KEY`, confirmed identical string at
`apexflow/backend/app/config.py:20`). Every route module above already
retargets to apexflow's `/internal/workflows/...` and
`/internal/instance-by-token/...` surfaces — this is NOT legacy
enrollx-shaped code needing a Plan 3 retarget; Plan 3's job is filling
gaps in what's already wired (see §10).

---

## 6. familyhub frontend

All paths relative to `familyhub/frontend/src/` unless stated otherwise.

### 6a. `api/facade.ts` (full file, 298 lines) — full export list

```ts
export class FacadeError extends Error { readonly status: number; ... }    // :33-41
export async function fetchRegistrationBundle(tenantId, definitionId): Promise<RegistrationBundle>  // :109-118
export async function startRegistration(tenantId, definitionId, applicantEmail): Promise<StartResponse>  // :126-140
export async function fetchApplication(token): Promise<HubBundle>          // :149-153
export const saveDraft = (token, draftData) => ...                          // :174-175
export const completeItem = (token, itemId, payloadRef?) => ...             // :184-189
export const submitApplication = (token) => ...                             // :192
export async function requestLink(tenantId, email): Promise<void>           // :201-208
export async function createDocumentSlot(token, meta): Promise<DocumentSlot>  // :215-225
export async function uploadDocumentFile(token, itemId, file): Promise<string>  // :237-257
export async function getDocumentUrl(token, documentId): Promise<string>    // :265-271
export function decodeToken(token): DecodedToken | null                     // :280-297
```

**Confirmed live discrepancy #1 (§10 finding 1, cross-referenced here since
it's this file's own bug):** `saveDraft` (`:174-175`) sends
`{action: 'save_draft', draft_data: draftData}` — the wire key is
`draft_data`. But `machine.py::_run_item_builtin` (`:379-382`) reads
`params.get("section_answers")`, defaulting to `{}` when absent. Since
`application.py`'s `put_application` route forwards the client payload
UNCHANGED (`familyhub/backend/app/api/application.py:87-93`,
`json_body=payload`), every `saveDraft` call from familyhub-frontend today
silently no-ops on the backend — `section_answers` is always the default
empty dict. The comment directly above this code (`facade.ts:170-172`,
"Params verified against apexflow/backend/app/workflows/engine.py:
save_draft -> draft_data") is itself the source of the bug — it names the
wrong wire key. Confirmed correct key via `familyhub/backend/tests/test_application_routes.py:130`,
which asserts `json={"action": "save_draft", "section_answers": {"s1":
{"child_name": "Mei"}}}` — the backend TEST suite already uses the right
shape; only this frontend client is wrong.

**Confirmed live discrepancy #2:** `completeItem`'s optional `payloadRef`
param (`:184-189`, sent as `{action: 'complete_item', item_id, payload_ref}`)
is silently dropped on the backend too — `machine.py::_run_item_builtin`'s
non-`save_draft` branch (`:387-393`) only ever forwards `item_id` to
`engine.complete_item`, whose signature (`engine.py:435`) has no
`payload_ref` parameter at all. See §10 finding 2 for the full chain (this
is the SAME root cause as `complete_item`'s documented `payload_ref_missing`
409 in §1f — nothing ever writes `payload_ref` onto the item).

`RawConfigBundle`/`RawHubBundle` (`:85-89`, `:142-146`) are both local
`interface` declarations, not exported — no naming mismatch with anything
apexflow itself returns (apexflow's `workflow_config`/`instance_by_token`
responses are reshaped server-side by `registration.py`/`application.py`
before ever reaching this client, per §5b/§5a). `normalizeConfig`
(`:63-83`) parses `blocks` from a JSON string OR passes through an array —
currently always receives `[]` from the backend's placeholder reshape (§5b).

### 6b. `types/registration.ts` (full file, 159 lines)

`EntityRecord`/`entityData()` (`:34-43`) tolerate both the DataCore
envelope shape and a flattened row. `entityId()` (`:62-68`) — the
load-bearing id-read helper, added after a real bug (a parent's first
`save_draft` 400d because `entityData(row).entity_id` reads `''` on an
ENVELOPE-shaped row, since `entity_id` sits at the top level there, not
inside `base_data`). `TenantSummary` (`:75-78`), `CapacityState`
(`:90-94`, matches apexflow's `_capacity_summary` shape exactly, §1g),
`RegistrationBundle`/`StartResponse`/`HubBundle`/`DocumentSlot`/`DecodedToken`
(`:96-154`). `ApplicationStatus`/`ItemStatus` are RE-EXPORTED from
`@neoapex/workflow-forms` (`:6`), not redeclared — no drift risk there by
construction.

### 6c. Page structure

`RegisterPage.tsx`: `type Phase = 'loading' | 'email' | 'running' |
'notFound' | 'invalidLink'` (`:38`, **no drift** from Plan 2 map's
citation). `HubPage.tsx`: `const OUTSTANDING: ItemStatus[] =
['not_started', 'in_progress', 'rejected']` (`:62`), `const TERMINAL:
ApplicationStatus[] = ['declined', 'withdrawn']` (`:63`, **no drift**).

### 6d. i18n key namespaces

`familyhub/frontend/src/i18n/translations.ts`: single-file
`Record<Locale, Record<string, string>>` (Locale = `'en-US' | 'zh-CN'`,
`:1`), same pattern as admindash's. Top-level key namespaces observed:
`nav.*` (shared chrome), `landing.*`, `register.*` (registration-start
flow), `hub.*` (parent hub page).

---

## 7. admindash backend

All paths relative to `admindash/backend/app/` unless stated otherwise.

### 7a. `Settings` (full class, `config.py:8-56`)

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ADMINDASH_", case_sensitive=False)  # :9-12
    environment: str = "development"                                      # :14
    datacore_url: str = "http://localhost:5800"                           # :15
    papermite_backend_url: str = "http://localhost:5710"                  # :16
    cors_allowed_origins: Union[Optional[str], List[str]] = None          # :20
    port: int = 5610                                                      # :21
    chat_model: str = "anthropic:claude-haiku-4-5-20251001"               # :22
    chat_max_tokens: int = 1024                                           # :23
    chat_history_turns: int = 8                                           # :24
    chat_session_message_cap: int = 30                                    # :25
```
**No drift** from Plan 2 map's `:8-56` citation. No `apexflow_url` field
exists on admindash's `Settings` — admindash has NO apexflow integration
wired yet (confirmed: `grep -rn "apexflow"` across
`admindash/backend/app/` and `admindash/frontend/src/` returns zero
matches). This is the actual Plan 3 gap on the admindash side — Section
8's route table below confirms no staff-assisted-entry route exists either.

### 7b. Papermite proxy — `api/extract.py`

```python
@router.post("/extract/{tenant_id}/student")                              # :18
async def extract_student(...): ...                                       # :19
@router.get("/config/models")                                             # :63
def get_available_models(user=Depends(require_authenticated_user)): ...   # :64
```

### 7c. `tenancy.py` — tenant-match + SQL guard

```python
def require_tenant_match(tenant_id: str, user=Depends(require_authenticated_user)) -> dict: ...  # :290
def assert_query_tenant_match(request_tenant_id, user: dict) -> None: ...  # :299
def assert_sql_is_safe_read(sql: str) -> None: ...                         # :311
```
**No drift** from Plan 2 map's citations. The shared SQL shape guard block
(`# ── BEGIN/END shared SQL shape guard ──`) ends immediately above
`require_tenant_match` at `:287` — `require_tenant_match` checks
`user.get("tenant_id") != tenant_id` (path param); `assert_query_tenant_match`
checks the SAME thing against a request-BODY tenant_id (`/api/query` has no
`{tenant_id}` path segment to check against instead).

### 7d. `main.py` — router mounts (full file, 43 lines)

```python
app.include_router(auth.router, prefix="/auth", tags=["auth"])            # :34
app.include_router(health.router, prefix="/api", tags=["health"])         # :37
app.include_router(query.router, prefix="/api", tags=["query"])           # :38
app.include_router(entities.router, prefix="/api", tags=["entities"])     # :39
app.include_router(extract.router, prefix="/api", tags=["extract"])       # :40
app.include_router(leads.router, prefix="/api", tags=["leads"])           # :41
app.include_router(chat_router.router, prefix="/api", tags=["chat"])      # :42
```
(Prior map cited `:34-42` as one block; on fresh read the mounts occupy
`:34` then `:37-42` — `:35-36` are blank/comment lines. No functional
drift, only a citation-precision correction.)

### 7e. respx test pattern

`grep -rln "respx"` across `admindash/backend/tests/`: `test_auth.py`,
`test_auth_dep.py`, `test_chat_proposals.py`, `test_chat_endpoint.py`,
`test_entities.py`, `test_chat_tools.py`, `test_query.py`,
`test_chat_datacore.py`, `test_extract.py`, `test_leads.py`,
`test_tenancy.py` — a wider set than Plan 2's map named (which cited only
`test_extract.py`, `test_entities.py`, `test_leads.py`); `test_query.py`
and `test_tenancy.py` also use it directly for the query-proxy and
guard-parity tests respectively.

### 7f. Open sync-httpx-in-async status — CONFIRMED STILL OPEN

`admindash/backend/app/api/entities.py`: `import httpx` (`:2`),
`async def _proxy_to_datacore(...)` (`:11`) calls **synchronous**
`httpx.request(...)` at `:18` (not `AsyncClient`). `admindash/backend/app/api/query.py`:
`async def query(...)` (`:13`) calls **synchronous** `httpx.post(...)` at
`:34`. **Both are still unfixed on this branch** — the exact same
event-loop-blocking bug apexflow's OWN copies of these two files had (and
fixed, commit `dd1ee6d`, awaited `httpx.AsyncClient`) has NOT been
backported to admindash's originals. Since apexflow's `api/entities.py`
and `api/query.py` (§1b/§1c) were explicitly PORTED FROM admindash's
copies per their own module docstrings, admindash is the stale source, not
apexflow — a fix here would need to flow the other direction (or be fixed
independently) if it's ever addressed.

---

## 8. admindash frontend

All paths relative to `admindash/frontend/src/` unless stated otherwise.

### 8a. `App.tsx` — full route table (full file, 97 lines)

```tsx
<Route path="/login" .../>                                                 // :45
<Route path="/inquire/:tenantId" element={<PublicInquiryPage />} />         // :47
<Route path="/home" element={<HomePage tenant={tenant} />} />               // :62
<Route path="/students" element={<StudentsPage tenant={tenant} />} />       // :63
<Route path="/students/bulk-add" element={<BulkAddStudentsPage tenant={tenant} />} />  // :64-67
<Route path="/leads" element={<LeadPage tenant={tenant} />} />              // :68
<Route path="/programs" element={<ProgramPage tenant={tenant} />} />        // :69
<Route path="/families" element={<FamiliesPage tenant={tenant} />} />       // :70
<Route path="/" element={<Navigate to="/home" replace />} />                // :71
<Route path="*" element={<NotFound />} />                                   // :72
```
**No apexflow/workflow route exists anywhere in this file** — confirms
§7a's finding: admindash has zero staff-assisted-entry wiring today. This
is new-territory work for Plan 3, not a retarget.

### 8b. `components/Navbar.tsx`

`icons` map: `:18-46` (**no drift**) — `home`, `leads`, `students`,
`families`, `programs` (five keys, no `workflows`/`apexflow` icon).
`navItems`: `:81-87` (**no drift**):
```ts
const navItems = [
  { to: '/home', label: t('nav.home'), icon: 'home' },
  { to: '/leads', label: t('nav.lead'), icon: 'leads' },
  { to: '/students', label: t('nav.student'), icon: 'students' },
  { to: '/families', label: t('nav.family'), icon: 'families' },
  { to: '/programs', label: t('nav.program'), icon: 'programs' },
];
```

### 8c. `api/client.ts` — full export list (26 functions/consts)

`postQuery` (`:24-36`, **no drift**), `archiveEntities` (`:38`),
`restoreEntities` (`:56`), `updateEntity` (`:73`), `createEntity` (`:95`),
`extractStudentFromDocument` (`:116`), `fetchAvailableModels` (`:139`),
`fetchNextEntityId` (`:147`), `checkDuplicateStudents` (`:159`),
`listLeads` (`:175`), `getLead` (`:182`), `createLead` (`:188`),
`updateLeadStage` (`:197`), `listActivities` (`:206`), `addActivity`
(`:212`), `convertLead` (`:227`), `fetchPublicLeadModel` (`:238`),
`submitPublicLead` (`:246`), `escapeSql` (`:255`), `searchFamilies`
(`:259`), `getFamilyById` (`:271`), `getStudentsByFamily` (`:278`),
`createFamily` (`:288`), `searchStudents` (`:295`). No apexflow-related
export exists.

### 8d. `pages/LeadPage.tsx` — board

```ts
const stages = leadStages(model);                                         // :40
const byStage = (s: string) => visible.filter((l) => l.stage === s);       // :68
const renderColumn = (label: string, rows: Lead[], tone: string) => (...)  // :87
{stages.map((stage, i) => renderColumn(stage, byStage(stage), stageTone(i, stages.length)))}  // :161
```
(Plan 2 map cited `stages` at a fixed line without noting it's a derived
`const` from `leadStages(model)`, not a literal array — `:40` itself still
matches.)

### 8e. `utils/tone.ts::stageTone` (`:96-102`, **no drift**)

```ts
export function stageTone(index: number, total: number): string {
  if (total <= 1) return 'stage-0';
  if (index >= total - 1) return 'stage-5';
  const span = Math.max(1, total - 2);
  const step = Math.round((index / span) * (STAGE_STEPS - 3));
  return `stage-${Math.min(step, STAGE_STEPS - 3)}`;
}
```

### 8f. `components/LeadDetailDrawer.tsx`

No exported `Props` interface — inline destructured type on the default
export (`:21-24`):
```ts
export default function LeadDetailDrawer(
  { tenant, lead, onClose, onChanged }:
  { tenant: string; lead: Lead; onClose: () => void; onChanged: () => void },
) { ... }
```

### 8g. Shared UI component prop interfaces (all confirmed **no drift** vs. Plan 2 map)

- `DataTable.tsx`: `Column<T>` `:5`, `EmptyState` `:16`, `DataTableProps<T>`
  `:22`, `export default function DataTable<T>(...)` `:76`.
- `ui/Modal.tsx`: `ModalProps` `:17`, `export function Modal(...)` `:47`.
- `ui/Button.tsx`: `ButtonProps extends ButtonHTMLAttributes<...>` `:6`,
  `export function Button(...)` `:22`.
- `StatusBadge.tsx`: `export default function StatusBadge({ status }: {
  status?: unknown }) {` `:9`.
- `ui/ViewChips.tsx` (new since Plan 2's map — not previously catalogued):
  ```ts
  export interface ViewOption { value: string; label: string; tone?: string; }  // :5-11
  interface ViewChipsProps {                                                     // :13-27
    options: ViewOption[]; active: string; onPick: (value: string) => void;
    counts: Record<string, number> | null; total: number; allLabel: string;
    ariaLabel: string; showAdvanced: boolean; onToggleAdvanced: () => void;
  }
  ```

### 8h. `useTablePreferences` key builder

```ts
function buildStorageKey(namespace: string, userId: string, tenantId: string): string {
  return `admindash_table_prefs_${namespace}_${userId}_${tenantId}`;        // :38-40
}
```
`DEFAULT_NAMESPACE = 'student'` (`:26`), `DEFAULT_SORT_BY = 'last_name'` (`:27`).

### 8i. `vitest.config.ts` (full file, 9 lines)

```ts
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/__tests__/*.test.ts'] },
});
```
Node env (not jsdom); only `.test.ts` files match (NOT `.test.tsx` —
component tests are out of scope for this config).

### 8j. Translations guard test (`i18n/__tests__/translations.test.ts`, full file, 37 lines)

Three assertions: same key set in both locales (`:13-17`), no blank values
in any locale (`:19-26`), and matching `{placeholder}` interpolation tokens
across locales for every key (`:28-35`).

---

## 9. Configuration-facts table (re-verified in a second pass — see note below)

| Fact | Value | Source (file:line) |
|---|---|---|
| `services.json` — `apexflow-frontend` | `{"host": "localhost", "port": 5900}` | `services.json:12` |
| `services.json` — `apexflow-backend` | `{"host": "localhost", "port": 5910}` | `services.json:13` |
| `services.json` — `admindash-frontend` | `{"host": "localhost", "port": 5600}` | `services.json:5` |
| `services.json` — `admindash-backend` | `{"host": "localhost", "port": 5610}` | `services.json:6` |
| `services.json` — `familyhub-frontend` | `{"host": "localhost", "port": 5620}` | `services.json:7` |
| `services.json` — `familyhub-backend` | `{"host": "localhost", "port": 5630}` | `services.json:8` |
| `services.json` — `datacore` | `{"host": "localhost", "port": 5800}` | `services.json:11` |
| `services.json` — `launchpad-frontend`/`-backend` | `5500` / `5510` | `services.json:3-4` |
| `services.json` — `papermite-frontend`/`-backend` | `5700` / `5710` | `services.json:9-10` |
| apexflow-backend `port` default | `5910` | `apexflow/backend/app/config.py:42` |
| apexflow-backend `datacore_url` default | `http://localhost:5800` | `apexflow/backend/app/config.py:39` |
| apexflow-backend `familyhub_base_url` default | `http://localhost:5620` | `apexflow/backend/app/config.py:59` |
| apexflow-backend env prefix | `APEXFLOW_` | `apexflow/backend/app/config.py:28` |
| apexflow-backend `link_secret`/`internal_key` dev defaults | `dev-link-secret-change-in-prod` / `dev-internal-key-change-in-prod` | `apexflow/backend/app/config.py:19-20` |
| apexflow-backend `MIN_SECRET_LENGTH` | `32` | `apexflow/backend/app/config.py:24` |
| apexflow-backend CORS env var (prod-required) | `APEXFLOW_CORS_ALLOWED_ORIGINS` | `apexflow/backend/app/config.py:80,84` |
| apexflow-backend CORS dev default | `["http://localhost:5900"]` | `apexflow/backend/app/config.py:87` |
| admindash-backend `datacore_url` default | `http://localhost:5800` | `admindash/backend/app/config.py:15` |
| admindash-backend `papermite_backend_url` default | `http://localhost:5710` | `admindash/backend/app/config.py:16` |
| admindash-backend `port` default | `5610` | `admindash/backend/app/config.py:21` |
| admindash-backend CORS env var | `ADMINDASH_CORS_ALLOWED_ORIGINS` | `admindash/backend/app/config.py:41,46` |
| admindash-backend has NO `apexflow_url`/apexflow field | confirmed absent (grep, zero matches) | `admindash/backend/app/config.py` (full file, 56 lines) |
| familyhub-backend `datacore_url` default | `http://localhost:5800` | `familyhub/backend/app/config.py:13` |
| familyhub-backend `apexflow_url` default | `http://localhost:5910` | `familyhub/backend/app/config.py:21` |
| familyhub-backend `apexflow_internal_key` dev default | `dev-internal-key-change-in-prod` (must equal apexflow's `DEV_INTERNAL_KEY`) | `familyhub/backend/app/config.py:22`; confirmed identical to `apexflow/backend/app/config.py:20` |
| familyhub-backend `port` default | `5630` | `familyhub/backend/app/config.py:25` |
| familyhub-backend CORS env var | `FAMILYHUB_CORS_ALLOWED_ORIGINS` | `familyhub/backend/app/config.py:40,44` |
| datacore JWT secret env var | `DATACORE_JWT_SECRET` (dev default `neoapex-dev-secret-change-in-prod`) | `datacore/src/datacore/auth/config.py:11-13` |
| datacore JWT expiry env var | `DATACORE_JWT_EXPIRY_HOURS` (default `24`) | `datacore/src/datacore/auth/config.py:14-16` |
| datacore CORS env var (unprefixed) | `CORS_ALLOWED_ORIGINS` | `datacore/src/datacore/api/__init__.py:29,34,39` |
| apexflow-frontend `APEXFLOW_API_URL` resolution | `import.meta.env.VITE_APEXFLOW_API_URL \|\| svcUrl('apexflow-backend')` | `apexflow/frontend/src/config.ts:10` |
| admindash-frontend `ADMINDASH_API_URL` resolution | `import.meta.env.VITE_ADMINDASH_API_URL \|\| svcUrl("admindash-backend")` | `admindash/frontend/src/config.ts:9` |
| familyhub-frontend `FAMILYHUB_API_URL` resolution | `import.meta.env.VITE_FAMILYHUB_API_URL \|\| svcUrl("familyhub-backend")` | `familyhub/frontend/src/config.ts:9` |
| localStorage: JWT token | key `neoapex_token` | `admindash/frontend/src/contexts/AuthContext.tsx:4`; `apexflow/frontend/src/contexts/AuthContext.tsx:12`, `apexflow/frontend/src/api/{designer,client}.ts:18,13` (independent copies, not shared code) |
| localStorage: locale | key `preferredLanguage` | `admindash/frontend/src/hooks/useTranslation.ts:4`; `familyhub/frontend/src/hooks/useTranslation.ts:4`; `apexflow/frontend/src/hooks/useTranslation.ts:8`; also read directly at `workflow-forms/src/i18n.ts:93` (drift from Plan 2 map's `:87` citation — corrected here) |
| localStorage: admindash density | key `admindash_density` | `admindash/frontend/src/hooks/useDensity.ts:3` |
| localStorage: admindash table prefs | key `admindash_table_prefs_${namespace}_${userId}_${tenantId}` | `admindash/frontend/src/hooks/useTablePreferences.ts:38-40` |
| sessionStorage: admindash chat history | key `admindash_chat_history` | `admindash/frontend/src/contexts/AuthContext.tsx:63` |
| DataCore models write route | `PUT /api/models/{tenant_id}` | `datacore/src/datacore/api/routes.py:205` |
| DataCore models read | via `POST /api/query {table: "models"}` — no dedicated GET route | `datacore/src/datacore/api/unified_routes.py:34` |
| `start-services.sh` apexflow port vars | `APEXFLOW_BE_PORT`, `APEXFLOW_FE_PORT` (via `read_port`) | `start-services.sh:53,58` |
| `start-services.sh` familyhub port vars | `FAMILYHUB_BE_PORT`, `FAMILYHUB_FE_PORT` | `start-services.sh:54,59` |
| apexflow-frontend directory | **now exists** (built in Plan 2) — Plan 2 map's "does not exist yet" note is stale | `apexflow/frontend/` contains `dist/`, `eslint.config.js`, `index.html`, `node_modules`, `package-lock.json` (confirmed via `ls`) |

**Second-pass note:** every row above was re-checked by re-opening the
cited file a second time after the first draft of this table was written.
Corrections made during the second pass: (1) `admindash/backend/app/main.py`'s
router-mount citation was split from a single `:34-42` block into `:34` +
`:37-42` after noticing blank/comment lines at `:35-36` on the second
read — no value changed, only citation precision. (2) The apexflow-frontend
"does not exist yet" row was flipped from the Plan 2 map's claim to
"now exists," confirmed by directly listing the directory rather than
trusting the prior map's snapshot. No other value changed between passes.

---

## 10. Cross-cutting notes for Plan 3 implementers

1. **`saveDraft`'s wire key is wrong on familyhub-frontend today — this
   silently breaks family-side draft saving end-to-end.**
   `familyhub/frontend/src/api/facade.ts:174-175` sends
   `{action: 'save_draft', draft_data: draftData}`. apexflow's
   `machine.py::_run_item_builtin` (`:379-382`) reads
   `params.get("section_answers")`, defaulting to `{}`. Since
   `familyhub/backend/app/api/application.py`'s `put_application`
   (`:87-93`) forwards the payload unchanged, every real `saveDraft` call
   from the parent-facing hub today writes an empty draft — no error, no
   4xx, just silent data loss. The backend's OWN test suite already
   expects the correct key (`familyhub/backend/tests/test_application_routes.py:130`,
   `"section_answers": {...}`), so this is a frontend-only bug, not a
   contract ambiguity. **Any Plan 3 task that wires draft-saving through
   this channel must fix `facade.ts:174-175` to send `section_answers`,
   built via §4c's converter, not `draft_data`.**

2. **`payload_ref` has no write path anywhere in production code —
   document-item completion is currently unreachable end-to-end via any
   channel.** `engine.py::complete_item` 409s
   `{"reason": "payload_ref_missing"}` for a `documents`-kind item unless
   `item.get("payload_ref")` is already set (`engine.py:483-484`). Nothing
   ever sets it: `machine.py::_run_item_builtin`'s item-op dispatch
   (`:387-393`) only forwards `item_id` to the underlying `engine.py`
   function — `payload_ref` is never in that call. Neither
   `internal.py::create_document_by_token` (`:383-403`) nor
   `documents.py::create_document` (staff surface, `:67-86`) writes
   anything onto the `workflow_item` row after presigning the DataCore
   blob upload — they only create a `document` row. The only place
   `payload_ref` is EVER written is test helper code
   (`apexflow/backend/tests/test_items.py:169-172` and
   `test_enrollment_template.py:95-98`, both writing directly into
   `fake_dc`, bypassing any real API). `familyhub/frontend/src/api/facade.ts:184-189`'s
   `completeItem(token, itemId, payloadRef)` already tries to send
   `payload_ref` as a `complete_item` param — it is silently dropped on
   arrival (machine.py never reads it) even if the frontend does its part
   correctly. **A Plan 3 task must add the missing write** — either a new
   `set_payload_ref`-shaped item action, or extending `complete_item`'s
   params to accept and persist `payload_ref` before running its
   `documents`-kind validation — before ANY document-upload flow through
   either channel can work end-to-end.

3. **`available_in` has zero runtime enforcement anywhere in
   apexflow-backend** (§4d). If Plan 3 needs a channel to hide/show a step
   by the instance's current machine state (plausible for both the
   family hub and staff-assisted entry), there is no engine-side
   precedent to call — only `PreviewPane.tsx`'s client-side pre-filter
   (`apexflow/frontend/src/editor/PreviewPane.tsx:101-104`) exists, and it
   is designer-preview-only, never wired to a real instance's state.

4. **admindash has zero apexflow integration today** (§7a, §8a) — no
   `apexflow_url` config field, no route, no nav item, no API client
   function. This is greenfield work for whichever Plan 3 task adds
   staff-assisted entry, not a retarget of something already scaffolded
   (contrast familyhub, which is already substantially wired — see note 6
   below).

5. **admindash's `entities.py`/`query.py` still have the sync-httpx-in-async
   blocking bug that was found and fixed in apexflow's ported copies**
   (§7f) — confirmed still open on this branch. Out of scope to fix as
   part of Plan 3 unless a task explicitly touches these files, but worth
   flagging since apexflow's OWN copies (which were ported FROM these
   files) already carry the fix and a future casual re-port from
   admindash would reintroduce the bug.

6. **familyhub's apexflow retarget (Task 10, prior plan) is essentially
   complete already** — `upstream.py`, `relay.py`, `ratelimit.py`, and
   every route in `api/{application,registration,documents}.py` already
   target apexflow's `/internal/workflows/...` and
   `/internal/instance-by-token/...` surfaces with the internal-key auth
   pattern. Plan 3's familyhub-side work is fixing the two bugs above
   (notes 1-2), not building the channel from scratch.

7. **`_status='active'` filtering in DataCore is a caller convention, not
   an engine guarantee** (§2c) — `QueryEngine.query` runs the caller's SQL
   verbatim with no implicit status filter. Any new query apexflow or a
   channel backend builds against `/api/query` must include
   `AND _status = 'active'` itself, the same way `list_entities` already
   does (`apexflow/backend/app/workflows/datacore.py:153`).

8. **No `WorkflowDraft` <-> `section_answers` converter exists anywhere**
   (§4c) — this is new code for Plan 3, in both directions (write:
   flatten `WorkflowDraft`'s dotted/bare keys into nested
   `section_answers`; read: hydrate a fetched `instance.draft_data` back
   into a flat `WorkflowDraft`). Neither `workflow-forms` nor either channel
   frontend has a partial implementation to build on.

9. **`workflows/definitions.py::parse_machine_steps`'s signature is at
   `:40`, not `:46-47`.** The plan brief's own citation for this symbol
   (echoed from the Plan 2 map) points at `:46-47`, which on fresh re-read
   are two lines INSIDE the function body (`machine_dict = json.loads(...)`
   / `steps_list = json.loads(...)`), not the `def` line — §1h above
   already cites the correct current range (`:40-50`). Flagged here
   explicitly per this task's own note-drifts-in-§10 requirement;
   `referenced_entity_models (:53)` and `fetch_models (:67)` are both still
   correct as cited, only this one symbol drifted.
