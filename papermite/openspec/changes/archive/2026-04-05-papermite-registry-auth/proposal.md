## Why

Papermite currently authenticates users against a hardcoded `test_user.json` file with plain-text passwords — a dev-only workaround that is insecure and disconnected from the real identity system. LaunchPad already stores user credentials in the global registry table (DataCore) with bcrypt-hashed passwords; Papermite should use the same source of truth so that users registered through LaunchPad can log in to Papermite without separate credentials.

## What Changes

- Remove `test_user.json` and the config code that loads it from Papermite
- Add a `RegistryStore` client in Papermite that reads user records from the DataCore global "registry" table (mirroring LaunchPad's implementation)
- Update Papermite's login endpoint to look up users via `RegistryStore` and verify bcrypt-hashed passwords
- Remove the `TestUser` Pydantic model and replace with `UserRecord` (matching LaunchPad's model)
- Update `get_current_user` JWT dependency to return a `UserRecord`-compatible user object

## Capabilities

### New Capabilities
- `registry-auth`: Papermite authenticates users by querying the DataCore global registry table, matching LaunchPad's credential storage and bcrypt verification flow.

### Modified Capabilities

## Impact

- `papermite/backend/app/config.py` — remove test user loading logic
- `papermite/backend/app/api/auth.py` — replace JSON-based login with registry lookup
- `papermite/test_user.json` — deleted
- `papermite/backend/app/storage/registry_store.py` — new file mirroring LaunchPad's registry store
- `papermite/backend/app/models/registry.py` — new file with `UserRecord` model (or shared with LaunchPad)
- DataCore dependency: Papermite backend must be configured with DataCore base URL and the "registry" table
