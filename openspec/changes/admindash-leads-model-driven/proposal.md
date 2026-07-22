## Why

The leads module currently hard-codes its pipeline stages (`New → … → Lost`) and its capture fields in AdminDash. Every other core entity — tenant, student, program, application/enrollment — is **customer-definable** through the LaunchPad onboarding flow (seed the default model, or edit fields and selection options in Papermite's review UI). Leads should work the same way: a school should be able to define its own pipeline stages and its own lead-capture fields during onboarding, and AdminDash should adapt to whatever they choose. The two things schools most need to shape about leads are exactly **the stages** and **the fields that capture lead info**.

## What Changes

- **Seed `lead` into the default model** (`base_model.json`) so it is defined and versioned like every other entity. The current fields and the current six stages become the **default** — a school that changes nothing keeps today's behavior.
- **Represent pipeline stages as the `options` of a `selection` field named `stage`** (mirroring `student.status` / `program.status`). Defining/reordering stages is then just editing that field's options — no new schema. `source` likewise becomes a `selection` field. This makes stages first-class and customer-definable through the existing field/options editor.
- **Make `lead` editable through the same onboarding path** as other entities: add a `Lead` domain model to Papermite so it appears in the extraction **review/edit UI** (add/remove fields, edit `stage` options, mark required), and is seeded by LaunchPad's "use default model".
- **Make AdminDash leads model-driven:** the backend validates stages against the tenant's lead model (not a constant) and preserves all model fields (including custom ones) on update; the frontend derives the pipeline board, the stage dropdown, and the add/edit forms from the tenant's lead model. If the model defines new stages or new fields, the UI reflects them.
- **Convert-to-Family no longer forces a hard-coded "Enrolled" stage** (that stage may not exist in a custom pipeline): convert still creates + links Family/Student and guards double-conversion, and the convert dialog lets the admin **pick the target stage** (defaulting to the pipeline's last stage), validated against the tenant's stage options. **BREAKING** relative to the just-built (unreleased) behavior that auto-set `Enrolled`.
- **Graceful fallback:** if a tenant has no `lead` model yet, AdminDash falls back to today's default fields/stages, so nothing breaks during rollout.

## Capabilities

### New Capabilities
- `lead-model-definition`: `lead` as a seeded, versioned, customer-definable model — default fields + `stage`/`source` as selection fields; editable via LaunchPad use-default and Papermite review; `lead_activity` remains a non-configurable transactional log.
- `lead-model-driven-ui`: AdminDash derives the pipeline stages, capture fields, board, forms, and stage control from the tenant's lead model, with a safe fallback to defaults.

### Modified Capabilities
<!-- The base leads specs (lead-pipeline/lead-intake/lead-conversion) live in the unarchived
     admindash-leads-module change, so their model-driven revisions are folded into the two
     new capabilities above rather than expressed as delta specs against main. The behavioral
     changes covered there: pipeline stages come from the model's `stage` options; capture
     forms and required-ness come from the model; conversion no longer forces `Enrolled` and
     instead moves to an admin-selected target stage (default = last). -->


## Impact

- **LaunchPad** (`launchpad/backend/app/data/base_model.json`): add the `lead` entity (default fields + `stage`/`source` selection fields). No flow changes — `use-default` already PUTs the whole model.
- **Papermite** (`papermite/backend/app/models/domain.py` + `ENTITY_CLASSES`): add a `Lead` domain model so leads surface in the extraction/review editor for field + stage-option customization.
- **AdminDash backend** (`admindash/backend/app/api/leads.py`): read the tenant's lead `stage` options from the model for validation; make the read-modify-write base_data reconstruction dynamic (preserve all/custom fields); drop the forced `Enrolled` on convert.
- **AdminDash frontend**: `LeadPage` board, `LeadDetailDrawer` stage control, and `AddLeadModal`/edit become model-driven (via `getModel('lead')` + `DynamicForm`); `Lead`/`LEAD_STAGES` fixed types relax to model-driven; public inquiry form renders the model's prospect fields (excluding internal `stage`/`source`/`lead_id`/`converted_family_id`).
- **DataCore**: no change — models + `lead` abbreviation already supported.
