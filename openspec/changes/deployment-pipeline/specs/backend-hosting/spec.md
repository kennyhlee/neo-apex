## ADDED Requirements

### Requirement: Each backend runs as a dedicated Fly.io app

The system SHALL host each of `datacore`, `launchpad` backend, `papermite` backend, and `admindash` backend as a distinct Fly.io application. Each app MUST have its own `fly.toml` configuration file committed to the repo at the service root (`datacore/fly.toml`, `launchpad/backend/fly.toml`, `papermite/backend/fly.toml`, `admindash/backend/fly.toml`). Deploying one app MUST NOT cause any other app to be restarted or reconfigured.

#### Scenario: Launchpad deploy does not restart DataCore
- **WHEN** the release pipeline deploys `launchpad-api` to Fly.io
- **THEN** the `datacore` Fly.io app continues running its previous version without any restart or configuration change

#### Scenario: Admindash backend deploy does not restart other backends
- **WHEN** the release pipeline deploys `admindash-backend` to Fly.io
- **THEN** the `datacore`, `launchpad-api`, and `papermite-api` Fly.io apps continue running their previous versions without any restart or configuration change

#### Scenario: Each app has its own fly.toml
- **WHEN** a developer inspects the repo
- **THEN** `datacore/fly.toml`, `launchpad/backend/fly.toml`, `papermite/backend/fly.toml`, and `admindash/backend/fly.toml` each exist and declare a distinct `app =` name

### Requirement: DataCore is reachable only on the Fly private network

The `datacore` Fly.io app SHALL NOT have any public HTTP service defined in its `fly.toml`. It MUST be reachable by sibling Fly.io apps via Fly's internal DNS (`datacore.internal`) on its configured port. There MUST be no public DNS record pointing at the `datacore` app.

#### Scenario: Public request to DataCore is rejected
- **WHEN** an unauthenticated client on the public internet attempts to connect to any `*.fly.dev` or Cloudflare URL for `datacore`
- **THEN** the connection fails because no such public endpoint exists

#### Scenario: Launchpad backend reaches DataCore internally
- **WHEN** the `launchpad-api` Fly.io app makes an HTTP request to `http://datacore.internal:5800/auth/me`
- **THEN** the request reaches the `datacore` app over Fly's private WireGuard network and receives a response

#### Scenario: Admindash backend reaches DataCore internally
- **WHEN** the `admindash-backend` Fly.io app makes an HTTP request to `http://datacore.internal:5800/auth/me`
- **THEN** the request reaches the `datacore` app over Fly's private WireGuard network and receives a response

### Requirement: Public backends only accept traffic from Cloudflare

The `launchpad-api`, `papermite-api`, and `admindash-backend` Fly.io apps SHALL reject any HTTP request whose source IP is not within the current Cloudflare published IP ranges. Rejected requests MUST return HTTP 403.

#### Scenario: Cloudflare-proxied request to launchpad-api succeeds
- **WHEN** a client makes a request to `https://api.launchpad.floatify.com/health` via Cloudflare
- **THEN** Cloudflare forwards the request to the Fly.io origin, the origin sees a Cloudflare source IP, and the app returns a normal response

#### Scenario: Cloudflare-proxied request to admindash-backend succeeds
- **WHEN** a client makes a request to `https://api.admin.floatify.com/api/health` via Cloudflare
- **THEN** Cloudflare forwards the request to the Fly.io origin, the origin sees a Cloudflare source IP, and the app returns a normal response

#### Scenario: Direct-to-origin request is blocked
- **WHEN** an attacker discovers the Fly.io origin IP for any of the public backends and makes a request directly to the Fly machine bypassing Cloudflare
- **THEN** the app returns HTTP 403 because the source IP is not in the Cloudflare IP range

### Requirement: CORS fail-closed in production

Every backend SHALL read the allowed CORS origins from the `CORS_ALLOWED_ORIGINS` environment variable as a comma-separated list of exact origin strings in production. If `CORS_ALLOWED_ORIGINS` is unset or empty in production, the backend MUST refuse to start and exit with a non-zero status and a clear error message. Production builds MUST NOT fall back to a wildcard (`*`) origin.

#### Scenario: Missing CORS env var prevents startup
- **WHEN** a backend is started in production mode without `CORS_ALLOWED_ORIGINS` set
- **THEN** the process exits with a non-zero status and logs an error identifying the missing variable

#### Scenario: Allowed origin request succeeds
- **WHEN** a request arrives at `launchpad-api` from `Origin: https://launchpad.floatify.com` and `CORS_ALLOWED_ORIGINS` includes that exact origin
- **THEN** the response includes `Access-Control-Allow-Origin: https://launchpad.floatify.com`

#### Scenario: Disallowed origin request is blocked
- **WHEN** a request arrives at `launchpad-api` from `Origin: https://evil.example.com` and `CORS_ALLOWED_ORIGINS` does not include that origin
- **THEN** the response does not include an `Access-Control-Allow-Origin` header for that origin and the browser blocks the cross-origin access

### Requirement: DataCore has a persistent volume with daily snapshots

The `datacore` Fly.io app SHALL have a persistent volume mounted at the LanceDB data path. The volume MUST be configured with automatic daily snapshots retained for at least seven days. Snapshot configuration MUST be declared in `fly.toml` or documented such that it is reproducible from an empty Fly.io account.

#### Scenario: Volume persists across deploys
- **WHEN** the release pipeline deploys a new `datacore` image
- **THEN** the new Fly.io machine attaches the same persistent volume and the existing LanceDB data is still available

#### Scenario: Snapshot is created daily
- **WHEN** 24 hours elapse after the last snapshot
- **THEN** Fly.io automatically creates a new volume snapshot for the DataCore volume

### Requirement: Backends use production service URLs via environment variables

In production, each backend SHALL resolve sibling service URLs from environment variables set in its Fly.io app secrets, not from `services.json` defaults. `launchpad`, `papermite`, and `admindash` backends MUST reach `datacore` via `datacore.internal` (private network) and MUST NOT reach `datacore` via any public URL. Similarly, `admindash-backend` MUST reach `papermite-api` via the appropriate internal hostname (`papermite-api.internal` if available, or otherwise the same private network mechanism) and MUST NOT call Papermite via its public URL.

#### Scenario: Launchpad reaches DataCore via internal DNS
- **WHEN** the `launchpad-api` app starts in production
- **THEN** its effective DataCore URL is `http://datacore.internal:5800` (or equivalent, as set in its Fly secrets)

#### Scenario: Admindash backend reaches DataCore via internal DNS
- **WHEN** the `admindash-backend` app starts in production
- **THEN** its effective DataCore URL is `http://datacore.internal:5800` (or equivalent, as set in its Fly secrets)

#### Scenario: services.json fallback is not used in production
- **WHEN** any backend runs in production mode
- **THEN** the backend does not read `services.json` localhost URLs for sibling service resolution

### Requirement: Per-service Dockerfile for reproducible builds

Each backend SHALL have a `Dockerfile` at its service root (`datacore/Dockerfile`, `launchpad/backend/Dockerfile`, `papermite/backend/Dockerfile`, `admindash/backend/Dockerfile`) that builds a runnable image from source. The image MUST run the service as a non-root user and MUST NOT include development dependencies or test fixtures in the final layer.

#### Scenario: Docker build produces a runnable image
- **WHEN** a developer runs `docker build -t datacore-test datacore/` from the repo root
- **THEN** the build succeeds and `docker run datacore-test` starts the service

#### Scenario: Image runs as non-root
- **WHEN** the built image is inspected via `docker inspect`
- **THEN** the `User` field is set to a non-root user

### Requirement: Health check endpoint for Fly.io

Each backend SHALL expose an HTTP endpoint that returns HTTP 200 with a small JSON body when the service is healthy, and the `fly.toml` for that app MUST configure this endpoint as the Fly.io HTTP health check so unhealthy machines are automatically replaced.

#### Scenario: Healthy service returns 200
- **WHEN** Fly.io health checks `/health` on a running backend
- **THEN** the endpoint returns HTTP 200 within the Fly.io health check timeout

#### Scenario: Unhealthy machine is replaced
- **WHEN** a backend Fly.io machine fails its health check consistently over the configured window
- **THEN** Fly.io automatically restarts or replaces the machine without human intervention
