## ADDED Requirements

### Requirement: Delegate model storage to datacore

Papermite's `lance_store.py` SHALL delegate all LanceDB storage operations to `datacore.Store` instead of managing LanceDB directly. The module SHALL initialize a `datacore.Store` instance using the existing `settings.lancedb_dir` path and use `put_model()` / `get_active_model()` for all persistence.

#### Scenario: Store a new model definition via datacore

- **WHEN** `commit_finalize()` is called with a tenant_id and extraction result that produces a new model definition containing multiple entity types
- **THEN** the function SHALL call `datacore.Store.put_model()` once per entity type, each with its own `entity_type` value and the entity type's definition as `model_definition`
- **AND** SHALL embed `source_filename` and `created_by` as underscore-prefixed keys (`_source_filename`, `_created_by`) inside each entity type's `model_definition`
- **AND** all `put_model()` calls for one finalization SHALL share the same `change_id` to enable grouped rollback
- **AND** SHALL translate datacore's `_version` to `version`, `_created_at` to `created_at`, and set `status: "finalized"` (not datacore's `_status: "active"`)
- **AND** SHALL strip the underscore-prefixed metadata keys from `model_definition` in the return value
- **AND** SHALL reassemble the per-entity-type results into a single combined `model_definition` dict keyed by entity type
- **AND** the returned record SHALL include `tenant_id`, `version`, `status: "finalized"`, `model_definition`, `source_filename`, `created_by`, and `created_at`

#### Scenario: Retrieve active model definition via datacore

- **WHEN** `get_active_model()` is called with a tenant_id
- **THEN** the function SHALL retrieve all active model records across all entity types for the tenant
- **AND** SHALL reassemble them into a single `model_definition` dict keyed by entity type
- **AND** SHALL construct the return dict with only the expected keys: `tenant_id`, `version` (max `_version` across entity types), `status: "active"`, `model_definition` (with metadata keys stripped), `source_filename` (from any record's `_source_filename`), `created_by` (from any record's `_created_by`), `created_at` (max `_created_at` across entity types)
- **AND** SHALL NOT leak datacore-internal fields (`_change_id`, `_updated_at`, `entity_type`) into the return value
- **AND** return `None` if no active models exist for the tenant

#### Scenario: Rollback a finalization by change_id

- **WHEN** `store.rollback_by_change_id(tenant_id, change_id)` is called
- **THEN** all entity type model definitions stored with that `change_id` SHALL be reverted
- **AND** each entity type SHALL independently revert to its most recent archived version

### Requirement: Preserve public API contract

The public interface of `lance_store.py` SHALL remain unchanged. All callers (`finalize.py`, `extraction.py`) SHALL continue to work without modification.

#### Scenario: get_active_model returns same shape

- **WHEN** `get_active_model(tenant_id)` is called
- **THEN** the return value SHALL be a dict with keys: `tenant_id`, `version`, `status`, `model_definition`, `source_filename`, `created_by`, `created_at`
- **AND** the return type and key names SHALL match the existing API contract exactly

#### Scenario: preview_finalize returns same shape

- **WHEN** `preview_finalize(tenant_id, extraction)` is called
- **THEN** the return value SHALL include `status` ("unchanged" or "pending_confirmation"), `version`, `model_definition`, `source_filename`
- **AND** if unchanged, SHALL also include `created_by` and `created_at` from the existing active model
- **AND** the `version` for a pending confirmation SHALL be calculated as the max `_version` across all active entity types + 1 (or `1` if no active models exist)

#### Scenario: commit_finalize returns same shape

- **WHEN** `commit_finalize(tenant_id, extraction, created_by)` is called
- **THEN** the return value SHALL include `tenant_id`, `version`, `status` ("unchanged" or "finalized"), `model_definition`, `source_filename`, `created_by`, `created_at`

### Requirement: Change detection before storage

The module SHALL compare the new model definition against the existing active model before writing. If the normalized definitions are identical, no new version SHALL be created.

#### Scenario: Skip write when model is unchanged

- **WHEN** `commit_finalize()` is called and the new model definition matches the active model after normalization
- **THEN** no call to `datacore.Store.put_model()` SHALL be made
- **AND** the function SHALL return the existing model with `status: "unchanged"`

#### Scenario: Write when model has changed

- **WHEN** `commit_finalize()` is called and the new model definition differs from the active model
- **THEN** `datacore.Store.put_model()` SHALL be called with the new definition
- **AND** the function SHALL return the new model with `status: "finalized"`

### Requirement: Domain logic stays in papermite

The functions `_build_model_definition()`, `_normalize_model_def()`, and `_infer_type()` SHALL remain in papermite's `lance_store.py`. These are domain-specific transformations, not storage operations.

#### Scenario: Build model definition from extraction

- **WHEN** `_build_model_definition()` is called with a list of entity results
- **THEN** it SHALL produce a dict keyed by entity type with `base_fields` and `custom_fields` lists
- **AND** this logic SHALL not depend on datacore or LanceDB

### Requirement: Remove direct LanceDB dependency

Papermite SHALL remove `lancedb` from its direct dependencies in `pyproject.toml` and add `datacore` instead. All LanceDB access SHALL go through datacore.

#### Scenario: No direct lancedb imports in lance_store.py

- **WHEN** the refactored `lance_store.py` is inspected
- **THEN** it SHALL NOT import `lancedb` or `pyarrow`
- **AND** it SHALL import `datacore.Store` instead
