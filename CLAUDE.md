# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NeoApex is an education/enrollment management platform. Active services:

- **datacore** — Central storage (LanceDB), query engine, and auth server (JWT/bcrypt). All other services depend on this.
- **launchpad** — Tenant lifecycle, onboarding, and user management. Python backend + React frontend. Customer-facing entry point.
- **papermite** — Document ingestion gateway. Upload documents → AI extraction → model definition finalization. Python backend + React frontend.
- **admindash** — School operations product for school administrators. React frontend (port 5600) + Python FastAPI backend (port 5610). The backend proxies authenticated requests to DataCore and Papermite.
- **ui-tokens** — Shared CSS design tokens package.

Placeholder directories (empty): `apexflow`, `enrollx`, `familyhub`, `sampledoc`.

## Commands

### Start All Services

```bash
./start-services.sh          # Non-interactive: kill existing, start all
./start-services.sh -i       # Interactive: choose which to kill/start
```

### Per-Service Commands

**DataCore** (Python backend):
```bash
cd datacore && uv sync --extra dev          # Install deps
cd datacore && uv run python -m pytest tests/ -v   # Run all tests
cd datacore && uv run python -m pytest tests/test_auth_api.py::test_login_success -v  # Single test
```

**LaunchPad** (Python backend + React frontend):
```bash
cd launchpad/backend && uvicorn app.main:app --port 5510 --reload  # Backend dev
cd launchpad/frontend && npm run dev      # Frontend dev
cd launchpad/frontend && npm run build    # TypeScript check + Vite build
cd launchpad/frontend && npm run lint     # ESLint
```

**Papermite** (Python backend + React frontend):
```bash
cd papermite/backend && uvicorn app.main:app --port 5710 --reload  # Backend dev
cd papermite/frontend && npm run dev      # Frontend dev
cd papermite/frontend && npm run build    # TypeScript check + Vite build
cd papermite/frontend && npm run lint     # ESLint
```

**AdminDash** (Python backend + React frontend):
```bash
cd admindash && uv sync --extra dev                                   # Install backend deps
cd admindash && uv run uvicorn app.main:app --app-dir backend --port 5610 --reload  # Backend dev
cd admindash && uv run pytest backend/tests/ -v                       # Backend tests
cd admindash/frontend && npm run dev                                  # Frontend dev
cd admindash/frontend && npm run build                                # TypeScript check + Vite build
cd admindash/frontend && npm run lint                                 # ESLint
```

## Service Ports

Defined in `services.json` at repo root. All services read from this file.

| Service | Port |
|---|---|
| LaunchPad frontend | 5500 |
| LaunchPad backend | 5510 |
| AdminDash frontend | 5600 |
| AdminDash backend | 5610 |
| Papermite frontend | 5700 |
| Papermite backend | 5710 |
| DataCore backend | 5800 |

To change a port: edit `services.json`, restart affected services.

## Architecture

### Authentication
Centralized in DataCore (`datacore/src/datacore/auth/`). Single JWT issuer. All backends validate tokens by calling `GET /auth/me` on DataCore. Token stored in localStorage as `neoapex_token`. Cross-service navigation uses exchange codes (not JWT in URLs).

### Configuration
- **Backends**: Read `services.json` at startup via helpers in `config.py`. Env vars override (e.g., `LAUNCHPAD_DATACORE_AUTH_URL`).
- **Frontends**: `config.ts` imports `services.json` at build time. `VITE_*` env vars override for production.
- **CORS**: Built dynamically from frontend entries in `services.json`. Override with `CORS_ALLOWED_ORIGINS` env var.

### Data Flow
- DataCore owns all persistent storage (LanceDB with tenant-scoped tables, version history)
- Papermite currently reads/writes model definitions via direct LanceDB access (migration to DataCore HTTP API planned)
- LaunchPad manages users and onboarding via DataCore's registry table
- AdminDash frontend talks only to its own backend (`admindash-backend`) on port 5610. The backend proxies entity/query operations to DataCore and document extract to Papermite, with JWT validation delegated to DataCore.

### Multi-Tenancy
All data tenant-scoped. Tenant ID embedded in JWT. API routes enforce tenant match (`user.tenant_id == request.tenant_id`). Tenant entity must exist in DataCore before dependent operations.

## Conventions

- Each service has its own `CLAUDE.md` with service-specific details (papermite, admindash have them; datacore, launchpad do not yet).
- Backend: FastAPI + Uvicorn, pydantic_settings for config.
- Frontend: React 19 + TypeScript + Vite. Native Fetch API (no axios). CSS variables (no CSS-in-JS). No global state library.
- Always use SSH for git remotes (`git@github.com:` URLs).
- Always use the `superpowers:subagent-driven-development` skill when executing implementation plans with independent tasks.
- Prefer the `/floatify` skill for development workflow: use OpenSpec to write and review specs, then execute with superpowers skills.
- `VOYAGE_API_KEY` and other API keys are in `~/.zshrc`. Run `source ~/.zshrc` if env vars appear missing.
