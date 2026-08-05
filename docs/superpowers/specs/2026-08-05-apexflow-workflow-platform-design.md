# ApexFlow — Workflow Platform Design

**Date:** 2026-08-05
**Status:** Draft for user review
**Supersedes:** `2026-08-03-student-registration-flow-design.md` and `2026-08-04-registration-whole-school-revision-design.md`. Registration Phase 1 (Plans 1–5) is frozen and becomes raw material: its engine patterns, channel topology, and hardening lessons carry forward; its code is re-implemented as the platform's first template.

## 1. Overview

ApexFlow is the workflow platform of an educational OS: school administrators define their own operational workflows — enrollment, program signup, attendance, and anything else their operation needs — as data, not code. A workflow is built from the tenant's **entity models** (student, family, contact, …): as models grow through model setup, the designer sees the new fields automatically. Workflows move data through admin-defined states and, at defined points, **transition** collected data into real entities — workflows are how data enters and moves through the system.

The system ships **templates** (enrollment first) as starting points, never as restrictions. A later phase adds AI authoring: upload a policy/handbook/operations document and get a drafted workflow to review and edit.

### Decisions locked during review

| Decision | Choice |
|---|---|
| Module | Activate the `apexflow` placeholder: `apexflow-backend` (engine + designer API), `apexflow-frontend` (designer). **enrollx retires entirely**; AdminDash hosts tracking + staff entry; FamilyHub remains the family channel. |
| State machine | **Fully definable in v1**: states, transitions, guards, and effects are admin-authored per workflow. Guards/effects come from a curated primitive library (§4) — composition is free, primitives are vetted code. |
| Sections | Declared sections (registration revision "Option C"): form steps declare sections bound to entity models, with per-field include/require pickers covering **every** model field, optional ones included. |
| Registration fate | Re-implemented as the **enrollment template** on the generic engine. Whole-school scope (per `school_year`, no `program_id`) and the enriched default models come along. No dual-engine period. |
| Payments | Plan 3 code **deleted** (revert from history when a payments workflow returns). No `payment` block/primitive in v1. |

## 2. Architecture

Storage and API principles are inherited unchanged from the registration spec: DataCore is the only persistence; generic query/entity endpoints first; bespoke endpoints only where the server enforces invariants.

```
Family (magic link)                          Staff (JWT, role + tenant-checked)
      │                                                │
      ▼                                                ▼
familyhub-frontend (6000)                    admindash-frontend (5600)      apexflow-frontend (5900)
  workflow runtime · family hub                tracking · staff entry         workflow designer
      │  [flow-runtime pkg]                        │  [flow-runtime pkg]         │  [flow-runtime pkg]
      ▼                                            ▼                             ▼
familyhub-backend (6010)                     admindash-backend (5610)       apexflow-backend (5910)
  token-scoped facade ────private network──► thin proxies ────────────────►   engine: definitions,
  (no staff routes)                                                           instances, actions,
                                                                              internal token routes
                                                                                   │
                                                                                   ▼
                                                                              DataCore (5800)
```

- **apexflow-backend (5910)** — the only service with workflow invariants: definition publish/validation, instance creation, the action endpoint executing the state machine, magic-link issuance, internal token-scoped routes for familyhub, Resend email. Persists nothing; DataCore only.
- **apexflow-frontend (5900)** — the designer: steps/sections, state-machine editor, live preview, template gallery, versioning/publish. Staff-only (JWT, `admin`/`staff`).
- **admindash** — gains generic workflow tracking (pipeline/detail per workflow) and staff-assisted entry, all via thin proxies to apexflow-backend (the existing papermite-proxy pattern). Reads go through the generic query endpoint.
- **familyhub** — unchanged trust model: token-scoped facade, no staff/generic routes; proxies writes to apexflow-backend internal routes over the private network (retargeted from enrollx). Generalizes from "application" to "instance".
- **flow-runtime** — generalizes: renders a definition's steps/sections/state affordances in `family | staff | preview` modes for all three frontends.
- Ports: apexflow takes 5900/5910 (freed by enrollx). `services.json` renames the entries; deploy pipeline gains `apexflow-v*` in place of `enrollx-v*` (`apexflow.floatify.com` / `api.apexflow.floatify.com`).

Tenant isolation carries over verbatim from registration spec §3: `require_tenant_match` + `require_role` on every authenticated apexflow route, tenant-scoped SQL guards on query passthrough, HMAC magic links scoped to `(tenant_id, instance entity_id)` with `token_version` revocation, familyhub's no-admin-surface property, `uploaded_by` derived server-side for documents.

## 3. Data model

New entity types in `base_model.json`; DataCore `DEFAULT_ABBREVS`: `workflow_definition: WD`, `workflow_instance: WI`, `workflow_item: WT`, `workflow_activity: WA`. Registration workflow entities (`registration_config`, `application_item`, `application_activity`) are removed from the base model — their generic counterparts replace them; `registration_application` is **retained and enriched** as the enrollment template's application-facts model (§8); `document` stays (blob API is unchanged); `payment` is removed.

- **`workflow_definition`** — `definition_id, name, version, status (draft|published|archived), channel_access (staff_only|family), machine (JSON), steps (JSON)`. At most one published version per definition lineage; instances pin `definition_version`. Publishing validates the machine and steps (§4) and archives the prior version.
- **`workflow_instance`** — `instance_id, definition_id, definition_version, state, subject_refs (JSON: {student_id?, family_id?, …}), context (JSON: template-declared scalars, e.g. school_year), channel_started, applicant_email?, token_version, draft_data, opened_at, closed_at?`. `state` is derived at write time by the engine and stored, so the generic query endpoint and the chatbot read it as plain data.
- **`workflow_item`** — one per requirement instance: `item_id, instance_id, step_id, kind (form|documents|message-ack), title, status (not_started|in_progress|submitted|verified|rejected|waived), blocking, due_at?, completed_by, payload_ref`.
- **`workflow_activity`** — `activity_id, instance_id, type (state_change|item_change|note|email_sent), from, to, actor, at`.

**Identifier convention (unchanged):** wherever an API payload, token, or filter says `instance_id`, it means the DataCore **entity_id**, not the WI-prefixed display id. This rule bit Plan 4 four times; it goes in every plan's standing context.

### State machine schema (`workflow_definition.machine`)

```
states:      [{state_id, name, kind: initial | active | terminal}]   // exactly one initial; ≥1 terminal
transitions: [{transition_id, from, to, action, actor: family | staff | system,
               guards: [GuardRef], effects: [EffectRef]}]
```

`GuardRef`/`EffectRef` are `{primitive, params}` referencing the library in §4. Publish-time validation: every state reachable from initial, every non-terminal state has an outgoing transition, action names unique per `from` state, guard/effect refs resolve with valid params, every `commit_sections` effect references declared sections.

### Steps and declared sections (`workflow_definition.steps`)

Ordered `[{step_id, type: form | documents | message, title, required, blocking, available_in: [state_id], config}]`.

- `form` config: `sections: [{section_id, entity_model, fields: [{name, required}], mode: create | match_or_create, repeat?: {min, max}}]`. `repeat` renders the section as an add-another list (e.g. emergency contacts) producing one entity per instance at commit. The designer's field picker lists **all** base + custom fields of the referenced model (minus engine-owned/id fields) — the current builder's gap (optional fields invisible) is closed structurally: the picker is generated from the model definition, so a model change is a designer refresh away.
- `documents` config: `docs: [{name, description, sensitive, blocking, due_days_after_state?}]`.
- `message` config: `{body}` with an optional acknowledgment item.

Section answers autosave into `draft_data`. Data leaves the instance only via the `commit_sections` effect on a transition: each committed section writes to its entity model (`match_or_create` reuses the bulk-add orchestration), and resulting ids land in `subject_refs`. Sections commit in declaration order with **link-field injection**: when a later section's model declares a field named `{earlier_model}_id` (e.g. `family_id` on `student` and `contact`; `student_id`/`family_id` on `registration_application`), the engine stamps the resolved id — link fields are engine-written and never rendered in the form. Field mapping is by-name identity: a picked field *is* the model field, so there is no mapping table to maintain. **Engine-owned instance fields are never section-writable** (400 on attempt); flow-runtime exports the owned-field list as a constant.

## 4. Engine semantics

One bespoke write surface, mirroring registration's shape:

- `POST /api/workflows/{tenant_id}/definitions/{definition_id}/instances` body `{context, channel, applicant_email?}` → `201 {instance, items}`; derives items from the published definition (invariant — never via generic entity writes).
- `POST /api/workflows/{tenant_id}/instances/{instance_id}/actions` body `{action, ...params}` — looks up transitions from the current state, checks actor + guards, applies effects atomically-per-entity, derives and stores the new state, logs activity. 409 with allowed actions on guard/transition failure.
- Item-level actions (`save_draft, complete_item, verify_item, reject_item, waive_item`) are engine built-ins operating on items, available in any non-terminal state, with actor rules (family may only `save_draft`/`complete_item`).
- Internal token-scoped routes for familyhub keep Plan 2's shape (`/internal/instance-by-token/{token}` read/actions/documents, `/internal/workflows/{tenant_id}/{definition_id}/start`, request-link), with family-permitted actions = item built-ins + transitions whose `actor: family`.

**Guard primitives (v1):** `all_blocking_items_complete`, `items_in_status {step_ids?, status}`, `capacity_available {count_states, capacity_field, scope_context_key?}` (e.g. count instances in approved-like states per `school_year` against `tenant.capacity`), `context_equals`, `actor_role`.

**Effect primitives (v1):** `commit_sections {section_ids}`, `set_entity_field {ref, field, value}` (e.g. student status), `send_email {template}`, `issue_link`, `start_due_clocks {step_ids}`, `set_context {key, value}`.

The library is small and deliberately so: fully definable machines, vetted primitives. New primitives are code changes with tests, added when a real workflow needs them (attendance and signup templates will drive the next batch). No primitive executes tenant-supplied code.

## 5. Designer (apexflow-frontend)

Two editors over one definition: the **step editor** (compose steps; per-section model+field pickers driven live from the tenant's model definitions) and the **machine editor** (states, transitions, guard/effect composition from the primitive library, with publish-time validation surfaced inline). Live preview mounts the real flow-runtime renderer in `preview` mode. Template gallery instantiates a copy the admin owns and edits freely. Versioning/publish follows registration's builder: drafts via generic entity writes, `publish_definition` as the sole authoring action.

## 6. Channels

- **AdminDash tracking:** a Workflows area listing definitions; per definition a pipeline (columns = that definition's states — read from the pinned machine, not hardcoded) and instance detail (items, activity, documents, allowed actions rendered from the 409-advertised transition list). Staff-assisted entry mounts flow-runtime in `staff` mode. All reads via generic query; all writes via admindash-backend proxies to apexflow.
- **FamilyHub:** public start URL `familyhub.floatify.com/w/{tenant_id}/{definition_id}` for definitions with `channel_access: family`; magic-link hub shows current state, item checklist, and family-permitted actions. The enrollment template makes this concretely `/w/{tenant}/enrollment` — whole-school registration, no program in sight.

## 7. The enrollment template

Ships as seed data proving full definability — nothing about it is engine-special:

- **Machine:** states `draft, submitted, in_review, pending_items, approved, enrolled, waitlisted, declined, withdrawn`; transitions mirror the registration lifecycle, with `capacity_available` (tenant.capacity per `school_year`, counting approved/enrolled) guarding submit, and approve's effects `commit_sections(student, family, contacts) + set_entity_field(student.status) + start_due_clocks + send_email(approved)`. No enrollment entities are created — program/activity assignment is a separate workflow later.
- **Steps:** welcome message; form sections drawn from `student`, `family`, `contact`, and `registration_application` (§8) models; documents (immunization etc., `sensitive` where medical); review.
- **Context:** `school_year` (July-rollover default in flow-runtime).

## 8. Default model enrichment

The template composes from the tenant's models, so the defaults must reach industry-standard admission coverage. `base_model.json` gains (all optional unless a template requires them):

- **`student`** — preferred name, gender, grade, school attending, allergies, dietary restrictions, medications, physician name/phone, insurance carrier/policy, special needs/IEP notes, photo/media release.
- **`family`** — guardian 2 name/phone/email/relationship, employer(s), home address split fields.
- **`contact`** — relationship, phone, and flags `emergency_contact`, `authorized_pickup`, `pickup_excluded`.
- **`registration_application`** — retained as the enrollment template's application-facts model: `school_year, student_id, family_id` (link fields, engine-stamped at commit), `requested_start_date, schedule_days, pickup_method, handbook_acknowledged, liability_waiver_signed, tuition_agreement_signed, signature_name, signature_date` (plus tenant customization: agreements, initials, …). The committed entity is the durable admission record — the workflow instance remains the process record (state, items, activity).

**Papermite finalize merges, never replaces**: for an entity type that already exists in the tenant's models, extracted fields matching existing base fields by name are dropped and the remainder append to `custom_fields`. This rule (from the whole-school revision) is what keeps model setup and the designer coherent, and it applies to every entity type.

## 9. AI workflow authoring (later phase)

Upload a policy/handbook/operations document → Papermite extracts → a drafting step proposes a `workflow_definition` (sections mapped to models, candidate states/transitions from the primitive library, document requirements) → the admin reviews and edits in the designer before anything publishes. Drafts are ordinary draft definitions; the AI path has no special write powers. Detailed design deferred to its own spec once the designer exists.

## 10. Teardown and migration (dev only — nothing deployed)

- Delete the `enrollx/` module (frontend + backend + tests) and Plan 3 payments code wholesale; git history is the archive. Remove enrollx entries from `services.json` (apexflow takes the ports), start-services.sh, and CLAUDE.md.
- familyhub: retarget internal client enrollx→apexflow; rename env `FAMILYHUB_ENROLLX_INTERNAL_KEY` → `FAMILYHUB_APEXFLOW_INTERNAL_KEY` (secret `APEXFLOW_INTERNAL_KEY`, link secret `APEXFLOW_LINK_SECRET`); routes generalize per §6.
- Wipe dev-tenant registration rows (`registration_config`, `registration_application`, `application_item`, `application_activity`, `payment`, registration `document` rows); reseed models per §8 + §3; re-run the Papermite merge for acme-afterschool so its model-setup fields survive as custom fields.
- Carry forward unchanged: DataCore blob API, magic-link module, Resend integration, CloudflareIPMiddleware (now four copies — the follow-up to unify stands), the AdminDash tenant-match hardening from Plan 1.
- Open follow-ups from Plans 3–5 that survive the teardown (R2 seam verification, `TRUST_ALL_IPS` deploy checklist, referrer-policy/log scrubbing, pagination) transfer to the apexflow follow-ups doc; payments follow-ups close as moot.

## 11. Phasing

1. **Foundations** — entities + abbrevs, machine/steps schemas + publish validation, engine (instances, actions, guards/effects, items), magic links, internal routes, enrollment template as seed + table-driven machine tests. Headless; enrollx teardown lands here.
2. **Designer** — apexflow-frontend step + machine editors, live preview, template gallery, publish.
3. **Channels** — AdminDash tracking/entry + proxies; familyhub generalization; browser click-through of the enrollment template both channels (document upload deferred to manual verification while R2 creds are absent).
4. **AI authoring** — document → draft definition (own spec).
5. **More templates** — program signup, attendance; the primitives they demand; payments workflow re-introduction (revert Plan 3 from history into apexflow shape).

## 12. Testing

Registration's strategy generalizes: table-driven machine execution tests (the enrollment template's full lifecycle as the fixture), publish-validation rejection cases, guard/effect unit tests per primitive, section commit (match-or-create, engine-owned-field 400), token scope/revocation, cross-tenant 403s, capacity boundary per `(tenant, school_year)`, Papermite merge idempotency. Frontend: designer round-trips definition JSON; renderer walks representative definitions; pipeline renders arbitrary state sets. Standing rules (TDD, subagent-driven execution, interface-map-first plans, i18n `en-US` + `zh-CN`) carry over from the registration roadmap.

## 13. Out of scope (v1)

Payments (deleted; own template later), esign, conditional field logic, parent accounts, automated waitlist offers, cross-workflow orchestration (one workflow triggering another), scheduled/time-triggered transitions beyond due-date clocks, workflow analytics.

## 14. Risks

- **Generality vs. usability:** a machine editor is designer-hostile if raw. Mitigation: templates as the entry path; validation that explains itself; the enrollment template as the canonical example.
- **Primitive library pressure:** real workflows will demand primitives v1 lacks; the library grows by code change, which is the safety property — resist an inline-expression escape hatch.
- **Re-implementation scope:** freezing registration means no shippable enrollment until Phase 3 of this effort; acceptable while unreleased, but sequence Phases 1–3 tightly.
- **flow-runtime becomes load-bearing** across three frontends; its build/consumption story must be settled in Phase 1.
