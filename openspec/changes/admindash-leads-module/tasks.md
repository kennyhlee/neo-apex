## 1. DataCore — human-friendly lead id

- [ ] 1.1 Add `"lead": "LD"` to `DEFAULT_ABBREVS` in `datacore/src/datacore/api/routes.py`
- [ ] 1.2 Add a datacore test asserting `POST /api/entities/{tenant}/lead` auto-assigns a sequential `base_data.lead_id` (e.g. `ABR-LD26...`), mirroring the existing student next-id test

## 2. AdminDash backend — leads router (authenticated)

- [ ] 2.1 Create `admindash/backend/app/api/leads.py` with a `_lead_proxy` helper reusing the httpx→DataCore pattern from `entities.py` (base URL `settings.datacore_url`, forward `user["_token"]`)
- [ ] 2.2 Define Pydantic schemas: `LeadCreate` (guardian_name required, email/phone at least one), `LeadStageUpdate` (stage in the fixed enum), `ActivityCreate` (type in `call|email|note`, body), and the stage constant list `New, Contacted, Tour Scheduled, Toured, Enrolled, Lost`
- [ ] 2.3 `POST /api/leads/{tenant_id}` — create a lead with `source=manual`, `stage=New`; validate contact requirement; proxy to DataCore entities create; return created lead
- [ ] 2.4 `GET /api/leads/{tenant_id}` — list leads for tenant with optional `?stage=` filter, via DataCore `/api/query` SQL on `entity_type='lead'`
- [ ] 2.5 `GET /api/leads/{tenant_id}/{lead_id}` — fetch a single lead
- [ ] 2.6 `PATCH /api/leads/{tenant_id}/{lead_id}/stage` — validate new stage; if unchanged, no-op (no activity); else update lead stage + `updated_at` and create a `lead_activity` of type `stage_change` with metadata `{from,to}`, `created_by=system`
- [ ] 2.7 `POST /api/leads/{tenant_id}/{lead_id}/activities` — create a `lead_activity` (type in enum, body), `created_by`=current user
- [ ] 2.8 `GET /api/leads/{tenant_id}/{lead_id}/activities` — return the lead's activities ordered `created_at` desc via `/api/query`
- [ ] 2.9 `POST /api/leads/{tenant_id}/{lead_id}/convert` — guard against existing `converted_family_id` (409 with existing family id); create `family` then `student` (family_id link, status=Enrolled) from a supplied/reviewed payload; update lead `converted_family_id` + stage=Enrolled + stage_change activity; return created ids
- [ ] 2.10 All routes in 2.3–2.9 depend on `require_authenticated_user`
- [ ] 2.11 Register the leads router in `admindash/backend/app/main.py`

## 3. AdminDash backend — public intake (unauthenticated)

- [ ] 3.1 `POST /api/public/leads/{tenant_id}` with NO auth dependency: accept only prospect fields (guardian_name, email, phone, student_first_name, student_last_name, grade_of_interest, message); reject/ignore internal fields
- [ ] 3.2 Validate the tenant exists (probe DataCore) before writing; on unknown tenant return 404 without creating a lead
- [ ] 3.3 Force `source=web_form`, `stage=New`; proxy create to DataCore; return a minimal ack (no other tenant data)
- [ ] 3.4 Register the public route in `main.py` (ensure it is reachable without a JWT and, in tests, past the Cloudflare-IP middleware)

## 4. AdminDash backend — tests

- [ ] 4.1 `test_leads.py`: create/list(+stage filter)/get happy paths with respx stubbing DataCore
- [ ] 4.2 Stage transition test: asserts lead updated AND a `stage_change` activity created; same-stage no-op creates no activity
- [ ] 4.3 Activity create/list tests (type validation rejects unknown type; list ordered desc)
- [ ] 4.4 Convert tests: pre-fills family+student, links lead, marks Enrolled; double-convert returns 409
- [ ] 4.5 Public intake tests: creates web_form lead; unknown tenant 404; internal fields (stage/converted_family_id) ignored; no JWT required
- [ ] 4.6 Run `uv run pytest backend/tests/ -v` — all pass

## 5. AdminDash frontend — API client + types

- [ ] 5.1 Add `Lead`, `LeadActivity`, and stage type/const to `frontend/src/types/models.ts` (fixed schema)
- [ ] 5.2 Add client functions in `frontend/src/api/client.ts`: `listLeads(tenant, stage?)`, `getLead`, `createLead`, `updateLeadStage`, `listActivities`, `addActivity`, `convertLead`, and `submitPublicLead(tenant, fields)` (no auth header)
- [ ] 5.3 Add a client-side `parseInquiryEmail(text)` util in `frontend/src/utils/` (regex for name/email/phone/student name) with a couple of inline example cases

## 6. AdminDash frontend — leads pages

- [ ] 6.1 Replace placeholder `frontend/src/pages/LeadPage.tsx` with a pipeline view: leads grouped by stage in defined order, plus a stage filter; reuse `StatusBadge`/`DataTable` styling and `ui-tokens`
- [ ] 6.2 Lead detail (drawer or route): show fields, stage control (dropdown that calls `updateLeadStage`), activity timeline (desc), and an "Add activity" form (call/email/note)
- [ ] 6.3 Manual-entry modal: guardian name + contact required; on submit `createLead` (source=manual)
- [ ] 6.4 Email-import modal: paste text → `parseInquiryEmail` → editable review fields → confirm → `createLead` (source=email_import)
- [ ] 6.5 Convert-to-Family modal: pre-fill family+student fields from lead (mapping per design D7); collect required `primary_address`; on confirm `convertLead`; show "already converted" state linking the family when guarded
- [ ] 6.6 Add leads i18n keys to `frontend/src/i18n/translations.ts` (en-US, zh-CN) for the new UI strings

## 7. AdminDash frontend — public web form

- [ ] 7.1 Create `frontend/src/pages/PublicInquiryPage.tsx` — standalone form (guardian name, email, phone, student name, grade of interest, message) calling `submitPublicLead`; success + error states
- [ ] 7.2 Wire a public route `/inquire/:tenantId` in `App.tsx` OUTSIDE the auth guard (no redirect-to-login)

## 8. Verify

- [ ] 8.1 `cd admindash/frontend && npm run build && npm run lint` — pass
- [ ] 8.2 `cd datacore && uv run python -m pytest tests/ -v` and `cd admindash && uv run pytest backend/tests/ -v` — pass
- [ ] 8.3 Manual smoke: create lead (manual + email import), advance through stages (timeline logs), add activities, submit public form, convert to family (verify Family+Student created and lead Enrolled)
