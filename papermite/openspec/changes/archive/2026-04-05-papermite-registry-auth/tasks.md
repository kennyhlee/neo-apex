## 0. Add bcrypt dependency

- [ ] 0.1 In `papermite/pyproject.toml`, add `"bcrypt>=4.0"` to the `dependencies` list
- [ ] 0.2 Run `pip install -e ".[dev]"` in `papermite/` to install bcrypt into the venv

## 1. Add UserRecord model to Papermite

- [ ] 1.1 Create `papermite/backend/app/models/registry.py` with `UserRecord` model (fields: `user_id`, `name`, `email`, `password_hash`, `tenant_id`, `tenant_name`, `role`, `created_at`) — identical to LaunchPad's model but without `OnboardingStatus`

## 2. Add RegistryStore to Papermite

- [ ] 2.1 Create `papermite/backend/app/storage/registry_store.py` copying LaunchPad's `RegistryStore` class — include `verify_password`, `get_user_by_email`, and `get_user_by_id` methods; omit write methods (`create_user`, `update_user`, `delete_user`, `create_onboarding`, etc.) since Papermite is read-only
- [ ] 2.2 Update `papermite/backend/app/storage/__init__.py` to expose a `get_registry_store()` FastAPI dependency that lazily initializes `RegistryStore` with a `datacore.Store` instance pointed at `settings.lancedb_dir` (same pattern as LaunchPad's `storage/__init__.py`)

## 3. Update config.py — remove test user code

- [ ] 3.1 In `papermite/backend/app/config.py`, remove the `TestUser` model class, the `test_user_path` field, and the `load_test_user()`, `load_users()`, and `find_user_by_email()` methods from `Settings`
- [ ] 3.2 Remove the `import json` and `from pathlib import Path` imports from `config.py` if they are no longer needed after removing test user code (keep `Path` if still used by `upload_dir` or `lancedb_dir`)

## 4. Update auth.py — replace JSON login with registry lookup

- [ ] 4.1 In `papermite/backend/app/api/auth.py`, update imports: remove `TestUser` from `app.config`, add `UserRecord` from `app.models.registry` and `get_registry_store` from `app.storage`
- [ ] 4.2 Update `_create_token()` to accept a `UserRecord` (it already reads `user_id`, `email`, `tenant_id`, `role` — just change the type annotation)
- [ ] 4.3 Update `login()` endpoint: replace `settings.find_user_by_email(req.email)` with `registry.get_user_by_email(req.email)` (injected via `Depends(get_registry_store)`), replace plain-text password check with `RegistryStore.verify_password(req.password, user.password_hash)`, and replace `del user_data["password"]` with `del user_data["password_hash"]`
- [ ] 4.4 Update `get_current_user()` dependency: when decoding a Papermite-issued token, replace `settings.find_user_by_email(payload["email"])` with `registry.get_user_by_id(payload["user_id"])` (inject registry via `Depends(get_registry_store)`); for the LaunchPad JWT fallback, construct a `UserRecord` instead of a `TestUser` (set `password_hash=""`, `created_at=""`)
- [ ] 4.5 Update `require_admin()` and `get_me()` type annotations to use `UserRecord` instead of `TestUser`; update `get_me()` to `del user_data["password_hash"]`

## 5. Delete test_user.json

- [ ] 5.1 Delete `papermite/test_user.json` from the repository
