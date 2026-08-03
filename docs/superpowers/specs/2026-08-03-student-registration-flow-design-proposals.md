# Student Registration Flow — Design Proposals (for review)

**Date:** 2026-08-03
**Status:** Superseded — direction chosen (Design 2 + Hub, hybrid channels); see `2026-08-03-student-registration-flow-design.md`
**Goal:** Let tenants design their own student registration flow (forms, document submission such as medical forms, payment plan selection, payment submission) and give administrators status tracking across all registration applications.

---

## 1. Current state (what exists in NeoApex today)

**What we can reuse:**

| Asset | Where | Relevance |
|---|---|---|
| Model-driven form renderer | `admindash/frontend/src/components/DynamicForm.tsx` | Renders any entity form from a model definition; a11y-complete |
| Multi-phase wizard + draft resume | `BulkAddStudentsPage.tsx`, `db/bulkAddDrafts.ts` | Only cross-session workflow persistence in the repo (IndexedDB) |
| Multi-entity create orchestration | `api/bulkAddOrchestrators.ts`, `utils/familyPlan.ts` | Family-before-student ordering + dedup already solved |
| Stage workflow + activity log | `admindash/backend/app/api/leads.py` | Stage transitions validated against model options; every change logged as a `lead_activity` entity |
| Public unauthenticated form | `PublicInquiryPage.tsx` + `POST /api/public/leads/{tenant}` | The precedent for a parent-facing submission surface |
| Generic AI document extraction | Papermite `POST /api/extract/{tenant}/{entity_type}` | Already generic over entity type; AdminDash proxy hardcodes `student` and it is admin-only |
| Seeded but unused entities | `launchpad/backend/app/data/base_model.json` | `enrollment` and `contact` schemas exist with zero read/write code; Papermite has a vestigial `RegistrationApplication` Pydantic class |

**What does not exist (must be built regardless of design):**

- Payments — zero payment/invoice/billing code repo-wide; no provider dependency.
- Document storage — Papermite writes scratch files only; no document records, retrieval, retention, or entity↔document links; no image support (phone photos of immunization cards).
- Parent access — `parent` role is assignable but inert; user records have no link to family/student; AdminDash backend enforces authentication but never role.
- Notifications/email — nothing anywhere.
- Form/flow configuration — model definitions describe entities, not forms; no ordering, sections, or conditional logic.
- Application lifecycle — no state machine, review queue, or approval flow (only the lead stage pattern to generalize).

## 2. Industry research summary

Surveyed: Regpack, Enrollsy, Jumbula, ACTIVE Camp & Class Manager, CampMinder, Jackrabbit, iClassPro, Sawyer, Amilia, SchoolMint/PowerSchool Enrollment.

Patterns that should shape this design:

1. **Typed step blocks** (Enrollsy): flows are an ordered skeleton (identity → program → payment → confirm) with insertable blocks — custom form, required documents, e-signature, message.
2. **Blocking vs post-enrollment requirements** (ACTIVE, CampMinder, Jumbula): payment and core forms block submission; physician-signed medical forms are collected *after* approval with reminders and due dates. Not making this split is the classic cause of abandoned registrations.
3. **Two-layer status** (CampMinder, PowerSchool, Jumbula): overall application status is *derived* from per-item statuses (each form/document/payment: not started / submitted / verified / rejected). Admins get both a pipeline view and a families × requirements completion matrix.
4. **Per-program enrollment mode**: instant enroll / hold for review / waitlist-when-full with offer-accept-expire (SchoolMint, iClassPro Autopilot).
5. **Question-level conditional logic** is a mid-market differentiator (Regpack has it; Amilia's lack of it is a cited complaint). Step-level branching is advanced and can wait.
6. **Payments table stakes**: card + ACH, deposit with balance due, installment plans, autopay with retry; rule-based sibling/early-bird discounts are expected in v1 by this market.
7. **Household-first**: one parent account → children → applications; prefill on re-enrollment; multi-child checkout.
8. **Compliance**: medical uploads need role-restricted access; e-signed waivers must retain the signed artifact with timestamp + document version, not a checkbox.

Common status lifecycle (superset across platforms):
`Draft → Submitted → In Review → Pending Items → Approved/Offered → Enrolled`, with side states `Waitlisted`, `Declined`, `Withdrawn`.

## 3. Shared foundations (identical in all three designs)

Whichever design is chosen, these are the same:

**New entity types** (added to `base_model.json`, stored in DataCore like everything else):
- `registration_config` — per-program registration configuration (shape differs per design below).
- `registration_application` — one per child per program per school year: `application_id, tenant, program_id, school_year, status, family_id?, student_id?, config_version, submitted_at`. Revives Papermite's vestigial `REGAPP` concept as a real entity.
- `application_item` — one per requirement per application: `item_id, application_id, kind (form|document|esign|payment), status (not_started|submitted|verified|rejected|waived), blocking (bool), due_at?, payload_ref`. Separate entities (not embedded JSON) so the admin matrix view is a plain DataCore SQL query.
- `application_activity` — status-transition history, mirroring `lead_activity`.
- `document` — metadata record linking an application/student to a stored file (`storage_key, filename, content_type, uploaded_by, sensitive (bool)`).
- `payment_plan` / `payment` — provider-agnostic records (see payments below).
- New ID abbrevs in `datacore/api/routes.py` `DEFAULT_ABBREVS` (e.g. `registration_application: RA`, `enrollment: EN`, `document: DC`).

**Status model** (two-layer, per research): application status derived from item statuses plus admin actions. Approval creates an `enrollment` entity (finally using the seeded schema) and updates student status. Transitions validated server-side and logged to `application_activity` — a direct generalization of the lead-stage code.

**Document storage** (net-new): Cloudflare R2 (we already run Cloudflare) with presigned upload URLs issued by admindash-backend; `document` entity holds metadata; medical docs flagged `sensitive` and access role-gated. Papermite extraction becomes an optional enhancer: un-hardcode the AdminDash proxy's entity type and add image support so an uploaded form can prefill application fields — an AI differentiator none of the incumbent afterschool products have.

**Payments** (net-new, v1 scope): Stripe Checkout sessions created by admindash-backend; webhook marks the corresponding `application_item` paid. Deposit vs pay-in-full vs installment plans configured per program (installments as Stripe subscription schedules or scheduled invoices). All money state mirrored into `payment` entities so reporting never depends on Stripe alone. Manual "record offline payment" for cash/check tenants.

**Parent access** (v1): magic-link resumable applications — public route starts an application, a tokenized resume link is emailed (requires adding a mail provider, e.g. Resend — small, needed for reminders anyway). Full parent *accounts* (activating the inert `parent` role with a user↔family link) are a fast-follow, not a v1 blocker. Prerequisite either way: add `require_role` enforcement to admindash-backend routes.

**Admin tracking UI** (AdminDash):
- **Applications page** — pipeline view (list + Kanban by status), filters by program/year/status.
- **Application detail** — item checklist with per-item verify/reject/waive, activity timeline, document viewer, payment state.
- **Requirements matrix** — families × requirements grid per program (the Jumbula "who still owes a health form" view).

## 4. The three designs

The designs differ on one axis: **how much flow-design power the tenant gets**, which drives config data model, builder UI, and runtime complexity.

### Design 1 — "Configured Checklist": fixed skeleton + per-program toggles

The flow order is fixed and universal: **Family & Student Info → Contacts → Documents → Payment → Review & Submit**. Admins don't design the sequence; they configure, per program:

- Which student/family/contact fields appear (a per-program subset of the existing model definitions).
- The required-documents list: name, description, blocking vs due-after-approval, due date.
- Fees: amount, deposit, allowed payment plans.
- Enrollment mode: instant / review / waitlist.

`registration_config` is a flat settings object. The parent runtime is one hardcoded wizard (modeled on the bulk-add phase machine) at a public route `/register/:tenant/:program`, with IndexedDB draft + emailed resume link.

- **Pros:** Fastest to ship by a wide margin — reuses `DynamicForm`, the wizard pattern, and the public-form precedent nearly as-is. Simple mental model for admins ("fill in the settings"), zero builder UI to design or maintain. The admin tracking side (the second half of the goal) is identical to the other designs, so it arrives soonest.
- **Cons:** Only loosely satisfies "design their own flow" — tenants configure content, not structure. No custom steps, ordering, or per-question logic. A tenant wanting a waiver step before payment, or two separate forms, can't have it.
- **Effort:** ~3–4 weeks of the shared foundations + ~2 weeks of surface. Smallest risk.

### Design 2 — "Flow Builder": ordered typed step blocks (recommended)

A registration flow is a tenant-authored **ordered list of typed step blocks**, stored as `registration_config` per program (with versioning — applications pin the `config_version` they started on, which DataCore's row versioning supports naturally):

| Block type | Config | Produces item(s) |
|---|---|---|
| `form` | Field set drawn from entity models + ad-hoc custom questions; question-level show/if conditions | one `form` item |
| `documents` | List of required uploads (each: blocking or due-after-approval, due date, sensitive flag) | one `document` item per doc |
| `esign` | Waiver text/version; captures signer, timestamp, doc version | one `esign` item |
| `payment_plan` | Offered plans (pay-in-full / deposit+balance / installments) | plan selection on the application |
| `payment` | What's collected now (deposit or full) | one `payment` item |
| `message` | Rich-text instructions | none |
| `review` | Always last; summary + submit | — |

**Builder UI** in AdminDash: a step-list editor (add / reorder / remove blocks), a config panel per block, and a live preview that renders the *actual* runtime renderer — no separate preview implementation to drift. Publish = new config version.

**Runtime:** a generic `FlowRenderer` walks the block list, rendering each via existing components (`DynamicForm` for form blocks, an upload component for documents, Stripe Checkout redirect for payment). Draft + resume as in Design 1.

**Phasing:**
1. *Phase 1:* builder with `form`, `documents`, `payment_plan`/`payment`, `message` blocks; fixed review step; magic-link parents; admin pipeline + detail views.
2. *Phase 2:* question-level conditional logic, `esign` block, requirements matrix, reminders.
3. *Phase 3:* parent accounts + household prefill/re-enrollment, autopay + dunning, waitlist offer-accept-expire automation.

- **Pros:** Literally satisfies "design their own registration flow." Matches the winning industry combination (Enrollsy's block model + Regpack's conditionality). Extensible — new block types (interview scheduling, assessments) slot in without rework. The block/item mapping makes two-layer status tracking fall out naturally.
- **Cons:** Biggest build; builder UX is real design work; config versioning discipline required (mitigated by pinning `config_version` per application). Phase 1 is roughly 2× Design 1.
- **Effort:** shared foundations + ~4–6 weeks for Phase 1.

### Design 3 — "Requirements Hub": order-free checklist (CampMinder model)

No wizard at all. An application is a **set of requirement items** defined per program — forms, documents, e-signs, payments — each with a blocking flag and optional due date. The parent lands on a **Registration Hub**: a checklist dashboard showing every item and its status, completable in any order. "Submit application" unlocks when all *blocking* items are done; non-blocking items keep collecting after approval with reminder emails.

Admin config is just the requirements list — no ordering, no branching, therefore much simpler than a flow builder. Admin tracking makes the **requirements matrix the primary view** (it's the native shape of the data), with the pipeline view secondary.

- **Pros:** Simplest config model that still feels custom per program. Mirrors afterschool reality — paperwork trickles in over weeks; the hub is *the* pattern for post-enrollment collection (CampMinder, ACTIVE). Excellent for returning families (prefilled hub, only deltas needed). Parents on phones can knock out one item at a time.
- **Cons:** Less guided for first-time registrants than a wizard — order-free means parents can wander (mitigatable with a "suggested next" pointer, but that's a wizard creeping back in). "Design your own flow" becomes "define your requirements" — no sequencing control. Payment-first programs (pay to reserve a seat) fit awkwardly.
- **Effort:** between Designs 1 and 2 — no builder, but the hub UI and item-centric runtime are new.

## 5. Comparison and recommendation

| | D1 Configured Checklist | D2 Flow Builder | D3 Requirements Hub |
|---|---|---|---|
| Satisfies "design own flow" | Partially (content only) | **Fully** | Partially (requirements only) |
| Admin tracking quality | Full (shared) | Full (shared) | Full; matrix-native |
| Parent UX | Guided wizard | Guided wizard, tenant-shaped | Self-serve checklist |
| Handles post-approval paperwork | Via doc flags | Via per-block blocking flag | **Best — native** |
| Time to first release | **Fastest** | Slowest | Middle |
| Extensibility ceiling | Low | **High** | Medium |
| Industry analog | Sawyer/Amilia | Enrollsy/Regpack | CampMinder/ACTIVE |

**Recommendation: Design 2, phased, with Design 3's blocking/due-after-approval split built into every block from day one.** The goal explicitly asks for tenants to design their own flow, and the research shows the block-builder + item-level tracking combination is where the market leaders converge. Design 1 is the fallback if speed-to-demo dominates — and because all three share the same foundations (entities, status model, payments, documents, admin views), starting with Design 1's fixed skeleton and upgrading to the Design 2 builder later loses little work: the runtime renderer, item tracking, and admin views carry over unchanged; only the config shape generalizes.

## 6. Open questions for review

1. **Who is the primary registrant in v1 — parents self-serve (public link) or admins entering on behalf of families?** Everything above assumes parent-facing; if admin-entered is acceptable for v1, parent access and email can defer.
2. **Payments provider:** is Stripe acceptable, and is online payment required in v1, or is "record offline payment" enough to start?
3. **Waitlist/capacity:** in scope for v1, or is review-approval enough initially?
4. **Where does the parent-facing runtime live** — a new public section of AdminDash (precedent: `PublicInquiryPage`) or a new lightweight service/Worker? Default assumption: AdminDash public routes.
5. **Document retention/compliance targets** (how long to keep medical docs, who may view them) — affects the `sensitive` role-gating design.
