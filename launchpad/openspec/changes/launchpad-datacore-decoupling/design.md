## Context

LaunchPad accesses DataCore's LanceDB storage directly via the `datacore` Python package. Three storage modules exist:

- `storage/registry_store.py` — User CRUD and onboarding via `Store.put_global/get_global/query_global/delete_global` on the `registry` table
- `storage/model_store.py` — Reads tenant model definitions via `Store.get_active_model` and `Store.list_models`
- `storage/__init__.py` — FastAPI dependency injection, creates `Store` and `RegistryStore` singletons

Additionally, `tenants.py` has inline `from datacore import Store` calls that bypass the storage layer entirely for tenant entity and model operations.

DataCore's `auth_routes.py` also has inline user lookup and creation logic (`_get_user_by_email`, `_get_user_by_id`, registration with `_hash_password`) that duplicates what the new registry endpoints will provide.

Papermite was decoupled from DataCore in PR #14 using the same pattern: replace direct imports with `httpx` HTTP calls.

## Goals / Non-Goals

**Goals:**
- Remove `datacore` Python package from LaunchPad's dependencies
- Replace all direct LanceDB access with HTTP calls to DataCore API
- Add missing DataCore API endpoints for user CRUD and onboarding operations
- Refactor DataCore's auth_routes.py to call the new registry endpoints internally (eliminate duplicate logic)
- Delete LaunchPad's storage layer entirely

**Non-Goals:**
- Refactoring DataCore's internal storage (global table schema stays the same)
- Changing LaunchPad's API contract with frontends (same endpoints, same responses)
- Adding new user management features
- Full API consolidation (planned as a separate follow-up change)

## Decisions

### DataCore gets new registry API endpoints

New endpoints under `/api/registry/` expose user CRUD and onboarding operations:

- `GET /api/registry/users?tenant_id={id}&email={email}` — query users (filter by tenant, email, or both)
- `POST /api/registry/users` — create user (hashes password, generates user_id)
- `GET /api/registry/users/{user_id}` — get user by ID
- `PUT /api/registry/users/{user_id}` — update user
- `DELETE /api/registry/users/{user_id}` — delete user
- `GET /api/registry/onboarding/{tenant_id}` — get onboarding status
- `POST /api/registry/onboarding/{tenant_id}/complete-step` — mark step complete

These reuse the same global registry table and record key patterns (`user:{id}`, `onboarding:{tenant_id}`).

### DataCore auth_routes.py refactored to use registry endpoints

The existing auth routes have inline user lookup and creation logic that duplicates what the new registry endpoints provide. After registry endpoints are added, auth_routes.py will call them internally instead of accessing the Store directly:

- `_get_user_by_email()` → calls the registry user query function
- `_get_user_by_id()` → calls the registry user get function
- Registration user creation → calls the registry user create function
- Registration onboarding creation → calls the registry onboarding functions

This eliminates duplicate logic and ensures a single code path for user/onboarding operations.

### LaunchPad uses httpx for all DataCore calls

Same pattern as Papermite and existing auth delegation: `httpx.get/post/put/delete` to DataCore URLs built from `settings.datacore_api_url`.

### Tenant and model operations use existing DataCore endpoints

- Tenant profile: `GET/PUT /api/tenants/{tenant_id}` (already exists)
- Model storage: `PUT /api/models/{tenant_id}` (added in PR #14)
- Model read: `GET /api/models/{tenant_id}` and `GET /api/models/{tenant_id}/{entity_type}` (already exist)

### Password hashing stays in DataCore

`RegistryStore.hash_password` and `verify_password` are used when creating users. The new `POST /api/registry/users` endpoint handles hashing server-side. LaunchPad sends plaintext passwords over the internal network (same as it does for `/auth/login` today).

## Alternatives Considered

**Keep RegistryStore but inject an HTTP-backed implementation** — More complex, adds an abstraction layer that isn't needed since LaunchPad's API routes can call httpx directly. Rejected for unnecessary complexity.
