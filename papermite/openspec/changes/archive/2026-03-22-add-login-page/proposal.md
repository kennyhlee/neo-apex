# Proposal: Add Login Page

## Why

Papermite currently has no authentication — the app auto-loads `test_user.json` and grants full access. There's no way to test multi-user scenarios or verify that non-admin users are properly rejected. Adding a login page provides credential-based access control and ensures only `tenant_admin` users can access the application.

## What Changes

- `test_user.json` becomes an array of users, each with an `email` and `password` field
- A new `POST /api/login` backend endpoint validates credentials and returns a JWT token
- A new `GET /api/me` endpoint reads the JWT to identify the logged-in user (replaces the current auto-load)
- All existing API routes require a valid JWT with `tenant_admin` role
- Frontend gets a login page styled after [Floatify](https://www.floatify.com/) — dark theme, glassmorphism card, purple/violet gradient accents
- JWT is stored in localStorage for session persistence across refresh
- Logout button added to the app header, clears token and redirects to login
- Non-admin users see an "Access Denied" screen after login

## Capabilities

### New Capabilities
- `login`: Email + password authentication against test_user.json
- `session-persistence`: JWT stored in localStorage, survives refresh
- `logout`: Clear session, redirect to login page
- `role-gate`: Only tenant_admin users access the app; others see access denied

### Modified Capabilities
- `auth`: `GET /me` now reads JWT instead of auto-loading test user. `require_tenant_admin()` validates JWT token.
- `api-routes`: All routes require Authorization header with Bearer token.

## Impact

- `test_user.json` — restructured from single object to `{ users: [...] }` with password fields
- `backend/app/config.py` — `TestUser` gets password field; `load_test_user()` → `load_users()` / `find_user()`
- `backend/app/api/auth.py` — new `POST /login`, updated `GET /me`, JWT validation
- `backend/app/api/upload.py`, `extraction.py`, `finalize.py` — inject authenticated user via dependency
- `frontend/src/pages/LoginPage.tsx` — new page (Floatify-style dark glassmorphism)
- `frontend/src/pages/LoginPage.css` — standalone dark theme styles
- `frontend/src/api/client.ts` — add `login()`, attach Authorization header to all requests
- `frontend/src/App.tsx` — auth state management, protected routes, logout in header
