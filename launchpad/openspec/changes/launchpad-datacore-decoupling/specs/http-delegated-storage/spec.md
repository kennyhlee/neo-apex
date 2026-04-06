## ADDED Requirements

### Requirement: LaunchPad delegates all storage to DataCore HTTP API

LaunchPad has zero direct imports of the `datacore` Python package. All data access goes through DataCore's HTTP API via `httpx`.

#### Scenario: User management in users.py
- **WHEN** LaunchPad's user management endpoints are called
- **THEN** they use `httpx` to call DataCore's `/api/registry/users/*` endpoints instead of `RegistryStore`

#### Scenario: Onboarding in tenants.py
- **WHEN** LaunchPad's onboarding endpoints are called
- **THEN** they use `httpx` to call DataCore's `/api/registry/onboarding/*` endpoints instead of `RegistryStore`

#### Scenario: Tenant profile in tenants.py
- **WHEN** LaunchPad's tenant profile endpoints are called
- **THEN** they use `httpx` to call DataCore's existing `/api/tenants/{tenant_id}` endpoint instead of inline `Store` access

#### Scenario: Model operations in tenants.py
- **WHEN** LaunchPad's model endpoints are called
- **THEN** they use `httpx` to call DataCore's existing `/api/models/{tenant_id}` and `/api/models/{tenant_id}/{entity_type}` endpoints instead of inline `Store` access

#### Scenario: Storage layer removed
- **WHEN** the LaunchPad codebase is inspected
- **THEN** `storage/registry_store.py`, `storage/model_store.py`, and `storage/__init__.py` do not exist
- **AND** `datacore` does not appear in `pyproject.toml` dependencies
- **AND** no Python file imports from `datacore` or `app.storage`
