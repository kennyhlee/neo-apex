## ADDED Requirements

### Requirement: Service runs locally on port 5610

The admindash backend SHALL be a Python FastAPI service located at `admindash/backend/` in the repo. It MUST run via `uvicorn app.main:app` on port 5610 in local development. The service MUST be discoverable via `services.json` under the key `admindash-backend` and MUST be started by `start-services.sh` alongside the other services.

#### Scenario: Service starts via uvicorn
- **WHEN** a developer runs `cd admindash/backend && uv run uvicorn app.main:app --port 5610` from a fresh checkout after `uv sync --extra dev`
- **THEN** the service starts and listens on `http://localhost:5610`

#### Scenario: services.json includes admindash-backend
- **WHEN** a developer reads `services.json` after this change
- **THEN** the file contains an entry `"admindash-backend": { "host": "localhost", "port": 5610 }`

#### Scenario: start-services.sh launches admindash-backend
- **WHEN** a developer runs `./start-services.sh` from a clean state
- **THEN** the admindash-backend process starts before the admindash frontend and is reachable on port 5610 within the script's startup window

### Requirement: Health check endpoint

The admindash backend SHALL expose `GET /api/health` returning HTTP 200 with a JSON body indicating the service is up. The endpoint MUST NOT require authentication and MUST NOT make any downstream HTTP calls.

#### Scenario: Anonymous health check succeeds
- **WHEN** an anonymous client sends `GET http://localhost:5610/api/health`
- **THEN** the response is HTTP 200 with body `{"status": "ok"}` (or equivalent JSON)

### Requirement: Auth proxy endpoints

The admindash backend SHALL expose `POST /auth/login` and `GET /auth/me` endpoints that forward to DataCore's corresponding endpoints. The login endpoint MUST forward the entire request body to DataCore unmodified and return DataCore's response unmodified. The `/auth/me` endpoint MUST require an `Authorization: Bearer <token>` header, forward it to DataCore, and return DataCore's response unmodified.

#### Scenario: Login is forwarded to DataCore
- **WHEN** a client sends `POST /auth/login` with a JSON body `{"email": "u@example.com", "password": "..."}`
- **THEN** the admindash backend forwards the same body to `{DATACORE_URL}/auth/login` and returns DataCore's response (status code, body, content-type) verbatim to the client

#### Scenario: /auth/me is forwarded with the bearer token
- **WHEN** a client sends `GET /auth/me` with `Authorization: Bearer <token>`
- **THEN** the admindash backend forwards the same header to `{DATACORE_URL}/auth/me` and returns the response verbatim

#### Scenario: /auth/me without a token returns 401
- **WHEN** a client sends `GET /auth/me` with no `Authorization` header
- **THEN** the admindash backend returns HTTP 401 without calling DataCore

### Requirement: JWT validation for protected endpoints

For every endpoint other than `/api/health`, `/auth/login`, and `/auth/me`, the admindash backend SHALL validate the caller's bearer token by sending `GET {DATACORE_URL}/auth/me` with the same `Authorization` header before forwarding the request. If DataCore returns any non-2xx response, the admindash backend MUST return HTTP 401 to the caller and MUST NOT forward the original request.

#### Scenario: Valid token is forwarded
- **WHEN** a client calls `POST /api/query` with `Authorization: Bearer <valid-token>`
- **THEN** the admindash backend first calls DataCore `/auth/me` with that token, receives HTTP 200, and only then forwards the original `POST /api/query` to DataCore

#### Scenario: Invalid token is rejected
- **WHEN** a client calls `POST /api/query` with `Authorization: Bearer <expired-or-bad-token>`
- **THEN** DataCore `/auth/me` returns HTTP 401, the admindash backend returns HTTP 401 to the caller, and no forwarded `POST /api/query` is made

#### Scenario: Missing Authorization header is rejected
- **WHEN** a client calls `POST /api/query` with no `Authorization` header
- **THEN** the admindash backend returns HTTP 401 without calling DataCore

### Requirement: Generic SQL query proxy

The admindash backend SHALL expose `POST /api/query` that forwards the request body to DataCore's `/api/query` endpoint after JWT validation, and returns DataCore's response (status code, headers content-type, body) verbatim.

#### Scenario: Valid query is forwarded
- **WHEN** an authenticated client sends `POST /api/query` with body `{"tenant_id": "t1", "table": "entities", "sql": "SELECT * FROM entities LIMIT 10"}`
- **THEN** the admindash backend forwards this body to DataCore `/api/query` and returns DataCore's response unchanged

#### Scenario: DataCore error is surfaced
- **WHEN** DataCore returns HTTP 400 with an error body for a malformed query
- **THEN** the admindash backend returns the same HTTP 400 with the same error body to the caller

### Requirement: Entity CRUD proxy endpoints

The admindash backend SHALL expose the following entity endpoints, forwarding each to DataCore unchanged after JWT validation:

- `POST /api/entities/{tenant_id}/{entity_type}` (create entity)
- `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}` (update entity)
- `POST /api/entities/{tenant_id}/{entity_type}/archive` (archive entities)
- `GET /api/entities/{tenant_id}/{entity_type}/next-id` (next sequential id)
- `POST /api/entities/{tenant_id}/{entity_type}/duplicate-check` (duplicate detection)

For each endpoint, path parameters MUST be preserved verbatim when constructing the downstream URL, and request/response bodies MUST be passed through unchanged.

#### Scenario: Create entity is forwarded with path params preserved
- **WHEN** an authenticated client sends `POST /api/entities/tenant_123/student` with a JSON body
- **THEN** the admindash backend sends `POST {DATACORE_URL}/api/entities/tenant_123/student` with the same body and returns DataCore's response verbatim

#### Scenario: Update entity preserves the entity id
- **WHEN** an authenticated client sends `PUT /api/entities/tenant_123/student/stu_456` with a JSON body
- **THEN** the admindash backend sends `PUT {DATACORE_URL}/api/entities/tenant_123/student/stu_456` with the same body and returns DataCore's response verbatim

#### Scenario: Next-id endpoint is forwarded as GET
- **WHEN** an authenticated client sends `GET /api/entities/tenant_123/student/next-id`
- **THEN** the admindash backend sends `GET {DATACORE_URL}/api/entities/tenant_123/student/next-id` and returns the response verbatim

### Requirement: Document extract proxy with multipart streaming

The admindash backend SHALL expose `POST /api/extract/{tenant_id}/student` that forwards a multipart file upload to Papermite's `/api/extract/{tenant_id}/student` endpoint after JWT validation. The request body MUST be streamed (not buffered into memory) and the original `Content-Type` header (including the multipart boundary) and `Content-Length` MUST be preserved on the forwarded request.

#### Scenario: Multipart upload is streamed end-to-end
- **WHEN** an authenticated client sends `POST /api/extract/tenant_123/student` with a multipart body containing a 10 MB PDF file and `Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryXYZ`
- **THEN** the admindash backend forwards the body as a stream to `{PAPERMITE_BACKEND_URL}/api/extract/tenant_123/student` with the same `Content-Type` (including the same boundary) and `Content-Length` headers, and Papermite receives a body byte-identical to the original

#### Scenario: Extract response is returned verbatim
- **WHEN** Papermite returns HTTP 200 with extracted student fields as JSON
- **THEN** the admindash backend returns the same status code, content-type, and body to the caller

#### Scenario: Extract endpoint requires auth
- **WHEN** a client sends `POST /api/extract/tenant_123/student` with no Authorization header
- **THEN** the admindash backend returns HTTP 401 without calling Papermite

### Requirement: Configurable downstream URLs

The admindash backend SHALL read the DataCore base URL from the environment variable `DATACORE_URL` and the Papermite base URL from `PAPERMITE_BACKEND_URL`. If unset, the defaults MUST come from `services.json` (`http://localhost:5800` for DataCore and `http://localhost:5710` for Papermite). The service MUST be runnable in production by overriding both variables with private-network URLs.

#### Scenario: Defaults match services.json in dev
- **WHEN** the admindash backend starts with no `DATACORE_URL` or `PAPERMITE_BACKEND_URL` env vars set
- **THEN** the effective DataCore URL is `http://localhost:5800` and the effective Papermite URL is `http://localhost:5710`

#### Scenario: Env var overrides take effect
- **WHEN** the admindash backend starts with `DATACORE_URL=http://datacore.internal:5800`
- **THEN** all proxied requests go to `http://datacore.internal:5800` instead of the localhost default

### Requirement: CORS allowlist with fail-closed production mode

The admindash backend SHALL read allowed CORS origins from the environment variable `CORS_ALLOWED_ORIGINS` as a comma-separated list of exact origin strings. In local development (`ENVIRONMENT` unset or `ENVIRONMENT=development`), the default MUST allow `http://localhost:5600`. In production (`ENVIRONMENT=production`), `CORS_ALLOWED_ORIGINS` MUST be required; if it is unset or empty, the process MUST exit with a non-zero status code and log an error identifying the missing variable. Wildcard (`*`) origins MUST NOT be permitted in production mode.

#### Scenario: Local dev allows admindash frontend by default
- **WHEN** the backend starts with no environment overrides on a developer machine
- **THEN** requests from `Origin: http://localhost:5600` are allowed by CORS

#### Scenario: Production mode without CORS_ALLOWED_ORIGINS exits
- **WHEN** the backend is started with `ENVIRONMENT=production` and `CORS_ALLOWED_ORIGINS` unset
- **THEN** the process exits with a non-zero status code before serving any requests, and an error message identifies the missing variable

#### Scenario: Production wildcard is rejected
- **WHEN** the backend is started with `ENVIRONMENT=production` and `CORS_ALLOWED_ORIGINS=*`
- **THEN** the process exits with a non-zero status code and an error message identifying the wildcard as disallowed in production

### Requirement: Downstream errors are surfaced verbatim

For all proxied endpoints, when the downstream service (DataCore or Papermite) returns a non-2xx response, the admindash backend SHALL return the same status code, the same response body, and the same `Content-Type` header to the caller. The backend MUST NOT translate downstream 5xx errors into 502/503, MUST NOT redact or rewrap downstream error bodies, and MUST NOT add its own error envelope.

#### Scenario: DataCore 500 is returned as 500
- **WHEN** DataCore returns HTTP 500 with body `{"error": "internal server error"}` for a proxied query
- **THEN** the admindash backend returns HTTP 500 with the same body and content-type

#### Scenario: DataCore 422 validation error is returned as 422
- **WHEN** DataCore returns HTTP 422 with a pydantic validation error body for a malformed entity create
- **THEN** the admindash backend returns HTTP 422 with the same body

### Requirement: Admindash frontend calls only the new backend

After this change, every HTTP call originating from `admindash/frontend/src/` (including `api/`, `pages/`, `contexts/`, `components/`, and `hooks/`) MUST target `ADMINDASH_API_URL` (default `http://localhost:5610`). The frontend MUST NOT contain any reference to `DATACORE_URL`, `DATACORE_AUTH_URL`, `PAPERMITE_BACKEND_URL`, `:5800`, or `:5710` after this change.

#### Scenario: Search for old URLs returns no results in admindash frontend
- **WHEN** a developer greps `admindash/frontend/src/` for `5800`, `5710`, `DATACORE_URL`, `DATACORE_AUTH_URL`, or `PAPERMITE_BACKEND_URL`
- **THEN** no matches are found in source files (matches in `node_modules`, generated files, or comments documenting the migration are acceptable)

#### Scenario: Single config constant is used
- **WHEN** a developer reads `admindash/frontend/src/config.ts`
- **THEN** the file exports a single `ADMINDASH_API_URL` constant that defaults to `http://localhost:5610` and accepts `VITE_ADMINDASH_API_URL` as an override

#### Scenario: Login still works end-to-end
- **WHEN** a user logs into admindash from the browser after this change with valid credentials
- **THEN** the browser sends `POST http://localhost:5610/auth/login`, admindash backend forwards to DataCore, the response (with JWT) is returned, and admindash stores the token in `localStorage['neoapex_token']` as before

### Requirement: Backend test suite covers auth and proxy paths

The admindash backend SHALL include a `tests/` directory with pytest-based tests covering at minimum: (1) successful JWT validation against a mocked DataCore `/auth/me`, (2) failed JWT validation returning 401, (3) one example of each HTTP method proxy (POST query, PUT entity update, GET next-id, POST archive), (4) the multipart extract proxy verifying body bytes are forwarded unchanged, (5) downstream error pass-through (e.g., DataCore 500 surfaced as 500), (6) CORS production fail-closed behavior. Tests MUST use `respx` (or equivalent) to mock outbound httpx calls so they run with no live DataCore/Papermite dependency.

#### Scenario: Tests pass on a fresh checkout
- **WHEN** a developer runs `cd admindash/backend && uv run pytest -v` after `uv sync --extra dev`
- **THEN** all tests pass without requiring DataCore or Papermite to be running

#### Scenario: Multipart test asserts byte-identical forwarding
- **WHEN** the multipart extract test runs
- **THEN** it sends a known multipart body to the admindash backend, captures the body the mocked Papermite receives, and asserts the captured bytes equal the original input bytes
