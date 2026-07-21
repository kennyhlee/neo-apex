## Context

Leads were built (unreleased, on `feat/admindash-leads-module`, PR #89) with a **fixed** schema and a **hard-coded** six-stage pipeline. Every other core entity is customer-definable through one shared mechanism: a per-tenant **model definition** (`{entity_type: {base_fields, custom_fields}}`) stored in DataCore, seeded from LaunchPad's `base_model.json` via `POST /tenants/{id}/model/use-default`, and editable in Papermite's extraction **review UI** (rename fields, change types, edit `selection` options, mark required). Selection fields with ordered `options` already model ordered enums (e.g. `student.status`, `program.status`, `enrollment.status`). AdminDash already renders model-driven pages (StudentsPage) via `ModelContext.getModel` + `DynamicForm` + `StatusBadge`.

This change brings leads onto that same mechanism. The two customer-shaped concepts — **stages** and **capture fields** — map cleanly onto an existing construct: stages are the `options` of a `selection` field named `stage`; fields are the model's `base_fields`/`custom_fields`.

## Goals / Non-Goals

**Goals:**
- `lead` is a seeded, versioned, customer-definable model; today's fields + stages are the default.
- Defining/reordering **stages** = editing the `stage` field's `options`, through the same LaunchPad/Papermite flow — no new schema or bespoke pipeline editor.
- AdminDash (management UI **and** public form) derives stages, fields, board, forms, and stage control from the tenant's lead model; changing the model changes the UI.
- Backward-compatible: no lead model yet ⇒ fall back to today's defaults.

**Non-Goals:**
- No new field-editor UI — reuse Papermite's review editor and LaunchPad use-default.
- `lead_activity` is NOT modelled/configurable (transactional log).
- No per-stage automation/rules, WIP limits, or stage-entry hooks.
- No migration of existing leads' stage values if a tenant renames stages (documented as a risk).

## Decisions

### D1 — Stages = `options` of a `selection` field named `stage`; `source` also a selection field
The lead model's `stage` field is `{type: "selection", options: [...ordered stages...]}`. The pipeline order is the option order. `source` becomes `{type: "selection", options: ["web_form","manual","email_import"]}`. This reuses the exact construct behind `student.status`, so the existing review editor already edits it and `DynamicForm`/`StatusBadge` already render it.
- **Alternative:** a new first-class `stages`/`pipeline` attribute on the model definition. Rejected — needs schema, storage, editor, and API changes across DataCore/Papermite/LaunchPad for no gain over an ordered selection field.
- **Reserved name:** AdminDash treats the `selection` field literally named `stage` as the pipeline driver.

### D2 — Seed `lead` in `base_model.json`; add `Lead` to Papermite domain
Add a `lead` entity to `base_model.json` (default fields below), so `use-default` seeds it with the rest. Add a `Lead` Pydantic model to `papermite/backend/app/models/domain.py` and its `ENTITY_CLASSES` so leads surface in the review editor for customization (same as student/program). `lead_activity` is deliberately excluded from the model.
- Default lead `base_fields`: `lead_id`(str), `guardian_name`(str, required), `email`(email), `phone`(phone), `student_first_name`(str), `student_last_name`(str), `grade_of_interest`(str), `message`(str), `source`(selection: web_form/manual/email_import), `stage`(selection: New/Contacted/Tour Scheduled/Toured/Enrolled/Lost), `converted_family_id`(str); `custom_fields: []`.

### D3 — AdminDash reads stages/fields from the tenant lead model, with fallback
Frontend: `getModel(tenant, 'lead')`; derive the pipeline from the `stage` field's `options`, build the board columns and the stage dropdown from them, and render add/edit forms with `DynamicForm(model)`. Backend: fetch the lead model (DataCore `models` query) to get valid `stage` options for validation. Both fall back to the current hard-coded defaults (`DEFAULT_STAGES`, default field list) when no `lead` model exists — preserves behavior during rollout and in tests.

### D4 — Dynamic base_data reconstruction on update (preserve custom fields)
The stage/convert read-modify-write currently rebuilds `base_data` from a hard-coded `_LEAD_FIELDS` allowlist, which would **drop** customer-added fields. Change `_lead_base_data` to preserve every non-system column from the fetched row (exclude `entity_id`, `_*` metadata, and flattened custom columns handled separately) — i.e. reconstruct from the model's fields, or simply carry all non-underscore keys. This keeps custom fields intact across stage changes and conversion.

### D5 — Convert-to-Family: admin picks the target stage (default = last stage)
`convert` gains an optional `target_stage`. It creates Family → Student → links `converted_family_id`, then moves the lead to `target_stage` (validated against the model's stage options); if omitted, defaults to the **last** stage in the pipeline. Still guards double-conversion (409). Removes the hard-coded `Enrolled`. The convert dialog shows a stage `<select>` (from the model) defaulting to the last stage.
- **Alternatives considered:** never change stage (loses the "won" signal); always jump to last stage (wrong when the last stage is "Lost"). Admin-pick with a sensible default is the most robust for arbitrary pipelines.

### D6 — Model-driven capture forms; required-ness from the model
`AddLeadModal` and the edit form render via `DynamicForm(leadModel)`, emitting `base_data`/`custom_fields`. The previous bespoke "guardian name + (email or phone)" rule is replaced by the model's `required` flags (`guardian_name` required by default). The public inquiry form renders the model's **prospect** fields — base fields excluding the reserved internal ones (`stage`, `source`, `converted_family_id`, `lead_id`) — fetched via an unauthenticated `models` query (DataCore models have no auth, like entities). Email-import maps parsed values onto model field names by name; unknown parsed keys are ignored.

### D7 — Board card + graceful degradation
The board groups leads by their `stage` value in model order. Each card shows whatever of the conventional fields exist (`guardian_name`, student name, email/phone); if a customer removes/renames them, the card shows the available fields without erroring. Leads whose stored `stage` is not in the current options (e.g. after a rename) render in an "Other"/uncategorized column so they are never hidden.

## Risks / Trade-offs

- **Renamed/removed stages orphan existing leads' values** → Mitigation: render unknown stage values in an "Other" column (never hidden); document that renaming stages doesn't migrate existing rows. No automatic data migration in this change.
- **Reserved field name `stage`** → if a customer deletes the `stage` field, the pipeline can't function → Mitigation: fall back to `DEFAULT_STAGES` and surface a single, non-fatal notice; keep `stage` in the seeded default and treat it as required-by-convention in docs.
- **Public form fetches model unauthenticated** → only the field *shape* (names/types/options) is exposed, no tenant data; consistent with DataCore's existing no-auth models/entities. Still guard the reserved internal fields server-side on public intake (already enforced) regardless of model.
- **Backend model fetch per request** adds a DataCore round-trip to stage/convert/validation → Mitigation: fetch once per request; acceptable at current scale (a short-TTL cache is a follow-up).
- **BREAKING vs unreleased behavior:** convert no longer auto-sets `Enrolled`; the email-or-phone rule is dropped. Both are on the unmerged branch, so no production impact; update the existing leads tests accordingly.
