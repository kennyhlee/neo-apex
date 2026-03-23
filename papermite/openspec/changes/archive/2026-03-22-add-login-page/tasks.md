# Tasks: Add Login Page

## 1. Backend: Config & test data

- [x] 1.1 Add `password` field to `TestUser` model in `config.py`
- [x] 1.2 Add `load_users()` and `find_user_by_email()` methods to `Settings`
- [x] 1.3 Update `test_user.json` to multi-user array format with passwords

## 2. Backend: Login endpoint & JWT

- [x] 2.1 Install `PyJWT` dependency
- [x] 2.2 Create `POST /api/login` endpoint (email + password → JWT)
- [x] 2.3 Add JWT secret and expiry to Settings config

## 3. Backend: Auth dependency injection

- [x] 3.1 Create `get_current_user()` FastAPI dependency (decode JWT from Authorization header)
- [x] 3.2 Create `require_admin()` dependency (check tenant_admin role)
- [x] 3.3 Update `GET /api/me` to use JWT-based auth
- [x] 3.4 Update upload, extraction, and finalize routes to use `Depends(require_admin)`

## 4. Frontend: Login page UI

- [x] 4.1 Create `LoginPage.tsx` with email + password form
- [x] 4.2 Create `LoginPage.css` with Floatify-style dark glassmorphism theme
- [x] 4.3 Add form validation (empty fields) and error display

## 5. Frontend: Auth state & API client

- [x] 5.1 Add `login()` function to `api/client.ts`
- [x] 5.2 Add `authFetch()` helper that attaches Bearer token from localStorage
- [x] 5.3 Update all existing API functions to use `authFetch()`

## 6. Frontend: App shell integration

- [x] 6.1 Update `App.tsx` with auth state (token in localStorage, user in state)
- [x] 6.2 Add protected route logic (no token → login, non-admin → access denied)
- [x] 6.3 Add logout button to app header
- [x] 6.4 Create AccessDenied component for non-admin users

## 7. Verify

- [x] 7.1 Test login with valid admin credentials → app access
- [x] 7.2 Test login with valid non-admin credentials → access denied
- [x] 7.3 Test login with invalid credentials → error message
- [x] 7.4 Test refresh → session persists
- [x] 7.5 Test logout → redirected to login
