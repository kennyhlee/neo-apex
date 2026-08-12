# Plan 5 bindings — actual names from Plans 1–4 code

Produced by Task 1 (hard gate). Every `# ADJUST(bindings)` line in the Plan 5
task text resolves against this file — the code wins wherever this file and
the plan text disagree. All citations are `file:line` against
`/Users/kennylee/Development/NeoApex` at commit `fdee9c4`
(`feat/registration-plan5-familyhub`, based on the Plans-1-4 integration
branch).

## 1. Discrepancies between the plan text and reality

1. **`resolve_token` name.** Plan prose elsewhere in the roadmap referred to
   this as a private resolver; it is the actual public name used by both
   `internal.py` and `checkout.py`. No conflict found — flagging only because
   the brief explicitly asked to confirm the rename landed. Confirmed:
   `enrollx/backend/app/api/internal.py:50` defines `def resolve_token(token: str) -> tuple[str, dict]`,
   and `enrollx/backend/app/api/checkout.py:10` imports it
   (`from app.api.internal import require_internal_key, resolve_token`). **Code wins, matches plan intent — no rework needed.**
2. **Staff `uploaded_by` format is NOT `"staff:{user_id}"`.** The brief's
   phrasing ("confirm precisely what string enrollx writes for a staff
   upload") could be read as implying a `staff:`-prefixed tag symmetric with
   `parent:{application_id}`. It is not — it is the bare DataCore user id
   string, with a literal fallback of `"staff"` if absent.
   `enrollx/backend/app/api/documents.py:72`: `"uploaded_by": user.get("user_id", "staff")`.
   DataCore's own module docstring confirms this is deliberate, not an
   oversight: `datacore/src/datacore/api/document_routes.py:55-58`
   ("Parent uploads pass `parent:{application entity_id}`; staff uploads pass
   the staff user_id"). **Code wins.** Plan 5 must derive the parent string
   as `f"parent:{eid}"` and must never invent a `staff:`-style prefix anywhere
   it mirrors this logic.
3. **`ApplicationSummary.application_id` is the business id, not `entity_id`
   — the one place in the wire contract where that's true for the
   application row itself.** `enrollx/frontend/src/pages/ApplicationEntryPage.tsx:171`:
   `application_id: app.application_id` (the flattened DataCore row's own
   `application_id` field, i.e. the RA-prefixed business id) — contrast with
   the same file's item mapping at line 161, `item_id: i.entity_id`, which
   deliberately uses `entity_id`. This field is display-only in every block
   that reads it (grep of `workflow-forms/src/blocks/*.tsx` for
   `application.application_id`/`application_id` found no consumer — the
   workflow-forms blocks never dispatch on it); it is not used to key any
   action call. **Not a plan-vs-reality conflict**, but a trap for Plan 5:
   whatever familyhub sends to `FlowRenderer`'s `application` prop for
   display should follow the same convention (business id for display), but
   familyhub's OWN action calls (`onCompleteItem`, `onCheckout`, action
   dispatch bodies) must use `entity_id` exactly like enrollx does at line
   161 — see the identifier-convention table below.
4. No other discrepancies were found between the plan's Global Constraints /
   task-1 brief assertions and the actual code. Every other name, arity, and
   route checked below matched what the plan and ledger already claimed.

## 2. Bindings table

| # ADJUST(bindings) name | Verified actual value | Citation |
|---|---|---|
| Internal router module path | `enrollx/backend/app/api/internal.py` | file exists, router defined line 31 |
| X-Internal-Key dependency name + import | `require_internal_key` from `app.api.internal` | `enrollx/backend/app/api/internal.py:22-28`; re-imported by `enrollx/backend/app/api/checkout.py:10` |
| Dev-mode default `ENROLLX_INTERNAL_KEY` | `"dev-internal-key-change-in-prod"` | `enrollx/backend/app/config.py:9,40` |
| `resolve_token` signature | `def resolve_token(token: str) -> tuple[str, dict]` — returns `(tenant_id, app_row)`; raises `HTTPException(401, "Invalid link")` on any TokenError or missing row | `enrollx/backend/app/api/internal.py:50-62` |
| `verify_link_token` signature | `def verify_link_token(token: str, token_version: int) -> tuple[str, str]` — **two required args**, verifies against the row's **stored** `token_version` (`int(app_row.get("token_version") or 1)`), never a bare `verify_link_token(token)` | `enrollx/backend/app/registration/tokens.py:89-94`; call site `enrollx/backend/app/api/internal.py:59` |
| Internal start route | `POST /internal/registration/{tenant_id}/{program_id}/start`, body `{school_year, applicant_email}`, 201 | `enrollx/backend/app/api/internal.py:34-37,75-81` |
| start response keys | `{application, items, token, link}` — `application`/`items` come from `engine.create_application`'s own `{application, items}` result, spread with `token`/`link` added | `enrollx/backend/app/api/internal.py:76-81` |
| Internal application-by-token GET | `GET /internal/application-by-token/{token}` → `{application: <flattened row dict>, items: [<flattened rows>], config: <flattened row or None>}` — **entities here are flattened DataCore rows, NOT `{entity_id, entity_type, base_data}` envelopes** (contrast with `dc_create`/`dc_update` return shape, which IS the envelope) | `enrollx/backend/app/api/internal.py:123-130`; `engine.get_application`→`dc.get_entity` returns a flattened row (`datacore.py:153-167`) |
| Internal actions route | `POST /internal/application-by-token/{token}/actions`, body `{"action": <str>, ...extra params merged in via `model_dump(exclude={"action"})`}`; 403 if action not in `PARENT_ACTIONS` before dispatch | `enrollx/backend/app/api/internal.py:39-42,133-141` |
| save_draft param | `draft_data` (dict) | `enrollx/backend/app/registration/actions.py:86-88` |
| complete_item params | `item_id` (required), `payload_ref` (optional str) — **no `payload` field** | `enrollx/backend/app/registration/actions.py:102,105-106` |
| submit params | none required (body `{}` is valid) | `enrollx/backend/app/registration/actions.py:117-141` |
| record_offline_payment params | `item_id` (required), `amount` (required int, cents — rejects bool and non-int), `kind` (optional str, default `"offline"`), `currency` (optional str, default `"USD"`) — **no `note` field** | `enrollx/backend/app/registration/actions.py:251-265` |
| PARENT_ACTIONS allowlist | `{"save_draft", "complete_item", "submit"}` exactly | `enrollx/backend/app/registration/actions.py:22` |
| Internal checkout route | `POST /internal/application-by-token/{token}/checkout`, body `{item_id?: str}`, response `{checkout_url, session_id, kind, amount, currency}` — **`checkout_url` is the key holding the Stripe Checkout URL** | `enrollx/backend/app/api/checkout.py:16,41-53`; response shape at `enrollx/backend/app/checkout_service.py:259-265` (`return {"checkout_url": session.url, "session_id": session.id, "kind": ctx.kind, "amount": ctx.amount, "currency": ctx.currency}`) |
| Request-link internal route | `POST /internal/registration/{tenant_id}/request-link`, body `{email: str, program_id?: str}`, **always `200 {}`** regardless of match (email send happens via `BackgroundTasks`, deferred until after the response is written) | `enrollx/backend/app/api/internal.py:45-47,94-120` |
| Helper to read entities without a user JWT | `app.registration.datacore.list_entities(tenant_id, entity_type, where="", token=None)` and `.get_entity(tenant_id, entity_type, entity_id, token=None)` — `token=None` is the parent/internal-channel calling convention throughout `engine.py`/`actions.py` | `enrollx/backend/app/registration/datacore.py:130-167`; module docstring line 1-9 explicitly documents unauthenticated-by-design DataCore calls |
| Loader for published registration_config | `engine.get_published_config(tenant_id, program_id, token=None)` — filters `registration_config` rows in Python for `program_id` + `status="published"` | `enrollx/backend/app/registration/engine.py:165-171` |
| Config bundle route (public, pre-start) | `GET /internal/registration/{tenant_id}/{program_id}/config` → `{config, program, capacity}`; 404 if either `program` or `config` missing | `enrollx/backend/app/api/internal.py:84-91` |
| Capacity/is-full helper | `engine.capacity_state(tenant_id, program_id, token=None) -> {"capacity": int|None, "approved": int, "enrolled": int, "full": bool}`; `engine.is_capacity_full(tenant_id, program_id, token=None) -> bool` (thin wrapper reading `["full"]`) | `enrollx/backend/app/registration/engine.py:211-249` |
| Existing internal-route test file | `enrollx/backend/tests/test_internal_api.py` — uses `tests/fakes.py`'s `FakeDataCore`, `install_fake_datacore(monkeypatch, fdc)`, `seed_program_and_config(fdc, capacity=...)` fixtures | `enrollx/backend/tests/test_internal_api.py:1-24` |
| DataCore blob POST auth | **No auth dependency at all** — route signature is `def create_document(tenant_id: str, body: CreateDocumentRequest)`, no `Depends(...)` anywhere | `datacore/src/datacore/api/document_routes.py:100-101` |
| DataCore blob POST accepted body fields | `application_id` (required str), `item_id` (optional str), `filename` (required), `content_type` (required, allow-listed), `size` (required int, ≤20MB advisory), `sensitive` (bool, default False), `uploaded_by` (**required** str) | `datacore/src/datacore/api/document_routes.py:45-59` |
| `uploaded_by` requirement confirmed | Field is declared **required** (no default) on `CreateDocumentRequest`; module comment states parent uploads pass `"parent:{application entity_id}"`, staff uploads pass the raw staff user_id, and `store.put_entity` does not validate against the model definition (nothing stops a caller from sending any string) | `datacore/src/datacore/api/document_routes.py:52-59` |
| DataCore blob POST 201 response keys | `{document_id, upload_url, storage_key}` | `datacore/src/datacore/api/document_routes.py:151-157` |
| DataCore blob GET url route | `GET /api/documents/{tenant_id}/{document_id}/url` — **no auth dependency**, response `{download_url: str}`, 404 if entity missing | `datacore/src/datacore/api/document_routes.py:161-169` |
| config.ts API-base constant | `FAMILYHUB_API_URL` (exported const), resolved from `VITE_FAMILYHUB_API_URL` env override or `services.json`'s `familyhub-backend` entry | `familyhub/frontend/src/config.ts:8-9` |
| translations file path + export shape | `familyhub/frontend/src/i18n/translations.ts` exports `type Locale = 'en-US' | 'zh-CN'` and `const translations: Record<Locale, Record<string, string>>` | `familyhub/frontend/src/i18n/translations.ts:1-20` |
| App.tsx route structure | Single `<Route path="/" element={<LandingPage />} />` inside a `BrowserRouter`; no auth context anywhere; docstring explicitly earmarks Plan 5 to add `/register/:tenantId/:programId` and `/application/:token` | `familyhub/frontend/src/App.tsx:1-23` |
| theme.css token names | Present and pre-wired: `--bg-card: var(--surface)` (line 254), `--text-primary: var(--ink)` (line 266); `--accent-ink` is NOT redefined locally — it is inherited from `@neoapex/ui-tokens` (`ui-tokens/tokens.css:30`, `--accent-ink: #2B6FB5`), per this file's own comment | `familyhub/frontend/src/styles/theme.css:37,44,58,254,266` |
| useTranslation localStorage key | `'preferredLanguage'` — matches `flowLocale()`'s read exactly | `familyhub/frontend/src/hooks/useTranslation.ts:4,7-8`; `workflow-forms/src/i18n.ts:83` |
| program entity name field | `name` (str) — **not** `program_name` | `launchpad/backend/app/data/base_model.json` → `program.base_fields` (verified via `python3 -c` extraction: fields are `program_id, name, description, start_date, end_date, capacity, status`) |

## 3. Routes

### enrollx `/internal/*` (guard: `require_internal_key`, `X-Internal-Key` header, constant-time compare against `settings.internal_key`; every route below sits behind it — the `internal.py`-mounted routes (start/config/request-link/application-by-token bundle/actions/documents) are confirmed by `test_all_internal_routes_require_key`, `enrollx/backend/tests/test_internal_api.py:32-45`; the separately-mounted checkout route's guard is confirmed by a different test, `test_internal_checkout_requires_internal_key`, `enrollx/backend/tests/test_checkout_routes.py:93`)

| Method + path | Body | Response | File:line |
|---|---|---|---|
| `POST /internal/registration/{tenant_id}/{program_id}/start` | `{school_year, applicant_email}` | 201 `{application, items, token, link}` | `internal.py:75-81` |
| `GET /internal/registration/{tenant_id}/{program_id}/config` | — | 200 `{config, program, capacity}`; 404 if not open | `internal.py:84-91` |
| `POST /internal/registration/{tenant_id}/request-link` | `{email, program_id?}` | always 200 `{}` (never discloses a match) | `internal.py:94-120` |
| `GET /internal/application-by-token/{token}` | — | 200 `{application, items, config}`; 401 on bad/revoked token | `internal.py:123-130` |
| `POST /internal/application-by-token/{token}/actions` | `{action, ...params}` | passthrough of `perform_action`'s result; 403 if `action` outside `PARENT_ACTIONS` | `internal.py:133-141` |
| `GET /internal/application-by-token/{token}/documents` | — | 200 `{documents: [{entity_id, document_id, filename, uploaded_by, item_id}]}` — filtered: own uploads (`uploaded_by == "parent:{eid}"`) always visible, others only if `not sensitive` | `internal.py:144-161` |
| `POST /internal/application-by-token/{token}/checkout` | `{item_id?}` | `{checkout_url, session_id, kind, amount, currency}` — Stripe Checkout URL is `checkout_url` | `checkout.py:41-53`, mounted with `prefix="/internal"` at `enrollx/backend/app/main.py:43`; response shape `checkout_service.py:259-265` |

### enrollx documents proxy (STAFF-ONLY — familyhub does NOT call these; it calls DataCore's blob API directly per the plan's architecture decision)

| Method + path | Guard | Body | Response |
|---|---|---|---|
| `POST /api/documents/{tenant_id}` | `require_staff_tenant` (JWT) | `{application_id, item_id?, filename, content_type, size, sensitive?}` — **no `uploaded_by` field on the model**, so a client-supplied one is silently dropped by pydantic's default `extra="ignore"` | 201, DataCore's response forwarded verbatim: `{document_id, upload_url, storage_key}` | `documents.py:36-43,59-83` |
| `GET /api/documents/{tenant_id}/{document_id}/url` | `require_staff_tenant` (JWT) | — | 200 `{download_url}` forwarded verbatim | `documents.py:86-96` |

Confirmed staff `uploaded_by` derivation: `user.get("user_id", "staff")` at `documents.py:72`; confirmed by test `test_create_document_ignores_client_supplied_uploaded_by` (`enrollx/backend/tests/test_documents_routes.py:84-104`) that a spoofed `uploaded_by` in the request body never reaches DataCore.

### DataCore blob API (familyhub-frontend/backend will call this directly for the parent path)

| Method + path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/documents/{tenant_id}` | **none** | `{application_id, item_id?, filename, content_type, size, sensitive?, uploaded_by}` (`uploaded_by` REQUIRED, unauthenticated) | 201 `{document_id, upload_url, storage_key}` |
| `GET /api/documents/{tenant_id}/{document_id}/url` | **none** | — | 200 `{download_url}`; 404 if entity missing |

`document.entity_id == document.document_id` confirmed: `_store.put_entity(..., entity_id=document_id, ...)` at `datacore/src/datacore/api/document_routes.py:131-137` — the business id IS the entity_id for this one entity type, exactly the stated exception.

## 4. workflow-forms barrel surface (verbatim, `workflow-forms/src/index.ts`)

**enrollx-frontend file that mounts `FlowRenderer` for staff-assisted entry:**
`enrollx/frontend/src/pages/ApplicationEntryPage.tsx` (`FlowRenderer` call at
lines 372-391) — one of only two `FlowRenderer` importers in
`enrollx/frontend/src` (the other, `ConfigBuilderPage.tsx`, is the builder's
preview mode, not the staff-assisted entry flow).

```ts
export * from './types';
export { FlowRenderer, type FlowRendererProps } from './FlowRenderer';
export { flowT, flowTWith, useFlowT, useFlowLocale, type Locale } from './i18n';
export { validateFlowField } from './validateField';
export {
  formFields, docsOf, plansOf, planAmounts, messageBody,
  resolvePlanKind, paymentAmountFor,
} from './blockConfig';
export { formatCents } from './money';
```

Confirmed signatures:
- `FlowRendererProps` (`workflow-forms/src/FlowRenderer.tsx:18-68`): `config`, `mode: FlowMode`, `locale?: Locale`, `application: ApplicationSummary | null`, `items: ApplicationItem[]`, `values: Record<string, unknown>`, `onSaveDraft: (values) => Promise<void>`, `onCompleteItem: (itemId: string) => Promise<void>` (**no `payload` param**), `onUploadDocument: (blockId: string, doc: RequiredDoc, file: File, itemId?: string) => Promise<void>` (carries `itemId`), `onCheckout: (itemId: string) => Promise<void>`, `onSubmit: () => Promise<void>`, `onRecordOfflinePayment?: (itemId: string) => void` (staff-mode only).
- `validateFlowField(field: FlowField, value: unknown, locale?: Locale): string | null` — `workflow-forms/src/validateField.ts:28-30`.
- `resolvePlanKind(config: RegistrationConfigDef, planChoice: string): PaymentPlanKind | null` — `workflow-forms/src/blockConfig.ts:60-62`.
- `paymentAmountFor(config, planChoice: string, item: ApplicationItem | null, paymentBlockId): number | null` — `workflow-forms/src/blockConfig.ts:96-99` (signature continues past the read window but matches the plan's claimed shape).
- `useFlowLocale()`/`useFlowT()` read from `FlowLocaleContext`, which `FlowRenderer` populates from its `locale` prop, falling back to `flowLocale()` (a `localStorage.getItem('preferredLanguage')` read) when no `FlowRenderer` ancestor supplies one — `workflow-forms/src/i18n.ts:81-87,126,143-145`.

Reference type shapes consumed (`workflow-forms/src/types.ts:1-70`): `FlowBlock`, `RegistrationConfigDef{config_id, program_id, version, status, blocks}`, `FlowMode = 'parent'|'staff'|'preview'`, `ApplicationStatus`/`ItemStatus`/`ItemKind` enums, `ApplicationSummary{application_id, program_id, school_year, status, channel_started, config_version, applicant_email?}`, `ApplicationItem{item_id, application_id, block_id, kind, title, status, blocking, due_at?, completed_by?, payload_ref?, due_days_after_approval?}`, `FlowField{name, type, required, options?, multiple?, default?}`.

## 5. The identifier convention (the "trap" — verified end to end)

DataCore's `entity_id` (assigned by DataCore itself on create) and the
business id an entity carries in its own `base_data` (`application_id` on
`registration_application`, `item_id` on `application_item`, `config_id` on
`registration_config`) are **independently generated and never equal**.

- `engine.create_application` (`engine.py:280-297`) mints the business id via
  `dc.next_id(...)` and stores it at `base_data.application_id` /
  `base_data.registration_application_id`; DataCore assigns a *separate*
  `entity_id` to the same row on create. Same pattern for items:
  `engine.create_application_item` (`engine.py:265-269`) mints
  `item_fields`/`item_id` (a uuid hex) into `base_data.item_id`, distinct from
  the row's `entity_id`.
- **The backend keys on `entity_id` everywhere it resolves an application or
  item for a write.** `actions.py:46-49` (`_require_item`):
  `dc.get_entity(tenant_id, "application_item", item_id, token)` where the
  passed-in `item_id` param must be the `entity_id` value — confirmed by
  enrollx-frontend's own binding comment at
  `enrollx/frontend/src/pages/ApplicationEntryPage.tsx:147-161`
  (`item_id: i.entity_id`, with an explicit comment explaining why the
  business `item_id` field would 404). `internal.py:133-141`
  (`action_by_token`) resolves the application via `resolve_token` →
  `app_row["entity_id"]`, then calls `perform_action(tenant_id,
  app_row["entity_id"], ...)` — the value it dispatches on is `entity_id`,
  even though the wire param name the action body carries for items is
  `item_id`.
- **`document_id` is the sole exception**: DataCore sets
  `entity_id = document_id` at create time
  (`datacore/src/datacore/api/document_routes.py:131-137`), confirmed above.
- Practical implication for Plan 5: familyhub's facade routes take the
  token in the URL and resolve `(tenant_id, app_row)` via enrollx's
  `/internal/application-by-token/{token}` bundle (or by re-deriving through
  the token itself server-side — task 2's concern). Any action call the
  facade proxies to `/internal/application-by-token/{token}/actions` must
  send `item_id: <application_item's entity_id>` (from the `items` array in
  the bundle, i.e. each item's `entity_id` field, not its `item_id` field) —
  exactly the same substitution enrollx-frontend performs at line 161.
  `application_id`-shaped display text (e.g. showing the application's
  reference number to a parent) should use the business
  `application.application_id` field per §1 discrepancy 3 above, since that's
  what enrollx-frontend itself displays to a human.

## 6. Security-critical invariants Plan 5 must uphold

1. **Parent channel action allowlist enforced twice.** familyhub's facade
   must reject any action outside `{save_draft, complete_item, submit}`
   itself (403) *before* proxying, per the plan's Global Constraints — but
   enrollx re-enforces the identical allowlist independently at
   `enrollx/backend/app/api/internal.py:136-138`, so a facade bug here is
   defense-in-depth, not the sole boundary. Verified allowlist:
   `enrollx/backend/app/registration/actions.py:22`, `PARENT_ACTIONS =
   {"save_draft", "complete_item", "submit"}`.
2. **`uploaded_by` must be facade-derived, never client-supplied**, exactly
   mirroring enrollx's own staff-proxy property
   (`enrollx/backend/tests/test_documents_routes.py:84-104`,
   `test_create_document_ignores_client_supplied_uploaded_by`). Because
   DataCore's blob POST has **no auth dependency at all**
   (`datacore/src/datacore/api/document_routes.py:100-101`), the facade is
   the *entire* enforcement point for the parent-download access-control rule
   (`uploaded_by == "parent:{application entity_id}"`) — there is no
   second layer catching a mistake here.
3. **Magic-link revocation is real only if `verify_link_token` is always
   called with the row's current stored `token_version`.**
   `tokens.verify_link_token(token, token_version)` requires both args
   (`tokens.py:89-94`); `resolve_token` calls it correctly with
   `int(app_row.get("token_version") or 1)` (`internal.py:59`). Plan 5's
   facade never calls this function directly (it delegates entirely to
   enrollx's `resolve_token` via the internal routes), so this invariant is
   enrollx's to hold, not familyhub's — but familyhub must never attempt to
   validate a token itself with a one-arg call, since it has no access to
   `link_secret` in the first place (correctly — it's an enrollx-only
   secret; familyhub holds only `internal_key`).
4. **`request-link` must return 200 with an identical body on match and
   non-match.** Confirmed enrollx's own internal route already does this
   (`internal.py:94-120`, deferred send via `BackgroundTasks`), and Plan 5's
   `POST /api/application/request-link` facade route must preserve that
   property end-to-end (return whatever enrollx returns, `{}`, unconditionally
   200).
5. **familyhub must gain no JWT/auth surface, no generic query/entity route.**
   Confirmed the current scaffold has none (`familyhub/backend/app/main.py`
   mounts only `health`; `familyhub/backend/app/config.py` has no
   `datacore` query/entity route, no `auth.py`) — this is a constraint to
   maintain going forward, not something already violated.

## 7. Gaps — things later Plan 5 tasks must create (do not exist yet)

- **`familyhub/backend/app/upstream.py` with a `call_upstream` seam does not
  exist.** The Global Constraints describe monkeypatching
  `app.upstream.call_upstream` for the `FakeHTTP` fixture pattern, but
  `familyhub/backend/app` currently contains only `__init__.py`, `config.py`,
  `main.py`, and `api/health.py` (confirmed via directory listing). **Task 2
  must create this module** before any backend task can write the prescribed
  test fixture.
- **`familyhub/backend/app/config.py` has no `enrollx_internal_key`,
  `familyhub_url`/public-url, or upstream-timeout settings yet** — only
  `environment`, `datacore_url`, `enrollx_url`, `cors_allowed_origins`,
  `port` (`familyhub/backend/app/config.py:12-16`). The plan's Global
  Constraints name `FAMILYHUB_ENROLLX_INTERNAL_KEY` as required-non-empty in
  production; this field does not exist in the scaffold. **Task 2 must add
  it** (and should mirror enrollx's `validate_production_secrets` pattern
  for the production-required check).
- **familyhub-frontend has no routes beyond `/`** — `App.tsx` is a single
  placeholder route, with the `/register/:tenantId/:programId` and
  `/application/:token` routes explicitly left for Plan 5 to add (its own
  docstring says so, `familyhub/frontend/src/App.tsx:8-9`). Whichever task
  builds `RegisterPage`/`HubPage`/`RequestLinkPage` must add these routes.
- **`translations.ts` has only two keys** (`nav.language`,
  `landing.explanation`) — every new user-facing string Plan 5's frontend
  tasks add must be inserted into both `en-US` and `zh-CN` blocks per the
  Global Constraints; there is no existing registration/hub vocabulary to
  reuse.
- **No familyhub backend test beyond `test_health.py`** exists yet
  (`familyhub/backend/tests/` contains only `__init__.py` and
  `test_health.py`) — every subsequent backend task is building its test
  file from scratch, not extending one.

## 8. Task 2 outcomes — all three routes already existed; nothing built

Task 2's brief (public config bundle, documents list, tenant-scoped
request-link) invoked the Step 1 conditional-skip check. On inspection, all
three routes were **already implemented** in
`enrollx/backend/app/api/internal.py`, guarded by the router-level
`Depends(require_internal_key)`, and already had passing test coverage in
`enrollx/backend/tests/test_internal_api.py`. Per Step 1 ("Build only what is
missing"), no new route, no new test file, and no code change was made. The
one change in this task is this bindings addendum.

| Route (as implemented) | Response | Guard | Covering test(s) |
|---|---|---|---|
| `GET /internal/registration/{tenant_id}/{program_id}/config` | 200 `{"config": <flattened row>, "program": <flattened row>, "capacity": {"capacity", "approved", "enrolled", "full"}}`; 404 if program or published config missing | router-level `require_internal_key` | `test_config_bundle_includes_capacity_state` (`test_internal_api.py:64-73`); guard: `test_all_internal_routes_require_key` (`:32-45`) |
| `GET /internal/application-by-token/{token}/documents` | 200 `{"documents": [{"entity_id", "document_id", "filename", "uploaded_by", "item_id"}]}`, filtered to `uploaded_by == "parent:{eid}"` OR `not sensitive` (own uploads always visible regardless of sensitivity) | router-level `require_internal_key`; token errors funnel through `resolve_token` → 401 | `test_documents_route_filters_sensitive_foreign_uploads`, `test_non_sensitive_staff_document_is_visible_to_parent` (`test_internal_api.py:151-196`); guard: `test_all_internal_routes_require_key` |
| `POST /internal/registration/{tenant_id}/request-link` | body `{"email": str, "program_id": str \| None}` → **always** 200 `{}` (not `{"sent": n}` — the brief's roadmap-contract default was superseded even before Task 1; the send is fire-and-forget via `BackgroundTasks`, so match/no-match is never observable in the body or the response timing) | router-level `require_internal_key` | `test_request_link_always_200_and_sends_only_on_match` (`test_internal_api.py:132-148`); guard: `test_all_internal_routes_require_key` |

Note for consumers (familyhub, later Plan 5 tasks): the config-bundle's
`"program"` key is the **full flattened program row** (includes `program_id`,
`name`, `capacity`, `status`, etc.), not the brief's imagined
`{program_id, name, capacity, is_full}` shape — read fullness from the
sibling top-level `"capacity"` key's `"full"` boolean, not from
`program.is_full` (that field does not exist). The request-link route's body
is always the empty object `{}`, never `{"sent": n}` — familyhub's facade
must not attempt to surface a count to the parent.

Full enrollx suite at the time of this check: `504 passed` (no change from
the recorded baseline — this task added zero lines of application or test
code).

## E2E smoke results (2026-08-04)

Task 12. Executed against the real dev stack (`./start-services.sh`) on
branch `feat/registration-plan5-familyhub` at `38cca88`. Dev tenant `acme`,
staff login `jane@acme.edu` / `admin123` (pre-seeded by
`datacore/src/datacore/auth/seed.py`, not created new). **No browser was
available in this environment** — every browser-only step was either
substituted with an equivalent API call (noted explicitly) or recorded as
NOT EXECUTED, never claimed as passed. `DATACORE_R2_*`, `STRIPE_*`, and
`RESEND_*` were **absent** from `~/.zshrc` — confirmed by grep before
starting, not assumed.

| Step | Result | Notes |
|---|---|---|
| 1 — boot and health | PASS (with note) | `datacore`, `enrollx-backend`, `familyhub-backend` all healthy. Runbook's `curl localhost:5800/api/health` 404s — datacore's real health route is `GET /health` (`datacore/src/datacore/api/__init__.py:84`), not `/api/health`. Runbook text defect, not an app bug. |
| 2 — variables / staff login | PASS | Runbook's example `admin@acme.test`/`changeme` don't exist; used the real seeded dev user `jane@acme.edu`/`admin123`, tenant `acme`. Login response key is `token`, not `access_token` (runbook's own fallback `d.get("token")` correctly handles this — no code defect). |
| 3 — staff creates program + publishes flow | SUBSTITUTED | No browser, so the Flow Builder UI was not clicked through. Instead: created `program` entity "Fall 2026 Smoke" (`AAC-PR260001`, entity_id `34d33c983fa0`, capacity 20, `start_date: 2027-09-01`) and a `registration_config` (`AAC-RC260001`, entity_id `614a6eaa3314`) with a `form` block (student name fields), a `documents` block (doc "Immunization record", `sensitive: true`), and a `review` block, via the staff JWT + generic `/api/entities/{tenant}/{type}` proxy — the same backend path `ConfigBuilderPage.tsx` calls. Published via `POST /api/registration/acme/applications/614a6eaa3314/actions {"action":"publish_config"}` → 200, `status: "published"`. **Confirms the publish-path-slot-is-entity_id contract from the bindings holds** (used entity_id `614a6eaa3314`, not business id `AAC-RC260001`; the wrong one would have 404'd per the Plan 4 postmortem this file cites). **Lost coverage: the Flow Builder UI itself was never exercised — its React state, drag-and-drop block ordering, and client-side validation are unverified.** |
| 4 — parent fetches bundle + starts | PASS | `GET /api/registration/acme/AAC-PR260001` → 200, `config.status: "published"`, `program.capacity: 20`, `capacity: {"capacity":20,"approved":0,"enrolled":0,"full":false}`. `POST .../start` → 201, `{application, items, token, link, hub_url}`. **Seam 3 confirmed here**: program `start_date` is `2027-09-01`; returned `application.school_year` is `"2027-2028"` — the *program's* year, not `2026-2027` (today's default) — proving `familyhub/backend/app/api/registration.py:_school_year_from_program` is wired, not the wall-clock fallback. |
| 5 — parent works the application | PASS with one BLOCKED sub-step and one runbook-script defect found | See breakdown below. |
| 6 — staff approves | PASS (on 2nd application; 1st application's approve call correctly failed per a runbook defect, see below) | `POST /api/registration/acme/applications/{entity_id}/actions {"action":"approve"}` → 200, application `status: "approved"`, family/student/enrollment created. |
| 7 — parent sees Approved (browser) | SUBSTITUTED (bundle-fetch only) + NOT EXECUTED (visual/mobile) | `GET /api/application/{token}` after approval shows `application.status: "approved"` and both items `status: "submitted"` — the data the Approved banner would render from is correct. **The actual page render, the "Still needed from you" section, and mobile device-toolbar layout were never viewed — no browser.** No payment block exists in this smoke config, so the Stripe sub-step is N/A here regardless of key availability. |
| 8 — lost-link flow | PASS (curl) / NOT EXECUTED (browser + email) | Known-email and unknown-email `POST /api/application/request-link` both returned `200 {"status":"ok"}`, byte-identical. The `/request-link` browser page and actual Resend delivery were not exercised — no browser, no Resend key. |
| 9 — full registration in browser | NOT EXECUTED | No browser available. This is the plan's acceptance gate for the FlowRenderer/frontend path and could not be run. See hand-off. |
| 10 — record + commit | this section | — |

### Step 5 breakdown

- `save_draft`, `complete_item` (form item), and the parent-action guard
  (`{"action":"approve"}` via the familyhub facade) — **PASS**. Guard
  returned `403 {"detail":"Action not permitted via the family channel.
  Allowed: complete_item, save_draft, submit"}` and enrollx's own log shows
  no `/internal/.../actions` call for `approve` was ever made — the facade
  rejected it before proxying, confirming **seam 4**.
- Document upload (`POST /api/application/{token}/documents` →
  presign → R2 PUT → `complete_item` with `payload_ref` → download URL) —
  **BLOCKED, not a code defect**: `DATACORE_R2_ENDPOINT` /
  `DATACORE_R2_ACCESS_KEY_ID` / `DATACORE_R2_SECRET_ACCESS_KEY` /
  `DATACORE_R2_BUCKET` are all read via bare `os.environ[...]` with no
  fallback (`datacore/src/datacore/documents.py:18-20,49`) and were absent
  from `~/.zshrc`. The presign call threw `KeyError:
  'DATACORE_R2_ENDPOINT'` inside DataCore (confirmed in
  `.logs/datacore.log`), surfaced to enrollx as a 500 and masked by
  familyhub's 5xx policy to `502 {"detail":"Registration is temporarily
  unavailable..."}`. **Seam 6 (document authorization / `uploaded_by`
  derivation) is therefore UNVERIFIED end-to-end** — the whole path that
  would exercise it never got a document_id. As a deviation from the
  script, `complete_item` was called on the document item with no
  `payload_ref` (no real document exists) purely to unblock `submit` for
  the rest of the chain; this proves nothing about R2 presigning or the
  parent-download authorization rule.
- **Runbook-script defect found**: the runbook's own Step 5 example,
  `{"action":"save_draft","draft_data":{"student_first_name":"Mei",
  "student_last_name":"Smoke"}}`, does not match what `_approve`
  (`enrollx/backend/app/registration/actions.py:323-325`) actually reads —
  it expects a **nested** `draft.student.first_name` /
  `draft.student.last_name` (and `draft.family.*` for family matching), not
  flat `student_first_name` keys. Following the runbook's literal script on
  application `AAC-RA260001` (entity `f9cdfd7f8db2`) and then calling
  `approve` produced `422 {"error":"Cannot approve: the application has no
  student name","missing":["student.first_name","student.last_name"]}` —
  reproducible, not a fluke. A **second** application
  (`AAC-RA260002`, entity `e94b16f74023`) was started and driven through
  with the corrected nested shape
  (`{"student":{"first_name":"Mei","last_name":"Smoke2"},"family":
  {"family_name":"Smoke Family","primary_email":"smoke-parent-2@example.com"}}`),
  and `approve` succeeded (200, family/student/enrollment created). This is
  a documentation defect in the task-12 runbook script, not an application
  bug — `_approve`'s nested-shape expectation is real production behavior,
  exercised correctly once the draft shape matched it. First application
  (`AAC-RA260001`) was left in `submitted` status, not approved.

### The six seams — what was observed

1. **Internal key match.** No 401 was ever returned from any `/internal/*`
   or familyhub-proxied call across the whole run — confirms
   `FAMILYHUB_ENROLLX_INTERNAL_KEY` and `ENROLLX_INTERNAL_KEY` both resolved
   to the same dev default (`config.py` in both services default to
   `dev-internal-key-change-in-prod`; neither env var was overridden).
2. **Magic-link round-trip + revocation.** Minted via `start`, verified
   repeatedly via the hub bundle route (200). Tampering the token's last
   character → `401 {"detail":"Invalid link"}`. Then staff-called
   `resend_link` (bumps stored `token_version`) — the **old** token, which
   worked seconds before, immediately 401'd, and the **new** token from the
   response worked. Real revocation against the stored `token_version`,
   confirmed live, not just by reading the code.
3. **`school_year` from program `start_date`.** Program's `start_date`
   `2027-09-01` (school year 2027-2028) vs. today's wall-clock default
   (2026-2027, since today is 2026-08-04) — the created application's
   `school_year` was `"2027-2028"`, the program's year. Silent-failure mode
   would have been `"2026-2027"`; that did not happen.
4. **Parent action allowlist.** `PUT /api/application/{token}
   {"action":"approve"}` → `403`, allowed-list message names only
   `complete_item, save_draft, submit`. enrollx's access log for this run
   shows no `/internal/application-by-token/.../actions` hit for the
   approve attempt at all — confirms the facade rejected it before
   proxying, not merely that enrollx also rejected it.
5. **Request-link always-200.** Known email (`smoke-parent-2@example.com`)
   and unknown email (`never-registered@example.com`) both returned
   `200 {"status":"ok"}` — `diff` of the two response bodies was empty.
6. **Document authorization.** **UNVERIFIED** — blocked entirely by missing
   `DATACORE_R2_*` credentials before any document row was ever created.
   Neither the `uploaded_by == "parent:{entity_id}"` derivation nor the
   cross-application document-id refusal could be exercised this run.

### Integration break found

None in application code. The one real break was environmental: this dev
shell has no `DATACORE_R2_*` credentials configured, so the entire
document-upload/download path (and therefore seam 6) is unreachable in this
environment. This is a **BLOCKED** finding, not a FAIL — no application code
was touched to work around it, and none should be; the fix is operational
(add real or MinIO-backed R2 test credentials to the dev environment).

### Hand-off checklist — still requires a human

- [ ] **Step 3 (Flow Builder UI)**: click through the actual builder at
  `http://localhost:5900` — form/documents/review block authoring, drag
  ordering, client-side validation. Only the resulting API contract was
  exercised here.
- [ ] **Step 7 (Approved banner + mobile layout)**: open
  `http://localhost:6000/application/{token}` for entity `e94b16f74023`
  (business id `AAC-RA260002`) in a real browser and device-toolbar mobile
  view; the backend state is confirmed correct, the render is not.
- [ ] **Step 8 (request-link page + real email)**: submit
  `http://localhost:6000/request-link?tenant=acme` in a browser; configure
  a real Resend test key to confirm delivery and that the emailed link
  opens the hub.
- [ ] **Step 9 (full FlowRenderer happy path)**: the plan's actual
  acceptance gate — register a new parent end-to-end in a private browser
  window through `http://localhost:6000/register/acme/AAC-PR260001`,
  including a real document photo/PDF upload, and confirm the approved
  state renders after a staff approval + refresh. Not executed at all.
- [ ] **Document authorization (seam 6)**: once `DATACORE_R2_*` test
  credentials are available, re-run the document slot → R2 PUT → complete →
  download-URL chain, and specifically attempt to fetch another
  application's `document_id` to confirm it's refused.
- [ ] **Payment step**: no `payment`/`payment_plan` block was included in
  the smoke config and Stripe test keys are absent — the checkout/Pay-now
  path is completely untested this run, browser or otherwise.
- [ ] Consider fixing the runbook script's Step 5 `draft_data` example (flat
  `student_first_name`/`student_last_name`) to the nested
  `{"student": {...}, "family": {...}}` shape `_approve` actually reads, so
  the next person running this doesn't hit the same reproducible 422.

Full enrollx and familyhub suites were **not** re-run as part of this task
(out of scope for a runbook task; Task 1's `504 passed` baseline for
enrollx stands unchanged since no application code was modified).
