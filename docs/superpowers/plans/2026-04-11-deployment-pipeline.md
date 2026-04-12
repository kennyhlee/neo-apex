# Deployment Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add everything the repo needs to deploy NeoApex to Fly.io (backends) and Cloudflare Pages (frontends) via a GitHub Actions release-tag-triggered pipeline. Phase 1 of this deployment-pipeline change is **purely code** — Dockerfiles, `fly.toml` configs, the GitHub Actions workflow YAML, production CORS fail-closed refactors, a Cloudflare IP allowlist middleware, CSP headers, and deployment docs. Everything lands as committable, locally-testable code. Phase 2 (creating real Fly.io accounts/apps/secrets, Cloudflare Pages projects, DNS records, GitHub Environment + secrets, and cutting the first release tag) happens AFTER Phase 1 ships, by the human operator following `docs/deployment/provisioning.md` — which this plan creates as one of its tasks.

**Architecture:** Four FastAPI backends (`datacore`, `launchpad-api`, `papermite-api`, `admindash-api`) containerized via per-service `Dockerfile`s and deployed as Fly.io apps. `datacore` is on Fly's private network only (no public HTTP service); the other three are public, sit behind Cloudflare as a reverse proxy, and enforce a Cloudflare-IP-only allowlist middleware so their origin IPs cannot be reached directly. The three React frontends build on Cloudflare Pages from the repo and serve under `floatify.com` subdomains. A single GitHub Actions workflow listens for `release: published` with module-prefixed tags (`datacore-v*`, `launchpad-v*`, `papermite-v*`, `admindash-v*`) and dispatches to per-module deploy jobs. All deploys run inside a `production` GitHub Environment with required reviewer. Every backend fails closed on CORS in production mode.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, httpx, pydantic-settings; Docker; Fly.io (`flyctl`, `fly.toml`); Cloudflare Pages; GitHub Actions; `uv` for dependency management; GHCR for image storage.

---

## File Structure

**Files to CREATE:**

| Path | Responsibility |
|---|---|
| `datacore/Dockerfile` | Build datacore image on python:3.11-slim |
| `datacore/.dockerignore` | Exclude tests, local data, venv, caches |
| `launchpad/backend/Dockerfile` | Build launchpad-api image |
| `launchpad/backend/.dockerignore` | Same pattern |
| `papermite/backend/Dockerfile` | Build papermite-api image with poppler-utils + libmagic system deps |
| `papermite/backend/.dockerignore` | Same pattern |
| `admindash/backend/Dockerfile` | Build admindash-api image |
| `admindash/backend/.dockerignore` | Same pattern |
| `launchpad/backend/app/middleware/__init__.py` | Empty package marker |
| `launchpad/backend/app/middleware/cloudflare_ip.py` | Cloudflare IP allowlist middleware |
| `launchpad/backend/tests/test_cloudflare_ip.py` | Middleware unit tests |
| `papermite/backend/app/middleware/__init__.py` | Empty package marker |
| `papermite/backend/app/middleware/cloudflare_ip.py` | Copy of middleware (drift risk noted) |
| `papermite/backend/tests/test_cloudflare_ip.py` | Unit tests |
| `admindash/backend/app/middleware/__init__.py` | Empty package marker |
| `admindash/backend/app/middleware/cloudflare_ip.py` | Copy of middleware |
| `admindash/backend/tests/test_cloudflare_ip.py` | Unit tests |
| `datacore/fly.toml` | Fly.io config for datacore — **no `[http_service]`** (private network only), persistent volume, daily snapshots |
| `launchpad/backend/fly.toml` | Fly.io config for launchpad-api — public with Cloudflare-proxied TLS |
| `papermite/backend/fly.toml` | Fly.io config for papermite-api |
| `admindash/backend/fly.toml` | Fly.io config for admindash-api with scale-to-zero |
| `.github/workflows/deploy.yml` | Release-tag-triggered deploy workflow |
| `.github/dependabot.yml` | Weekly dep updates for pip, npm, github-actions |
| `launchpad/frontend/public/_headers` | Strict CSP for Cloudflare Pages |
| `papermite/frontend/public/_headers` | Strict CSP |
| `admindash/frontend/public/_headers` | Strict CSP |
| `docs/deployment/architecture.md` | Topology diagram + service graph |
| `docs/deployment/provisioning.md` | Phase 2 user runbook — Fly.io account setup, DNS, secrets, first deploy |
| `docs/deployment/release-runbook.md` | How to cut a release, approve a deploy, roll back |
| `docs/deployment/follow-ups.md` | Deferred hardening work (R2 backup, Tunnel, etc.) |
| `datacore/tests/test_cors_production.py` | Fail-closed CORS tests for datacore |
| `launchpad/backend/tests/test_cors_production.py` | Fail-closed CORS tests for launchpad |
| `papermite/backend/tests/test_cors_production.py` | Fail-closed CORS tests for papermite |

**Files to MODIFY:**

| Path | Change |
|---|---|
| `.gitignore` | Remove the `uv.lock` exclusion (line 225) so lockfiles can be committed for reproducible Docker builds |
| `datacore/src/datacore/api/__init__.py` | Refactor `_load_cors_origins()` to fail-closed in production |
| `launchpad/backend/app/config.py` | Add `environment` field + fail-closed production CORS |
| `papermite/backend/app/config.py` | Add `environment` field + fail-closed production CORS |
| `launchpad/backend/app/main.py` | Wire CloudflareIPMiddleware into the FastAPI app |
| `papermite/backend/app/main.py` | Wire CloudflareIPMiddleware |
| `admindash/backend/app/main.py` | Wire CloudflareIPMiddleware |
| `CLAUDE.md` (top-level) | Add deployment architecture section, link to runbooks |

**NEW committed files from untracked** (Task 1 only):
| Path | Change |
|---|---|
| `datacore/uv.lock` | Commit to repo for reproducible Docker builds |
| `launchpad/uv.lock` | Commit |
| `papermite/uv.lock` | Commit |
| `admindash/uv.lock` | Commit |

---

## Execution notes

- **TDD applies to code refactors** (CORS fail-closed, Cloudflare IP middleware) — write the failing test first, implement, confirm green, commit.
- **Configuration files** (`fly.toml`, `Dockerfile`, `deploy.yml`, `_headers`, `dependabot.yml`) use a looser "write → syntax-check → commit" flow since there's no unit-test target for them. Use `bash -n` for shell, `python3 -c "import tomllib; tomllib.loads(open(...).read())"` for TOML, `python3 -c "import yaml; yaml.safe_load(...)"` for YAML.
- **Do NOT run `flyctl deploy`, `flyctl apps create`, `flyctl secrets set`, `wrangler`, or any command that provisions real external resources.** All of that is Phase 2 and belongs in `docs/deployment/provisioning.md`.
- **Do NOT create a Cloudflare API token, Fly.io deploy token, or GitHub Environment** — those are Phase 2.
- **Docker build verification** is local-only. Use `docker build -t <name> <path>` to confirm each Dockerfile builds successfully. Do NOT push anywhere.
- **Commit frequently.** Every task should end in one (occasionally two) commits. Never batch multiple tasks into a single commit.
- **The branch you're working on** is `feat/admindash-backend-api` — wait, no. Double-check at start. Task 0 handles branch setup.

---

## Task 0: Branch setup

**Files:** none

- [ ] **Step 1: Verify current branch and working state**

Run:
```bash
cd /Users/kennylee/Development/NeoApex
git status --short
git rev-parse --abbrev-ref HEAD
git log --oneline -3
```

Expected: working tree may have unrelated untracked files (admindash-program-page, add-student-modal, selection-cardinality, etc. — leave them alone). Current branch should be either `feat/admindash-backend-api` (if the admindash work hasn't merged yet) or `main` (if it has).

- [ ] **Step 2: Create the deployment-pipeline branch**

If current branch is `main`:
```bash
cd /Users/kennylee/Development/NeoApex
git checkout -b feat/deployment-pipeline
```

If current branch is `feat/admindash-backend-api` and it hasn't merged yet:
```bash
cd /Users/kennylee/Development/NeoApex
git checkout -b feat/deployment-pipeline
```
(This branches off the current `feat/admindash-backend-api` state, so the deployment-pipeline work includes the admindash-backend code. That's correct — deployment-pipeline depends on admindash-backend existing.)

Confirm:
```bash
git rev-parse --abbrev-ref HEAD
```
Expected: `feat/deployment-pipeline`.

- [ ] **Step 3: No commit yet**

This task does not commit. It just sets up the branch.

---

## Task 1: Commit uv.lock files for reproducible Docker builds

**Files:**
- Modify: `.gitignore`
- Add to repo: `datacore/uv.lock`, `launchpad/uv.lock`, `papermite/uv.lock`, `admindash/uv.lock`

**Why this task exists:** The top-level `.gitignore` currently excludes `uv.lock` (line 225). All 4 backends have a `uv.lock` file on disk but untracked. For Docker builds to produce reproducible images — and especially for rollback to an old image tag to behave predictably — the lockfiles must be in git. This task reverses that gitignore decision.

- [ ] **Step 1: Read the current `.gitignore` line 225 context**

Run:
```bash
sed -n '220,230p' /Users/kennylee/Development/NeoApex/.gitignore
```

You should see something like:

```
# Lockfiles (uv)
uv.lock
```

(exact line numbers may vary slightly).

- [ ] **Step 2: Remove the `uv.lock` exclusion**

Edit `.gitignore`: delete the line `uv.lock` (and the `# Lockfiles (uv)` comment if it's there). The file should no longer contain any `uv.lock` patterns.

After editing, verify:
```bash
grep -n "uv.lock" /Users/kennylee/Development/NeoApex/.gitignore
```
Expected: no output (zero matches).

- [ ] **Step 3: Verify the 4 lockfiles are now stageable**

Run:
```bash
cd /Users/kennylee/Development/NeoApex && git status datacore/uv.lock launchpad/uv.lock papermite/uv.lock admindash/uv.lock
```

Expected: all 4 files show as untracked (`??`) — they will be added in the next step.

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add .gitignore datacore/uv.lock launchpad/uv.lock papermite/uv.lock admindash/uv.lock
git commit -m "build: commit uv.lock files for reproducible Docker builds

Previously uv.lock was gitignored globally. With production deploys coming
online, reproducible builds are essential — a rollback to an old image tag
must resolve the same dependency tree it did at build time. Commit all 4
service lockfiles and remove the .gitignore exclusion."
```

---

## Task 2: datacore Dockerfile

**Files:**
- Create: `datacore/Dockerfile`
- Create: `datacore/.dockerignore`

- [ ] **Step 1: Create `datacore/.dockerignore`**

```
# Virtualenv and caches
.venv
.pytest_cache
__pycache__
*.pyc
*.pyo
*.pyd

# Local data and logs
data/
*.log
.DS_Store

# Tests and development tooling
tests/
docs/
openspec/
.logs/
*.md

# Editor junk
.vscode
.idea
```

- [ ] **Step 2: Create `datacore/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS runtime

# System deps: curl for health checks, ca-certificates for HTTPS to downstream services
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install uv (pinned release)
RUN pip install --no-cache-dir uv==0.5.14

# Non-root user
RUN useradd --create-home --shell /bin/bash app
WORKDIR /app

# Copy dependency manifests first so this layer is cached when only source changes
COPY --chown=app:app pyproject.toml uv.lock ./

# Copy source
COPY --chown=app:app src ./src

USER app

# Sync dependencies into a project-local venv (honors uv.lock)
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5800

EXPOSE 5800

# DataCore's entrypoint is datacore.api.server:app (matches start-services.sh)
CMD ["uvicorn", "datacore.api.server:app", "--host", "0.0.0.0", "--port", "5800"]
```

- [ ] **Step 3: Build the image locally to confirm it works**

Run:
```bash
cd /Users/kennylee/Development/NeoApex && docker build -t datacore-test -f datacore/Dockerfile datacore/
```

Expected: build succeeds. You'll see each stage run. Final line: `Successfully tagged datacore-test:latest` (or equivalent).

If the build fails, read the error and fix. Common causes:
- `uv.lock` missing — you skipped Task 1. Go back.
- Python version mismatch — pyproject.toml says `>=3.11`, image is 3.11-slim. Match.
- Missing system dep — if the build fails installing a Python package that needs a system library, add the apt package to the `RUN apt-get install` line. DataCore uses `lancedb` which may need build tools; if it does, add `build-essential` and `pkg-config` to the apt install list.

- [ ] **Step 4: Smoke test the built image**

Run:
```bash
docker run --rm -d --name datacore-smoke -p 5899:5800 datacore-test
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5899/
docker logs datacore-smoke 2>&1 | tail -20
docker stop datacore-smoke
```

Expected: the container starts and uvicorn logs appear. The `curl` to `/` may return 404 (DataCore doesn't have a root route — that's fine) or 200 depending on the routes registered. What matters is that the container is running and uvicorn is listening. If it fails to start (e.g., exits immediately), read the logs and fix.

Note: DataCore does NOT have a `/health` endpoint today. We'll add one in Task 9 (production CORS + health check wiring). For now, any HTTP response from the container = success.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add datacore/Dockerfile datacore/.dockerignore
git commit -m "build(datacore): add Dockerfile for Fly.io deployment"
```

---

## Task 3: launchpad backend Dockerfile

**Files:**
- Create: `launchpad/backend/Dockerfile`
- Create: `launchpad/backend/.dockerignore`

- [ ] **Step 1: Create `launchpad/backend/.dockerignore`**

```
.venv
.pytest_cache
__pycache__
*.pyc
*.pyo
*.pyd
data/
*.log
.DS_Store
tests/
docs/
openspec/
.logs/
*.md
.vscode
.idea
```

- [ ] **Step 2: Create `launchpad/backend/Dockerfile`**

Note: launchpad's `pyproject.toml` is at `launchpad/pyproject.toml` (one level up from `backend/`) and it declares `[tool.hatch.build.targets.wheel] packages = ["backend/app"]`. So the Dockerfile's Docker build context should be `launchpad/` (NOT `launchpad/backend/`), and the Dockerfile will live at `launchpad/backend/Dockerfile` but reference files relative to the parent.

Actually — Docker doesn't have a clean way to reference files above the Dockerfile location unless the build context is set to the parent. We'll use `docker build -f launchpad/backend/Dockerfile launchpad/` to achieve this. The Dockerfile paths are relative to the build context (`launchpad/`), not the Dockerfile location.

```dockerfile
# syntax=docker/dockerfile:1.6
# Build context: launchpad/ (NOT launchpad/backend/)
# Build with: docker build -t launchpad-api-test -f launchpad/backend/Dockerfile launchpad/
FROM python:3.11-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.5.14

RUN useradd --create-home --shell /bin/bash app
WORKDIR /app

# pyproject.toml + uv.lock live at launchpad/ (the build context root)
COPY --chown=app:app pyproject.toml uv.lock ./

# The Python package lives at launchpad/backend/app per hatch config
COPY --chown=app:app backend/app ./backend/app

USER app

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5510

EXPOSE 5510

# From /app, uvicorn needs --app-dir backend to find app.main (matches start-services.sh pattern)
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "5510"]
```

- [ ] **Step 3: Build the image locally**

```bash
cd /Users/kennylee/Development/NeoApex && docker build -t launchpad-api-test -f launchpad/backend/Dockerfile launchpad/
```

Expected: build succeeds.

- [ ] **Step 4: Smoke test the built image**

```bash
docker run --rm -d --name launchpad-smoke -p 5599:5510 launchpad-api-test
sleep 3
curl -s http://localhost:5599/api/health
echo
docker logs launchpad-smoke 2>&1 | tail -10
docker stop launchpad-smoke
```

Expected: `curl` returns `{"status":"ok"}` (launchpad's existing `/api/health` endpoint). Logs show uvicorn startup.

If the health endpoint returns an error, check `launchpad/backend/app/main.py` to confirm the endpoint exists at `/api/health`. If it does but the curl fails, the container's port binding may be wrong — double-check the `-p 5599:5510` flag matches the EXPOSE and uvicorn port.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add launchpad/backend/Dockerfile launchpad/backend/.dockerignore
git commit -m "build(launchpad): add backend Dockerfile for Fly.io deployment"
```

---

## Task 4: papermite backend Dockerfile (with apt system deps)

**Files:**
- Create: `papermite/backend/Dockerfile`
- Create: `papermite/backend/.dockerignore`

Papermite's backend does document ingestion — it uses `docling` (PDF parsing), which needs `poppler-utils` and `libmagic1` installed at the system level. This Dockerfile includes those apt packages.

- [ ] **Step 1: Create `papermite/backend/.dockerignore`**

```
.venv
.pytest_cache
__pycache__
*.pyc
*.pyo
*.pyd
data/
uploads/
*.log
.DS_Store
tests/
docs/
openspec/
.logs/
*.md
.vscode
.idea
```

Note: `uploads/` is excluded because papermite stores uploaded documents there locally; those are runtime state, not build artifacts.

- [ ] **Step 2: Create `papermite/backend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6
# Build context: papermite/ (NOT papermite/backend/)
# Build with: docker build -t papermite-api-test -f papermite/backend/Dockerfile papermite/
FROM python:3.11-slim AS runtime

# System deps:
# - curl + ca-certificates for health checks + HTTPS to downstream services
# - poppler-utils: PDF → text for docling
# - libmagic1: file type detection
# - build-essential + pkg-config: some Python deps (lancedb, pyarrow) need a compiler at install time
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    poppler-utils \
    libmagic1 \
    build-essential \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.5.14

RUN useradd --create-home --shell /bin/bash app
WORKDIR /app

COPY --chown=app:app pyproject.toml uv.lock ./

COPY --chown=app:app backend/app ./backend/app

USER app

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5710

EXPOSE 5710

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "5710"]
```

- [ ] **Step 3: Build the image locally**

```bash
cd /Users/kennylee/Development/NeoApex && docker build -t papermite-api-test -f papermite/backend/Dockerfile papermite/
```

Expected: build succeeds. This build will take longer than the others because papermite has more dependencies (docling, pydantic-ai, etc.) and some need compilation.

If the build fails with a "missing header" or "no such file" error for a C library, add the corresponding `-dev` apt package to the install list (e.g., `libssl-dev`, `libffi-dev`). Rebuild.

- [ ] **Step 4: Smoke test**

```bash
docker run --rm -d --name papermite-smoke -p 5799:5710 papermite-api-test
sleep 5  # papermite boots slower than the others
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5799/api/health
docker logs papermite-smoke 2>&1 | tail -15
docker stop papermite-smoke
```

Expected: the curl returns 200 OR 404 (papermite may not have `/api/health` today — the health endpoint wiring is handled in Task 9). What matters is that the container is running and uvicorn is listening.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/Dockerfile papermite/backend/.dockerignore
git commit -m "build(papermite): add backend Dockerfile with poppler-utils and libmagic"
```

---

## Task 5: admindash backend Dockerfile

**Files:**
- Create: `admindash/backend/Dockerfile`
- Create: `admindash/backend/.dockerignore`

- [ ] **Step 1: Create `admindash/backend/.dockerignore`**

```
.venv
.pytest_cache
__pycache__
*.pyc
*.pyo
*.pyd
*.log
.DS_Store
tests/
docs/
openspec/
.logs/
*.md
.vscode
.idea
```

- [ ] **Step 2: Create `admindash/backend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6
# Build context: admindash/ (NOT admindash/backend/)
# Build with: docker build -t admindash-api-test -f admindash/backend/Dockerfile admindash/
FROM python:3.11-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.5.14

RUN useradd --create-home --shell /bin/bash app
WORKDIR /app

COPY --chown=app:app pyproject.toml uv.lock ./
COPY --chown=app:app backend/app ./backend/app

USER app

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5610

EXPOSE 5610

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "5610"]
```

- [ ] **Step 3: Build the image locally**

```bash
cd /Users/kennylee/Development/NeoApex && docker build -t admindash-api-test -f admindash/backend/Dockerfile admindash/
```

Expected: build succeeds.

- [ ] **Step 4: Smoke test**

```bash
docker run --rm -d --name admindash-smoke -p 5699:5610 admindash-api-test
sleep 3
curl -s http://localhost:5699/api/health
echo
docker logs admindash-smoke 2>&1 | tail -10
docker stop admindash-smoke
```

Expected: `curl` returns `{"status":"ok"}` (admindash-backend's existing `/api/health` from the admindash-backend-api change).

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/Dockerfile admindash/backend/.dockerignore
git commit -m "build(admindash): add backend Dockerfile for Fly.io deployment"
```

---

## Task 6: Cloudflare IP allowlist middleware (launchpad — canonical copy)

**Files:**
- Create: `launchpad/backend/app/middleware/__init__.py` (empty)
- Create: `launchpad/backend/app/middleware/cloudflare_ip.py`
- Create: `launchpad/backend/tests/test_cloudflare_ip.py`
- Modify: `launchpad/backend/app/main.py`

This task creates the **canonical** Cloudflare IP allowlist middleware in launchpad. Tasks 7 and 8 will copy this middleware (with adjusted import paths) into papermite and admindash-backend. Since the three files are small and we don't want to introduce a shared Python package, **we accept the copy-paste drift risk** and leave a prominent comment at the top of each copy pointing at the other copies.

The middleware rejects requests whose source IP is not within Cloudflare's published IPv4/IPv6 ranges, returning HTTP 403. It is skippable in development via `TRUST_ALL_IPS=1` env var.

Cloudflare's IP ranges change occasionally. This plan hardcodes them as of 2026-04-11. A follow-up change (listed in `docs/deployment/follow-ups.md`) will fetch the list at container start.

- [ ] **Step 1: Create the empty middleware package marker**

```bash
touch /Users/kennylee/Development/NeoApex/launchpad/backend/app/middleware/__init__.py
```

- [ ] **Step 2: Write the failing middleware tests**

Create `launchpad/backend/tests/test_cloudflare_ip.py`:

```python
"""Tests for the Cloudflare IP allowlist middleware."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.cloudflare_ip import CloudflareIPMiddleware


def _make_app(trust_all_ips: bool = False) -> TestClient:
    app = FastAPI()
    app.add_middleware(CloudflareIPMiddleware, trust_all_ips=trust_all_ips)

    @app.get("/test")
    def test_route():
        return {"ok": True}

    return TestClient(app)


def test_trust_all_ips_allows_any_source(monkeypatch):
    client = _make_app(trust_all_ips=True)
    resp = client.get("/test")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_cloudflare_ipv4_is_allowed():
    client = _make_app(trust_all_ips=False)
    # 173.245.48.1 is inside the Cloudflare range 173.245.48.0/20
    resp = client.get("/test", headers={"x-forwarded-for": "173.245.48.1"})
    assert resp.status_code == 200


def test_non_cloudflare_ipv4_is_rejected():
    client = _make_app(trust_all_ips=False)
    resp = client.get("/test", headers={"x-forwarded-for": "8.8.8.8"})
    assert resp.status_code == 403


def test_cloudflare_ipv6_is_allowed():
    client = _make_app(trust_all_ips=False)
    # 2400:cb00::1 is inside 2400:cb00::/32
    resp = client.get("/test", headers={"x-forwarded-for": "2400:cb00::1"})
    assert resp.status_code == 200


def test_missing_forwarded_for_header_is_rejected():
    client = _make_app(trust_all_ips=False)
    # TestClient's default source is 127.0.0.1, not in Cloudflare range
    resp = client.get("/test")
    assert resp.status_code == 403


def test_first_ip_in_xff_chain_is_used():
    client = _make_app(trust_all_ips=False)
    # Multiple IPs comma-separated; first is the original client (Cloudflare)
    resp = client.get(
        "/test",
        headers={"x-forwarded-for": "173.245.48.1, 10.0.0.1, 10.0.0.2"},
    )
    assert resp.status_code == 200
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/test_cloudflare_ip.py -v
```

Expected: 6 tests FAIL with `ModuleNotFoundError: No module named 'app.middleware.cloudflare_ip'`.

- [ ] **Step 4: Create the middleware**

Create `launchpad/backend/app/middleware/cloudflare_ip.py`:

```python
"""Cloudflare IP allowlist middleware.

Rejects requests whose source IP is not within Cloudflare's published IP
ranges with HTTP 403. This prevents attackers from bypassing the Cloudflare
WAF by finding the Fly.io origin IP via certificate transparency logs or
historical DNS.

IMPORTANT: This file is COPY-PASTED across launchpad/backend/app/middleware/,
papermite/backend/app/middleware/, and admindash/backend/app/middleware/.
Keep all three copies in sync. When Cloudflare updates its IP ranges (rare),
update CLOUDFLARE_IP_RANGES in all three files.

Cloudflare IPs as of 2026-04-11, from https://www.cloudflare.com/ips/
A follow-up change will fetch this list at container start instead of
hardcoding it.
"""
import ipaddress
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp


CLOUDFLARE_IPV4_RANGES: list[str] = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
]

CLOUDFLARE_IPV6_RANGES: list[str] = [
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
]


def _parse_networks(ranges: Iterable[str]) -> list[ipaddress._BaseNetwork]:
    return [ipaddress.ip_network(r) for r in ranges]


_CF_NETWORKS: list[ipaddress._BaseNetwork] = _parse_networks(
    CLOUDFLARE_IPV4_RANGES + CLOUDFLARE_IPV6_RANGES
)


def _is_cloudflare_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for network in _CF_NETWORKS:
        if ip.version != network.version:
            continue
        if ip in network:
            return True
    return False


def _client_ip_from_request(request: Request) -> str | None:
    """Extract the client IP from the X-Forwarded-For header.

    Cloudflare sets X-Forwarded-For to a comma-separated chain ending at the
    original client. The FIRST entry is the original client IP; subsequent
    entries are intermediate proxies. We check the FIRST entry.

    If no XFF header is present, fall back to the TCP source IP from the ASGI
    scope — but in production behind Cloudflare this should always be set.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first

    client = request.client
    if client:
        return client.host
    return None


class CloudflareIPMiddleware(BaseHTTPMiddleware):
    """Reject requests whose source IP is not within Cloudflare's IP ranges."""

    def __init__(self, app: ASGIApp, trust_all_ips: bool = False) -> None:
        super().__init__(app)
        self.trust_all_ips = trust_all_ips

    async def dispatch(self, request: Request, call_next):
        if self.trust_all_ips:
            return await call_next(request)

        client_ip = _client_ip_from_request(request)
        if client_ip is None or not _is_cloudflare_ip(client_ip):
            return JSONResponse(
                status_code=403,
                content={"detail": "Source IP not in Cloudflare range"},
            )

        return await call_next(request)
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/test_cloudflare_ip.py -v
```

Expected: all 6 tests pass.

If any test fails (e.g., `test_first_ip_in_xff_chain_is_used`), read the failure and fix the middleware logic. Common issues:
- `x-forwarded-for` chain parsing (make sure you take `.split(",")[0].strip()`)
- IPv6 address matching (make sure `ip.version != network.version` check excludes mixing)

- [ ] **Step 6: Wire the middleware into launchpad's FastAPI app**

Read `launchpad/backend/app/main.py` (which currently looks like this):

```python
"""FastAPI application entry point for Launchpad."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, tenants, users
from app.config import settings

app = FastAPI(
    title="Launchpad",
    description="Tenant lifecycle and identity service for the NeoApex platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(tenants.router, prefix="/api", tags=["tenants"])
app.include_router(users.router, prefix="/api", tags=["users"])

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

Update it to add the Cloudflare IP middleware **before** the CORS middleware (middleware runs in reverse order — the LAST one added wraps the others, so adding CF allowlist first means it runs first, rejecting non-Cloudflare traffic before CORS even gets to see it).

Change to:

```python
"""FastAPI application entry point for Launchpad."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, tenants, users
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="Launchpad",
    description="Tenant lifecycle and identity service for the NeoApex platform",
    version="0.1.0",
)

# Cloudflare IP allowlist — only applied when not running behind trust-all env.
# In dev (no Cloudflare in front), set TRUST_ALL_IPS=1 via start-services.sh or local shell.
app.add_middleware(
    CloudflareIPMiddleware,
    trust_all_ips=os.environ.get("TRUST_ALL_IPS") == "1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(tenants.router, prefix="/api", tags=["tenants"])
app.include_router(users.router, prefix="/api", tags=["users"])

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Verify launchpad still runs in dev mode with TRUST_ALL_IPS=1**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && TRUST_ALL_IPS=1 uv run uvicorn app.main:app --app-dir backend --port 5519 > /tmp/launchpad-smoke.log 2>&1 &
PID=$!
sleep 2
curl -s http://localhost:5519/api/health
echo
kill $PID
```

Expected: `{"status":"ok"}`. If it returns 403, the `TRUST_ALL_IPS` env check isn't being read — re-check the `os.environ.get("TRUST_ALL_IPS") == "1"` line.

- [ ] **Step 8: Update start-services.sh to export TRUST_ALL_IPS=1 for all backend services**

Read `/Users/kennylee/Development/NeoApex/start-services.sh` and find the `start_service()` function. Each backend `case` block currently looks like:

```bash
    launchpad-backend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/launchpad/backend"
      source "$SCRIPT_DIR/launchpad/.venv/bin/activate" 2>/dev/null || true
      uvicorn app.main:app --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
```

Add `TRUST_ALL_IPS=1` to the uvicorn invocation for all FOUR backend cases (datacore, launchpad-backend, papermite-backend, admindash-backend) so local dev doesn't trip the Cloudflare IP check. Example for launchpad:

```bash
    launchpad-backend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/launchpad/backend"
      source "$SCRIPT_DIR/launchpad/.venv/bin/activate" 2>/dev/null || true
      TRUST_ALL_IPS=1 uvicorn app.main:app --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
```

Apply the same `TRUST_ALL_IPS=1` prefix to:
- `datacore)` — but note that datacore doesn't use the middleware (datacore is private network only, not publicly-reachable). Add `TRUST_ALL_IPS=1` anyway for consistency — the env var is a no-op for services that don't check it.
- `launchpad-backend)` (done above)
- `papermite-backend)`
- `admindash-backend)` — the existing command already uses `uv run`; prefix with `TRUST_ALL_IPS=1`:
  ```bash
  cd "$SCRIPT_DIR/admindash" && TRUST_ALL_IPS=1 uv run uvicorn app.main:app --app-dir backend --port "$port" > "$log_file" 2>&1 &
  ```

Validate syntax:
```bash
bash -n /Users/kennylee/Development/NeoApex/start-services.sh
```

Expected: no output.

- [ ] **Step 9: Run launchpad's full test suite to confirm no regressions**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/ -v
```

Expected: all existing launchpad tests still pass, plus the 6 new Cloudflare IP tests.

If launchpad's existing tests fail because they hit routes through the middleware and don't set `x-forwarded-for` to a Cloudflare IP, you have two options:
(a) Update the test fixtures to set `TRUST_ALL_IPS=1` via `monkeypatch.setenv` before importing the app
(b) Update the `CloudflareIPMiddleware.__init__` to also check `os.environ.get("TRUST_ALL_IPS") == "1"` directly, bypassing the constructor arg

Option (a) is cleaner but requires changing the test layer. If only one or two tests break, prefer (a). If more than a handful break, go with (b) — make the middleware self-check the env var AND the constructor arg:

```python
def __init__(self, app: ASGIApp, trust_all_ips: bool = False) -> None:
    super().__init__(app)
    self.trust_all_ips = trust_all_ips or os.environ.get("TRUST_ALL_IPS") == "1"
```

(and add `import os` at the top of the middleware file.)

Either way, land the change and confirm all tests green before moving on.

- [ ] **Step 10: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add launchpad/backend/app/middleware/__init__.py \
        launchpad/backend/app/middleware/cloudflare_ip.py \
        launchpad/backend/tests/test_cloudflare_ip.py \
        launchpad/backend/app/main.py \
        start-services.sh
git commit -m "feat(launchpad): Cloudflare IP allowlist middleware with dev bypass"
```

---

## Task 7: Copy Cloudflare IP middleware to papermite

**Files:**
- Create: `papermite/backend/app/middleware/__init__.py`
- Create: `papermite/backend/app/middleware/cloudflare_ip.py`
- Create: `papermite/backend/tests/test_cloudflare_ip.py`
- Modify: `papermite/backend/app/main.py`

- [ ] **Step 1: Copy the middleware file and tests from launchpad**

```bash
mkdir -p /Users/kennylee/Development/NeoApex/papermite/backend/app/middleware
touch /Users/kennylee/Development/NeoApex/papermite/backend/app/middleware/__init__.py
cp /Users/kennylee/Development/NeoApex/launchpad/backend/app/middleware/cloudflare_ip.py /Users/kennylee/Development/NeoApex/papermite/backend/app/middleware/cloudflare_ip.py
cp /Users/kennylee/Development/NeoApex/launchpad/backend/tests/test_cloudflare_ip.py /Users/kennylee/Development/NeoApex/papermite/backend/tests/test_cloudflare_ip.py
```

The middleware file has no launchpad-specific imports, so it works in papermite as-is.

- [ ] **Step 2: Verify the copies are byte-identical to launchpad's**

```bash
diff /Users/kennylee/Development/NeoApex/launchpad/backend/app/middleware/cloudflare_ip.py /Users/kennylee/Development/NeoApex/papermite/backend/app/middleware/cloudflare_ip.py
diff /Users/kennylee/Development/NeoApex/launchpad/backend/tests/test_cloudflare_ip.py /Users/kennylee/Development/NeoApex/papermite/backend/tests/test_cloudflare_ip.py
```

Expected: no output (identical).

- [ ] **Step 3: Run the tests against papermite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/test_cloudflare_ip.py -v
```

Expected: 6 tests pass.

- [ ] **Step 4: Wire the middleware into papermite's FastAPI app**

Read `papermite/backend/app/main.py`:

```python
"""FastAPI application entry point for Papermite."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, upload, extraction, finalize, extract
from app.config import settings

app = FastAPI(
    title="Papermite",
    description="Document ingestion gateway for the NeoApex platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(extraction.router, prefix="/api", tags=["schema"])
app.include_router(finalize.router, prefix="/api", tags=["finalize"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

Update to:

```python
"""FastAPI application entry point for Papermite."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, upload, extraction, finalize, extract
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="Papermite",
    description="Document ingestion gateway for the NeoApex platform",
    version="0.1.0",
)

# Cloudflare IP allowlist — rejects non-Cloudflare traffic in production.
# Set TRUST_ALL_IPS=1 in dev to bypass.
app.add_middleware(
    CloudflareIPMiddleware,
    trust_all_ips=os.environ.get("TRUST_ALL_IPS") == "1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(extraction.router, prefix="/api", tags=["schema"])
app.include_router(finalize.router, prefix="/api", tags=["finalize"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

- [ ] **Step 5: Run the full papermite test suite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/ -v
```

Expected: all existing tests still pass. If any fail because they don't set `TRUST_ALL_IPS=1`, apply the same fix strategy as Task 6 Step 9 (either `monkeypatch.setenv` in test setup, or make the middleware self-check the env var in its constructor).

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/middleware/__init__.py \
        papermite/backend/app/middleware/cloudflare_ip.py \
        papermite/backend/tests/test_cloudflare_ip.py \
        papermite/backend/app/main.py
git commit -m "feat(papermite): Cloudflare IP allowlist middleware"
```

---

## Task 8: Copy Cloudflare IP middleware to admindash

**Files:**
- Create: `admindash/backend/app/middleware/__init__.py`
- Create: `admindash/backend/app/middleware/cloudflare_ip.py`
- Create: `admindash/backend/tests/test_cloudflare_ip.py`
- Modify: `admindash/backend/app/main.py`

- [ ] **Step 1: Copy the middleware and tests from launchpad**

```bash
mkdir -p /Users/kennylee/Development/NeoApex/admindash/backend/app/middleware
touch /Users/kennylee/Development/NeoApex/admindash/backend/app/middleware/__init__.py
cp /Users/kennylee/Development/NeoApex/launchpad/backend/app/middleware/cloudflare_ip.py /Users/kennylee/Development/NeoApex/admindash/backend/app/middleware/cloudflare_ip.py
cp /Users/kennylee/Development/NeoApex/launchpad/backend/tests/test_cloudflare_ip.py /Users/kennylee/Development/NeoApex/admindash/backend/tests/test_cloudflare_ip.py
```

- [ ] **Step 2: Run the tests against admindash**

```bash
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_cloudflare_ip.py -v
```

Expected: 6 tests pass.

- [ ] **Step 3: Wire the middleware into admindash's FastAPI app**

Read `admindash/backend/app/main.py`. It currently looks like:

```python
"""FastAPI application entry point for admindash backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, entities, extract, health, query
from app.config import settings

app = FastAPI(
    title="Admindash Backend",
    description="School operations backend powering the admindash product",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(entities.router, prefix="/api", tags=["entities"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

Update to add CF middleware before CORS:

```python
"""FastAPI application entry point for admindash backend."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, entities, extract, health, query
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="Admindash Backend",
    description="School operations backend powering the admindash product",
    version="0.1.0",
)

# Cloudflare IP allowlist — rejects non-Cloudflare traffic in production.
# Set TRUST_ALL_IPS=1 in dev to bypass.
app.add_middleware(
    CloudflareIPMiddleware,
    trust_all_ips=os.environ.get("TRUST_ALL_IPS") == "1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(entities.router, prefix="/api", tags=["entities"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

- [ ] **Step 4: Run the full admindash test suite**

```bash
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
```

Expected: 28 existing tests + 6 new middleware tests = 34 passing. If any of the 28 original tests fail because they don't set TRUST_ALL_IPS, apply the Task 6 Step 9 fix strategy.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/middleware/__init__.py \
        admindash/backend/app/middleware/cloudflare_ip.py \
        admindash/backend/tests/test_cloudflare_ip.py \
        admindash/backend/app/main.py
git commit -m "feat(admindash): Cloudflare IP allowlist middleware"
```

---

## Task 9: datacore production CORS fail-closed + /health endpoint

**Files:**
- Modify: `datacore/src/datacore/api/__init__.py`
- Create: `datacore/tests/test_cors_production.py`

datacore's CORS is loaded via a function `_load_cors_origins()` in `datacore/src/datacore/api/__init__.py`. This task refactors that function to fail closed when `ENVIRONMENT=production` and adds a `/health` endpoint if one doesn't exist.

- [ ] **Step 1: Check if datacore already has a /health endpoint**

Run:
```bash
grep -rn "api/health\|@app.get.*/health\|def health" /Users/kennylee/Development/NeoApex/datacore/src/datacore/
```

- If `/api/health` or similar already exists, skip adding one (note which file and line it's defined in for the verification step).
- If no health endpoint exists, you'll add one as part of this task.

- [ ] **Step 2: Check what test framework datacore uses**

```bash
ls /Users/kennylee/Development/NeoApex/datacore/tests/
```

Expected: existing `test_*.py` files. Note the test naming and import style (e.g., do tests use `from datacore.api import ...`?).

- [ ] **Step 3: Write the failing test for production CORS fail-closed**

Create `datacore/tests/test_cors_production.py`:

```python
"""Tests for production fail-closed CORS on datacore."""
import pytest

from datacore.api import _load_cors_origins


def test_dev_mode_with_services_json_default(monkeypatch):
    """In dev mode (no ENVIRONMENT set), _load_cors_origins returns origins
    derived from services.json frontends (plus any CORS_ALLOWED_ORIGINS
    override)."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    origins = _load_cors_origins()
    # At least one of the expected dev frontend origins should be in the list
    assert any("localhost:5600" in o for o in origins), (
        f"Expected localhost:5600 in dev CORS origins, got: {origins}"
    )


def test_dev_mode_with_env_override(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://example.com")
    origins = _load_cors_origins()
    assert origins == ["http://example.com"]


def test_production_without_origins_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        _load_cors_origins()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _load_cors_origins()


def test_production_with_explicit_origins_succeeds(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv(
        "CORS_ALLOWED_ORIGINS",
        "https://launchpad.floatify.com,https://papermite.floatify.com",
    )
    origins = _load_cors_origins()
    assert origins == [
        "https://launchpad.floatify.com",
        "https://papermite.floatify.com",
    ]
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/datacore && uv run pytest tests/test_cors_production.py -v
```

Expected: `test_production_without_origins_raises` and `test_production_with_wildcard_raises` FAIL because the current `_load_cors_origins` does not raise in production. The other 3 tests may pass or fail depending on the current behavior — you can ignore those for now.

- [ ] **Step 5: Refactor `_load_cors_origins()` in datacore**

Read `/Users/kennylee/Development/NeoApex/datacore/src/datacore/api/__init__.py`. The current function is:

```python
def _load_cors_origins() -> list[str]:
    """Build CORS allowed origins from services.json or env var override."""
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]

    config_path = Path(__file__).resolve().parent.parent.parent.parent.parent / "services.json"
    if not config_path.exists():
        return []

    with open(config_path) as f:
        config = json.load(f)

    frontend_keys = [k for k in config["services"] if k.endswith("-frontend")]
    origins = []
    for key in frontend_keys:
        svc = config["services"][key]
        port = svc["port"]
        origins.append(f"http://localhost:{port}")
        origins.append(f"http://127.0.0.1:{port}")
    return origins
```

Replace it with:

```python
def _load_cors_origins() -> list[str]:
    """Build CORS allowed origins from env var or services.json.

    In production mode (ENVIRONMENT=production), CORS_ALLOWED_ORIGINS is
    required and must not contain '*'. Missing or wildcard → RuntimeError.

    In development mode, falls back to services.json-derived frontend origins
    when CORS_ALLOWED_ORIGINS is unset.
    """
    environment = os.environ.get("ENVIRONMENT", "development")
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")

    if environment == "production":
        if not env_origins:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS is required in production and must not be empty"
            )
        origins = [o.strip() for o in env_origins.split(",") if o.strip()]
        if "*" in origins:
            raise RuntimeError(
                "wildcard '*' in CORS_ALLOWED_ORIGINS is not permitted in production"
            )
        return origins

    # Dev mode: env var wins if set
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]

    # Dev mode fallback: derive from services.json
    config_path = Path(__file__).resolve().parent.parent.parent.parent.parent / "services.json"
    if not config_path.exists():
        return []

    with open(config_path) as f:
        config = json.load(f)

    frontend_keys = [k for k in config["services"] if k.endswith("-frontend")]
    origins = []
    for key in frontend_keys:
        svc = config["services"][key]
        port = svc["port"]
        origins.append(f"http://localhost:{port}")
        origins.append(f"http://127.0.0.1:{port}")
    return origins
```

- [ ] **Step 6: Add /health endpoint if one doesn't exist**

If Step 1 showed that datacore already has a health endpoint, skip this step.

Otherwise, add one inside `create_app()`. The current `create_app()` ends with `return app` after registering routes. Add a `@app.get("/health")` or `@app.get("/api/health")` handler BEFORE `return app`. Pick `/health` (not under `/api`) to match the pattern other Fly.io apps use for health checks.

Modify `create_app()` in `datacore/src/datacore/api/__init__.py`:

```python
def create_app(store: Store) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="datacore")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_load_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app, store)
    register_registry_routes(app, store)
    register_auth_routes(app, store)
    register_unified_routes(app, store)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app
```

- [ ] **Step 7: Run the datacore test suite**

```bash
cd /Users/kennylee/Development/NeoApex/datacore && uv run pytest tests/test_cors_production.py -v
```

Expected: all 5 new CORS tests pass.

Then run the full suite:
```bash
cd /Users/kennylee/Development/NeoApex/datacore && uv run pytest tests/ -v
```

Expected: all existing datacore tests still pass, plus the 5 new CORS tests.

- [ ] **Step 8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add datacore/src/datacore/api/__init__.py datacore/tests/test_cors_production.py
git commit -m "feat(datacore): production fail-closed CORS and /health endpoint"
```

---

## Task 10: launchpad production CORS fail-closed

**Files:**
- Modify: `launchpad/backend/app/config.py`
- Create: `launchpad/backend/tests/test_cors_production.py`

launchpad uses pydantic-settings with a `_cors_origins()` helper. The refactor mirrors what admindash does: add an `environment` field to `Settings` (or check the env var directly in `_cors_origins()`) and raise in production.

For minimal blast radius and to avoid breaking existing tests that assume the Settings class shape, modify the `_cors_origins()` HELPER FUNCTION to check `ENVIRONMENT` and raise. Do NOT add a new field to `Settings` — that might require touching other code that instantiates the class.

- [ ] **Step 1: Write the failing test**

Create `launchpad/backend/tests/test_cors_production.py`:

```python
"""Tests for production fail-closed CORS on launchpad backend."""
import pytest

from app.config import _cors_origins


def test_dev_mode_with_services_json_default(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    origins = _cors_origins()
    # At least one of the dev frontend origins should be present
    assert any("localhost:5500" in o for o in origins), (
        f"Expected localhost:5500 in dev CORS origins, got: {origins}"
    )


def test_dev_mode_with_env_override(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://example.com")
    origins = _cors_origins()
    assert origins == ["http://example.com"]


def test_production_without_origins_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        _cors_origins()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _cors_origins()


def test_production_with_explicit_origin_succeeds(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://launchpad.floatify.com")
    origins = _cors_origins()
    assert origins == ["https://launchpad.floatify.com"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/test_cors_production.py -v
```

Expected: the two production tests (`test_production_without_origins_raises`, `test_production_with_wildcard_raises`) FAIL because the current `_cors_origins` doesn't raise.

- [ ] **Step 3: Refactor `_cors_origins()` in launchpad/backend/app/config.py**

Read `launchpad/backend/app/config.py`. Replace the `_cors_origins()` function with:

```python
def _cors_origins() -> list[str]:
    environment = os.environ.get("ENVIRONMENT", "development")
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")

    if environment == "production":
        if not env_origins:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS is required in production and must not be empty"
            )
        origins = [o.strip() for o in env_origins.split(",") if o.strip()]
        if "*" in origins:
            raise RuntimeError(
                "wildcard '*' in CORS_ALLOWED_ORIGINS is not permitted in production"
            )
        return origins

    # Dev mode: env var wins if set
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]

    # Dev mode fallback: derive from services.json
    origins = []
    for k in _services:
        if k.endswith("-frontend"):
            port = _services[k].get("port", 0)
            origins.append(f"http://localhost:{port}")
            origins.append(f"http://127.0.0.1:{port}")
    return origins
```

(The rest of config.py — `_load_services`, `_svc_url`, `Settings` class — is unchanged.)

- [ ] **Step 4: Run the CORS test**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/test_cors_production.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run the full launchpad test suite**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/ -v
```

Expected: all existing launchpad tests + the new 5 CORS tests + the 6 Cloudflare IP tests from Task 6 = all green.

**Important:** at import time of `app.config`, the module-level `settings = Settings()` call will invoke `_cors_origins()`. If ANY of the launchpad tests run with `ENVIRONMENT=production` set in their environment (leftover from a previous test in the same process), the import will fail. This is the same fragility pattern we documented in admindash Task 2. Mitigation: ensure tests that manipulate `ENVIRONMENT` via `monkeypatch.setenv` also `monkeypatch.delenv` in teardown. pytest's `monkeypatch` fixture handles this automatically at the end of each test function, so tests within a single run should be fine.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add launchpad/backend/app/config.py launchpad/backend/tests/test_cors_production.py
git commit -m "feat(launchpad): production fail-closed CORS in _cors_origins helper"
```

---

## Task 11: papermite production CORS fail-closed

**Files:**
- Modify: `papermite/backend/app/config.py`
- Create: `papermite/backend/tests/test_cors_production.py`

papermite's `_cors_origins()` function has the same shape as launchpad's. The refactor is identical.

- [ ] **Step 1: Write the failing test**

Create `papermite/backend/tests/test_cors_production.py`:

```python
"""Tests for production fail-closed CORS on papermite backend."""
import pytest

from app.config import _cors_origins


def test_dev_mode_with_services_json_default(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    origins = _cors_origins()
    assert any("localhost:5700" in o for o in origins), (
        f"Expected localhost:5700 in dev CORS origins, got: {origins}"
    )


def test_dev_mode_with_env_override(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://example.com")
    origins = _cors_origins()
    assert origins == ["http://example.com"]


def test_production_without_origins_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        _cors_origins()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _cors_origins()


def test_production_with_explicit_origin_succeeds(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://papermite.floatify.com")
    origins = _cors_origins()
    assert origins == ["https://papermite.floatify.com"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/test_cors_production.py -v
```

Expected: the two production tests FAIL.

- [ ] **Step 3: Refactor `_cors_origins()` in papermite/backend/app/config.py**

Read `papermite/backend/app/config.py`. Replace the `_cors_origins()` function with the same pattern as launchpad's:

```python
def _cors_origins() -> list[str]:
    environment = os.environ.get("ENVIRONMENT", "development")
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")

    if environment == "production":
        if not env_origins:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS is required in production and must not be empty"
            )
        origins = [o.strip() for o in env_origins.split(",") if o.strip()]
        if "*" in origins:
            raise RuntimeError(
                "wildcard '*' in CORS_ALLOWED_ORIGINS is not permitted in production"
            )
        return origins

    # Dev mode: env var wins if set
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]

    # Dev mode fallback: derive from services.json
    origins = []
    for k in _services:
        if k.endswith("-frontend"):
            port = _services[k].get("port", 0)
            origins.append(f"http://localhost:{port}")
            origins.append(f"http://127.0.0.1:{port}")
    return origins
```

- [ ] **Step 4: Run the CORS tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/test_cors_production.py -v
```

Expected: 5 passing.

- [ ] **Step 5: Run the full papermite test suite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/ -v
```

Expected: all existing tests + new CORS tests + the Cloudflare IP tests from Task 7 = all green.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/config.py papermite/backend/tests/test_cors_production.py
git commit -m "feat(papermite): production fail-closed CORS in _cors_origins helper"
```

---

## Task 12: datacore/fly.toml — private network only

**Files:**
- Create: `datacore/fly.toml`

datacore is the highest-value target in the system (JWT signing key, bcrypt hashes, tenant data). It MUST NOT have a public HTTP endpoint. Its `fly.toml` defines only an internal service and a persistent volume.

- [ ] **Step 1: Create `datacore/fly.toml`**

```toml
# Fly.io configuration for datacore
#
# IMPORTANT: datacore is private-network-only. There is NO [http_service]
# block. Sibling Fly apps in the same org reach datacore via Fly's internal
# DNS at `datacore.internal:5800`. There is no public DNS record pointing
# at this app, and it has no Cloudflare in front of it.
#
# The persistent volume stores the LanceDB data. Daily snapshots are retained
# for 7 days as a baseline data-loss safeguard. Off-site backup to Cloudflare
# R2 is a follow-up (see docs/deployment/follow-ups.md).

app = "datacore"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  ENVIRONMENT = "production"
  PORT = "5800"

# Internal service on Fly's private network. No [http_service] means the app
# is NOT reachable from the public internet.
[[services]]
  protocol = "tcp"
  internal_port = 5800

  [[services.ports]]
    port = 5800

  [services.concurrency]
    type = "connections"
    hard_limit = 100
    soft_limit = 50

  [[services.tcp_checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "10s"

# Persistent volume for LanceDB data
[[mounts]]
  source = "datacore_data"
  destination = "/app/data"
  initial_size = "3gb"
  snapshot_retention = 7

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 2: Validate TOML syntax**

```bash
python3 -c "import tomllib; tomllib.loads(open('/Users/kennylee/Development/NeoApex/datacore/fly.toml').read())"
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add datacore/fly.toml
git commit -m "feat(datacore): fly.toml config for private-network-only deploy"
```

Note: this task does NOT run `flyctl deploy`. That happens in Phase 2 after the user has provisioned a Fly.io account. The `fly.toml` is just code committed to the repo.

---

## Task 13: launchpad/backend/fly.toml

**Files:**
- Create: `launchpad/backend/fly.toml`

- [ ] **Step 1: Create `launchpad/backend/fly.toml`**

```toml
# Fly.io configuration for launchpad-api
#
# Public customer-facing service. Fronted by Cloudflare at
# https://api.launchpad.floatify.com. The Cloudflare IP allowlist
# middleware enforces that only Cloudflare-originated traffic is accepted.
#
# In production, the app reads these env vars (set via `flyctl secrets set`):
#   - ENVIRONMENT=production
#   - CORS_ALLOWED_ORIGINS=https://launchpad.floatify.com
#   - LAUNCHPAD_DATACORE_AUTH_URL=http://datacore.internal:5800/auth
#   - LAUNCHPAD_DATACORE_API_URL=http://datacore.internal:5800/api
# (any API keys the service needs)

app = "launchpad-api"
primary_region = "iad"

[build]
  dockerfile = "backend/Dockerfile"

[env]
  PORT = "5510"

[http_service]
  internal_port = 5510
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/api/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

Note: `[build] dockerfile = "backend/Dockerfile"` — this tells Fly.io that when it builds from the context at `launchpad/`, the Dockerfile lives at `backend/Dockerfile`. Matches the `docker build -f backend/Dockerfile launchpad/` invocation from Task 3.

- [ ] **Step 2: Validate TOML syntax**

```bash
python3 -c "import tomllib; tomllib.loads(open('/Users/kennylee/Development/NeoApex/launchpad/backend/fly.toml').read())"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add launchpad/backend/fly.toml
git commit -m "feat(launchpad): fly.toml config for public Fly.io deploy"
```

---

## Task 14: papermite/backend/fly.toml

**Files:**
- Create: `papermite/backend/fly.toml`

- [ ] **Step 1: Create `papermite/backend/fly.toml`**

```toml
# Fly.io configuration for papermite-api
#
# Public customer-facing service. Fronted by Cloudflare at
# https://api.papermite.floatify.com. Cloudflare IP allowlist middleware
# enforces origin protection.
#
# Papermite does document extraction (poppler + libmagic via Dockerfile),
# so memory is higher than the other backends.
#
# Production env vars (set via `flyctl secrets set`):
#   - ENVIRONMENT=production
#   - CORS_ALLOWED_ORIGINS=https://papermite.floatify.com,https://admin.floatify.com
#   - PAPERMITE_DATACORE_AUTH_URL=http://datacore.internal:5800/auth
#   - PAPERMITE_DATACORE_API_URL=http://datacore.internal:5800/api
#   - VOYAGE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY (whatever the AI pipeline needs)

app = "papermite-api"
primary_region = "iad"

[build]
  dockerfile = "backend/Dockerfile"

[env]
  PORT = "5710"

[http_service]
  internal_port = 5710
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "15s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/api/health"

[[vm]]
  size = "shared-cpu-2x"
  memory = "1gb"
```

- [ ] **Step 2: Validate TOML syntax**

```bash
python3 -c "import tomllib; tomllib.loads(open('/Users/kennylee/Development/NeoApex/papermite/backend/fly.toml').read())"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/fly.toml
git commit -m "feat(papermite): fly.toml config for public Fly.io deploy"
```

---

## Task 15: admindash/backend/fly.toml with scale-to-zero

**Files:**
- Create: `admindash/backend/fly.toml`

admindash-api is a thin proxy used by a small number of school administrators. Scale-to-zero saves cost when nobody's using it — the machine wakes on first request (~2s cold start) and sleeps after idle.

- [ ] **Step 1: Create `admindash/backend/fly.toml`**

```toml
# Fly.io configuration for admindash-api
#
# Public customer-facing service powering the admindash school operations
# product. Fronted by Cloudflare at https://api.admin.floatify.com.
# Cloudflare IP allowlist middleware enforces origin protection.
#
# Scale-to-zero enabled because admindash-api is a low-traffic internal
# admin tool — an idle machine costs near-zero. First request after idle
# incurs ~2s cold start; acceptable for an admin dashboard.
#
# Production env vars (set via `flyctl secrets set`):
#   - ENVIRONMENT=production
#   - CORS_ALLOWED_ORIGINS=https://admin.floatify.com
#   - ADMINDASH_DATACORE_URL=http://datacore.internal:5800
#   - ADMINDASH_PAPERMITE_BACKEND_URL=http://papermite-api.internal:5710
# Note: papermite-api.internal is the Fly private DNS for the papermite-api
# sibling app in the same org. No public URL used.

app = "admindash-api"
primary_region = "iad"

[build]
  dockerfile = "backend/Dockerfile"

[env]
  PORT = "5610"

[http_service]
  internal_port = 5610
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/api/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

- [ ] **Step 2: Validate TOML syntax**

```bash
python3 -c "import tomllib; tomllib.loads(open('/Users/kennylee/Development/NeoApex/admindash/backend/fly.toml').read())"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/fly.toml
git commit -m "feat(admindash): fly.toml config with scale-to-zero"
```

---

## Task 16: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

This is the single GitHub Actions workflow that listens for `release: published` events with module-prefixed tags and dispatches to per-module deploy jobs. Each deploy job:
1. Parses the tag to identify the module
2. Waits for production environment approval
3. Logs in to GHCR
4. Builds the Docker image (backends) or triggers a Cloudflare Pages build (frontends)
5. Pushes the image
6. Calls `flyctl deploy --image ghcr.io/.../module:tag -a <app>`

The workflow also supports `workflow_dispatch` as an emergency redeploy path that skips the build step and deploys an existing image by tag.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      module:
        description: 'Module to (re)deploy'
        required: true
        type: choice
        options:
          - datacore
          - launchpad
          - papermite
          - admindash
      version:
        description: 'Release tag to deploy (must already exist as a GitHub Release)'
        required: true
        type: string

concurrency:
  group: deploy-${{ github.event.release.tag_name || format('{0}-{1}', github.event.inputs.module, github.event.inputs.version) }}
  cancel-in-progress: false

permissions:
  contents: read
  packages: write

jobs:
  parse-tag:
    name: Parse release tag
    runs-on: ubuntu-latest
    outputs:
      module: ${{ steps.parse.outputs.module }}
      version: ${{ steps.parse.outputs.version }}
      tag: ${{ steps.parse.outputs.tag }}
    steps:
      - name: Parse tag or dispatch input
        id: parse
        run: |
          set -euo pipefail
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            MODULE="${{ github.event.inputs.module }}"
            VERSION="${{ github.event.inputs.version }}"
            TAG="${VERSION}"
          else
            TAG="${{ github.event.release.tag_name }}"
            if [[ "$TAG" =~ ^(datacore|launchpad|papermite|admindash)-v(.+)$ ]]; then
              MODULE="${BASH_REMATCH[1]}"
              VERSION="${BASH_REMATCH[2]}"
            else
              echo "::error::Release tag '$TAG' does not match <module>-v<semver> pattern"
              exit 1
            fi
          fi
          echo "module=$MODULE" >> "$GITHUB_OUTPUT"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
          echo "Parsed: module=$MODULE version=$VERSION tag=$TAG"

  deploy-datacore:
    name: Deploy datacore (Fly.io)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'datacore'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push datacore image (release event only)
        if: github.event_name == 'release'
        uses: docker/build-push-action@v5
        with:
          context: datacore
          file: datacore/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/datacore:${{ needs.parse-tag.outputs.tag }}

      - name: Install flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_DATACORE }}
        run: |
          flyctl deploy \
            --image ghcr.io/${{ github.repository_owner }}/datacore:${{ needs.parse-tag.outputs.tag }} \
            --config datacore/fly.toml \
            --app datacore

      - name: Deploy summary
        run: |
          echo "## Deployed datacore ${{ needs.parse-tag.outputs.tag }}" >> $GITHUB_STEP_SUMMARY
          echo "Image: ghcr.io/${{ github.repository_owner }}/datacore:${{ needs.parse-tag.outputs.tag }}" >> $GITHUB_STEP_SUMMARY

  deploy-launchpad-api:
    name: Deploy launchpad-api (Fly.io)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'launchpad'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push launchpad-api image (release event only)
        if: github.event_name == 'release'
        uses: docker/build-push-action@v5
        with:
          context: launchpad
          file: launchpad/backend/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/launchpad-api:${{ needs.parse-tag.outputs.tag }}

      - name: Install flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_LAUNCHPAD }}
        run: |
          flyctl deploy \
            --image ghcr.io/${{ github.repository_owner }}/launchpad-api:${{ needs.parse-tag.outputs.tag }} \
            --config launchpad/backend/fly.toml \
            --app launchpad-api

      - name: Deploy summary
        run: |
          echo "## Deployed launchpad-api ${{ needs.parse-tag.outputs.tag }}" >> $GITHUB_STEP_SUMMARY

  deploy-launchpad-frontend:
    name: Deploy launchpad-frontend (Cloudflare Pages)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'launchpad'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: launchpad/frontend/package-lock.json

      - name: Install dependencies
        working-directory: launchpad/frontend
        run: npm ci

      - name: Build
        working-directory: launchpad/frontend
        env:
          VITE_API_BASE_URL: https://api.launchpad.floatify.com
        run: npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy launchpad/frontend/dist --project-name=launchpad-frontend --branch=main

  deploy-papermite-api:
    name: Deploy papermite-api (Fly.io)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'papermite'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push papermite-api image (release event only)
        if: github.event_name == 'release'
        uses: docker/build-push-action@v5
        with:
          context: papermite
          file: papermite/backend/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/papermite-api:${{ needs.parse-tag.outputs.tag }}

      - name: Install flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_PAPERMITE }}
        run: |
          flyctl deploy \
            --image ghcr.io/${{ github.repository_owner }}/papermite-api:${{ needs.parse-tag.outputs.tag }} \
            --config papermite/backend/fly.toml \
            --app papermite-api

      - name: Deploy summary
        run: |
          echo "## Deployed papermite-api ${{ needs.parse-tag.outputs.tag }}" >> $GITHUB_STEP_SUMMARY

  deploy-papermite-frontend:
    name: Deploy papermite-frontend (Cloudflare Pages)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'papermite'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: papermite/frontend/package-lock.json

      - name: Install dependencies
        working-directory: papermite/frontend
        run: npm ci

      - name: Build
        working-directory: papermite/frontend
        env:
          VITE_API_BASE_URL: https://api.papermite.floatify.com
        run: npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy papermite/frontend/dist --project-name=papermite-frontend --branch=main

  deploy-admindash-api:
    name: Deploy admindash-api (Fly.io)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'admindash'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push admindash-api image (release event only)
        if: github.event_name == 'release'
        uses: docker/build-push-action@v5
        with:
          context: admindash
          file: admindash/backend/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/admindash-api:${{ needs.parse-tag.outputs.tag }}

      - name: Install flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_ADMINDASH }}
        run: |
          flyctl deploy \
            --image ghcr.io/${{ github.repository_owner }}/admindash-api:${{ needs.parse-tag.outputs.tag }} \
            --config admindash/backend/fly.toml \
            --app admindash-api

      - name: Deploy summary
        run: |
          echo "## Deployed admindash-api ${{ needs.parse-tag.outputs.tag }}" >> $GITHUB_STEP_SUMMARY

  deploy-admindash-frontend:
    name: Deploy admindash frontend (Cloudflare Pages)
    needs: parse-tag
    if: needs.parse-tag.outputs.module == 'admindash'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: admindash/frontend/package-lock.json

      - name: Install dependencies
        working-directory: admindash/frontend
        run: npm ci

      - name: Build
        working-directory: admindash/frontend
        env:
          VITE_ADMINDASH_API_URL: https://api.admin.floatify.com
        run: npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy admindash/frontend/dist --project-name=admindash --branch=main
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('/Users/kennylee/Development/NeoApex/.github/workflows/deploy.yml').read())"
```

Expected: no output.

- [ ] **Step 3: Check workflow structure**

Spot-check a few things:

```bash
grep -c "^  deploy-" /Users/kennylee/Development/NeoApex/.github/workflows/deploy.yml
```

Expected: 7 (parse-tag is not in this count since it doesn't start with `deploy-`; the 7 are `deploy-datacore`, `deploy-launchpad-api`, `deploy-launchpad-frontend`, `deploy-papermite-api`, `deploy-papermite-frontend`, `deploy-admindash-api`, `deploy-admindash-frontend`).

```bash
grep -c "environment: production" /Users/kennylee/Development/NeoApex/.github/workflows/deploy.yml
```

Expected: 7 (every deploy job enforces production approval).

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add .github/workflows/deploy.yml
git commit -m "feat(ci): GitHub Actions deploy workflow for module-prefixed releases"
```

---

## Task 17: Cloudflare Pages _headers files (CSP)

**Files:**
- Create: `launchpad/frontend/public/_headers`
- Create: `papermite/frontend/public/_headers`
- Create: `admindash/frontend/public/_headers`

Each frontend gets a `_headers` file in its `public/` directory. Cloudflare Pages serves `_headers` to set HTTP headers on responses. The CSP directives lock down script sources, connect sources (to only the paired API origin), frame-ancestors to prevent clickjacking, and disallow inline scripts (unless unavoidable — Vite dev uses them but production builds don't).

- [ ] **Step 1: Create `launchpad/frontend/public/_headers`**

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.launchpad.floatify.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

- [ ] **Step 2: Create `papermite/frontend/public/_headers`**

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.papermite.floatify.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

- [ ] **Step 3: Create `admindash/frontend/public/_headers`**

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.admin.floatify.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Note: the `connect-src` directive differs per frontend — each one allows only its paired API origin.

- [ ] **Step 4: Verify each frontend still builds**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad/frontend && npm run build
cd /Users/kennylee/Development/NeoApex/papermite/frontend && npm run build
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build
```

Expected: all three build cleanly. The `_headers` file in `public/` is copied verbatim to `dist/_headers` during the build.

Verify each:
```bash
ls /Users/kennylee/Development/NeoApex/launchpad/frontend/dist/_headers
ls /Users/kennylee/Development/NeoApex/papermite/frontend/dist/_headers
ls /Users/kennylee/Development/NeoApex/admindash/frontend/dist/_headers
```

Expected: all three files exist in the dist/ output.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add launchpad/frontend/public/_headers \
        papermite/frontend/public/_headers \
        admindash/frontend/public/_headers
git commit -m "feat(frontend): strict CSP headers for Cloudflare Pages"
```

---

## Task 18: Dependabot configuration

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "github-actions"

  # Python backends
  - package-ecosystem: "pip"
    directory: "/datacore"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "python"
      - "datacore"

  - package-ecosystem: "pip"
    directory: "/launchpad"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "python"
      - "launchpad"

  - package-ecosystem: "pip"
    directory: "/papermite"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "python"
      - "papermite"

  - package-ecosystem: "pip"
    directory: "/admindash"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "python"
      - "admindash"

  # Frontend projects
  - package-ecosystem: "npm"
    directory: "/launchpad/frontend"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "javascript"
      - "launchpad"

  - package-ecosystem: "npm"
    directory: "/papermite/frontend"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "javascript"
      - "papermite"

  - package-ecosystem: "npm"
    directory: "/admindash/frontend"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "javascript"
      - "admindash"
```

- [ ] **Step 2: Validate YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('/Users/kennylee/Development/NeoApex/.github/dependabot.yml').read())"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add .github/dependabot.yml
git commit -m "feat(ci): enable Dependabot for python, npm, and github-actions"
```

---

## Task 19: docs/deployment/architecture.md

**Files:**
- Create: `docs/deployment/architecture.md`

- [ ] **Step 1: Create the file**

```bash
mkdir -p /Users/kennylee/Development/NeoApex/docs/deployment
```

Then create `docs/deployment/architecture.md`:

````markdown
# NeoApex Production Architecture

Last updated: 2026-04-11

## Topology

```
                                     Internet (end users, school admins)
                                                   │
                                                   ▼
                          ┌─────────────────────────────────────────────┐
                          │                  Cloudflare                 │
                          │  DNS │ TLS │ WAF │ Pages (static frontends) │
                          └─────────────────────────────────────────────┘
                                 │                        │
                                 │                        │
           ┌─────────────────────┼────────────────┬───────┼────────┐
           │                     │                │       │        │
           ▼                     ▼                ▼       ▼        ▼
     ┌─────────┐         ┌─────────┐       ┌─────────┐ ┌─────┐ ┌──────────┐
     │ launch  │         │papermite│       │ admin   │ │CF   │ │ CF Pages │
     │  pad    │         │ frontend│       │  dash   │ │Pages│ │ (3 sites)│
     │frontend │         │(Pages)  │       │ (Pages) │ │     │ │          │
     │(Pages)  │         └─────────┘       └─────────┘ └─────┘ └──────────┘
     └─────────┘
           │                     │                │
           │ fetch("/api/…")     │                │
           ▼                     ▼                ▼
     ┌──────────┐         ┌──────────┐       ┌──────────┐
     │ launchpad│         │ papermite│       │ admindash│   <-- Fly.io public apps
     │   -api   │         │   -api   │       │ -backend │       (Cloudflare IP allowlist)
     └──────────┘         └──────────┘       └──────────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │ Fly private network
                               ▼
                      ┌────────────────┐
                      │   datacore     │    <-- Fly.io private-network only
                      │                │        (no public DNS)
                      │ + LanceDB vol  │
                      └────────────────┘
```

## Services

| Name | Type | Host | Public URL | Private DNS |
|---|---|---|---|---|
| `datacore` | Python/FastAPI backend | Fly.io (`iad`) | **none** | `datacore.internal:5800` |
| `launchpad-api` | Python/FastAPI backend | Fly.io (`iad`) | `api.launchpad.floatify.com` | `launchpad-api.internal:5510` |
| `papermite-api` | Python/FastAPI backend | Fly.io (`iad`) | `api.papermite.floatify.com` | `papermite-api.internal:5710` |
| `admindash-api` | Python/FastAPI backend | Fly.io (`iad`, scale-to-zero) | `api.admin.floatify.com` | `admindash-api.internal:5610` |
| `launchpad-frontend` | React SPA (static) | Cloudflare Pages | `launchpad.floatify.com` | — |
| `papermite-frontend` | React SPA (static) | Cloudflare Pages | `papermite.floatify.com` | — |
| `admindash` | React SPA (static) | Cloudflare Pages | `admin.floatify.com` | — |

## Trust boundaries and security layers

1. **Cloudflare TLS termination** — every public domain is served over HTTPS by Cloudflare. Certificates auto-renewed.
2. **Cloudflare WAF** — baseline DDoS and bot protection for all public hostnames.
3. **Cloudflare IP allowlist** at the Fly.io public backends — `launchpad-api`, `papermite-api`, `admindash-api` reject any request whose source IP is not in Cloudflare's published IP ranges. This prevents attackers from finding the Fly origin IP (via certificate transparency logs) and bypassing the Cloudflare WAF.
4. **CORS fail-closed** — every backend reads `CORS_ALLOWED_ORIGINS` from env and refuses to start if it's missing or contains `*` in production mode.
5. **DataCore on Fly private network only** — no public DNS, no public HTTP service in `fly.toml`. Reachable only via Fly's internal WireGuard mesh from sibling Fly apps in the same org.
6. **JWT auth via DataCore** — every authenticated request delegates validation to DataCore's `/auth/me`. Only DataCore holds the JWT signing secret.
7. **Production GitHub Environment** — deploys cannot run without a human approving them in the Actions UI.
8. **Per-app Fly.io deploy tokens** — a leaked token for one app cannot be used to deploy a different app.

## Data flow for a typical admindash request

1. Browser at `https://admin.floatify.com` → Cloudflare Pages serves the SPA
2. SPA makes `fetch("https://api.admin.floatify.com/api/query", ...)` with `Authorization: Bearer <jwt>`
3. Cloudflare receives the request, proxies it to the `admindash-api` Fly.io origin
4. `admindash-api`'s `CloudflareIPMiddleware` sees a Cloudflare source IP and allows the request
5. `admindash-api`'s `require_authenticated_user` dependency calls `http://datacore.internal:5800/auth/me` with the bearer token
6. DataCore validates the JWT (signing secret present locally), returns the user object
7. `admindash-api` forwards the `/api/query` body to `http://datacore.internal:5800/api/query` with the original Authorization header
8. DataCore executes the query, returns the result
9. `admindash-api` returns the result verbatim to the browser

## Cost (monthly, approximate)

| Line item | Cost |
|---|---|
| Fly.io: `datacore` (shared-cpu-1x, 512MB, volume) | ~$5–8 |
| Fly.io: `launchpad-api` (shared-cpu-1x, 512MB, min=1) | ~$5–8 |
| Fly.io: `papermite-api` (shared-cpu-2x, 1GB, min=1) | ~$8–15 |
| Fly.io: `admindash-api` (shared-cpu-1x, 256MB, min=0, scale-to-zero) | ~$0.50–3 |
| Cloudflare (Pages, DNS, TLS, WAF basics) | Free |
| GHCR (private image storage) | Free at this scale |
| **Total** | **~$18–35** |

## Deploy lifecycle

See [`release-runbook.md`](./release-runbook.md) for how to cut a release and approve a deploy.

See [`provisioning.md`](./provisioning.md) for first-time setup of Fly.io apps, Cloudflare Pages projects, DNS records, and GitHub Environment/secrets.

See [`follow-ups.md`](./follow-ups.md) for deferred hardening work.
````

- [ ] **Step 2: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add docs/deployment/architecture.md
git commit -m "docs(deployment): production architecture overview"
```

---

## Task 20: docs/deployment/provisioning.md — Phase 2 user runbook

**Files:**
- Create: `docs/deployment/provisioning.md`

This is the runbook for the HUMAN operator to execute Phase 2 — the parts of the deployment pipeline that require real accounts, tokens, DNS changes, and interactive auth flows. Phase 1 of this plan writes all the code; Phase 2 is the user following this runbook.

- [ ] **Step 1: Create the file**

```markdown
# Provisioning Runbook — One-Time Setup

This runbook is for the operator (human) setting up NeoApex production infrastructure for the first time. Follow it top to bottom. Every step here requires interactive authentication or dashboard clicks — **nothing in this runbook can be done by an agent**.

Prerequisites:
- A GitHub account with admin rights on the `neo-apex` repo
- A Cloudflare account that already owns `floatify.com`
- A macOS or Linux workstation with `docker`, `git`, and the ability to install `flyctl`
- A credit card for Fly.io (free tier is not sufficient for persistent volumes)

All steps assume the feat/deployment-pipeline branch is merged and you're on `main`.

## Step 1: Install flyctl and create a Fly.io account

```bash
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"
flyctl version
```

Then sign up (browser-based):

```bash
flyctl auth signup   # or `flyctl auth login` if you already have an account
```

Follow the browser flow. Add a payment method when prompted.

## Step 2: Create the Fly.io organization (or use an existing one)

```bash
flyctl orgs list
```

If you see an org you want to use (likely `personal`), note its slug. Otherwise create one:

```bash
flyctl orgs create floatify
```

Export the org slug as an env var for the rest of this runbook:

```bash
export FLY_ORG=<your-org-slug>
```

## Step 3: Create the four Fly.io apps

```bash
flyctl apps create datacore --org $FLY_ORG
flyctl apps create launchpad-api --org $FLY_ORG
flyctl apps create papermite-api --org $FLY_ORG
flyctl apps create admindash-api --org $FLY_ORG
```

Each command should print `New app created: <name>`. If you get a name collision, pick a different org or an already-unique name and update `app = "..."` in the corresponding `fly.toml`.

## Step 4: Create the DataCore persistent volume

```bash
flyctl volumes create datacore_data \
  --app datacore \
  --region iad \
  --size 3 \
  --snapshot-retention 7
```

Confirm:

```bash
flyctl volumes list --app datacore
```

Expected: one volume named `datacore_data`, 3GB, region `iad`.

## Step 5: Set production secrets on each Fly.io app

**datacore**

```bash
# Generate a JWT signing secret (keep this value — you will never see it again)
JWT_SECRET=$(openssl rand -base64 48)
echo "JWT_SECRET=$JWT_SECRET  # <-- save this somewhere safe"

flyctl secrets set --app datacore \
  ENVIRONMENT=production \
  CORS_ALLOWED_ORIGINS="https://launchpad.floatify.com,https://papermite.floatify.com,https://admin.floatify.com" \
  DATACORE_JWT_SECRET="$JWT_SECRET" \
  VOYAGE_API_KEY="<your-voyage-api-key>"
```

Replace `<your-voyage-api-key>` with the actual key from `~/.zshrc` or your password manager.

**launchpad-api**

```bash
flyctl secrets set --app launchpad-api \
  ENVIRONMENT=production \
  CORS_ALLOWED_ORIGINS="https://launchpad.floatify.com" \
  LAUNCHPAD_DATACORE_AUTH_URL="http://datacore.internal:5800/auth" \
  LAUNCHPAD_DATACORE_API_URL="http://datacore.internal:5800/api"
```

**papermite-api**

```bash
flyctl secrets set --app papermite-api \
  ENVIRONMENT=production \
  CORS_ALLOWED_ORIGINS="https://papermite.floatify.com,https://admin.floatify.com" \
  PAPERMITE_DATACORE_AUTH_URL="http://datacore.internal:5800/auth" \
  PAPERMITE_DATACORE_API_URL="http://datacore.internal:5800/api" \
  ANTHROPIC_API_KEY="<your-anthropic-key>" \
  OPENAI_API_KEY="<your-openai-key>"
```

**admindash-api**

```bash
flyctl secrets set --app admindash-api \
  ADMINDASH_ENVIRONMENT=production \
  ADMINDASH_CORS_ALLOWED_ORIGINS="https://admin.floatify.com" \
  ADMINDASH_DATACORE_URL="http://datacore.internal:5800" \
  ADMINDASH_PAPERMITE_BACKEND_URL="http://papermite-api.internal:5710"
```

## Step 6: Do a first manual deploy of each Fly.io app

This verifies the `fly.toml` files are valid and the Dockerfiles build on Fly's remote builders.

```bash
cd /path/to/NeoApex

# datacore (build context = datacore/)
flyctl deploy --config datacore/fly.toml --app datacore --dockerfile datacore/Dockerfile datacore/

# launchpad-api (build context = launchpad/)
flyctl deploy --config launchpad/backend/fly.toml --app launchpad-api --dockerfile launchpad/backend/Dockerfile launchpad/

# papermite-api
flyctl deploy --config papermite/backend/fly.toml --app papermite-api --dockerfile papermite/backend/Dockerfile papermite/

# admindash-api
flyctl deploy --config admindash/backend/fly.toml --app admindash-api --dockerfile admindash/backend/Dockerfile admindash/
```

Each deploy should end with a healthy machine status.

Verify internal connectivity:

```bash
# SSH into launchpad-api and hit datacore.internal
flyctl ssh console --app launchpad-api -C "curl -s http://datacore.internal:5800/health"
```

Expected: `{"status":"ok"}`.

## Step 7: Create Cloudflare Pages projects

In the Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**:

Create three projects:

1. **launchpad-frontend**
   - Repo: `kennyhlee/neo-apex`
   - Production branch: `main`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `launchpad/frontend`
   - Production environment variables:
     - `VITE_API_BASE_URL` = `https://api.launchpad.floatify.com`
     - (add any other VITE_* values the app needs)

2. **papermite-frontend**
   - Same settings, root directory: `papermite/frontend`
   - `VITE_API_BASE_URL` = `https://api.papermite.floatify.com`

3. **admindash**
   - Root directory: `admindash/frontend`
   - `VITE_ADMINDASH_API_URL` = `https://api.admin.floatify.com`

Let each project do its first build from `main`. Verify each is reachable at its temporary `*.pages.dev` URL.

## Step 8: Add custom domains to each Cloudflare Pages project

In each Pages project → **Custom domains** → **Set up a custom domain**:

- `launchpad-frontend` → `launchpad.floatify.com`
- `papermite-frontend` → `papermite.floatify.com`
- `admindash` → `admin.floatify.com`

Cloudflare will automatically create the CNAME records and provision TLS certificates.

## Step 9: Add Cloudflare DNS records for the Fly.io backends

In Cloudflare dashboard → `floatify.com` → **DNS** → **Records**:

Create three **CNAME** records (proxied, orange cloud on):

| Name | Target | Proxy |
|---|---|---|
| `api.launchpad` | `launchpad-api.fly.dev` | ☁️ Proxied |
| `api.papermite` | `papermite-api.fly.dev` | ☁️ Proxied |
| `api.admin` | `admindash-api.fly.dev` | ☁️ Proxied |

Then tell Fly.io about the custom domains so it can issue certificates:

```bash
flyctl certs add api.launchpad.floatify.com --app launchpad-api
flyctl certs add api.papermite.floatify.com --app papermite-api
flyctl certs add api.admin.floatify.com --app admindash-api
```

Wait for each to show `Ready` (can take a few minutes):

```bash
flyctl certs list --app launchpad-api
flyctl certs list --app papermite-api
flyctl certs list --app admindash-api
```

## Step 10: Generate Fly.io deploy tokens (scoped per app)

These go into GitHub Environment secrets in the next step.

```bash
flyctl tokens create deploy --app datacore --name github-actions-datacore
# Copy the output — this is the ONLY time you will see the token
```

Do the same for the other three apps:

```bash
flyctl tokens create deploy --app launchpad-api --name github-actions-launchpad-api
flyctl tokens create deploy --app papermite-api --name github-actions-papermite-api
flyctl tokens create deploy --app admindash-api --name github-actions-admindash-api
```

## Step 11: Create the Cloudflare API token

In Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token** → **Custom token**:

- Name: `neo-apex-deploy`
- Permissions:
  - `Account` → `Cloudflare Pages` → `Edit`
- Account Resources: include the specific account
- Zone Resources: none needed
- Click **Continue to summary** → **Create Token**
- Copy the token — you will never see it again

Also copy your Cloudflare **Account ID** from the Pages dashboard (right side).

## Step 12: Create the GitHub `production` environment with required reviewer

In GitHub → `neo-apex` repo → **Settings** → **Environments** → **New environment** → name it `production`.

Configure:

- **Required reviewers**: add yourself (and any teammate you trust)
- **Wait timer**: 0 minutes
- **Deployment branches**: restrict to `main`

Then add the environment secrets (Settings → Environments → production → Environment secrets → Add secret):

| Name | Value |
|---|---|
| `FLY_API_TOKEN_DATACORE` | paste datacore token from Step 10 |
| `FLY_API_TOKEN_LAUNCHPAD` | paste launchpad-api token |
| `FLY_API_TOKEN_PAPERMITE` | paste papermite-api token |
| `FLY_API_TOKEN_ADMINDASH` | paste admindash-api token |
| `CLOUDFLARE_API_TOKEN` | paste token from Step 11 |
| `CLOUDFLARE_ACCOUNT_ID` | paste account ID from Step 11 |

## Step 13: Cut the first releases

For each module, tag a release on GitHub:

```bash
cd /path/to/NeoApex
git checkout main
git pull

git tag datacore-v0.1.0
git push origin datacore-v0.1.0

gh release create datacore-v0.1.0 \
  --title "datacore v0.1.0" \
  --notes "Initial production release"
```

The release event triggers the deploy workflow. Go to GitHub → Actions → the new workflow run → click **Review deployments** → approve → the deploy runs.

Repeat for the other three modules:

```bash
git tag launchpad-v0.1.0 && git push origin launchpad-v0.1.0 && gh release create launchpad-v0.1.0 --title "launchpad v0.1.0" --notes "Initial"
git tag papermite-v0.1.0 && git push origin papermite-v0.1.0 && gh release create papermite-v0.1.0 --title "papermite v0.1.0" --notes "Initial"
git tag admindash-v0.1.0 && git push origin admindash-v0.1.0 && gh release create admindash-v0.1.0 --title "admindash v0.1.0" --notes "Initial"
```

## Step 14: Smoke test production

```bash
curl -s https://api.launchpad.floatify.com/api/health
curl -s https://api.papermite.floatify.com/api/health
curl -s https://api.admin.floatify.com/api/health
# Each should return {"status":"ok"}

curl -I https://launchpad.floatify.com
curl -I https://papermite.floatify.com
curl -I https://admin.floatify.com
# Each should return 200 or 304 with a valid TLS cert and CSP header
```

Test the admin flow end-to-end by visiting `https://admin.floatify.com` in a browser, logging in with a real user, and walking through the admindash UI.

## Step 15: Enable branch protection on main

GitHub → repo → **Settings** → **Branches** → **Branch protection rules** → **Add rule**:

- Branch name pattern: `main`
- Require pull request reviews before merging: ✅
- Dismiss stale pull request approvals when new commits are pushed: ✅
- Require status checks to pass: ✅ (Dependabot can be added later)
- Restrict who can push to matching branches: ✅ (admins only)
- Include administrators: optional

Also consider adding a tag protection rule for `*-v*.*.*`.

## Done

At this point, production is live. See [`release-runbook.md`](./release-runbook.md) for day-to-day operations — cutting new releases, approving deploys, and rolling back.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add docs/deployment/provisioning.md
git commit -m "docs(deployment): provisioning runbook for first-time setup"
```

---

## Task 21: docs/deployment/release-runbook.md and follow-ups.md

**Files:**
- Create: `docs/deployment/release-runbook.md`
- Create: `docs/deployment/follow-ups.md`

- [ ] **Step 1: Create `docs/deployment/release-runbook.md`**

```markdown
# Release Runbook — Day-to-Day Deploy Operations

This runbook covers cutting releases, approving deploys, rolling back, and reading logs. For first-time setup, see [`provisioning.md`](./provisioning.md).

## Cutting a release

Releases are triggered by GitHub Releases with module-prefixed tags:

- `datacore-v1.2.0` → deploys only `datacore`
- `launchpad-v0.3.1` → deploys `launchpad-api` + `launchpad-frontend`
- `papermite-v2.0.0-rc.1` → deploys `papermite-api` + `papermite-frontend` (prerelease is fine)
- `admindash-v0.5.0` → deploys `admindash-api` + `admindash` frontend

To cut a release:

```bash
cd /path/to/NeoApex
git checkout main
git pull

# Pick a module and version
MODULE=datacore
VERSION=v1.2.0

git tag ${MODULE}-${VERSION}
git push origin ${MODULE}-${VERSION}

gh release create ${MODULE}-${VERSION} \
  --title "${MODULE} ${VERSION}" \
  --notes "Summary of changes in this release. Commits since last release: ..."
```

The release event triggers the Deploy workflow (`.github/workflows/deploy.yml`), which:

1. Parses the tag prefix to identify the module
2. Enters the `production` GitHub Environment — waiting for reviewer approval
3. Builds the Docker image (for backends) and pushes to GHCR
4. Runs `flyctl deploy` against the target Fly.io app
5. For modules with a frontend, builds and deploys to Cloudflare Pages in parallel

## Approving a deploy

Go to GitHub → `neo-apex` repo → **Actions** → click the pending workflow run → **Review deployments** → check the production environment → click **Approve and deploy**.

Approval is required before ANY deploy step runs. The reviewer should:

- Confirm the tag matches the intended module and version
- Confirm the release notes are sane
- Check `flyctl status --app <app>` if the current state is unclear
- Click Approve

## Rolling back

### Option 1: Deploy a previous image tag (fastest, ~30s)

```bash
gh workflow run deploy.yml \
  -f module=datacore \
  -f version=datacore-v1.1.9
```

This triggers the workflow in `workflow_dispatch` mode, which skips the build step (the image already exists in GHCR) and just runs `flyctl deploy --image ghcr.io/.../datacore:datacore-v1.1.9`. Approve the production environment in Actions as usual.

### Option 2: Rollback via Fly.io CLI (bypasses approval, fastest in a crisis)

```bash
flyctl releases --app datacore   # list recent releases
flyctl deploy --image ghcr.io/kennyhlee/datacore:datacore-v1.1.9 --config datacore/fly.toml --app datacore
```

This requires `flyctl` authenticated with a token that has deploy rights. Bypasses the GitHub Environment approval — use only in emergencies.

### Option 3: Rollback a frontend via Cloudflare Pages dashboard

Cloudflare dashboard → `launchpad-frontend` (or whichever) → **Deployments** → find the previous deployment → **Rollback to this deployment**.

## Reading logs

### Fly.io backends

```bash
flyctl logs --app datacore
flyctl logs --app launchpad-api
flyctl logs --app papermite-api
flyctl logs --app admindash-api
```

Add `--region iad` if you have multi-region. Add `-i` for interactive follow.

### Cloudflare Pages frontends

Cloudflare dashboard → each Pages project → **Deployments** → click a deployment → **Build output** tab.

### GitHub Actions

GitHub → Actions → click any workflow run → expand the job → expand the step.

## Common operations

### Check which version is deployed

```bash
flyctl status --app datacore | grep -i "image\|release"
```

### SSH into a running backend

```bash
flyctl ssh console --app datacore
# inside: hit /health, read logs, inspect state
```

### Secrets rotation

```bash
# Set the new secret
flyctl secrets set --app datacore JWT_SECRET="new-secret-value"

# Fly.io auto-redeploys to pick up the change. Old pods are drained.
```

### Fly.io cert renewal

Fly.io handles this automatically. If a cert status shows `Awaiting configuration`, run:

```bash
flyctl certs show api.launchpad.floatify.com --app launchpad-api
```

and follow the DNS instructions.

### Cloudflare token rotation

Generate a new token at Cloudflare dashboard → My Profile → API Tokens. Update the GitHub Environment secret `CLOUDFLARE_API_TOKEN`. Delete the old token at Cloudflare.

## Emergency contacts / escalation

- Fly.io status page: https://status.flyio.net/
- Cloudflare status page: https://www.cloudflarestatus.com/
- GitHub status page: https://www.githubstatus.com/
```

- [ ] **Step 2: Create `docs/deployment/follow-ups.md`**

```markdown
# Deployment Follow-Ups

Deferred hardening and nice-to-haves. These are intentionally out of scope for the initial deployment-pipeline change and should be tracked as separate OpenSpec changes when prioritized.

## Security hardening

- **Cloudflare Tunnel** instead of IP allowlist for public Fly.io backends. The IP allowlist middleware (`app/middleware/cloudflare_ip.py`) closes the WAF-bypass hole but still has a public Fly IP. Cloudflare Tunnel runs a `cloudflared` sidecar in each Fly.io machine that opens an outbound connection to Cloudflare — the origin has no public IP at all. Stricter but more complex to set up and maintain.

- **Papermite upload hardening** — file size limits enforced at the Fly.io proxy layer, MIME type allowlist, magic-byte validation, ClamAV scanning. Currently the `/api/extract/` endpoint accepts anything a client uploads.

- **JWT → httpOnly cookie migration** — admindash currently stores JWTs in `localStorage`, which is vulnerable to XSS. Move to httpOnly SameSite=Strict cookies. This is a cross-cutting change that affects all four backends + all three frontends + the CORS credential policy.

- **MFA in DataCore's auth layer** — DataCore currently does JWT + bcrypt password auth with no second factor. Adding TOTP MFA would protect against credential stuffing.

- **Cloudflare IP range auto-refresh** — the current middleware hardcodes the Cloudflare IP ranges. A follow-up should fetch the list from `https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6` at container start, or bake the fetch into the Dockerfile at build time.

- **Dependabot auto-merge** — configure auto-merge for Dependabot PRs with patch-level version bumps after CI passes.

- **Image signing and SBOM** — sign images with `cosign` and generate SBOMs via `syft` as part of the deploy workflow.

## Reliability / ops

- **LanceDB off-site backup to Cloudflare R2** — Fly.io volume snapshots are phase 1 insurance but are single-provider. A scheduled GitHub Action should tar the LanceDB directory and upload to an R2 bucket daily. Restore procedure documented and tested quarterly.

- **Multi-region Fly.io topology** — currently single-region (`iad`). If uptime requirements tighten, replicate the backends to a second region. DataCore would need a different strategy (LanceDB replication is not trivial).

- **Staging environment** — a second Fly.io org + Cloudflare Pages branch deployments would give us a place to test deploys before hitting production. Currently deploys go straight to prod after approval.

- **GHCR image cleanup** — the registry grows unbounded as releases accumulate. A scheduled cleanup workflow should prune images older than N days, keeping the last K releases per module.

- **Per-tenant rate limiting** — currently there's no rate limiting at any layer. At minimum, limit login attempts to protect against credential stuffing.

- **Monitoring and alerting** — Fly.io's built-in metrics are enough to start, but there's no paging on downtime. Sentry for error tracking, UptimeRobot or a similar service for HTTP uptime, and ideally Prometheus/Grafana for metrics.

## Platform evolution

- **Floatify-internal ops dashboard** — a separate surface (e.g., `ops.floatify.com`) for Floatify employees to monitor across all tenant schools, debug customer issues, and support engineering. This is where Cloudflare Access SSO belongs (not on admindash, which is customer-facing). Gets its own deployment change.

- **GitHub OIDC federation with Fly.io** — replace long-lived Fly.io deploy tokens with ephemeral OIDC tokens issued by GitHub Actions. Fly.io's OIDC support is maturing; revisit in 6 months.

- **School operations domain logic** — admindash-api is a thin proxy today. Real business logic (enrollment workflows, program rules, RBAC, audit logging) lands in follow-up OpenSpec changes on top of the existing admindash-api scaffolding.
```

- [ ] **Step 3: Commit both files**

```bash
cd /Users/kennylee/Development/NeoApex
git add docs/deployment/release-runbook.md docs/deployment/follow-ups.md
git commit -m "docs(deployment): release runbook and follow-ups list"
```

---

## Task 22: Update top-level CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read the current top-level CLAUDE.md and identify where to add deployment info**

Read `/Users/kennylee/Development/NeoApex/CLAUDE.md`. Look for the sections that exist today: Project Overview, Commands, Service Ports, Architecture.

- [ ] **Step 2: Add a new "Deployment" section after the "Architecture" section**

Insert the following section (place it after the existing "Architecture" section, before any other trailing content):

```markdown
## Deployment

NeoApex deploys to Fly.io (Python backends) and Cloudflare Pages (React frontends) via a GitHub Actions release-tag-triggered pipeline.

**Topology:** `datacore` is on Fly's private network only. `launchpad-api`, `papermite-api`, and `admindash-api` are public Fly.io apps fronted by Cloudflare with an IP allowlist middleware. The three frontends are on Cloudflare Pages at `launchpad.floatify.com`, `papermite.floatify.com`, and `admin.floatify.com`. The API endpoints are at `api.<name>.floatify.com`.

**Release trigger:** publish a GitHub Release with a module-prefixed tag (`datacore-v*`, `launchpad-v*`, `papermite-v*`, `admindash-v*`). The `.github/workflows/deploy.yml` workflow parses the tag, dispatches to per-module deploy jobs, and requires manual approval via the `production` GitHub Environment before any deploy step runs.

**Docs:**
- [`docs/deployment/architecture.md`](docs/deployment/architecture.md) — topology diagram, trust boundaries, cost estimates
- [`docs/deployment/provisioning.md`](docs/deployment/provisioning.md) — one-time setup runbook (Fly.io account, Cloudflare Pages, DNS, secrets, first deploy)
- [`docs/deployment/release-runbook.md`](docs/deployment/release-runbook.md) — cutting releases, approving deploys, rolling back
- [`docs/deployment/follow-ups.md`](docs/deployment/follow-ups.md) — deferred hardening and nice-to-haves
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add CLAUDE.md
git commit -m "docs: add deployment section to top-level CLAUDE.md"
```

---

## Task 23: Final verification

**Files:** none (verification only)

This task runs all the automated checks that can be done without external accounts. If anything fails, fix it before marking Phase 1 complete.

- [ ] **Step 1: Build all 4 Docker images from scratch**

```bash
cd /Users/kennylee/Development/NeoApex
docker build -t datacore-final -f datacore/Dockerfile datacore/
docker build -t launchpad-api-final -f launchpad/backend/Dockerfile launchpad/
docker build -t papermite-api-final -f papermite/backend/Dockerfile papermite/
docker build -t admindash-api-final -f admindash/backend/Dockerfile admindash/
```

Expected: all 4 builds succeed.

- [ ] **Step 2: Run the test suite for each backend**

```bash
cd /Users/kennylee/Development/NeoApex/datacore && uv run pytest tests/ -v
cd /Users/kennylee/Development/NeoApex/launchpad && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
```

Expected: all existing tests pass, plus:
- datacore: 5 new CORS production tests
- launchpad: 5 new CORS + 6 new Cloudflare IP tests = 11 new
- papermite: 5 new CORS + 6 new Cloudflare IP tests = 11 new
- admindash: 6 new Cloudflare IP tests (on top of the 28 from admindash-backend-api)

- [ ] **Step 3: Validate all TOML, YAML, and shell scripts**

```bash
cd /Users/kennylee/Development/NeoApex
python3 -c "import tomllib; tomllib.loads(open('datacore/fly.toml').read())"
python3 -c "import tomllib; tomllib.loads(open('launchpad/backend/fly.toml').read())"
python3 -c "import tomllib; tomllib.loads(open('papermite/backend/fly.toml').read())"
python3 -c "import tomllib; tomllib.loads(open('admindash/backend/fly.toml').read())"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml').read())"
python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml').read())"
bash -n start-services.sh
```

Expected: no output, zero exit codes.

- [ ] **Step 4: Confirm the three _headers files are present in each frontend build output**

Rebuild all three frontends and verify:

```bash
cd /Users/kennylee/Development/NeoApex/launchpad/frontend && npm run build && ls dist/_headers
cd /Users/kennylee/Development/NeoApex/papermite/frontend && npm run build && ls dist/_headers
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build && ls dist/_headers
```

Expected: each `ls` prints the file path.

- [ ] **Step 5: Confirm services still boot locally with TRUST_ALL_IPS=1**

```bash
cd /Users/kennylee/Development/NeoApex
./start-services.sh
```

Expected: all 7 services show `running` in the status table.

```bash
curl -s http://localhost:5610/api/health
```

Expected: `{"status":"ok"}`.

Also confirm datacore is reachable (if you added its /health endpoint in Task 9):

```bash
curl -s http://localhost:5800/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 6: Verify git log and file additions**

```bash
cd /Users/kennylee/Development/NeoApex
git log --oneline main..HEAD
git diff --stat main..HEAD | tail -10
```

Expected: roughly 22 commits (one per task that commits), covering Dockerfiles, fly.toml configs, middleware, CORS refactors, workflow YAML, CSP headers, docs, and Dependabot.

- [ ] **Step 7: Final report**

Output a summary:
- Commits added: N (expected ~22)
- Backend tests passing: (datacore + launchpad + papermite + admindash counts)
- All 4 Docker images build: ✅
- All config files validate: ✅
- Local dev still works: ✅
- Phase 1 complete and ready for PR review + merge.
- Phase 2 (deployment provisioning) begins at [`docs/deployment/provisioning.md`](docs/deployment/provisioning.md).

## Self-Review Checklist

Before declaring the plan done, walk through these:

**1. Spec coverage:**
- ✅ Release pipeline (task groups 14, 16 of openspec tasks.md) → Plan Task 16
- ✅ Per-service Dockerfiles → Plan Tasks 2–5
- ✅ Fly.io configs → Plan Tasks 12–15
- ✅ CORS fail-closed → Plan Tasks 9–11 (admindash already done in previous change)
- ✅ Cloudflare IP allowlist → Plan Tasks 6–8
- ✅ Frontend CSP → Plan Task 17
- ✅ Dependabot → Plan Task 18
- ✅ Documentation → Plan Tasks 19–22
- ✅ DataCore private network + volume → Plan Task 12
- ⚠ GitHub Environment + secrets → Phase 2 (Plan Task 20 runbook)
- ⚠ Cloudflare Pages projects → Phase 2 runbook
- ⚠ DNS records → Phase 2 runbook
- ⚠ First production deploy + rollback verification → Phase 2 runbook

Everything in the openspec tasks.md is covered by either a Plan Task or a Phase 2 runbook step.

**2. Placeholder scan:** None. Every step has exact file paths, complete code blocks, and exact commands with expected output.

**3. Type consistency:**
- `CloudflareIPMiddleware` — defined in Task 6, used identically in Tasks 6, 7, 8 ✅
- `trust_all_ips` parameter — consistent across all three copies ✅
- `FLY_API_TOKEN_*` secret names — `DATACORE`, `LAUNCHPAD`, `PAPERMITE`, `ADMINDASH` — used consistently in Task 16 workflow and Task 20 runbook ✅
- Env var prefixes — `LAUNCHPAD_`, `PAPERMITE_`, `ADMINDASH_` — match the service `env_prefix` in each `pyproject.toml`/`config.py` ✅
- Fly.io app names — `datacore`, `launchpad-api`, `papermite-api`, `admindash-api` — consistent across fly.toml, workflow, provisioning runbook ✅

No issues found.
