## Context

Papermite's `POST /api/tenants/{tenant_id}/finalize/commit` (in `papermite/backend/app/api/finalize.py`) accepts a full `ExtractionResult` and, today, only writes the **model definition schema** to DataCore via `PUT /api/models/{tenant_id}`. The accompanying `TENANT` entity inside `extraction.entities` — which `mapper.map_extraction()` populates with concrete field values (e.g., `name`, `display_name`, `contact_email`, `contact_phone`) when the source document contains tenant information — is silently dropped.

Launchpad's tenant detail view (`launchpad/frontend/src/pages/TenantSettingsPage.tsx`) calls `GET /tenants/{tenant_id}` on the Launchpad backend, which in turn issues `POST /api/query` to DataCore against the `tenants` table (`launchpad/backend/app/api/tenants.py:23-46`). DataCore stores tenant rows in a per-tenant entities table; the active row is the most recent `_status='active'` record with `entity_type='tenant'`. When no row exists, Launchpad's endpoint returns just `{tenant_id, name}`, leaving the form blank.

Relevant constraints — discovered during review:

- **`EntityResult.field_mappings` is the canonical source of post-review values.** `mapper._map_entity` builds both an `entity` dict and a `field_mappings` list; the frontend's edit handlers (`papermite/frontend/src/components/EntityCard.tsx:26-66`) update both in lockstep on inline edits. The model write already uses `field_mappings` as its source (see `_build_model_definition`). Using the same source for the tenant write keeps the two writes consistent and unambiguously captures the `base_model` vs `custom_field` distinction via the mapping's `source` field.
- **All base-model fields appear in `field_mappings` even when the AI did not extract them**, with `value=None` or a default (`mapper.py:159-200`). "There is a `TENANT` entity" is not equivalent to "the AI found tenant data." A meaningful skip requires checking that at least one mapping has a non-empty value.
- **DataCore has `PUT /api/tenants/{tenant_id}` with replace semantics** (the active row is archived and a new one written from the request body). There is **no merge mode** server-side. DataCore exposes **no GET-by-id endpoint for tenants** — all reads in the codebase go through `POST /api/query` with a SQL string (the same pattern Launchpad's `update_tenant_profile` already uses for a read-merge-write on this same table).
- **`POST /api/query` against the `tenants` alias flattens both `base_data` AND `custom_fields` into top-level string-typed columns** (`datacore/src/datacore/query.py:148-190`). All values come back stringified — `False` becomes `"False"`, `0` becomes `"0"`. This is true for the existing Launchpad read path as well, so we are not introducing this quirk.
- **Papermite does not depend on `toon`.** Decoding the raw `base_data`/`custom_fields` TOON columns directly would require adding the dependency. The flattened-columns view is sufficient for our needs if we discriminate base-vs-custom via `Tenant.model_fields`.

## Goals / Non-Goals

**Goals:**
- After finalize, Launchpad's tenant detail page renders the values Papermite extracted (where the user hasn't already filled them).
- Preserve any tenant fields the user entered during onboarding before finalize.
- Keep the model-definition write path unchanged on the happy path.

**Non-Goals:**
- No new DataCore endpoints. Reuse the existing `POST /api/query` and `PUT /api/tenants/{tenant_id}`.
- No new Papermite dependencies (specifically, no `toon` decoder).
- No UI changes in Launchpad or Papermite.
- No changes to extraction logic, the mapper, or DataCore storage schema.
- Not changing replace-vs-merge semantics of DataCore's PUT. Merge logic lives in Papermite.
- No fix for the pre-existing DataCore query stringification quirk (all values come back as strings). Merge semantics tolerate it; resolving it is out of scope.
- No retry/queue infrastructure for partial failures.

## Decisions

### Decision: Do the read-merge-write on Papermite's side via DataCore's `POST /api/query`

Use the same pattern Launchpad already uses in `update_tenant_profile` — query the flattened tenants row, build merged `base_data` and `custom_fields` dicts, PUT them back.

**Alternatives considered:**
- *Add `GET /api/tenants/{tenant_id}` to DataCore.* Cleaner long-term but expands the change to two services. Defer until a second caller needs it.
- *Add a `?merge=true` mode to DataCore's PUT.* Couples a single caller's policy to a shared endpoint. Rejected.
- *Add `toon` to Papermite and decode the raw `base_data`/`custom_fields` columns directly.* More accurate (preserves value types, no stringification), but adds a dependency for one read path. Rejected — the flattened-columns approach is sufficient.
- *Have Launchpad call Papermite or vice-versa for the merge.* Cross-service coupling for what is conceptually a Papermite responsibility (Papermite owns the finalize step). Rejected.

### Decision: Source extracted values from `entity_result.field_mappings`, not `entity_result.entity`

For each mapping in the `TENANT` entity's `field_mappings`:
- If `mapping.source == "base_model"` and `mapping.value` is non-empty → `extracted_base[mapping.field_name] = mapping.value`.
- If `mapping.source == "custom_field"` and `mapping.value` is non-empty → `extracted_custom[mapping.field_name] = mapping.value`.

"Non-empty" = not `None` and not an empty/whitespace-only string. Other values (`0`, `False`, lists) are kept as extracted.

Rationale: `field_mappings` is the canonical source the frontend keeps in sync on inline edits, includes user-renamed field names, and has the `source` field that unambiguously tells us which DataCore bucket the value belongs in. Using it matches what `_build_model_definition` already does for the model write.

### Decision: Split the existing-row response into base/custom buckets using `Tenant.model_fields`

Reading via `POST /api/query` returns one flat dict where every base-data and custom-fields value is a top-level string column. To rebuild the two DataCore buckets for the PUT, classify each cleaned column by:

- Key is in `app.models.domain.Tenant.model_fields` (excluding system fields `tenant_id`, `entity_type`, `custom_fields`) → goes to `existing_base`.
- Key is anything else (and survives the cleaning step) → goes to `existing_custom`.

Cleaning step (matches Launchpad's pattern at `launchpad/backend/app/api/tenants.py:69-72`): drop `_status`, `_version`, `_created_at`, `_updated_at`, `_change_id`, `entity_type`, `entity_id`, `base_data`, `custom_fields`, `vector`; drop any key starting with `_` (this includes `_abbrev`, which DataCore re-derives server-side on the PUT); drop `None` values.

**Alternative considered:** decode the raw `base_data`/`custom_fields` TOON columns. Rejected — requires the `toon` dependency.

**Trade-off accepted:** all values come back as strings. We pass them through unchanged. This matches what Launchpad already does on its own write path. If a custom field was originally stored as a number or list, it will be re-stored as its stringified form. Not made worse by this change.

### Decision: Merge policy is "only fill empty/null fields in DataCore"

For every `(field_name, value)` in the extracted TENANT entity's `base_data`, write `value` to the merged payload **only if** the corresponding key in the existing DataCore tenant row is missing, `None`, or an empty string. Existing non-empty values win.

Rationale: a user typing a value during onboarding represents an explicit human decision; extraction is a best-effort fallback. The user picked this policy explicitly.

Implementation detail: "empty" = `None` OR `""` (empty string after `.strip()`). Other falsy values (`0`, `False`, `[]`) are **not** treated as empty — they represent valid user input.

### Decision: Skip the tenant write when extraction has no usable tenant data

The tenant write SHALL be skipped (silently, no error) when **either** of the following holds:
- `extraction.entities` contains no entity with `entity_type == "TENANT"` (the AI did not mention a tenant at all).
- The `TENANT` entity exists but after applying the "non-empty" filter described in the extracted-values decision above, both `extracted_base` and `extracted_custom` are empty dicts (every mapping value is `None` or empty/whitespace).

In both cases the model-definition PUT proceeds as today and the endpoint returns its existing success response. This preserves the current behavior for documents that don't carry tenant info and avoids an unnecessary read-write round trip to DataCore.

### Decision: Tenant-write errors surface as 502, after the model-write has succeeded

If the read (`POST /query`) or the write (`PUT /tenants/{tenant_id}`) fails with a non-2xx status, Papermite raises `HTTPException(502, detail="Failed to persist tenant from extraction")`. The model-definition write has already succeeded by this point and is **not** rolled back.

Rationale: the model definition is the user's primary artifact at finalize time; losing it because of a secondary write failure would be a worse outcome than re-running tenant persistence later. The 502 is visible to the frontend, so the user knows to retry (a retry will re-PUT the same model — which DataCore's existing change-detection no-ops — and re-attempt the tenant write).

## Risks / Trade-offs

- **Partial-failure window** → If the tenant PUT fails, the model is persisted but tenant fields aren't. Mitigation: 502 surfaces error; retry idempotently re-tries tenant write (model write is a no-op on unchanged content per `lance_store.commit_finalize`).
- **Race: user edits tenant in Launchpad between read and PUT** → Possible but vanishingly small (finalize is a one-shot user action; the window between query and PUT is a few hundred ms). Mitigation accepted; we choose the merge result computed at PUT time. If this ever becomes a real problem, DataCore would need optimistic concurrency control — out of scope.
- **Extraction produces wrong values** → The merge-only-empty policy bounds the blast radius to fields the user hasn't touched. The user can still edit the tenant form afterward to fix any bad values. Acceptable.
- **Adding two more DataCore HTTP calls to finalize** → Adds ~50-200ms to finalize latency. Acceptable for an interactive action that already takes seconds.

## Migration Plan

- No data migration required. Existing tenants with empty rows will populate the next time the user finalizes a model.
- No backward-incompatible API change. Finalize's request and response shapes are unchanged.
- Rollback: revert the diff in `papermite/backend/app/api/finalize.py`. No DataCore changes to undo.
