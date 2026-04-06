# NeoApex

Multi-service education/enrollment management platform.

## Services

| Service | Description | Port | Block |
|---|---|---|---|
| LaunchPad frontend | Tenant onboarding & admin UI | 6000 | 60xx |
| LaunchPad backend | Tenant lifecycle & identity API | 6010 | 60xx |
| AdminDash frontend | Operations dashboard UI | 6100 | 61xx |
| Papermite frontend | Document ingestion UI | 6200 | 62xx |
| Papermite backend | Document ingestion API | 6210 | 62xx |
| DataCore backend | Storage, query engine & auth server | 6300 | 63xx |

**Port convention:** Each service owns a 100-port block. Frontend = `X00`, backend = `X10`.

## Configuration

### services.json

All service hostnames and ports are defined in `services.json` at the repo root:

```json
{
  "services": {
    "launchpad-frontend": { "host": "localhost", "port": 6000 },
    "launchpad-backend": { "host": "localhost", "port": 6010 },
    "admindash-frontend": { "host": "localhost", "port": 6100 },
    "papermite-frontend": { "host": "localhost", "port": 6200 },
    "papermite-backend": { "host": "localhost", "port": 6210 },
    "datacore": { "host": "localhost", "port": 6300 }
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
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

#### LaunchPad Backend

| Variable | Description | Default |
|---|---|---|
| `LAUNCHPAD_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `LAUNCHPAD_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for redirects) | `http://localhost:6200` |
| `LAUNCHPAD_PORT` | LaunchPad backend port | `6010` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

#### Papermite Backend

| Variable | Description | Default |
|---|---|---|
| `PAPERMITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `PAPERMITE_PORT` | Papermite backend port | `6210` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

### Frontend Configuration

React frontends read `services.json` at build time via Vite's JSON import. For production builds, use `VITE_` prefixed environment variables to override.

#### LaunchPad Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_LAUNCHPAD_BACKEND_URL` | LaunchPad backend base URL | `http://localhost:6010` |
| `VITE_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for cross-app navigation) | `http://localhost:6200` |

#### Papermite Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend base URL | `http://localhost:6210` |

#### AdminDash Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_DATACORE_URL` | DataCore API base URL | `http://localhost:6300` |
| `VITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend base URL | `http://localhost:6210` |

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
# 1. DataCore (port 6300)
cd datacore && uv run python3 -c "
from datacore import Store, create_app
from datacore.auth.seed import seed_test_user
import uvicorn
store = Store()
seed_test_user(store)
app = create_app(store)
uvicorn.run(app, host='127.0.0.1', port=6300)
"

# 2. LaunchPad backend (port 6010)
cd launchpad/backend && uvicorn app.main:app --port 6010

# 3. Papermite backend (port 6210)
cd papermite/backend && uvicorn app.main:app --port 6210

# 4. LaunchPad frontend (port 6000)
cd launchpad/frontend && npm run dev

# 5. Papermite frontend (port 6200)
cd papermite/frontend && npm run dev

# 6. AdminDash frontend (port 6100)
cd admindash/frontend && npm run dev
```

Test login: `jane@acme.edu` / `admin123`
