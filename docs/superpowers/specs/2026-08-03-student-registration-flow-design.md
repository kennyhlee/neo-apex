# Student Registration Flow — Design Spec

**Date:** 2026-08-03
**Status:** Draft for user review (direction approved: Flow Builder + Parent Hub, hybrid channels)
**Supersedes:** `2026-08-03-student-registration-flow-design-proposals.md` (proposal comparison; kept for rationale)

## 1. Overview

Tenants (afterschool programs/schools) design their own student registration flow per program — forms, document submission (including medical documents), payment plan selection, payment — and administrators track the status of every registration application. Parents can self-serve end-to-end, or submit partially and have admins assist to completion; both channels operate on the same application record, and parents can always see where their application stands and which actions remain.

### Decisions locked during review

| Decision | Choice |
|---|---|
| Flow model | Design 2: ordered typed step blocks per program ("Flow Builder"), plus a persistent parent status hub |
| Channels | Hybrid: parent self-serve (public route) and admin-assisted (inside AdminDash), interchangeable mid-application |
| Payments v1 | Stripe Checkout for pay-in-full or deposit-with-balance + admin "record offline payment"; installments/autopay in Phase 2 |
| Waitlist v1 | Programs get a capacity number; when full, submissions land `Waitlisted`; admins promote manually. Automated offers Phase 3 |
| Tenant isolation | All config, applications, documents, payments, and tracking are strictly per-tenant (see §3) |
| Parent identity v1 | Magic links (no parent accounts); parent accounts are Phase 3 |
| Service topology | Two placeholder modules activated: **enrollx** (staff: builder, lifecycle, tracking) and **familyhub** (parents: runtime, hub); shared `flow-runtime` frontend package; AdminDash scope unchanged |

## 2. Architecture

**Storage principle: DataCore is the only persistence layer.** Every registration record — configs, applications, items, activities, payments, document metadata — is a plain entity in the tenant's DataCore tables, written through DataCore's existing entity API and read through the generic query endpoint. Document *blobs* also become a DataCore capability (§8) so no other service owns durable state. admindash-backend holds workflow logic and integration glue (Stripe, email, magic-link auth) but persists nothing itself.

**API principle: generic endpoints first.** Reads use the existing generic query passthrough wherever possible (pipeline, matrix, detail, hub data are all SQL over entities); writes with no invariants use the existing generic entity endpoints (e.g. builder drafts). New bespoke endpoints exist only where a server must enforce invariants or handle non-entity concerns, and are consolidated into a single action endpoint plus a handful of integration routes (§2.1). Two payoffs: the endpoint count stays close to today's, and the AI chatbot (`chat.py`) can answer registration questions ("how many applications are pending documents for Fall 2026?") through the same generic query with zero registration-specific integration.

**Service principle: modular services, one concern each.** The feature activates two placeholder modules rather than growing AdminDash:

- **enrollx** (new module, React + FastAPI like admindash) — the enrollment system of action for staff: Flow Builder, application lifecycle (the action endpoint), admin tracking (pipeline, detail, matrix), Stripe integration, waitlist. Persists nothing; DataCore only. Ports 5900 (frontend) / 5910 (backend).
- **familyhub** (new module) — the family-facing channel: public registration runtime, magic-link parent hub ("where does my application stand, what's still needed"), later parent accounts and household management. Its backend is the narrow token-scoped facade; it never exposes generic query/entity endpoints, and application writes are proxied to enrollx's internal API over the private network (precedent: admindash → papermite proxying) so lifecycle invariants live in exactly one service. Ports 6000 / 6010.
- **admindash** — unchanged scope (day-to-day ops: students, families, leads, programs). Cross-links to enrollx; its AI chatbot can query registration entities anyway since all data is in DataCore.
- **datacore** — ID abbreviations + the document blob API (§8).
- **papermite** — image extensions; enrollx (not admindash) hosts the un-hardcoded extraction proxy for extract-to-prefill.
- **flow-runtime** (new shared frontend package, sibling of `ui-tokens`) — the FlowRenderer + block components, consumed by both enrollx (admin-assisted entry, builder live preview) and familyhub (parent runtime). One implementation, two hosts.

Physically separating the parent surface (familyhub) from the staff API (enrollx) also strengthens tenant isolation: the public-internet-facing service simply has no admin routes to leak.

**Deployment/infra additions:** `services.json` entries for the four new ports; two Fly apps (`enrollx-api`, `familyhub-api`) + two Cloudflare Workers (`enrollx.floatify.com`, `familyhub.floatify.com`, APIs at `api.enrollx.` / `api.familyhub.`); `enrollx-v*` / `familyhub-v*` release tags and deploy jobs; suite-manifest entries. All apps scale to zero like the existing ones. **Fallback** if two new modules prove too heavy for v1: host both surfaces in enrollx initially and split familyhub out at Phase 3 (parent accounts) — the facade/proxy boundary is designed in from day one either way.

```
Parent (magic link)                          Staff (JWT, role + tenant-checked)
      │                                                │
      ▼                                                ▼
familyhub-frontend (6000)                    enrollx-frontend (5900)
  registration runtime · parent hub            flow builder · pipeline · matrix · detail
      │  [flow-runtime pkg]                        │  [flow-runtime pkg]
      ▼                                            ▼
familyhub-backend (6010)                     enrollx-backend (5910)
  token-scoped public facade ──private──►      generic query/entity proxy → DataCore
  (no admin routes exist here)  network        action endpoint · Stripe · doc proxy
                                                   │           │
                                                   ▼           ▼
                                              DataCore (5800)  Papermite (extract-to-prefill)
                                                entities + query + document blobs (R2 behind it)
                                              Stripe Connect (per-tenant) · Resend (email)
```

### 2.1 API surface (complete list of new endpoints)

Staff-side reads and invariant-free writes add **zero** bespoke endpoints — enrollx-backend exposes the same generic `POST /api/query` and `POST /api/entities/{tenant}/{type}` proxy routes AdminDash already has (tenant-match enforced, §3). New endpoints, in full:

**enrollx-backend** (staff, JWT + role + tenant-match):

| Endpoint | Why it can't be generic |
|---|---|
| `POST /api/registration/{tenant}/applications` | Creates an application plus its `application_item` set derived from the published config — item derivation is an invariant a generic entity write would bypass. |
| `POST /api/registration/{tenant}/applications/{app_id}/actions` | Single typed-action endpoint: `save_draft, complete_item, submit, approve, decline, request_changes, verify_item, reject_item, waive_item, record_offline_payment, promote_waitlist, publish_config, resend_link`. Enforces transition guards, derives status, writes activity, runs approval side effects — invariants a raw entity write would bypass. familyhub reaches a parent-restricted subset (`save_draft, complete_item, submit`) via token-scoped internal routes guarded by a shared `X-Internal-Key` secret over the private network. |
| `POST /api/registration/{tenant}/applications/{app_id}/checkout` | Creates the Stripe Checkout Session on the tenant's connected account. |
| `POST /api/webhooks/stripe` | Stripe callback (unauthenticated by nature; verified by signature + connected-account→tenant mapping). |
| `POST /api/documents/{tenant}` / `GET /api/documents/{tenant}/{doc_id}/url` | Thin proxies to DataCore's blob API (§8) — presigned URLs are not entity data. |
| `POST /api/extract/{tenant}/{entity_type}` | Papermite proxy for extract-to-prefill (generic entity type, unlike AdminDash's student-only proxy). |

**familyhub-backend** (parents, magic-link token only — generic query/entity endpoints do not exist in this service):

| Endpoint | Purpose |
|---|---|
| `GET /api/registration/{tenant}/{program}` | Public config bundle (published flow + program info) |
| `POST …/start` | Start a draft application; issue magic link |
| `GET /api/application/{token}` | Hub bundle: application + items + statuses (server-side-scoped DataCore query) |
| `PUT /api/application/{token}` | Save draft / complete item (writes proxied to enrollx actions) |
| `POST /api/application/request-link` | Re-issue magic link by email match |

The Flow Builder needs no bespoke authoring API: configs are drafted via generic entity writes; only `publish_config` (validation + version pinning) is an action.

### Components

1. **Flow Builder** (enrollx-frontend) — authors `registration_config` per program.
2. **FlowRenderer** (`flow-runtime` shared package) — walks the config's step blocks; mounted by familyhub (parent runtime) and enrollx (staff-assisted entry, builder live preview).
3. **Parent Hub** (familyhub-frontend, via magic link) — application status + outstanding actions after first submission.
4. **Application service** (enrollx-backend) — application/item lifecycle, status derivation, transition validation, activity logging.
5. **Document blob API** (DataCore) — R2-backed blob storage behind DataCore; enrollx/familyhub backends proxy presign requests and enforce sensitive-doc gating.
6. **Payment service** (enrollx-backend) — Stripe Connect checkout sessions, webhook handling, offline payment recording.
7. **Notification service** (enrollx-backend) — Resend integration: magic links, submission receipts, action-needed notices.
8. **Tracking UI** (enrollx-frontend) — applications pipeline, application detail, requirements matrix.
9. **Public facade** (familyhub-backend) — token-scoped parent API; proxies lifecycle writes to enrollx over the private network.

## 3. Tenant isolation (cross-cutting requirement)

All configuration, flows, applications, documents, payments, and tracking are tenant-scoped and inaccessible across tenants.

- **Storage.** Every new entity is stored in the tenant's own LanceDB tables (`{tenant}_entities` / `{tenant}_models`) — physical separation, no shared tables. Flow configs reference only the owning tenant's model definitions and programs.
- **API enforcement.** A shared FastAPI dependency `require_tenant_match` asserts `user.tenant_id == path.tenant_id` on every authenticated enrollx route (403 on mismatch). **Prerequisite fix:** apply the same dependency to the existing AdminDash proxy routes (`entities.py`, `query.py`, `leads.py`), which today validate the JWT but not tenant match — the same generic proxies enrollx replicates.
- **Service separation.** familyhub — the only service parents touch — contains no generic query/entity routes and no staff routes at all; a compromise of the public surface exposes token-scoped application access, not tenant data access.
- **Query passthrough.** `/api/query` (raw SQL to DataCore) is restricted so a caller can only address their own tenant's tables. Matrix/pipeline queries are constructed server-side against `{tenant}_entities`, never from client-supplied table names.
- **Magic links.** Tokens are signed (HMAC, server secret), scoped to `(tenant_id, application_id)`, expiring, and revocable (token version stamped on the application). A token grants access to exactly one application. Entity IDs remain opaque/sequential per tenant; public endpoints never enumerate.
- **Documents.** Blobs live in R2 behind DataCore's blob API (§8); keys are prefixed `{tenant_id}/{application_id}/…`. Presigned URLs (upload and download) are issued only after tenant-match (admin) or token-scope (parent) checks. Documents flagged `sensitive: true` (medical) additionally require an admin role within the tenant to view; parents can view only documents they themselves uploaded.
- **Payments.** Each tenant connects **their own Stripe account via Stripe Connect** (Standard). Checkout sessions are created on the tenant's connected account; funds settle directly to the tenant. Webhook events carry the connected account ID, which maps to exactly one tenant before any state is touched. No cross-tenant money flow; platform never pools funds.
- **Email.** All links in email carry tenant-scoped tokens. Per-tenant sender branding is Phase 2; v1 sends from a platform address with the tenant's display name.
- **Roles.** enrollx-backend enforces `require_role` (mirroring LaunchPad's factory) from day one: builder and tracking routes require `admin` or `staff` of the matching tenant. AdminDash gets the same treatment as part of the prerequisite hardening.

## 4. Data model

New entity types added to `base_model.json` (seeded via LaunchPad's `use-default`/`sync-defaults` like existing types). New ID abbreviations in DataCore `DEFAULT_ABBREVS`: `registration_application: RA`, `enrollment: EN`, `document: DC`, `payment: PY`.

- **`registration_config`** — one active per program. `config_id, program_id, version, status (draft|published|archived), blocks (JSON)`. Publishing archives the prior version's row (DataCore row versioning retains history); applications pin `config_version` at start.
- **`registration_application`** — `application_id, program_id, school_year, status, family_id?, student_id?, config_version, channel_started (parent|admin), submitted_at?, decided_at?`. Family/student entities are created at approval time (reusing `bulkAddOrchestrators` match-or-create), not at draft time, to avoid polluting rosters with abandoned drafts. Draft form data lives on the application until then.
- **`application_item`** — one per requirement instance: `item_id, application_id, block_id, kind (form|document|esign|payment), title, status (not_started|in_progress|submitted|verified|rejected|waived), blocking (bool), due_at?, completed_by (parent|staff user_id), payload_ref (form data key | document_id | payment_id)`. Separate entities so pipeline/matrix views are plain queries.
- **`application_activity`** — `activity_id, application_id, type (status_change|item_change|note|email_sent), from, to, actor, at`. Mirrors `lead_activity`.
- **`document`** — `document_id, application_id, item_id, filename, content_type, size, storage_key, sensitive (bool), uploaded_by, uploaded_at`.
- **`payment`** — `payment_id, application_id, item_id, kind (deposit|balance|full|offline), amount, currency, status (pending|paid|failed|refunded), provider (stripe|offline), provider_ref?, recorded_by?, paid_at?`.
- **`enrollment`** — already seeded; first real consumer. Created on approval: `student_id, program_id, enrollment_date, status`.
- **`program`** — gains `capacity (number, optional)` field.

### Block schema (inside `registration_config.blocks`)

Ordered array; each block: `{block_id, type, title, required, blocking (bool), due_days_after_approval?, config}`.

| type | config | items produced |
|---|---|---|
| `form` | `entity_type?` (draw fields from student/family/contact model) or `custom_fields[]`; field-level `show_if` conditions (Phase 2) | one `form` item |
| `documents` | `docs[]: {name, description, sensitive, blocking, due_days_after_approval?}` | one `document` item per doc |
| `esign` (Phase 2) | `waiver_text, waiver_version` | one `esign` item |
| `payment_plan` | `plans[]: pay_in_full \| deposit {deposit_amount}` (installments Phase 2) | plan choice stored on application |
| `payment` | `collects: deposit \| full` (derived from chosen plan) | one `payment` item |
| `message` | `body (rich text)` | none |
| `review` | fixed, always last | — |

## 5. Status lifecycle

Application status is **derived** from item states plus explicit admin actions. Derivation happens at write time inside the action endpoint and is stored on the application entity — so the generic query endpoint (and the chatbot) reads status as plain data, and no consumer needs derivation logic. Transitions are validated server-side and every change is logged to `application_activity`.

```
Draft ──submit──► Submitted ──► In Review ──approve──► Approved ──all post-approval
  │   (all blocking items done;      │                    │        items verified──► Enrolled
  │    program full → Waitlisted)    │─decline─► Declined │
  │                                  │─request changes─► Pending Items ─► In Review
  └──────────── Withdrawn (parent or admin, any pre-enrolled state) ◄─────┘
Waitlisted ──admin promote──► In Review
```

- **Item statuses:** `not_started → in_progress → submitted → verified | rejected`; admins may `waive` any item. A rejected item flips the application to `Pending Items` and triggers an action-needed email.
- **Approval side effects:** create/match family + student entities (via the `familyPlan` orchestration), create `enrollment`, set student status, start due-date clocks on post-approval items.
- **Capacity:** at submission, if `count(active enrollments + approved apps) >= program.capacity`, status becomes `Waitlisted` instead of `Submitted`. Admin promotion moves it into review. Automated offer/expiry is Phase 3.

## 6. Runtime and channels

**Parent self-serve (familyhub).** `familyhub.floatify.com/register/{tenant_id}/{program_id}` starts a draft and issues a magic link (entered email → link sent; also shown once on screen). FlowRenderer walks blocks; every field change autosaves server-side (draft data on the application — server-side, unlike bulk-add's IndexedDB, because drafts must be visible to assisting admins). After submission the same link opens the **Parent Hub**: current status, per-item checklist with statuses, outstanding actions, payment state, and upload/complete affordances for anything still open.

**Admin-assisted (enrollx).** Staff open the same FlowRenderer inside enrollx against any application of their tenant (new or in-progress), enter data on behalf of the family, upload scanned/photographed paper forms, and record offline payments. Items track `completed_by`. Staff can trigger "send/resend parent link" at any time, enabling handoff in either direction mid-application.

**Extract-to-prefill (optional enhancer).** On any document upload, the runtime offers "prefill from this document": enrollx proxies to Papermite `POST /api/extract/{tenant}/{entity_type}` (generic entity type; image extensions added to Papermite). Extracted fields prefill the form block for confirmation — useful mainly on the admin-assisted path with paper forms. The packets in `sampledoc/` (2025-2026 Afterschool Admission Packet + two filled applications) are the reference fixtures for this path and for seeding a default flow template.

## 7. Payments

- Tenant onboarding: admin connects the tenant's Stripe account (Connect Standard OAuth) in an enrollx settings page; account ID stored on the tenant entity.
- Parent path: `payment` block creates a Stripe Checkout Session on the tenant's connected account for the chosen plan (full or deposit); webhook (`checkout.session.completed`, keyed by connected account → tenant) marks the payment item `paid` and writes a `payment` entity. Balance-due for deposits is tracked as a second, non-blocking payment item with a due date (collected via emailed pay link; autopay is Phase 2).
- Admin path: "record offline payment" (cash/check) writes a `payment` entity with `provider: offline` and marks the item paid; requires staff role and is logged with `recorded_by`.
- All money state is mirrored into `payment` entities — reporting never depends on Stripe queries.

## 8. Documents

- **Blob storage lives in DataCore**, keeping all persistence in one service: DataCore gains a small blob API (`POST /documents/{tenant}` → presigned R2 PUT + `document` entity write; `GET /documents/{tenant}/{doc_id}/url` → presigned GET), with R2 as its storage backend the same way LanceDB is. Other services never talk to R2 directly.
- enrollx-backend (staff) and familyhub-backend (parents) thin-proxy these two routes (DataCore is private-network only) and enforce authorization before proxying: admin tenant-match or parent token-scope on upload; `sensitive` documents additionally require tenant admin/staff role on download — parents see only their own uploads. Accepts pdf/docx/images (phone photos); size-limited.
- Document *metadata* is a normal entity, so document status queries (and the chatbot) go through the generic query endpoint like everything else.
- Retention: kept while the application/student is active; deletion follows entity archival. Configurable retention policy is a deferred follow-up (documented default; revisit for compliance).

## 9. Notifications (v1 minimum)

Resend integration in enrollx-backend (familyhub requests link emails via the private-network proxy); all sends logged as `application_activity(type: email_sent)`. V1 templates: magic link, submission receipt, status change (approved/declined/waitlisted), action needed (item rejected or documents due), payment receipt/balance reminder. Scheduled reminders for incomplete drafts and upcoming due dates are Phase 2.

## 10. Admin tracking UI

All tracking views read exclusively through the generic query endpoint (server-side-constructed SQL over `registration_application` / `application_item` / `application_activity` entities) — no bespoke read APIs. The same queries are available to the AI chatbot.

- **Applications page** (`/applications`): list + Kanban by status; filters: program, school year, status, "has outstanding items"; counts per column. Follows the leads page patterns.
- **Application detail**: item checklist with verify/reject/waive actions, activity timeline, document viewer, payment state, channel indicators (who completed what), "resend parent link", approve/decline/request-changes actions.
- **Requirements matrix** (Phase 2): families × requirements grid per program, driven by `application_item` queries — the "who still owes a medical form" view.

## 11. Error handling

- Transition guards return 409 with the allowed transitions; UI renders allowed actions only.
- Stripe webhook handlers are idempotent (event ID dedup) and reconcile on replay; a mismatch between Stripe and `payment` entities surfaces on the application detail.
- Uploads: client-side type/size validation plus server-enforced presign constraints; failed extract-to-prefill degrades to manual entry (extraction is never required).
- Expired/revoked magic links show a "request a new link" screen (email re-entry, matched server-side).
- Concurrent edits (parent and admin in the same application): last-write-wins per item with `application_activity` recording both; item-level granularity keeps the blast radius small.

## 12. Testing strategy

- Backend: pytest per service module — status derivation and transition guards (table-driven), tenant-match dependency (cross-tenant 403s, including the retrofitted legacy routes), magic-link scope/expiry/revocation, webhook idempotency and tenant mapping, capacity/waitlist edge (boundary at capacity), approval side-effect orchestration (family match-or-create).
- Frontend: builder produces valid config JSON (round-trip); FlowRenderer walks representative configs (all block types, blocking vs post-approval); hub renders each status/item combination.
- One end-to-end happy path per channel (parent self-serve incl. Stripe test mode; admin-assisted incl. offline payment) against a dev stack.

## 13. Phasing

- **Phase 1 (v1):** prerequisites (scaffold enrollx + familyhub modules and `flow-runtime` package, services.json + deploy pipeline entries, AdminDash tenant-match fix, `require_role`, DataCore blob API on R2, Resend, Stripe Connect onboarding); entities + status engine; builder with `form`/`documents`/`payment_plan`/`payment`/`message` blocks; FlowRenderer in both channels; magic links + hub; pipeline + detail views; basic capacity/waitlist; v1 notifications.
- **Phase 2:** question-level conditional logic, `esign` block, requirements matrix, scheduled reminders, installment plans + autopay + retry, per-tenant email branding, extract-to-prefill polish.
- **Phase 3:** parent accounts (activate `parent` role, user↔family link, household prefill/re-enrollment, multi-child), automated waitlist offer-accept-expire, discounts (sibling/early-bird), refund workflows tied to withdrawal.

## 14. Out of scope

Lottery-based admission (SchoolMint-style), attendance, subscription billing for ongoing programs, in-app messaging/chat with families, multi-language flows.

## 15. Risks / notes

- Builder UX is the largest unknown; live preview via the real renderer removes drift risk but the editor itself needs design iteration.
- Stripe Connect onboarding adds tenant-setup friction; offline recording keeps tenants unblocked meanwhile.
- Draft PII lives on the application entity pre-approval; DataCore version trimming (5 versions) bounds accumulation but frequent autosave may need batching (autosave debounce + dirty-field patch, not whole-form writes).
- Two new modules mean two more Fly apps + Workers + cert renewals + deploy jobs; scale-to-zero bounds cost, but ops surface grows. The consolidation fallback (both surfaces in enrollx, familyhub split at Phase 3) is in §2 if this proves heavy.
- The `flow-runtime` shared package is the first cross-frontend code package beyond ui-tokens; it needs a clean build/consumption story (npm workspace or file: dependency) so the two frontends don't drift.
