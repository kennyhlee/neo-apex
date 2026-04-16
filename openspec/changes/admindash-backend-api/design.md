## Context

`admindash` is the **school operations product** in the Floatify suite. School administrators use it to manage their schools: students, programs, and enrollment workflows today, with enrollment state machines, program rules, RBAC for school-internal roles (owner / registrar / teacher), audit logging, and server-side validation all on the near-term roadmap. It is customer-facing software whose users are school staff at Floatify-customer schools, not Floatify employees.

Today it ships as a backend-less React SPA at `admindash/frontend/`. It calls `datacore` (port 5800) for tenant/entity/auth operations and `papermite-backend` (port 5710) for document extract, both directly from the browser. The JWT lives in `localStorage['neoapex_token']` and is added by client code to every request. This works for the current CRUD-only surface but cannot accommodate the server-side concerns the product needs next: enrollment workflows can't be enforced from a browser, audit logs can't be written by clients, RBAC must be checked server-side, and rate limits can't be controlled by code the user runs.

Other NeoApex services (`launchpad`, `papermite`) follow a `<service>/backend/` + `<service>/frontend/` layout where the backend is FastAPI on Uvicorn, configured via `pydantic_settings`, with CORS read from `services.json` defaults overridable by env vars. We're standing up `admindash/backend/` to match that convention so all four services have the same shape.

This change is **the first slice of the school operations backend**: a thin proxy of the eight DataCore/Papermite endpoints admindash already calls, end-to-end on a laptop. The proxy itself has no business logic — that lands in subsequent changes (enrollment, programs, RBAC, audit). The reason to do this first is to (a) establish the codebase, (b) validate the architecture and the local-dev experience, (c) enable DataCore to move to the private network because admindash no longer calls it directly, and (d) give admindash a single API origin which simplifies CORS, CSP, and the SPA's client code.

A note on the future: `familyhub` (parent-facing) is a placeholder directory in the repo today and a possible teacher-facing app is on the roadmap (and may turn out to be admindash with a role flag rather than a separate frontend). If they end up needing the same school operations logic, we'll figure out how to share code at that point — refactoring is cheaper than predicting. We are explicitly NOT pre-building a shared package or service for hypothetical consumers in this change.

The work is gated to **local development end-to-end** in this change. Production hardening (private network for DataCore, Cloudflare IP allowlist, scoped Fly tokens, fail-closed CORS in env vars) is the parked `deployment-pipeline` change's responsibility, which is being updated in parallel to add admindash-backend as a fourth public customer-facing Fly.io app and to drop the earlier (mistaken) "Cloudflare Access for admindash" framing.

## Goals / Non-Goals

**Goals:**

- A new `admindash/backend/` FastAPI service that runs locally on port 5610 via the existing `start-services.sh` flow
- A 1:1 proxy of every endpoint admindash currently calls on DataCore and Papermite (eight endpoints + `/auth/login` and `/auth/me`), with no semantic changes
- JWT validation on every authenticated request by delegating to DataCore's `/auth/me`, so DataCore remains the single source of truth for authentication
- Streaming passthrough for the multipart `/api/extract/{tenant_id}/student` endpoint so file uploads don't get buffered or re-encoded
- Same directory shape and tooling as `launchpad/backend/` and `papermite/backend/` — `app/main.py` + `app/api/` (for routers) + `app/config.py`, with `pyproject.toml` at the service root
- A small test suite (pytest + `respx` for httpx mocking) covering the auth happy/sad paths and one example proxy per HTTP method, including the multipart case
- The admindash frontend is updated to call only the new backend; no `fetch` from admindash references DataCore or Papermite URLs after this change
- Local dev experience matches launchpad/papermite: `cd admindash && uv sync --extra dev && uv run uvicorn app.main:app --port 5610 --reload` works, and `start-services.sh` boots it as part of the bundle

**Non-Goals:**

- Any production deployment, Dockerfile, fly.toml, or CI work — that's the deployment-pipeline change
- Building actual school operations domain logic (enrollment workflows, program rules, RBAC enforcement, audit log writes) — each domain concern is its own follow-up change
- Pre-building a shared `school_ops/` Python package or a separate `school-ops/` service for hypothetical familyhub/teacher consumers — wait until a second consumer actually exists, then refactor
- Adding new admin operations beyond what admindash already calls
- Server-side authorization beyond "is the JWT valid and unexpired" (the existing DataCore tenant-RBAC continues to enforce data isolation; school-internal RBAC for owner/registrar/teacher roles is a follow-up change)
- Caching `/auth/me` responses (premature; one extra hop per request is fine; revisit when latency or DataCore load justifies it)
- Migrating the JWT out of `localStorage` into httpOnly cookies (architectural change, separate initiative)
- Hardening the Papermite document upload path (file size limits, MIME validation, virus scanning) — separate security pass
- Touching `apexflow`, `enrollx`, `familyhub`, `sampledoc` placeholder directories
- Test framework choice for the frontend (admindash currently has no test framework; this change does not introduce one)

## Decisions

### Decision 1: FastAPI + httpx + pydantic_settings, mirroring `launchpad/backend/`

**Choice:** Use the same Python tooling stack as `launchpad/backend/`: FastAPI as the web framework, Uvicorn for the dev server, `httpx.AsyncClient` for outbound HTTP, `pydantic_settings` for config. Same `app/` layout, same `pyproject.toml` shape, same `uv` dependency management.

**Alternatives considered:**

- **Starlette directly without FastAPI** — smaller but loses the OpenAPI/typed-routes ergonomics. Not worth saving 50 KB of dependency for an internal service.
- **Node/Express** — would let us share code with the React frontend, but introduces a second runtime in the monorepo for one tiny service. Rejected to keep the Python toolchain single-stacked.
- **Cloudflare Workers** — interesting for low cost in production, but we want local-dev parity with the other backends and Workers can't run uvicorn.

**Rationale:** Matching `launchpad/backend/` exactly minimizes cognitive load for anyone who already knows that service, and lets us copy-paste setup (pyproject, Dockerfile in the future, CORS middleware pattern, settings) instead of inventing new conventions. The proxy code itself is small enough that the framework choice barely matters.

### Decision 2: Validate JWT by delegating to DataCore `/auth/me` on every request

**Choice:** For every authenticated request, the backend extracts the bearer token from the `Authorization` header and makes an `httpx` GET to `{DATACORE_URL}/auth/me` with that token. If DataCore returns 200, the request is authenticated; the user object from the response is attached to the request state and the proxy proceeds. If DataCore returns 401, the backend returns 401 to the caller. The backend does **not** load or know the JWT signing secret, and does **not** verify the token signature locally.

**Alternatives considered:**

- **Verify JWT signature locally with a shared HS256 secret** — faster (no extra hop), but means admindash-backend needs the JWT secret in its env and must stay in sync with DataCore key rotation. Adds a coupling we don't need at this scale.
- **Cache `/auth/me` responses for N seconds** — saves the extra hop on bursts of requests, at the cost of a stale-revocation window. Premature for ~2 admin users; revisit later if latency is an issue.
- **Trust the JWT entirely without validation** — strictly worse, never seriously considered.

**Rationale:** Delegating keeps DataCore as the single source of truth. Token revocation, expiry, and any future MFA/session-state lookups happen in one place. The latency cost is one extra HTTP call to localhost in dev, and one extra hop on the Fly internal network in production — both negligible. The simplicity gain (no shared secret, no key rotation coordination) is worth it.

### Decision 3: Pass-through proxy with no request/response shape changes

**Choice:** Each proxy endpoint reads its request body as bytes, forwards the bytes verbatim to the downstream service (DataCore or Papermite), and returns the downstream response bytes verbatim with the original status code, content-type, and content-length. The backend does not deserialize, validate, transform, or filter request or response bodies. The backend does not enforce its own pydantic schemas on the proxied requests.

**Alternatives considered:**

- **Define typed pydantic models for every endpoint up front** — enables OpenAPI docs and per-field validation, but means schema drift if DataCore evolves. We end up duplicating DataCore's contract here. Rejected; can be added endpoint-by-endpoint later if and when it earns its keep.
- **Translate DataCore's response shape into a richer admin-specific shape** — out of scope; the goal is parity with what admindash calls today.

**Rationale:** A thin proxy is harder to break and easier to evolve. If DataCore changes a response shape, admindash needs to be updated regardless — having admindash-backend in the middle shouldn't add a second place to update. The endpoint signatures (path, method, query params) are typed in FastAPI for routing; the bodies are not. When real domain logic is needed in a future change, we'll add it then in whatever shape fits — same way launchpad and papermite have evolved.

### Decision 4: Stream multipart bodies for `/api/extract/{tenant_id}/student`

**Choice:** The extract endpoint reads `request.stream()` and forwards it to Papermite as a streaming `httpx` request, preserving `Content-Type` (including the multipart boundary) and `Content-Length`. The backend does not call `request.body()` or `request.form()`, both of which buffer the entire upload into memory.

**Alternatives considered:**

- **Buffer the upload, parse the multipart form, re-encode it for Papermite** — memory-bound, slow for large PDFs, and risks subtle re-encoding bugs (boundary mismatch, field order changes).
- **Redirect the browser to Papermite directly for this one endpoint** — reintroduces a second API origin, defeating the point of having a single backend.

**Rationale:** Streaming is the only correct answer for proxying file uploads. httpx supports it natively; FastAPI's `Request` exposes `stream()` for exactly this use case. Worth getting right once and never thinking about again.

### Decision 5: Surface downstream errors verbatim

**Choice:** When DataCore or Papermite returns a non-2xx response, the backend returns the same status code and body to the caller. The backend does not coerce 5xx into 502, does not rewrap error JSON, does not redact error messages.

**Alternatives considered:**

- **Translate downstream 5xx into 502/503** — the conventional reverse-proxy behavior. Useful for hiding internal topology, but we don't care about that for an internal admin tool, and developers debugging admindash benefit from seeing the real error.
- **Wrap all errors in a standardized envelope** — extra complexity, no clear benefit.

**Rationale:** The admindash frontend already handles DataCore/Papermite error shapes. Preserving them keeps frontend code unchanged and makes debugging trivial.

### Decision 6: CORS allowlist via env var, with a permissive default for local dev

**Choice:** `app/config.py` reads `CORS_ALLOWED_ORIGINS` as an env-overridable list. Default in local dev is `["http://localhost:5600"]` (the admindash frontend). In production (gated by `ENVIRONMENT=production`), the variable is required and the process exits non-zero if unset or empty. The fail-closed production behavior is enforced now even though we're not deploying yet, because adding it later is easy to forget and the cost of writing it now is one `if` statement.

**Rationale:** Matches the same pattern the deployment-pipeline change requires for all backends. Lets us validate the production behavior in tests now without having to retrofit later.

### Decision 7: Single `ADMINDASH_API_URL` constant in admindash frontend, refactor `api/*` modules

**Choice:** Replace the existing `DATACORE_URL`, `DATACORE_AUTH_URL`, and `PAPERMITE_BACKEND_URL` constants in `admindash/frontend/src/config.ts` with a single `ADMINDASH_API_URL` constant (default `http://localhost:5610`, overridable via `VITE_ADMINDASH_API_URL`). Every `fetch` in `admindash/frontend/src/api/*` (and any inline fetches in pages/contexts) is updated to use this base URL with the path it currently uses on DataCore/Papermite. Path shapes are preserved 1:1 — admindash-backend exposes the same paths as DataCore, so the only change in admindash is the host portion of each URL.

**Alternatives considered:**

- **Keep three separate constants but point them all at admindash-backend** — wastes the cleanup opportunity and leaves dead variable names.
- **Per-feature config (one constant per feature module)** — overengineering for a small SPA.

**Rationale:** One origin = one config knob. The cleanup is mechanical and fits in the same change since it's the only way to validate the proxy works end-to-end.

### Decision 8: pytest + respx for backend tests, no frontend tests in this change

**Choice:** Add a `tests/` directory under `admindash/backend/` with pytest and `respx` (an httpx mock library). Tests cover: auth validation 200/401 paths, one example proxy per HTTP method (POST query, PUT entity, GET next-id, POST archive, multipart extract), CORS fail-closed in production mode. Frontend gets manual smoke testing for now — admindash has no test framework configured today, and adding one is a separate decision out of scope for this change.

**Rationale:** Backend tests are cheap and high-leverage for a proxy. Frontend tests are not cheap (need to set up vitest/playwright/etc.) and the surface area touched in admindash frontend is mechanical retargeting. Manual smoke test on `npm run dev` is sufficient.

## Risks / Trade-offs

- **Extra latency hop on every authenticated request** → Each call now does admindash-backend → DataCore /auth/me → DataCore actual endpoint, instead of admindash → DataCore directly. On localhost this is ~1ms total. On production Fly internal network it's ~2–3ms. Acceptable for an admin tool. Mitigation: cache `/auth/me` per-token for 30 seconds in a follow-up if it ever becomes a problem.
- **Admindash frontend is broken until both halves of this change land** → The frontend retargeting and the backend implementation must ship together. Mitigation: do the work in a feature branch, land both in one merge. The change is small enough that this is fine.
- **Stale admindash CLAUDE.md references to ports 8080/8081** → Pre-existing problem, not introduced by this change. We refresh those references as part of the docs update task, but the rest of admindash CLAUDE.md may have other staleness we don't touch.
- **Single point of failure for admindash** → If admindash-backend is down, the whole admin dashboard is down. This is strictly the same situation as if DataCore is down today (admindash already breaks completely without DataCore), so it's not a regression. Mitigation: in production, Fly health checks restart a crashed admindash-backend machine within seconds.
- **Multipart streaming code paths are easy to get subtly wrong** → Boundary mismatches, content-length truncation, premature stream close. Mitigation: dedicated test for the extract endpoint that posts a real multipart body and asserts the downstream receives it byte-identical.
- **DataCore now sees `localhost:5610` as the origin instead of the browser** → DataCore's CORS config doesn't matter because admindash-backend uses httpx (not a browser), so CORS doesn't apply to backend-to-backend calls. Worth noting so a future maintainer doesn't get confused.
- **No JWT signature validation locally means a forged token passes admindash-backend's check if DataCore is broken** → If DataCore returns 200 to a forged token, admindash-backend trusts it. This is acceptable because if DataCore is compromised, the system is compromised regardless. We are not adding a second validation layer for defense in depth, because the second layer would require duplicating the JWT secret.
- **Adding a service to start-services.sh has historically been error-prone** → Mitigation: include test that hits `http://localhost:5610/health` after a fresh `./start-services.sh` and report a clear error if not reachable.

## Migration Plan

This is greenfield code for the backend; the only "migration" is the admindash frontend cutover.

One-shot cutover. No feature flag, no gradual rollout.

1. **Add the backend with no callers** — write `admindash/backend/` end-to-end with tests, run it locally on 5610, hit it with curl or the OpenAPI Swagger UI to verify each endpoint proxies correctly. At this point admindash frontend still calls DataCore/Papermite directly and works as before.
2. **Refactor admindash frontend in one cut** — replace the three URL constants with `ADMINDASH_API_URL`, update every `fetch` site, run `npm run build` to make sure types still hold, run `npm run dev` and smoke-test the main flows: login, list students, create student, edit student, archive student, document extract. After this step admindash only talks to admindash-backend; there is no fallback path and no feature-flag toggle.
3. **Update `start-services.sh`** to launch admindash backend alongside the others, and update `services.json`.
4. **Update docs** — `admindash/CLAUDE.md`, top-level `CLAUDE.md`.
5. **Smoke test the full local stack** — kill everything, run `./start-services.sh`, walk through the admindash UI end-to-end, verify nothing in admindash code references `:5800` or `:5710` anymore.

**Rollback strategy:**

Local-only change with no production effects. If the cutover breaks something, revert the frontend changes (`git revert` of the admindash/frontend commits) and admindash falls back to calling DataCore/Papermite directly. The `admindash/backend/` directory can be left in place inert — nothing else in the repo depends on it.

## Open Questions

<!-- None at this time. Earlier draft questions about /api/health auth and /api/whoami were resolved by existing convention from launchpad/papermite — see "Resolved during review" below. -->

## Resolved during review

- **Should `/api/health` be authenticated?** No. Follows the launchpad convention: `GET /api/health` is unauthenticated and returns `{"status": "ok"}`. Papermite has no health endpoint at all today, so launchpad is the precedent.
- **Should we add a `/api/whoami` debug endpoint?** No, not needed as a separate endpoint. Launchpad and papermite both expose `GET /api/me` for this purpose, but admindash-backend already proxies `GET /auth/me` (which is the same functionality, just at the path admindash currently calls on DataCore). One endpoint covers the case; no second debug endpoint required.
