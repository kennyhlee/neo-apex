## Context

Admindash authenticates against a static `test_user.json` file — the login form takes username + password and compares them client-side. This was a dev-only placeholder. Meanwhile, LaunchPad registers users into DataCore's global `registry` table with bcrypt-hashed passwords, and papermite already authenticates against that registry via `POST /api/login` (email + password → JWT + user object).

Admindash needs to align with the rest of the NeoApex ecosystem: email-based login, backed by the same DataCore registry, with JWT-based sessions.

The Admindash frontend is a React SPA that calls its API server at `localhost:8080`. There is no backend code in this repo — only the frontend.

## Goals / Non-Goals

**Goals:**
- Switch login form from username to email
- Replace static credential check with a real `POST /api/login` API call
- Store JWT token and use it for authenticated requests
- Match the login API contract that papermite established (email/password → token/user)
- Update all related UI, i18n, and type definitions

**Non-Goals:**
- Implementing the backend `POST /api/login` endpoint (that lives in the API server repo, not here)
- Adding registration/signup flow
- Adding password reset or "forgot password" flow
- Implementing token refresh — use a long-lived token for now (matches papermite)
- Changing the Google login placeholder (remains a stub)

## Decisions

### 1. Call `POST /api/login` on existing API server (localhost:8080)

**Decision**: The frontend calls `POST http://localhost:8080/api/login` with `{email, password}` and expects `{token, user}` back — same contract as papermite's backend.

**Alternatives considered**:
- Call DataCore directly (localhost:8081) — rejected because doing bcrypt verification client-side is insecure, and the frontend should never touch password hashes
- Call papermite's endpoint (localhost:8000) — rejected because Admindash shouldn't depend on papermite being up; each app calls its own API server

**Rationale**: The API server at :8080 is already the established gateway for Admindash. Adding a `/api/login` endpoint there (backed by DataCore registry) is the natural fit. The backend work is out of scope for this frontend change, but the contract is well-defined.

### 2. JWT stored in localStorage (key: `admindash_token`)

**Decision**: Store the JWT in `localStorage` and the user object separately. Include the token as `Authorization: Bearer {token}` on all API requests.

**Alternatives considered**:
- Keep using sessionStorage — rejected because it doesn't persist across tabs, and papermite uses localStorage for consistency
- HttpOnly cookies — rejected because it would require backend cookie-setting and CORS changes; overkill for a dev/internal tool

**Rationale**: Matches papermite's approach. localStorage persists across tabs and browser restarts, which is the expected behavior for a dashboard app.

### 3. AuthContext refactored to async login

**Decision**: Change `login()` from a synchronous boolean return to an async function that calls the API and returns success/failure. The `ready` flag remains for initial state loading (now checks localStorage for existing token instead of fetching test_user.json).

**Rationale**: The current synchronous login is only possible because credentials are compared locally. A real API call is inherently async.

### 4. Retain `test_user.json` as documentation only

**Decision**: Keep `test_user.json` in the repo as a reference for dev setup (which credentials to register in DataCore), but remove it from the auth flow entirely. AuthContext no longer fetches or uses it.

**Alternatives considered**:
- Delete it entirely — risky because new developers wouldn't know what credentials to use
- Keep it as a fallback — rejected because it defeats the purpose of real auth

## Risks / Trade-offs

- **Backend dependency**: This frontend change assumes `POST /api/login` exists on the API server. Until that endpoint is implemented, login will fail. → Mitigation: Document the expected API contract clearly; the endpoint follows papermite's proven pattern.
- **No token refresh**: Tokens expire (24h in papermite). If Admindash uses the same expiry, users will be logged out after 24h with no automatic refresh. → Mitigation: Acceptable for an internal admin tool; can add refresh later.
- **localStorage security**: JWT in localStorage is accessible to XSS. → Mitigation: This is an internal tool, not public-facing. Matches papermite's approach. CSP headers on the API server provide additional protection.
