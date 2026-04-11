## Why

NeoApex has no production deployment story today. All services run locally via `start-services.sh`, there is no hosting, no CI/CD, no TLS, and no way to ship a new version of any module without manual work. To run Floatify as a real product we need a reliable, low-maintenance pipeline that can deploy each module independently as new releases are cut, so a bug fix in `papermite` never has to wait on unrelated work in `launchpad`, `datacore`, or `admindash`.

## What Changes

- Introduce a GitHub Actions release pipeline triggered by module-prefixed tags (e.g., `datacore-v1.2.0`, `launchpad-v0.3.1`), deploying only the matching module on each release
- Host four Python backends (`datacore`, `launchpad`, `papermite`, `admindash-api`) on Fly.io, one app per backend, with containerized builds pushed from CI. **Note**: `admindash-api` is being introduced in the parallel `admindash-backend-api` change as the school operations backend powering the admindash product; this change adds it to the production deployment topology
- Host the three React frontends (`launchpad`, `papermite`, `admindash`) on Cloudflare Pages, one project per frontend, building directly from the repo
- Place `datacore` on Fly.io's **private network only** (no public DNS, reached via `datacore.internal` from sibling backends), closing the largest blast-radius surface
- Treat `admindash-api` as a public customer-facing backend on the same footing as `launchpad-api` and `papermite-api` — public Fly.io app with Cloudflare-proxied DNS, fail-closed CORS, and Cloudflare IP allowlist. **Admindash users are school administrators (customers), not Floatify employees**, so the earlier "Cloudflare Access in front of admindash" idea is wrong and is removed from this change. Authentication is the standard DataCore JWT flow proxied through `admindash-api`.
- Lock Fly.io backend ingress to Cloudflare IP ranges so the Cloudflare WAF cannot be bypassed by hitting the Fly origin directly
- Require a manual approval on the `production` GitHub Environment before any deploy workflow runs, so a leaked token or rogue release cannot ship code without a human click
- Introduce per-service `fly.toml` configs, Dockerfiles, and Cloudflare Pages build config committed to the repo
- Route traffic via Cloudflare DNS under `floatify.com` subdomains (`launchpad.floatify.com`, `api.launchpad.floatify.com`, `papermite.floatify.com`, `api.papermite.floatify.com`, `admin.floatify.com`, `api.admin.floatify.com`)
- Configure daily Fly.io volume snapshots for the `datacore` LanceDB volume as a baseline data-loss safeguard
- Enable GitHub Dependabot on the repo for supply-chain visibility

## Capabilities

### New Capabilities

- `release-pipeline`: GitHub Actions workflow that detects module-prefixed release tags, routes to the correct per-module deploy job, enforces production approval gates, and manages scoped deploy tokens
- `backend-hosting`: Fly.io deployment of the four Python FastAPI backends (`datacore`, `launchpad-api`, `papermite-api`, `admindash-api`), including per-app `fly.toml` configuration, private-network-only setup for `datacore`, persistent volume for LanceDB, daily volume snapshots, CORS lockdown, and Cloudflare-only ingress restriction on the three public backends
- `frontend-hosting`: Cloudflare Pages deployment of the three React frontends, including per-project build configuration, custom domain mapping under `floatify.com`, and strict Content-Security-Policy headers via `_headers` files

### Modified Capabilities

<!-- None — this change introduces new production infrastructure and does not alter existing spec requirements. -->

### Removed from this change

- **`admin-access-control`** (previously listed): Was based on the assumption that admindash is an internal Floatify ops tool. Reframed during review — admindash is the school operations *product* used by school administrator customers, not by Floatify employees. Cloudflare Access SSO does not fit a customer-facing product. The capability is removed from this change. A separate future need has been noted (see Impact below) for a Floatify-internal ops/observability dashboard, which would be a different surface and would legitimately use Cloudflare Access — but that does not exist today and is out of scope here.

## Impact

- **New repo artifacts**: per-service `Dockerfile`, `fly.toml`, `.dockerignore`, and Cloudflare Pages `_headers`/`_redirects`; GitHub Actions workflow(s) under `.github/workflows/`
- **Existing code touched**: backend CORS config must read `CORS_ALLOWED_ORIGINS` from env in production for all four backends; service URL resolution in frontends must honor `VITE_*` env overrides at build time (already partly supported per `CLAUDE.md`); `launchpad`/`papermite`/`admindash-api` must reach `datacore` at `datacore.internal:5800` in production via the appropriate env var (`LAUNCHPAD_DATACORE_AUTH_URL`, etc.)
- **External dependencies**: Fly.io account, Fly.io CLI (`flyctl`) in CI, GitHub Container Registry (GHCR) for image storage, Cloudflare Pages + Cloudflare DNS (existing Cloudflare account). **Cloudflare Access is no longer required for this change.**
- **Secrets added to GitHub**: `FLY_API_TOKEN_DATACORE`, `FLY_API_TOKEN_LAUNCHPAD`, `FLY_API_TOKEN_PAPERMITE`, `FLY_API_TOKEN_ADMINDASH` (per-app scoped deploy tokens), `CLOUDFLARE_API_TOKEN` (scoped to Pages:Edit for the three projects), `CLOUDFLARE_ACCOUNT_ID`
- **DNS changes** in Cloudflare for `floatify.com`: add CNAMEs for the six subdomains above (`launchpad`, `api.launchpad`, `papermite`, `api.papermite`, `admin`, `api.admin`)
- **Cross-change dependency**: This change depends on the `admindash-backend-api` change being implemented first so that an `admindash/backend/` FastAPI service exists to be deployed. The dependency is one-directional: `admindash-backend-api` lands locally, then this change adds it to production.
- **Future need flagged but NOT in scope**: A Floatify-internal ops/observability dashboard (for Floatify employees to monitor all tenants, debug across schools, support customers) would be the right place for Cloudflare Access SSO. It does not exist today. When it is built, it gets its own deployment change and its own subdomain (e.g., `ops.floatify.com`) with Cloudflare Access in front of it.
- **Not changed by this proposal** (deferred to follow-up changes): LanceDB off-site backup to R2, Papermite upload hardening, JWT → httpOnly cookie migration, Cloudflare Tunnel upgrade from IP allowlist, Floatify-internal ops dashboard
- **Cost impact**: ~$16–27/month on Fly.io (~$1–2/mo added for the new admindash-api app, mostly free if scale-to-zero is enabled and it sees light traffic); Cloudflare Pages, DNS, and GHCR are free at this scale
