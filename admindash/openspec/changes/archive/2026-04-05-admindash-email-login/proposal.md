## Why

Admindash currently authenticates against a static `test_user.json` file using username + password. Meanwhile, LaunchPad and papermite already authenticate against DataCore's global `registry` table with bcrypt-hashed passwords and email-based login. Admindash should use the same source of truth so that users registered through LaunchPad can log in to Admindash without separate credentials — and the login experience should be consistent across all NeoApex apps (email + password).

## What Changes

- **BREAKING**: Login form switches from username + password to email + password
- Replace static `test_user.json` credential check with a real API call to `POST /api/login` on the Admindash API server (localhost:8080), which validates against DataCore's global registry
- Store JWT token returned by login endpoint; use it for authenticated API requests
- Remove `test_user.json` dependency from the auth flow
- Update `AuthContext` to manage token-based sessions instead of comparing against cached static credentials
- Update i18n translations to reflect email-based login labels
- Update `TestUser` type to reflect the new auth response shape

## Capabilities

### New Capabilities
- `email-login`: Email + password login form, API-backed authentication against DataCore registry, JWT token storage and session management

### Modified Capabilities

## Impact

- **Frontend files**: `LoginPage.tsx`, `AuthContext.tsx`, `client.ts` (API), `models.ts` (types), `translations.ts` (i18n), `LoginPage.css`
- **API contract**: Requires `POST /api/login` endpoint on the Admindash API server (localhost:8080) that mirrors papermite's contract — accepts `{email, password}`, returns `{token, user}`
- **Dev credentials**: `test_user.json` no longer used for auth; developers must have a user registered in DataCore's registry to log in (or the API server must provide a dev fallback)
- **Session storage**: Shifts from storing full user object in sessionStorage to storing JWT token + user data
