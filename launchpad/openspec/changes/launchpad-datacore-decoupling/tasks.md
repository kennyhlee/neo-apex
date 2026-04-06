## 1. DataCore: Add registry API endpoints

- [ ] 1.1 Add user CRUD endpoints to DataCore (query with tenant_id/email filters, create, get by ID, update, delete) with tests
- [ ] 1.2 Add onboarding endpoints to DataCore (get status, mark step complete) with tests
- [ ] 1.3 Refactor auth_routes.py to call registry functions instead of duplicating Store access logic

## 2. LaunchPad backend: Delegate to DataCore HTTP

- [ ] 2.1 Add `datacore_api_url` to LaunchPad config, remove `datacore_store_path`
- [ ] 2.2 Rewrite `users.py` to use httpx calls to DataCore registry API instead of RegistryStore
- [ ] 2.3 Rewrite `tenants.py` to use httpx calls to DataCore API (registry, tenant, model endpoints) instead of inline Store access and RegistryStore
- [ ] 2.4 Delete `storage/registry_store.py`, `storage/model_store.py`, `storage/__init__.py`
- [ ] 2.5 Remove `datacore` from `pyproject.toml` dependencies
- [ ] 2.6 Delete `tests/test_registry_store.py`

## 3. Verification

- [ ] 3.1 Verify no remaining `datacore` or `app.storage` imports in LaunchPad
- [ ] 3.2 Run DataCore tests — all pass
- [ ] 3.3 Verify LaunchPad backend starts
- [ ] 3.4 End-to-end: start all services, test user management and onboarding flows
