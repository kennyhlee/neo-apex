## Why

GitHub issue #69: After a user uploads a document to Papermite and clicks **Finish building model**, the Launchpad tenant detail page is blank — even though Papermite's extraction has already produced a populated `TENANT` entity (name, display_name, contact_email, contact_phone, …). The extracted tenant values are silently discarded at finalize time, forcing users to re-type information the system already has.

Root cause: Papermite's finalize endpoint persists only the **model definition schema** to DataCore's `models` table. It never writes the extracted **tenant data** to DataCore's `tenants` table, which is the table Launchpad reads from for the tenant detail view.

## What Changes

- Papermite's finalize endpoint (`POST /api/tenants/{tenant_id}/finalize/commit` in `papermite/backend/app/api/finalize.py`) SHALL, after the existing `PUT /api/models/{tenant_id}` call, persist values extracted from the `TENANT` `EntityResult` to DataCore's tenants table.
- The extracted values SHALL be sourced from `entity_result.field_mappings` (the same source `_build_model_definition` already uses) — `source == "base_model"` mappings go to DataCore's `base_data`; `source == "custom_field"` mappings go to DataCore's `custom_fields`.
- The write SHALL **merge, not overwrite**: only fields currently empty/null/whitespace-only on the DataCore tenant row are filled from extraction. Values already present (including those the user typed during onboarding) are preserved. The merge applies independently to `base_data` and `custom_fields`.
- The tenant write SHALL be skipped silently when extraction has no `TENANT` entity, OR when the `TENANT` entity's `field_mappings` contains no non-empty values. The model definition write SHALL continue to run regardless.
- Failure of the tenant read or write SHALL NOT roll back the model write, but SHALL surface HTTP 502 to the caller so the user can retry (the model write is idempotent — DataCore no-ops unchanged definitions).

No UI changes. No DataCore schema changes. No changes to extraction logic.

## Capabilities

### New Capabilities
- `papermite-finalize-tenant-persistence`: Behavior of Papermite's finalize endpoint with respect to persisting the extracted tenant entity to DataCore alongside the model definition.

### Modified Capabilities
<!-- None — no existing spec covers finalize tenant-write behavior. -->

## Impact

- **Code touched**: `papermite/backend/app/api/finalize.py` (sole behavioral change). Private helpers added in the same file for clarity.
- **Tests**: New tests in `papermite/backend/tests/` covering merge semantics, base-vs-custom split, skip conditions, and failure isolation.
- **APIs called**: Adds two new DataCore calls from Papermite — `POST /api/query` (to read the existing tenant row) and `PUT /api/tenants/{tenant_id}` (to write the merged result). Both endpoints already exist and are unauthenticated, matching the pattern of the existing models PUT.
- **No new dependencies.** Papermite does not add `toon` — base/custom split is performed by discriminating against `Tenant.model_fields` keys, using the flattened columns returned by `/api/query`.
- **No frontend changes.** Launchpad's tenant detail view already reads from its own `/tenants/{tenant_id}` endpoint; once the DataCore row is populated, the page renders correctly.
- **No migration.** Existing tenants with empty rows will populate on the next successful finalize.
