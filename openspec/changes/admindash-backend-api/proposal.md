## Why

`admindash` is the **school operations product** that school administrators use to manage their schools — students, programs, and enrollment workflows today, with substantially more domain logic landing in the coming months (enrollment state machines, program rules and capacity, role-based access for owners/registrars/teachers, audit trails, server-side validation). It is customer-facing software, not an internal Floatify ops tool. Today it ships as a backend-less React SPA that calls `datacore` (port 5800) and `papermite-backend` (port 5710) directly from the browser, which is fine for the current CRUD-only surface but cannot accommodate the server-side concerns the product needs next: enrollment workflows can't be enforced from a browser, audit logs can't be written by clients, RBAC must be checked server-side, and rate limits can't be controlled by code the user runs.

Building a small dedicated `admindash/backend/` FastAPI service that the SPA calls instead establishes the foundation for the school operations service. It also lets `datacore` go fully private in production (a key requirement from the parked `deployment-pipeline` change), gives admindash a single API origin (simpler CORS, simpler CSP), and creates the codebase that the upcoming enrollment / program / RBAC / audit-logging changes will land into.

This change is deliberately scoped to **phase 1** of that foundation: a thin proxy of the eight DataCore/Papermite endpoints admindash already calls, end-to-end on a laptop, with code organized so domain logic can grow on top of it cleanly. Production hardening, the deploy pipeline, and the actual enrollment/program/RBAC/audit features come in follow-up changes. We want to validate the architecture locally before committing the deployment pipeline to it.

## What Changes

- Add a new `admindash/backend/` Python/FastAPI service running on port 5610 in local development, mirroring the directory layout and tooling conventions of `launchpad/backend/` and `papermite/backend/` exactly — same `app/main.py` + `app/api/` + `app/config.py` shape, same `pyproject.toml` location, same `uv` workflow
- Add `admindash-backend` to `services.json` and to `start-services.sh` so it boots alongside the other services
- Implement the following proxy endpoints, each forwarding to the appropriate downstream service after JWT validation:
  - `POST /auth/login` → DataCore `/auth/login`
  - `GET  /auth/me`    → DataCore `/auth/me`
  - `POST /api/query`  → DataCore `/api/query`
  - `POST /api/entities/{tenant_id}/{entity_type}` → DataCore (create entity)
  - `PUT  /api/entities/{tenant_id}/{entity_type}/{entity_id}` → DataCore (update entity)
  - `POST /api/entities/{tenant_id}/{entity_type}/archive` → DataCore (archive entities)
  - `GET  /api/entities/{tenant_id}/{entity_type}/next-id` → DataCore (next sequential id)
  - `POST /api/entities/{tenant_id}/{entity_type}/duplicate-check` → DataCore (duplicate detection)
  - `POST /api/extract/{tenant_id}/student` → Papermite (multipart document extract)
- Validate every authenticated request by calling `GET {DATACORE_URL}/auth/me` with the caller's bearer token before proxying; reject with HTTP 401 if validation fails
- Stream multipart bodies for the document extract endpoint instead of buffering, so file uploads don't blow memory or rewrap content types
- Add `CORS_ALLOWED_ORIGINS` env var and lock CORS in production mode to an explicit allowlist (fail-closed); allow `localhost:5600` in local dev
- Update `admindash/frontend/src/config.ts` to point at a single `ADMINDASH_API_URL` (default `http://localhost:5610`) and refactor existing `api/*` modules so every fetch targets the new backend instead of DataCore/Papermite directly
- Update `admindash/CLAUDE.md` and the top-level `CLAUDE.md` to reflect the new service, port, and architecture
- Add a minimal pytest suite for `admindash/backend/` covering: auth validation happy/sad paths, one DataCore proxy endpoint per HTTP method, and the multipart extract proxy
- **BREAKING (local dev only)**: After this change, running admindash with `start-services.sh` requires the new admindash backend to be up. The frontend will not function against DataCore/Papermite directly anymore.

## Capabilities

### New Capabilities

- `admindash-backend-api`: A FastAPI service local to `admindash/backend/` that proxies a fixed set of admin operations from the admindash SPA to DataCore and Papermite. Validates the caller's DataCore JWT before forwarding, fails closed on missing CORS config, streams multipart uploads, and exposes a health check endpoint. Includes the corresponding admindash frontend retargeting so the SPA calls only the new backend rather than DataCore/Papermite directly.

### Modified Capabilities

<!-- None — there is no existing capability spec for the admindash frontend or for DataCore/Papermite proxying. -->

## Impact

- **New code**: `admindash/pyproject.toml` and `admindash/backend/app/` containing `main.py`, `config.py`, `auth.py`, `http_client.py`, `api/auth.py`, `api/query.py`, `api/entities.py`, `api/extract.py`, `api/health.py`, plus `tests/`. Roughly 400–500 lines including tests. Same shape as `launchpad/backend/`.
- **Modified files**:
  - `services.json` — add `admindash-backend` entry on port 5610
  - `start-services.sh` — start admindash backend before admindash frontend in dev mode
  - `admindash/frontend/src/config.ts` — replace `DATACORE_URL` / `DATACORE_AUTH_URL` / `PAPERMITE_BACKEND_URL` constants with a single `ADMINDASH_API_URL`
  - `admindash/frontend/src/api/*.ts` (and any inline fetch calls in pages/contexts) — retarget to the new base URL
  - `admindash/CLAUDE.md` — add backend section, refresh stale port references (it currently mentions `localhost:8080` and `localhost:8081` which are out of date)
  - top-level `CLAUDE.md` — note that admindash is no longer "frontend only" and now ships its own backend
- **External dependencies (added to admindash/backend/pyproject.toml)**: `fastapi`, `uvicorn[standard]`, `httpx`, `pydantic`, `pydantic-settings`, plus `pytest`, `pytest-asyncio`, `httpx[testing]`, `respx` for the test suite. No new system packages.
- **Ports**: 5610 added to the local port allocation. Already a free slot; matches the launchpad/papermite (`x500`/`x510`) and admindash (`5600`) numbering convention.
- **Auth flow**: unchanged from the user's perspective. The admindash frontend still stores the JWT in `localStorage['neoapex_token']` and still POSTs to `/auth/login` — the only change is the URL it POSTs to. DataCore continues to be the authoritative JWT issuer.
- **Cross-change dependency**: The parked `deployment-pipeline` change is being updated in parallel with this one to reflect (a) `admindash/backend/` is the fourth deployable Fly.io backend app alongside `datacore`, `launchpad-api`, and `papermite-api`, (b) admindash is a public customer-facing surface like launchpad and papermite (NOT an internal-only tool behind Cloudflare Access — that earlier framing was wrong because admindash users are school administrators, not Floatify employees), and (c) `datacore` can move to the private network because admindash no longer calls it directly.
- **Future cross-product consideration**: A future `familyhub` (parent-facing) and possibly a teacher-facing app are on the roadmap. If they end up needing the same school operations business logic, we'll figure out the right way to share code at that point. We are explicitly NOT pre-building a shared package or a separate service for hypothetical consumers in this change (YAGNI; familyhub may be months away, the teacher app may turn out to be admindash with a role flag, and refactoring is cheaper than predicting).
- **Out of scope**:
  - Production hardening (Cloudflare IP allowlist middleware, fail-closed CORS in production env vars, scoped Fly tokens) — handled in the deployment-pipeline change
  - Adding new admin operations beyond what admindash already calls today
  - Building actual domain logic (enrollment workflows, program rules, RBAC, audit log) — each one is its own follow-up change
  - Pre-building a shared `school_ops/` Python package or a separate `school-ops/` service for hypothetical future consumers
  - Migrating admindash's `localStorage` JWT to httpOnly cookies
  - Hardening the Papermite extract upload path (file size limits, type validation) — separate security pass
  - Updating `apexflow`, `enrollx`, `familyhub`, `sampledoc` placeholder directories
