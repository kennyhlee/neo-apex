## 1. LaunchPad — seed lead into the default model

- [ ] 1.1 Add a `lead` entity to `launchpad/backend/app/data/base_model.json` with default `base_fields` (lead_id str; guardian_name str required; email email; phone phone; student_first_name str; student_last_name str; grade_of_interest str; message str; source selection [web_form,manual,email_import]; stage selection [New,Contacted,Tour Scheduled,Toured,Enrolled,Lost]; converted_family_id str) and `custom_fields: []`
- [ ] 1.2 If a test asserts base_model contents / use-default payload, extend it to cover the `lead` entity and the `stage` options order; otherwise add a small test loading base_model.json and asserting the lead `stage` selection options

## 2. Papermite — register the Lead domain model

- [ ] 2.1 Add a `Lead` Pydantic model to `papermite/backend/app/models/domain.py` mirroring the default lead base fields, and register it in `ENTITY_CLASSES`
- [ ] 2.2 Add/extend a test asserting `lead` is a known entity class and that its model definition build includes the `stage`/`source` selection fields

## 3. AdminDash backend — model-driven stage validation + dynamic field preservation

- [ ] 3.1 Add a helper `_lead_model(tenant, token)` in `leads.py` that queries the DataCore `models` table for `entity_type='lead'` and returns the model dict, or `None` (generalize the query helper to accept a table, or add `_dc_query_models`)
- [ ] 3.2 Add `_stage_options(tenant, token) -> list[str]` returning the lead model's `stage` selection options, falling back to `DEFAULT_STAGES` (rename the current `STAGES` constant to `DEFAULT_STAGES`) when no model/stage field exists
- [ ] 3.3 Replace hard-coded stage checks in `update_stage`, `list_leads` filter, and `convert` with validation against `_stage_options(...)`
- [ ] 3.4 Make `_lead_base_data` reconstruct base_data from ALL non-system columns of the fetched row (drop the fixed `_LEAD_FIELDS` allowlist) so customer/custom fields survive read-modify-write; keep excluding `entity_id` and `_`-prefixed metadata
- [ ] 3.5 `convert`: add optional `target_stage` to `ConvertRequest`; validate it against `_stage_options` (default to the LAST option when omitted); move the lead to it and log the `stage_change`; remove the forced `Enrolled`; keep the double-conversion 409 guard
- [ ] 3.6 Update `create_lead`/manual create to no longer enforce the bespoke email-or-phone rule (accept the model's fields); keep forcing `stage` to the first stage option on create (default New) and `source=manual`
- [ ] 3.7 Update `test_leads.py`: stage tests stub a lead model (and a no-model fallback case); convert tests assert `target_stage`/default-last behavior and that custom fields survive; remove/replace the email-or-phone 422 assertion
- [ ] 3.8 Run `cd admindash && uv run pytest backend/tests/ -v` — all pass

## 4. AdminDash backend — public lead model endpoint

- [ ] 4.1 Add `GET /api/public/leads/{tenant_id}/model` (NO auth) returning the lead model's prospect fields (base fields minus `stage`,`source`,`converted_family_id`,`lead_id`), reusing the `tenant_id` charset guard; return the default prospect fields when no model exists
- [ ] 4.2 Test: public model endpoint returns prospect fields, excludes internal fields, needs no JWT, 404s a malformed tenant

## 5. AdminDash frontend — model plumbing + types

- [ ] 5.1 Relax `src/types/models.ts`: keep `LEAD_STAGES` as `DEFAULT_LEAD_STAGES` fallback; make `Lead` a loose record (known meta fields + `[key: string]: unknown`); keep `LeadActivity` as-is
- [ ] 5.2 Client: add `fetchPublicLeadModel(tenant)` (no auth) hitting the new public model endpoint; ensure `ModelContext.getModel(tenant,'lead')` is usable for the authenticated UI (it already is)
- [ ] 5.3 Add a small `leadStages(model): string[]` util deriving the `stage` field options from a model (fallback `DEFAULT_LEAD_STAGES`) and a `prospectFields(model)` util

## 6. AdminDash frontend — model-driven management UI

- [ ] 6.1 `LeadPage.tsx`: load `getModel(tenant,'lead')`; build board columns from `leadStages(model)`; render leads whose stage is unknown in a trailing "Other" column; keep card graceful (show guardian_name/student/contact if present)
- [ ] 6.2 `AddLeadModal.tsx`: render via `DynamicForm(leadModel)` (base+custom), emitting base_data/custom_fields to `createLead`; drop hard-coded field list and the email-or-phone rule
- [ ] 6.3 `LeadDetailDrawer.tsx`: build the stage `<select>` from `leadStages(model)` (keep the confirm-before-change dialog); render the lead's fields dynamically from the model (read-only view + edit via DynamicForm)
- [ ] 6.4 `ConvertToFamilyModal.tsx`: add a target-stage `<select>` from `leadStages(model)` defaulting to the last stage; pass `target_stage` to `convertLead`
- [ ] 6.5 `ImportEmailModal.tsx`: map parsed values onto model field names (by name); render the reviewed fields from the model's prospect fields; unknown parsed keys ignored

## 7. AdminDash frontend — model-driven public form

- [ ] 7.1 `PublicInquiryPage.tsx`: fetch the model via `fetchPublicLeadModel(tenant)` and render its prospect fields dynamically (fallback to current fixed fields on error); keep success/error states and `submitPublicLead`
- [ ] 7.2 Confirm the public route still renders unauthenticated and the reserved internal fields never appear

## 8. Verify

- [ ] 8.1 `cd datacore && uv run python -m pytest tests/ -q` (unchanged, sanity) and `cd admindash && uv run pytest backend/tests/ -q` — pass; run launchpad + papermite backend tests for tasks 1–2
- [ ] 8.2 `cd admindash/frontend && npm run build && npm run lint` — build passes; no new lint errors over baseline
- [ ] 8.3 Manual smoke: (a) seed default model → leads UI shows the six default stages/fields; (b) edit the lead model's `stage` options + add a custom field (via Papermite review or a direct model PUT) → board columns, forms, stage dropdown, and public form reflect the change; (c) change a stage (confirm dialog) and confirm custom fields survive; (d) convert a lead choosing a target stage; (e) submit the public form with the custom field
