# Shared Service Config: Centralized Port and URL Management

**Date:** 2026-04-05
**Status:** Approved

## Problem

All NeoApex services hardcode hostnames, ports, and URLs of other services they depend on. This is scattered across Python config files, TypeScript constants, CORS configurations, and Vite configs. Changing a single port requires updating multiple files across multiple projects.

## Decision

Introduce a single `services.json` at the repo root as the source of truth for all service hostnames and ports. All backends and frontends read from this file. Environment variables override for production deployment.

## Port Mapping

| Service | Port | Block |
|---|---|---|
| LaunchPad frontend | 6000 | 60xx |
| LaunchPad backend | 6010 | 60xx |
| AdminDash frontend | 6100 | 61xx |
| Papermite frontend | 6200 | 62xx |
| Papermite backend | 6210 | 62xx |
| DataCore backend | 6300 | 63xx |

**Pattern:** Each service owns a 100-port block. Frontend = `X00`, backend = `X10`. Customer-facing apps (LaunchPad, AdminDash) get the lowest, cleanest ports.

## services.json

Location: `/NeoApex/services.json` (repo root)

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

## How Services Read the Config

### Python Backends (DataCore, LaunchPad, Papermite)

Each backend reads `services.json` at startup to determine:
- URLs of services it depends on (e.g., DataCore auth URL)
- Frontend origins for CORS configuration

Environment variables override `services.json` values for production.

### React Frontends (LaunchPad, Papermite, AdminDash)

Vite imports `services.json` at build time. Each frontend derives:
- API base URLs for backends it calls
- Its own dev server port (in `vite.config.ts`)

`VITE_` prefixed env vars override at build time for production.

## Changes Per Service

### DataCore backend
- Read `services.json` for its own port
- Build CORS allowed origins dynamically from all frontend entries in config
- Remove hardcoded CORS origins from `api/__init__.py`

### LaunchPad backend
- Read `services.json` for DataCore URL, Papermite frontend URL, own port
- Remove `datacore_auth_url`, `papermite_url`, `port` from `config.py`
- Build CORS allowed origins from frontend entries in config

### Papermite backend
- Read `services.json` for DataCore URL, own port
- Remove `datacore_auth_url` from `config.py`
- Build CORS allowed origins from frontend entries in config

### LaunchPad frontend
- Read `services.json` for LaunchPad backend URL, Papermite frontend URL
- Remove hardcoded `BASE_URL` from `client.ts`
- Remove hardcoded Papermite URL from `App.tsx` and `TenantSettingsPage.tsx`
- Vite dev port from config

### Papermite frontend
- Read `services.json` for Papermite backend URL
- Remove hardcoded `BASE_URL` from `client.ts`
- Remove hardcoded URL from `LoginPage.tsx`
- Vite dev port from config

### AdminDash frontend
- Read `services.json` for DataCore URL, Papermite backend URL
- Remove hardcoded URLs from `client.ts` and `AuthContext.tsx`
- Vite dev port from config

## Environment Variable Overrides

### Backend Environment Variables

#### DataCore
| Variable | Description | Default (from services.json) |
|---|---|---|
| `DATACORE_HOST` | DataCore bind host | `localhost` |
| `DATACORE_PORT` | DataCore bind port | `6300` |
| `DATACORE_JWT_SECRET` | JWT signing secret | `neoapex-dev-secret-change-in-prod` |
| `DATACORE_JWT_EXPIRY_HOURS` | JWT token expiry | `24` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |

#### LaunchPad Backend
| Variable | Description | Default (from services.json) |
|---|---|---|
| `LAUNCHPAD_HOST` | LaunchPad bind host | `localhost` |
| `LAUNCHPAD_PORT` | LaunchPad bind port | `6010` |
| `LAUNCHPAD_DATACORE_URL` | DataCore base URL | `http://localhost:6300` |
| `LAUNCHPAD_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for redirects) | `http://localhost:6200` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |

#### Papermite Backend
| Variable | Description | Default (from services.json) |
|---|---|---|
| `PAPERMITE_HOST` | Papermite bind host | `localhost` |
| `PAPERMITE_PORT` | Papermite bind port | `6210` |
| `PAPERMITE_DATACORE_URL` | DataCore base URL | `http://localhost:6300` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |

### Frontend Environment Variables (VITE_ prefix)

#### LaunchPad Frontend
| Variable | Description | Default (from services.json) |
|---|---|---|
| `VITE_LAUNCHPAD_BACKEND_URL` | LaunchPad backend API URL | `http://localhost:6010` |
| `VITE_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for redirects) | `http://localhost:6200` |

#### Papermite Frontend
| Variable | Description | Default (from services.json) |
|---|---|---|
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend API URL | `http://localhost:6210` |

#### AdminDash Frontend
| Variable | Description | Default (from services.json) |
|---|---|---|
| `VITE_DATACORE_URL` | DataCore API URL | `http://localhost:6300` |
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend API URL | `http://localhost:6210` |
| `VITE_DATACORE_AUTH_URL` | DataCore auth URL | `http://localhost:6300/auth` |

### CORS Configuration

All backends build their CORS allowed origins dynamically by reading the frontend entries from `services.json`:

```python
# Example: builds ["http://localhost:6000", "http://localhost:6100", "http://localhost:6200"]
frontend_services = ["launchpad-frontend", "admindash-frontend", "papermite-frontend"]
cors_origins = [f"http://{svc['host']}:{svc['port']}" for name, svc in config["services"].items() if name in frontend_services]
```

In production, CORS origins can be overridden via environment variable:
| Variable | Description |
|---|---|
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed origins (overrides services.json) |

## README

A `README.md` at the repo root documents:
- Service port mapping table
- `services.json` format and location
- How to change ports for local development
- Backend env var table per service
- Frontend env var table per service (VITE_ prefix)
- Production deployment: how env vars override `services.json`
- CORS configuration
