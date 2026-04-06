## Why

LaunchPad imports the `datacore` Python package and reads/writes LanceDB directly for user CRUD, onboarding management, tenant profiles, and model operations. This creates tight coupling — LaunchPad needs the `datacore` package as a dependency, shares filesystem access to LanceDB, and requires `NEOAPEX_LANCEDB_DIR`. All other LaunchPad→DataCore interactions (auth) already go through HTTP. Papermite was already decoupled from DataCore in PR #14 using the same pattern.

## What Changes

- Add new DataCore API endpoints for user CRUD (create, get, list, update, delete), onboarding (get, mark step), and tenant profile (get, update)
- Replace all direct `datacore.Store` access in LaunchPad with `httpx` calls to DataCore's HTTP API
- Delete `launchpad/backend/app/storage/registry_store.py`, `model_store.py`, and `__init__.py`
- Remove `datacore` from LaunchPad's `pyproject.toml` dependencies
- Remove `datacore_store_path` from LaunchPad config
- Delete `launchpad/backend/tests/test_registry_store.py`

## Capabilities

### New Capabilities
- `user-management-api`: DataCore REST endpoints for user CRUD operations (create, get by ID/email, list by tenant, update, delete, count admins)
- `onboarding-api`: DataCore REST endpoints for onboarding status (get, mark step complete)
- `http-delegated-storage`: LaunchPad delegates all storage operations to DataCore via HTTP instead of direct library access

### Modified Capabilities

## Impact

- **DataCore**: New API endpoints in `routes.py` for user and onboarding CRUD on the global registry table
- **LaunchPad backend**: `users.py` and `tenants.py` switch from `RegistryStore` dependency injection to `httpx` calls; `storage/` directory deleted entirely
- **LaunchPad config**: Remove `datacore_store_path`, add `datacore_api_url` (already has `datacore_auth_url`)
- **Dependencies**: `datacore` package removed from `pyproject.toml`; `bcrypt` no longer needed in LaunchPad (password hashing moves to DataCore)
- **Tests**: `test_registry_store.py` deleted (tests for deleted code)
