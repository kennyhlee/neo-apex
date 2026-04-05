# Auth Consolidation: DataCore as Auth Server

**Date:** 2026-04-04
**Status:** Approved

## Problem

LaunchPad and Papermite each have independent auth/login modules with separate JWT secrets, both reading from the same DataCore registry table. Papermite works around this with a dual-secret hack that tries both secrets when decoding tokens. AdminDash has a separate dev-only auth using `test_user.json` and sessionStorage. Multiple token issuers create confusion and security risk.

## Decision

Consolidate all authentication into DataCore. DataCore becomes the single token issuer and validator. All apps delegate auth to DataCore's API.

### Why DataCore

- Already owns the user store (registry table) and has an API surface
- All services already depend on DataCore — no new dependency
- Single token issuer eliminates the dual-secret problem
- AdminDash gets real auth without depending on LaunchPad
- Works well with future third-party auth (OAuth callback hosted on DataCore)
- Auth module is extractable into a standalone service later if needed

## DataCore Auth API

| Endpoint | Method | Auth Required | Purpose |
|---|---|---|---|
| `POST /auth/login` | POST | No | Email + password -> JWT + user |
| `GET /auth/me` | GET | Yes (Bearer token) | Validate token, return user |
| `POST /auth/register` | POST | No | Create account (admin role, new tenant) |
| `POST /auth/register/check-email` | POST | No | Check if email domain exists |
| `POST /auth/register/suggest-ids` | POST | No | Generate tenant ID candidates |
| `POST /auth/exchange-code` | POST | Yes (Bearer token) | JWT -> one-time code (30s TTL) |
| `POST /auth/redeem-code` | POST | No | One-time code -> JWT |

### Token Spec

- JWT HS256, single secret (`DATACORE_JWT_SECRET`)
- 24h expiry (configurable via `DATACORE_JWT_EXPIRY_HOURS`)
- Payload: `user_id`, `email`, `tenant_id`, `role`, `exp`

### Exchange Code Spec

- Random string, stored in-memory (dict with TTL)
- Single-use, 30-second expiry
- Cleaned up on redemption or expiry

## DataCore Structure

```
datacore/src/datacore/
  api/
    routes.py         # storage/query endpoints (unchanged)
    auth_routes.py    # /auth router
    server.py         # registers both routers
  auth/
    tokens.py         # JWT creation, validation, secret config
    exchange.py       # in-memory one-time code store with TTL
    passwords.py      # bcrypt hash/verify
  store.py            # unchanged
  query.py            # unchanged
  embedder.py         # unchanged
```

### Separation of Concerns

- `auth/` is a self-contained package — knows nothing about `store.py`, `query.py`, `embedder.py`
- `auth_routes.py` imports from `auth/` for token/password logic, and reads from `store.py` only to look up users in the registry table
- `routes.py` (storage) has zero imports from `auth/` — completely unaware auth exists
- One-way dependency: `auth -> storage`, never `storage -> auth`
- Removing `auth/` + `auth_routes.py` leaves everything else untouched

## Cross-Service Navigation (LaunchPad <-> Papermite)

Uses short-lived exchange codes instead of passing JWTs in URLs:

1. User is in LaunchPad, authenticated
2. LaunchPad calls DataCore `POST /auth/exchange-code` with its JWT -> DataCore returns a one-time code (30s TTL)
3. LaunchPad redirects to Papermite with `?code=<exchange_code>`
4. Papermite calls DataCore `POST /auth/redeem-code` with the code -> DataCore returns the JWT
5. Papermite stores the JWT in localStorage, cleans the URL
6. Same flow in reverse when going back to LaunchPad

Benefits: JWT never appears in URL, browser history, or server logs. Code is single-use and short-lived.

## Changes Per App

### LaunchPad

- **Remove**: `_create_token()`, `_decode_token()`, JWT secret config, login/register endpoints from `auth.py`
- **Replace**: `get_current_user()` calls DataCore `GET /auth/me` with forwarded `Authorization` header
- **Replace**: Login page calls DataCore `POST /auth/login`
- **Replace**: Registration flow calls DataCore `/auth/register/*` endpoints
- **Replace**: Cross-service redirect uses exchange code instead of passing JWT in URL
- **Keep**: `require_role()` stays local, wraps the user returned from DataCore

### Papermite

- **Remove**: `auth.py` login endpoint, `_create_token()`, `_decode_token()`, both JWT secrets, dual-secret hack
- **Replace**: `get_current_user()` calls DataCore `GET /auth/me`
- **Replace**: Login page calls DataCore `POST /auth/login`
- **Replace**: `?token=` URL param -> `?code=` exchange code via `POST /auth/redeem-code`
- **Keep**: `require_admin()` stays local

### AdminDash

- **Remove**: `test_user.json`, sessionStorage-based fake auth in `AuthContext.tsx`
- **Add**: Real login page that calls DataCore `POST /auth/login` (email + password, not username)
- **Add**: `get_current_user()` middleware in backend that calls DataCore `GET /auth/me`
- **Token storage**: `localStorage` (consistent with other apps)

### Frontend Token Key

All apps standardize on `neoapex_token` in `localStorage`.

## Token Validation

All apps validate tokens by calling DataCore `GET /auth/me` (option B). The JWT secret lives only in DataCore. Benefits:

- Secret in one place — no distribution across app configs
- Secret rotation requires updating only DataCore
- Simpler third-party auth integration later
- Latency is negligible since services are co-deployed

## Existing Users and Tokens

- **Users**: No migration needed — all apps already use the same DataCore registry table
- **Tokens**: Existing JWTs will stop working (different secrets). Users log in again. Acceptable: 24h expiry, dev environment, no production users.

## Files Deleted

- `launchpad/test_user.json`
- `admindash/test_user.json`

## Seed Data

DataCore provides a seed mechanism that creates the test user on fresh setups:

- Email: `jane@acme.edu`
- Password: `admin123`
- Role: `admin`
- Tenant: `acme` / `Acme Afterschool`
