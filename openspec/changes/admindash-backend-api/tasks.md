## 1. Project scaffolding

- [ ] 1.1 Create `admindash/pyproject.toml` mirroring `launchpad/pyproject.toml`: name `admindash-backend`, Python `>=3.11`, dependencies `fastapi>=0.115`, `uvicorn[standard]>=0.30`, `pydantic>=2.0`, `pydantic-settings>=2.0`, `httpx>=0.28`
- [ ] 1.2 Add `[project.optional-dependencies] dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "respx>=0.21", "httpx>=0.28"]`
- [ ] 1.3 Add `[tool.hatch.build.targets.wheel] packages = ["backend/app"]` matching the launchpad convention
- [ ] 1.4 Create the `admindash/backend/app/` directory tree with `__init__.py` files for `app/`, `app/api/`, and `tests/` — same shape as `launchpad/backend/app/`
- [ ] 1.5 Run `cd admindash && uv sync --extra dev` and verify the lockfile is created and dependencies install cleanly

## 2. Configuration module

- [ ] 2.1 Create `admindash/backend/app/config.py` with a pydantic `Settings` class read by `pydantic-settings`
- [ ] 2.2 Add fields: `environment: str = "development"`, `datacore_url: str = "http://localhost:5800"`, `papermite_backend_url: str = "http://localhost:5710"`, `cors_allowed_origins: list[str] = []`, `port: int = 5610`
- [ ] 2.3 In the settings init or a startup hook, when `environment == "production"`, raise (and let it propagate to a non-zero exit) if `cors_allowed_origins` is empty or contains `*`
- [ ] 2.4 In development mode, default `cors_allowed_origins` to `["http://localhost:5600"]` if env var is not set
- [ ] 2.5 Read all values from environment variables with `pydantic-settings` (no manual `os.environ`)

## 3. Shared HTTP client

- [ ] 3.1 Create `admindash/backend/app/http_client.py` exposing two module-level `httpx.AsyncClient` instances: `datacore_client` (base_url from settings) and `papermite_client` (base_url from settings)
- [ ] 3.2 Configure both with `timeout=30.0` and `follow_redirects=False`
- [ ] 3.3 Add a startup/shutdown hook in `app/main.py` that closes the clients on app shutdown

## 4. Auth dependency

- [ ] 4.1 Create `admindash/backend/app/auth.py` exposing `require_authenticated_user` as a FastAPI dependency
- [ ] 4.2 The dependency reads the `Authorization` header from the request, returns HTTP 401 if missing or not a Bearer token
- [ ] 4.3 The dependency calls `datacore_client.get("/auth/me", headers={"Authorization": auth_header})`, returns HTTP 401 if DataCore returns non-2xx, and returns the parsed user dict from DataCore otherwise
- [ ] 4.4 Cache nothing — every request hits DataCore (per Decision 2 in design.md)
- [ ] 4.5 Make sure the dependency surfaces the original token via the returned object so route handlers can forward it to downstream calls

## 5. Health endpoint

- [ ] 5.1 Create `admindash/backend/app/api/health.py` exposing `GET /api/health` returning `{"status": "ok"}`
- [ ] 5.2 No authentication, no downstream calls

## 6. Auth proxy routes

- [ ] 6.1 Create `admindash/backend/app/api/auth.py` with `POST /auth/login` that reads the request body as bytes, forwards to `datacore_client.post("/auth/login", content=body, headers={"Content-Type": request.headers.get("content-type", "application/json")})`, and returns a `Response` with the same status code, content type, and body
- [ ] 6.2 Add `GET /auth/me` that requires the `Authorization` header (no full validation, just forward), calls `datacore_client.get("/auth/me", headers={"Authorization": auth_header})`, returns the response verbatim. If `Authorization` is missing, return HTTP 401 directly.
- [ ] 6.3 Mount the router at the app root (not under `/api`) so paths are `/auth/login` and `/auth/me` exactly

## 7. Generic query proxy route

- [ ] 7.1 Create `admindash/backend/app/api/query.py` with `POST /api/query` depending on `require_authenticated_user`
- [ ] 7.2 Read the request body as bytes, forward to DataCore `/api/query` with the same body and `Content-Type` header, return the response verbatim (status code, body, content-type)
- [ ] 7.3 On any httpx exception (connect error, timeout), return HTTP 502 with a small JSON body identifying the upstream

## 8. Entity CRUD proxy routes

- [ ] 8.1 Create `admindash/backend/app/api/entities.py` with all five entity endpoints listed in the spec
- [ ] 8.2 Implement `POST /api/entities/{tenant_id}/{entity_type}` (forward to DataCore)
- [ ] 8.3 Implement `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}` (forward to DataCore)
- [ ] 8.4 Implement `POST /api/entities/{tenant_id}/{entity_type}/archive` (forward to DataCore)
- [ ] 8.5 Implement `GET /api/entities/{tenant_id}/{entity_type}/next-id` (forward to DataCore)
- [ ] 8.6 Implement `POST /api/entities/{tenant_id}/{entity_type}/duplicate-check` (forward to DataCore)
- [ ] 8.7 Each route depends on `require_authenticated_user` and reuses a single helper for the proxy logic to avoid copy-paste

## 9. Document extract proxy with multipart streaming

- [ ] 9.1 Create `admindash/backend/app/api/extract.py` with `POST /api/extract/{tenant_id}/student` depending on `require_authenticated_user`
- [ ] 9.2 Read the request as a stream via `request.stream()` (do NOT call `request.body()` or `request.form()`)
- [ ] 9.3 Forward to Papermite using `papermite_client.stream("POST", path, content=request.stream(), headers={"Content-Type": request.headers["content-type"], "Content-Length": request.headers["content-length"]})`
- [ ] 9.4 Stream the Papermite response back to the caller via FastAPI `StreamingResponse`, preserving status code and content-type
- [ ] 9.5 Handle httpx exceptions the same way as the JSON routes (502 with upstream identifier)

## 10. FastAPI app entry point

- [ ] 10.1 Create `admindash/backend/app/main.py` constructing the FastAPI app with title "Admindash Backend" and description from the proposal
- [ ] 10.2 Add `CORSMiddleware` reading allowed origins from `settings.cors_allowed_origins`, `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`
- [ ] 10.3 Include all five routers: health, auth, query, entities, extract
- [ ] 10.4 Add a startup event that triggers settings validation (so production fail-closed CORS check fires on import)
- [ ] 10.5 Add a shutdown event that closes the httpx clients

## 11. Test suite

- [ ] 11.1 Create `admindash/backend/tests/conftest.py` with a fixture that provides a TestClient using `respx` to mock outbound httpx calls
- [ ] 11.2 Add `tests/test_health.py` asserting `GET /api/health` returns 200 with `{"status": "ok"}`
- [ ] 11.3 Add `tests/test_auth.py` covering: (a) `POST /auth/login` forwards body and returns DataCore response, (b) `GET /auth/me` with valid token returns 200, (c) `GET /auth/me` without header returns 401, (d) `GET /auth/me` when DataCore returns 401 returns 401
- [ ] 11.4 Add `tests/test_query.py` covering: (a) authenticated POST forwards body to DataCore and returns response, (b) unauthenticated POST returns 401, (c) DataCore 500 is surfaced as 500 verbatim
- [ ] 11.5 Add `tests/test_entities.py` covering one example each of POST create, PUT update, GET next-id, POST archive, asserting path params are preserved when constructing the downstream URL
- [ ] 11.6 Add `tests/test_extract.py` covering: (a) authenticated multipart upload is streamed to Papermite with content-type and body bytes preserved (capture mock request and assert byte equality), (b) unauthenticated request returns 401
- [ ] 11.7 Add `tests/test_cors.py` covering: (a) dev mode allows `http://localhost:5600`, (b) production mode without `CORS_ALLOWED_ORIGINS` exits non-zero on settings load, (c) production mode with `*` exits non-zero
- [ ] 11.8 Run `cd admindash && uv run pytest -v` and verify all tests pass

## 12. Wire admindash into services.json and start-services.sh

- [ ] 12.1 Add `"admindash-backend": { "host": "localhost", "port": 5610 }` to `services.json`
- [ ] 12.2 Update `start-services.sh`: add `ADMINDASH_BE_PORT=$(read_port "admindash-backend")` near the other port reads
- [ ] 12.3 Add `"admindash-backend:$ADMINDASH_BE_PORT:backend"` to the `SERVICES` array, ordered before `admindash-frontend` so it starts first
- [ ] 12.4 Add an `admindash-backend)` case to the `start_service()` function: `cd "$SCRIPT_DIR/admindash" && uv run uvicorn app.main:app --port "$port"` (note: from `admindash/` because pyproject is there, but app is at `backend/app/main.py` — verify the import path works; may need `--app-dir backend` or to invoke from `admindash/backend/`)
- [ ] 12.5 Run `./start-services.sh` from a clean state and verify the status table shows `admindash-backend` as `running`

## 13. Admindash frontend retargeting

- [ ] 13.1 Replace the contents of `admindash/frontend/src/config.ts` with a single export: `ADMINDASH_API_URL` defaulting to `import.meta.env.VITE_ADMINDASH_API_URL || svcUrl("admindash-backend")`. Remove `DATACORE_URL`, `DATACORE_AUTH_URL`, and `PAPERMITE_BACKEND_URL` exports.
- [ ] 13.2 Update `admindash/frontend/src/contexts/AuthContext.tsx` (and any login-page code) to call `${ADMINDASH_API_URL}/auth/login` and `${ADMINDASH_API_URL}/auth/me` instead of `DATACORE_AUTH_URL`
- [ ] 13.3 Update `admindash/frontend/src/api/*.ts` modules to use `ADMINDASH_API_URL` for every fetch
- [ ] 13.4 Update `admindash/frontend/src/contexts/ModelContext.tsx`, `DashboardContext.tsx`, and any other context that calls DataCore directly
- [ ] 13.5 Update page components (`StudentsPage.tsx`, `ProgramPage.tsx`, `HomePage.tsx`, `LoginPage.tsx`) and any inline fetches to use `ADMINDASH_API_URL`
- [ ] 13.6 Update document extract callers (`AddStudentModal` / `DocumentUpload` components) to call `${ADMINDASH_API_URL}/api/extract/${tenant_id}/student` instead of the Papermite URL
- [ ] 13.7 Run `cd admindash/frontend && npx tsc -b` and fix any type errors introduced by the constant rename
- [ ] 13.8 Run `cd admindash/frontend && npm run lint`

## 14. Verification

- [ ] 14.1 Grep `admindash/frontend/src` for `5800`, `5710`, `DATACORE_URL`, `DATACORE_AUTH_URL`, `PAPERMITE_BACKEND_URL` — assert no matches in source files
- [ ] 14.2 Grep `admindash/frontend/src` for `:5610` or `ADMINDASH_API_URL` — assert there is at least one reference (sanity check the cutover happened)
- [ ] 14.3 Run `cd admindash/frontend && npm run build` and verify it succeeds
- [ ] 14.4 Run `./start-services.sh` from a clean state, then in the browser:
  - Navigate to `http://localhost:5600`
  - Log in with a test user
  - Verify the home page student count loads
  - Navigate to Students, verify the table loads
  - Add a new student via the modal (test create + duplicate-check + next-id)
  - Edit the student (test update)
  - Archive the student (test archive)
  - Upload a document via the AddStudentModal (test multipart extract end-to-end)
- [ ] 14.5 Tail `.logs/admindash-backend.log` during the smoke test and verify the proxy is receiving and forwarding each request, with no unexpected errors

## 15. Documentation

- [ ] 15.1 Update `admindash/CLAUDE.md`:
  - Refresh the stale port references (currently mentions `localhost:8080` and `localhost:8081`)
  - Reframe the "Project Overview" section to position admindash as the **school operations product** for school administrators (not as an internal ops tool)
  - Add a "Backend" section describing the new FastAPI service, port 5610, what it proxies, and how to run it standalone (`cd admindash && uv run uvicorn app.main:app --port 5610 --reload`)
  - Update the "API endpoints" section to reflect the new admindash-backend API surface
- [ ] 15.2 Update top-level `CLAUDE.md`:
  - Change the admindash bullet from "React SPA only (no backend)" to mention the new backend and reframe admindash as the school operations product
  - Update the per-service commands section to add admindash backend dev/test commands
  - Update the data flow section to reflect that admindash now talks to admindash-backend instead of DataCore/Papermite directly
- [ ] 15.3 Add a brief `admindash/backend/README.md` summarizing: what the service does, how to run locally, how to run tests, env vars supported

## 16. Cross-change reference

- [ ] 16.1 Verify that the parallel updates to the parked `deployment-pipeline` change correctly add `admindash-backend` as a fourth public Fly.io app and remove the Cloudflare Access decision for admindash. (The deployment-pipeline change is being updated in the same review pass; this task is just a cross-check before this change is implemented.)
