# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NeoApex is an education/enrollment management platform. Active services:

- **datacore** — Central storage (LanceDB), query engine, and auth server (JWT/bcrypt). All other services depend on this.
- **launchpad** — Tenant lifecycle, onboarding, and user management. Python backend + React frontend. Customer-facing entry point.
- **papermite** — Document ingestion gateway. Upload documents → AI extraction → model definition finalization. Python backend + React frontend.
- **admindash** — School operations product for school administrators. React frontend (port 5600) + Python FastAPI backend (port 5610). The backend proxies authenticated requests to DataCore, Papermite, and ApexFlow (staff-side workflow definitions/instances — a Workflows area lists definitions, shows a per-definition pipeline board, and drives a staff-assisted entry flow). The Workflows list is an operations surface, not an authoring one: one row per workflow (not per version), archived and never-published workflows hidden, no lifecycle controls, and columns limited to what an operator acts on — intake, entry channel, open work items, and a needs-attention count reused from the `/attention` fetch. Each workflow has a "Work items" tab beside the pipeline board — the only surface where closed and frozen work items are reachable, with filters plus per-row and bulk cancel.
- **apexflow** — workflow platform: admin-defined operational workflows (registration, signup, ...) built on tenant entity models. React frontend (port 5900, Phase 2) + Python FastAPI backend (port 5910). Lineage lifecycle is a ladder: `active --deprecate-> deprecated --archive-> archived`, reversed by `reactivate`/`unarchive`. `retired` is accepted on read as a legacy alias for `archived` (`definitions.is_archived` is the single definition — never string-compare either value). Archive is reachable ONLY from `deprecated` (409 `not_deprecated` otherwise) — deprecating is the window in which mid-flight work drains. Whatever is still in flight when the archive lands is FROZEN (a `frozen_at` stamp; `state` is untouched, so thawing restores nothing), and `unarchive` thaws it and returns the lineage to `deprecated`. There is deliberately no destructive archive variant — `cancel_instance` is the only way a work item ends outside its machine's terminal states, and it is per-item and explicit. A `draft` definition can be deleted outright (`delete` action → DataCore's row-level soft delete); `published`/`superseded` rows cannot, since instances pin to them.
- **familyhub** — Family-facing workflow channel: parent workflow runtime and parent hub, generalized over any published tenant workflow (currently registration) rather than hardcoded to one. React frontend (port 5620) + Python FastAPI backend (port 5630). Deliberately has no staff auth surface.
- **ui-tokens** — Shared CSS design tokens package.
- **workflow-forms** — Shared workflow form-rendering engine (`@neoapex/workflow-forms`), not a service. Owns `StepRenderer`, section layout (rail/accordion), field validation, `evaluateCondition` (the client-side twin of the backend's `show_if`), draft↔section-answer conversion, its own i18n, and `itemStatus.generated.ts` (generated from the Python `ItemStatus` enum). Consumed by **three** frontends — familyhub (parent self-serve), admindash (staff-assisted entry), apexflow (designer preview) — so that all three render an identical form from an identical definition. A divergence here is a correctness bug, not a cosmetic one.

  **Build trap:** it is linked as `"@neoapex/workflow-forms": "file:../../workflow-forms"`, which npm **symlinks** rather than copies, so its `react` resolves from its OWN `node_modules`. CI must run `npm ci` inside `workflow-forms` *before* any frontend build or the build fails with `TS2307: Cannot find module 'react'` (`.github/workflows/deploy.yml` does this in three jobs). Locally the directory already has `node_modules`, so **a green local frontend build does not prove CI will pass.**

Placeholder directories (empty): `sampledoc`.

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
| FamilyHub frontend | 5620 |
| FamilyHub backend | 5630 |
| Papermite frontend | 5700 |
| Papermite backend | 5710 |
| DataCore backend | 5800 |
| ApexFlow frontend | 5900 |
| ApexFlow backend | 5910 |

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
- AdminDash frontend talks only to its own backend (`admindash-backend`) on port 5610. The backend proxies entity/query operations to DataCore, document extract to Papermite, and workflow definition/instance/document operations to ApexFlow, with JWT validation delegated to DataCore.

### Multi-Tenancy
All data tenant-scoped. Tenant ID embedded in JWT. API routes enforce tenant match (`user.tenant_id == request.tenant_id`). Tenant entity must exist in DataCore before dependent operations.

## Deployment

NeoApex deploys to Fly.io (Python backends) and Cloudflare Workers with Static Assets (React frontends) via a GitHub Actions release-tag-triggered pipeline.

**Topology:** `datacore` is on Fly's private network only. `launchpad-api`, `papermite-api`, and `admindash-api` are public Fly.io apps fronted by Cloudflare with an IP allowlist middleware. The three frontends are Cloudflare Workers (Static Assets) at `launchpad.floatify.com`, `papermite.floatify.com`, and `admin.floatify.com`. The API endpoints follow the **frontend** subdomain, not the module name — `api.launchpad.floatify.com`, `api.papermite.floatify.com`, and `api.admin.floatify.com` (admindash). `api.admindash.floatify.com` does not exist. The authoritative values are the `VITE_*_API_URL` env vars in `.github/workflows/deploy.yml`.

**Release trigger:** publish a GitHub Release with a module-prefixed tag (`datacore-v*`, `launchpad-v*`, `papermite-v*`, `admindash-v*`). The `.github/workflows/deploy.yml` workflow parses the tag, dispatches to per-module deploy jobs, and requires manual approval via the `production` GitHub Environment before any deploy step runs.

**Docs:**
- [`docs/deployment/architecture.md`](docs/deployment/architecture.md) — topology diagram, trust boundaries, cost estimates
- [`docs/deployment/provisioning.md`](docs/deployment/provisioning.md) — one-time setup runbook (Fly.io account, Cloudflare Workers, DNS, secrets, first deploy)
- [`docs/deployment/release-runbook.md`](docs/deployment/release-runbook.md) — cutting releases, approving deploys, rolling back
- [`docs/deployment/follow-ups.md`](docs/deployment/follow-ups.md) — deferred hardening and nice-to-haves
- [`docs/deployment/cost-control.md`](docs/deployment/cost-control.md) — scale-to-zero config for beta idle, cold-start expectations, wake/sleep commands

**Suite marker:** modules deploy from independent version lines, so no commit describes what is live. `deploy/suite-manifest.json` records the set known good together; `./scripts/suite.sh status|promote|rollback` reads it. `promote` captures the versions actually running on Fly, not what was intended. The `deployable` tag marks the commit of the last promotion — it is a plain tag, never a Release.

## Conventions

- Each service has its own `CLAUDE.md` with service-specific details (papermite, admindash have them; datacore, launchpad do not yet).
- Backend: FastAPI + Uvicorn, pydantic_settings for config.
- Frontend: React 19 + TypeScript + Vite. Native Fetch API (no axios). CSS variables (no CSS-in-JS). No global state library.
- Always use SSH for git remotes (`git@github.com:` URLs).
- Always use the `superpowers:subagent-driven-development` skill when executing implementation plans with independent tasks.
- Prefer the `/floatify` skill for development workflow: use OpenSpec to write and review specs, then execute with superpowers skills.
- `VOYAGE_API_KEY` and other API keys are in `~/.zshrc`. Run `source ~/.zshrc` if env vars appear missing.
