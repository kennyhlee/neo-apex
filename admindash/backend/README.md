# admindash backend

FastAPI service that powers the admindash school operations product. Sits between the admindash React SPA and the DataCore and Papermite backends, validates JWTs, and proxies requests.

## Run locally

```bash
# From the admindash/ directory (where pyproject.toml lives)
cd /Users/kennylee/Development/NeoApex/admindash
uv sync --extra dev
uv run uvicorn app.main:app --app-dir backend --port 5610 --reload
```

Or use the repo-level `start-services.sh` to boot all NeoApex services together.

## Run tests

```bash
cd /Users/kennylee/Development/NeoApex/admindash
uv run pytest backend/tests/ -v
```

28 tests cover: config fail-closed CORS, JWT validation dependency, health endpoint, auth proxy routes, query proxy, entity CRUD proxies, and multipart extract streaming.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMINDASH_ENVIRONMENT` | `development` | Set to `production` to enforce fail-closed CORS |
| `ADMINDASH_DATACORE_URL` | `http://localhost:5800` | Base URL for DataCore |
| `ADMINDASH_PAPERMITE_BACKEND_URL` | `http://localhost:5710` | Base URL for Papermite backend |
| `ADMINDASH_CORS_ALLOWED_ORIGINS` | `http://localhost:5600` (dev) | Comma-separated list. Required and non-wildcard in production. |

## Endpoints

| Method | Path | Forwards to |
|---|---|---|
| GET | `/api/health` | (none — local) |
| POST | `/auth/login` | DataCore `/auth/login` |
| GET | `/auth/me` | DataCore `/auth/me` |
| POST | `/api/query` | DataCore `/api/query` |
| POST | `/api/entities/{tenant_id}/{entity_type}` | DataCore (create) |
| PUT | `/api/entities/{tenant_id}/{entity_type}/{entity_id}` | DataCore (update) |
| POST | `/api/entities/{tenant_id}/{entity_type}/archive` | DataCore (archive) |
| GET | `/api/entities/{tenant_id}/{entity_type}/next-id` | DataCore |
| POST | `/api/entities/{tenant_id}/{entity_type}/duplicate-check` | DataCore |
| POST | `/api/extract/{tenant_id}/student` | Papermite (multipart streaming) |

Every endpoint except `/api/health` and `/auth/login` requires a valid bearer token validated against DataCore `/auth/me`.
