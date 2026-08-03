# Registration Flow — Phase 1 Roadmap (plan of plans)

**Spec:** `docs/superpowers/specs/2026-08-03-student-registration-flow-design.md`
**Status:** Plan 1 written (`2026-08-03-registration-plan1-foundations.md`); Plans 2–5 are authored just-in-time as each predecessor lands, against the real code it produced.

Phase 1 spans five subsystems. Each plan below produces working, testable software on its own and is executed by a fresh session (possibly a different model) with **no context beyond the spec, this roadmap, and its own plan file**.

## Plan sequence

| # | Plan | Delivers | Depends on |
|---|---|---|---|
| 1 | **Foundations** | AdminDash tenant-match/role hardening; enrollx + familyhub modules scaffolded (backends with auth/generic proxies, frontends with shells); `flow-runtime` package with shared types; new entity definitions in `base_model.json`; DataCore ID abbrevs; DataCore R2 blob API | — |
| 2 | **Application lifecycle engine** (enrollx-backend) | Status engine, single action endpoint, capacity/waitlist, activity logging, magic-link token module, Resend email | 1 |
| 3 | **Payments** (enrollx-backend + settings UI) | Stripe Connect onboarding, checkout session action, webhook, offline payment recording | 2 |
| 4 | **Builder + staff channel** (enrollx-frontend + flow-runtime) | Real FlowRenderer + block components, Flow Builder with live preview + publish, staff-assisted entry, tracking views (pipeline, detail) | 2 (3 for payment block) |
| 5 | **Family channel** (familyhub) | Token-scoped facade (5 routes), parent registration runtime, parent hub, request-link; end-to-end tests both channels | 2, 4 (3 for checkout) |

## Interface contracts (binding across all plans)

Plans must use these names/types exactly. They restate spec §4–§5; the spec wins on any conflict.

**Application status** (stored on `registration_application.base_data.status`, derived at write time in Plan 2's engine):
`draft | submitted | in_review | pending_items | approved | enrolled | waitlisted | declined | withdrawn`

**Item status** (`application_item.base_data.status`):
`not_started | in_progress | submitted | verified | rejected | waived`

**Action endpoint** (Plan 2): `POST /api/registration/{tenant_id}/applications/{application_id}/actions` with JSON body `{"action": <name>, ...params}`; action names:
`submit, approve, decline, request_changes, verify_item, reject_item, waive_item, record_offline_payment, promote_waitlist, publish_config, resend_link` (Plan 3 adds no new action; checkout is its own route).

**Magic-link token** (Plan 2 issues; Plan 5 validates via enrollx internal call): HMAC-SHA256 over `{tenant_id}.{application_id}.{token_version}` with server secret `ENROLLX_LINK_SECRET`; URL-safe base64; `token_version` stored on the application entity, incremented to revoke.

**flow-runtime types** (Plan 1 defines in `flow-runtime/src/types.ts`; Plans 4–5 consume):
```ts
export type BlockType = 'form' | 'documents' | 'payment_plan' | 'payment' | 'message' | 'review';
export interface FlowBlock {
  block_id: string;
  type: BlockType;
  title: string;
  required: boolean;
  blocking: boolean;
  due_days_after_approval?: number;
  config: Record<string, unknown>;
}
export interface RegistrationConfigDef {
  config_id: string;
  program_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  blocks: FlowBlock[];
}
export type FlowMode = 'parent' | 'staff' | 'preview';
```

**DataCore blob API** (Plan 1 builds; Plans 4–5 proxy):
- `POST /api/documents/{tenant_id}` body `{application_id, item_id?, filename, content_type, size, sensitive}` → `201 {document_id, upload_url}` (presigned R2 PUT; key `{tenant_id}/{application_id}/{document_id}/{filename}`) and writes a `document` entity.
- `GET /api/documents/{tenant_id}/{document_id}/url` → `200 {download_url}` (presigned GET).

**familyhub facade routes** (Plan 5): `GET /api/registration/{tenant_id}/{program_id}` · `POST /api/registration/{tenant_id}/{program_id}/start` · `GET /api/application/{token}` · `PUT /api/application/{token}` · `POST /api/application/request-link`.

**Ports** (Plan 1 registers in `services.json`): enrollx-frontend 5900, enrollx-backend 5910, familyhub-frontend 6000, familyhub-backend 6010.

## Standing rules for every plan

- Executors use `superpowers:subagent-driven-development` or `superpowers:executing-plans`; TDD; commit per task.
- Base branch: `docs/registration-flow-design` until merged, then `main`. One feature branch per plan: `feat/registration-plan<N>-<name>`.
- Backends: FastAPI + pydantic_settings, env prefix `<SERVICE>_`, DataCore is the only persistence, JWT validated via DataCore `/auth/me`. Frontends: React 19 + TS + Vite, native fetch, CSS variables, tokens from `@neoapex/ui-tokens`.
- Every authenticated enrollx route: `require_tenant_match` + role check (`admin`/`staff`). familyhub-backend must never gain generic query/entity routes.
- New user-facing strings in both `en-US` and `zh-CN` (follow admindash `i18n` pattern).
