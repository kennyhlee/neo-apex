# Design: Add Login Page

## Context

Papermite currently auto-loads a single test user from `test_user.json` with no credential check. The app has a warm light theme (DM Mono/DM Sans, amber accent). The login page will contrast this with a dark Floatify-inspired aesthetic, then transition to the existing light app shell on login.

## Goals / Non-Goals

**Goals:**
- Email + password authentication against test_user.json
- JWT-based session persisted in localStorage
- Floatify-style login page (dark, glassmorphism, purple/violet gradient)
- Role-based access control (tenant_admin required)
- Multi-user test config for dev testing
- Logout button in app header

**Non-Goals:**
- Production-grade auth (OAuth, SSO, password hashing) — this is dev/test tooling
- User registration or password reset
- Token refresh / rotation — simple expiry is sufficient
- Rate limiting on login attempts

## Decisions

### Decision 1: JWT with PyJWT, static secret

Use `PyJWT` library with a static secret key (from env or hardcoded default for dev). Token payload: `{ user_id, email, tenant_id, role, exp }`. Expiry: 24 hours.

**Why:** Simplest stateless auth that works across refresh. No database session table needed. PyJWT is lightweight with no extra dependencies.

### Decision 2: test_user.json becomes multi-user with plain text passwords

```json
{
  "users": [
    {
      "user_id": "u-001",
      "name": "Jane Admin",
      "email": "jane@acme.edu",
      "password": "admin123",
      "tenant_id": "acme",
      "tenant_name": "Acme Afterschool",
      "role": "tenant_admin"
    },
    {
      "user_id": "u-002",
      "name": "Bob Viewer",
      "email": "bob@acme.edu",
      "password": "viewer123",
      "tenant_id": "acme",
      "tenant_name": "Acme Afterschool",
      "role": "viewer"
    }
  ]
}
```

**Why:** Plain text is fine for dev-only test config. Array enables testing admin vs non-admin flows.

### Decision 3: FastAPI Dependency Injection for auth

Replace the current `require_tenant_admin()` function-call pattern with a FastAPI `Depends()` that reads the Authorization header, decodes JWT, and returns the user. This is cleaner and follows FastAPI conventions.

```python
def get_current_user(authorization: str = Header(...)) -> TestUser:
    # decode JWT, find user, return

def require_admin(user: TestUser = Depends(get_current_user)) -> TestUser:
    # check role, return user with tenant_id
```

### Decision 4: Login page as standalone dark island

The login page uses its own scoped CSS with a dark color palette inspired by Floatify:
- Background: deep dark (`#0F0A1A`) with radial gradient purple glows
- Card: glassmorphism (semi-transparent `rgba(255,255,255,0.05)`, backdrop-blur, subtle border)
- Button: purple-to-violet gradient with hover lift
- Typography: Inter (or fall back to existing DM Sans) with bold heading

The rest of the app keeps its existing light theme. This creates a clear visual distinction between the auth gate and the workspace.

### Decision 5: Frontend auth flow in App.tsx

```
App.tsx
├── Check localStorage for token
├── If token: GET /me → success → set user state → show app
│                     → 401 → clear token → show login
├── If no token: show LoginPage
├── On login success: store token + set user → show app
├── On logout: clear token + user → show login
└── If user.role !== tenant_admin: show AccessDenied
```

### Decision 6: API client adds Authorization header

`client.ts` exports a helper that attaches the Bearer token from localStorage to all fetch requests. The `login()` function is the only unauthenticated call.
