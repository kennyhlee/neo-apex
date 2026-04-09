# NeoApex

Multi-service education/enrollment management platform.

## Services

| Service | Description | Port | Block |
|---|---|---|---|
| LaunchPad frontend | Tenant onboarding & admin UI | 5500 | 55xx |
| LaunchPad backend | Tenant lifecycle & identity API | 5510 | 55xx |
| AdminDash frontend | Operations dashboard UI | 5600 | 56xx |
| Papermite frontend | Document ingestion UI | 5700 | 57xx |
| Papermite backend | Document ingestion API | 5710 | 57xx |
| DataCore backend | Storage, query engine & auth server | 5800 | 58xx |

**Port convention:** Each service owns a 100-port block in the `55xx-58xx` range (avoids Chrome-blocked ports and common macOS/dev tool conflicts). Frontend = `X00`, backend = `X10`. Future services continue the pattern: `59xx`, `60xx`, etc.

## Architecture

### Data Model Lifecycle

Entity models (Student, Program, Family, etc.) are defined as typed Python classes in Papermite (`papermite/backend/app/models/domain.py`). These Pydantic models are only used during **data ingestion** — when Papermite extracts structured data from uploaded documents, it validates and transforms the data against these typed models.

Once ingested, Papermite pushes the data and model definitions to DataCore as generic JSON. From that point forward:

- **DataCore** stores entity data and model definitions as versioned JSON blobs in LanceDB. It does not import or enforce Python model classes — storage is schema-flexible.
- **Model definitions** are stored per-tenant with version history (`{tenant_id}_models` table). Each version tracks the entity types, base fields, and custom fields as a JSON structure.
- **All downstream services** (AdminDash, LaunchPad) consume entity data as JSON from DataCore's query API. They do not reference the Python model definitions.

```
Documents → [Papermite] → Typed Pydantic models (validation & extraction)
                              ↓
                         Generic JSON
                              ↓
                        [DataCore] → Versioned JSON storage (LanceDB)
                              ↓
                   JSON API responses
                      ↓           ↓
               [AdminDash]   [LaunchPad]
```

This design means the typed Python models are an ingestion-time concern only. The rest of the platform operates on DataCore's versioned JSON schema, which supports per-tenant customization and field evolution without redeployment.

## Configuration

### services.json

All service hostnames and ports are defined in `services.json` at the repo root:

```json
{
  "services": {
    "launchpad-frontend": { "host": "localhost", "port": 5500 },
    "launchpad-backend": { "host": "localhost", "port": 5510 },
    "admindash-frontend": { "host": "localhost", "port": 5600 },
    "papermite-frontend": { "host": "localhost", "port": 5700 },
    "papermite-backend": { "host": "localhost", "port": 5710 },
    "datacore": { "host": "localhost", "port": 5800 }
  }
}
```

**To change a port for local development**, edit `services.json` and restart the affected services. All services read from this file — no need to update multiple config files.

### Backend Configuration

Python backends read `services.json` at startup. Environment variables override for production deployment.

#### DataCore

| Variable | Description | Default |
|---|---|---|
| `DATACORE_JWT_SECRET` | JWT signing secret | `neoapex-dev-secret-change-in-prod` |
| `DATACORE_JWT_EXPIRY_HOURS` | JWT token expiry in hours | `24` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |
| `DATACORE_DUPLICATE_CHECK_THRESHOLD` | Minimum cosine similarity for duplicate student detection | `0.75` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

#### LaunchPad Backend

| Variable | Description | Default |
|---|---|---|
| `LAUNCHPAD_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:5800/auth` |
| `LAUNCHPAD_DATACORE_API_URL` | DataCore API base URL | `http://localhost:5800/api` |
| `LAUNCHPAD_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for redirects) | `http://localhost:5700` |
| `LAUNCHPAD_PORT` | LaunchPad backend port | `5510` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

#### Papermite Backend

| Variable | Description | Default |
|---|---|---|
| `PAPERMITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:5800/auth` |
| `PAPERMITE_DATACORE_API_URL` | DataCore API base URL | `http://localhost:5800/api` |
| `PAPERMITE_PORT` | Papermite backend port | `5710` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

### Frontend Configuration

React frontends read `services.json` at build time via Vite's JSON import. For production builds, use `VITE_` prefixed environment variables to override.

#### LaunchPad Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_LAUNCHPAD_BACKEND_URL` | LaunchPad backend base URL | `http://localhost:5510` |
| `VITE_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for cross-app navigation) | `http://localhost:5700` |

#### Papermite Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend base URL | `http://localhost:5710` |

#### AdminDash Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_DATACORE_URL` | DataCore API base URL | `http://localhost:5800` |
| `VITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:5800/auth` |
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend base URL | `http://localhost:5710` |

### CORS

All backends build their CORS allowed origins dynamically from the frontend entries in `services.json`. In production, set `CORS_ALLOWED_ORIGINS` as a comma-separated list to override:

```bash
CORS_ALLOWED_ORIGINS=https://app.neoapex.com,https://admin.neoapex.com
```

## Production Deployment

In production (AWS ECS, Lambda, EKS, etc.), `services.json` is not used. Instead:

1. **Backend services** read configuration from environment variables set in the deployment configuration (ECS task definitions, Kubernetes ConfigMaps, etc.)
2. **Frontend apps** are built with `VITE_` env vars injected at build time in CI/CD
3. **CORS origins** are set via `CORS_ALLOWED_ORIGINS` env var on each backend

All services sit behind a reverse proxy/load balancer on port 443 in production.

## Quick Start

### Using the start script (recommended)

```bash
# Default — kills all existing services, starts everything
./start-services.sh

# Interactive mode — prompts to kill existing and choose which to start
./start-services.sh -i
# or
./start-services.sh --interactive
```

The script:
1. Reads ports from `services.json`
2. Checks for services already running on those ports
3. By default, kills all and starts all automatically; with `-i`, asks which to kill/start
4. Starts services in the background
5. Shows a status table when done
6. Logs output to `.logs/` directory (e.g., `.logs/datacore.log`)

### Starting services manually

```bash
# 1. DataCore (port 5800)
cd datacore && uv run uvicorn datacore.api.server:app --port 5800

# 2. LaunchPad backend (port 5510)
cd launchpad/backend && uvicorn app.main:app --port 5510

# 3. Papermite backend (port 5710)
cd papermite/backend && uvicorn app.main:app --port 5710

# 4. LaunchPad frontend (port 5500)
cd launchpad/frontend && npm run dev

# 5. Papermite frontend (port 5700)
cd papermite/frontend && npm run dev

# 6. AdminDash frontend (port 5600)
cd admindash/frontend && npm run dev
```
