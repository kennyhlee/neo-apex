## 1. Preflight and account setup

- [ ] 1.1 Confirm Fly.io region (default `iad`) with the user before provisioning any resources
- [ ] 1.2 Create the Fly.io organization (or reuse an existing one) and verify `flyctl auth` works locally for the operator
- [ ] 1.3 Verify the prerequisite `admindash-backend-api` change has been merged to `main` so that `admindash/backend/` exists as a deployable FastAPI service. This change cannot be implemented before that one lands.

## 2. Per-service Dockerfiles

- [ ] 2.1 Write `datacore/Dockerfile` based on `python:3.13-slim`, installing with `uv sync --frozen`, running as a non-root user, exposing port 5800, with `CMD` starting the FastAPI app via `uvicorn`
- [ ] 2.2 Write `datacore/.dockerignore` excluding `.venv`, `tests/`, `*.pyc`, local LanceDB data, and editor junk
- [ ] 2.3 Write `launchpad/backend/Dockerfile` following the same pattern, exposing port 5510
- [ ] 2.4 Write `launchpad/backend/.dockerignore`
- [ ] 2.5 Write `papermite/backend/Dockerfile` following the same pattern, exposing port 5710, including any system dependencies needed for document parsing (e.g., `poppler-utils`, `libmagic`)
- [ ] 2.6 Write `papermite/backend/.dockerignore`
- [ ] 2.7 Write `admindash/backend/Dockerfile` following the same pattern, exposing port 5610. (No special system dependencies needed; admindash-api is a thin proxy with FastAPI + httpx only.)
- [ ] 2.8 Write `admindash/backend/.dockerignore`
- [ ] 2.9 Verify each image builds locally with `docker build -t <module>-test <path>` and that `docker run` starts the service on the expected port

## 3. Health check endpoints

- [ ] 3.1 Verify `datacore` exposes a health endpoint returning HTTP 200 with a small JSON body; add `/health` in the FastAPI app if it does not exist
- [ ] 3.2 Verify `launchpad` backend exposes `/health`; add if missing
- [ ] 3.3 Verify `papermite` backend exposes `/health`; add if missing
- [ ] 3.4 Verify `admindash` backend exposes `/api/health` (already added by the `admindash-backend-api` change)
- [ ] 3.5 Ensure `/health` endpoints do not require authentication and do not touch the database on the happy path (avoids cascading failure during DB blips)

## 4. Production CORS fail-closed

- [ ] 4.1 In `datacore`'s startup code, refactor CORS configuration so that when `ENVIRONMENT=production` (or equivalent), `CORS_ALLOWED_ORIGINS` is required and the process exits with a non-zero status if unset or empty
- [ ] 4.2 Repeat for `launchpad` backend
- [ ] 4.3 Repeat for `papermite` backend
- [ ] 4.4 Confirm `admindash` backend already implements production CORS fail-closed (added by the `admindash-backend-api` change)
- [ ] 4.5 Update each backend's README or service `CLAUDE.md` with the new required env var

## 5. DataCore URL injection for sibling backends

- [ ] 5.1 Verify `launchpad` backend reads `LAUNCHPAD_DATACORE_AUTH_URL` (or the current equivalent) from env and uses it for all DataCore calls; refactor if any code paths still read from `services.json` at runtime in production
- [ ] 5.2 Repeat for `papermite` backend, using its equivalent env var
- [ ] 5.3 Confirm `admindash` backend reads `DATACORE_URL` and `PAPERMITE_BACKEND_URL` from env (already wired by the `admindash-backend-api` change)
- [ ] 5.4 Document that in production these env vars MUST point at `http://datacore.internal:5800` and `http://papermite-api.internal:5710` respectively

## 6. Fly.io app configuration

- [ ] 6.1 Write `datacore/fly.toml` with: `app = "datacore"`, primary region, no `[http_service]` block (private network only), `[[services]]` on internal port only, `[[mounts]]` for a persistent volume at the LanceDB data path, daily snapshot retention configured, HTTP health check on `/health`
- [ ] 6.2 Write `launchpad/backend/fly.toml` with: `app = "launchpad-api"`, public `[http_service]` with `force_https = true`, health check on `/health`
- [ ] 6.3 Write `papermite/backend/fly.toml` with: `app = "papermite-api"`, public `[http_service]` with `force_https = true`, health check on `/health`
- [ ] 6.4 Write `admindash/backend/fly.toml` with: `app = "admindash-api"`, public `[http_service]` with `force_https = true`, `auto_stop_machines = true`, `auto_start_machines = true`, `min_machines_running = 0` (or 1 if cold-start latency is judged user-visible after first deploy), HTTP health check on `/api/health`, `[[vm]]` size `shared-cpu-1x` with 256mb memory
- [ ] 6.5 Create the four Fly.io apps via `flyctl apps create datacore|launchpad-api|papermite-api|admindash-api` (idempotent if already created)
- [ ] 6.6 Create the DataCore persistent volume via `flyctl volumes create datacore_data -a datacore --size 3 --region <region> --snapshot-retention 7`
- [ ] 6.7 Set production secrets on each Fly.io app via `flyctl secrets set`. For admindash-api specifically: `ENVIRONMENT=production`, `DATACORE_URL=http://datacore.internal:5800`, `PAPERMITE_BACKEND_URL=http://papermite-api.internal:5710`, `CORS_ALLOWED_ORIGINS=https://admin.floatify.com`. For datacore/launchpad/papermite: their respective JWT secrets, internal URLs, CORS allowed origins, API keys (e.g., `VOYAGE_API_KEY`).
- [ ] 6.8 Do a first manual `flyctl deploy` of each app from a local machine to verify the `fly.toml` is valid before wiring CI

## 7. Cloudflare IP allowlist middleware

- [ ] 7.1 Add a small FastAPI middleware to `launchpad` backend that rejects requests whose `CF-Connecting-IP` is absent or whose immediate source IP is not within Cloudflare's published IP ranges, returning HTTP 403
- [ ] 7.2 Repeat for `papermite` backend
- [ ] 7.3 Repeat for `admindash` backend (the new `admindash/backend/`); add the middleware after the existing CORS middleware, conditional on `ENVIRONMENT=production`
- [ ] 7.4 Hardcode the Cloudflare IPv4+IPv6 ranges in a module-level constant for phase 1 (documented to refresh manually); leave a `TODO` and a follow-up task for fetching at startup. Consider extracting this to a small shared utility imported by all three backends to avoid drift.
- [ ] 7.5 Make the middleware skippable via env var (`TRUST_ALL_IPS=1`) for local development so Docker Compose and localhost testing are not blocked

## 8. GitHub Container Registry setup

- [ ] 8.1 Enable GHCR for the repository (enabled by default on github.com; verify permissions)
- [ ] 8.2 Verify the GITHUB_TOKEN in Actions has `packages: write` permission (or create a dedicated PAT if needed)

## 9. GitHub Environment and secrets

- [ ] 9.1 In repo settings, create a GitHub Environment named `production` with at least one required reviewer (the operator)
- [ ] 9.2 Generate four Fly.io deploy tokens via `flyctl tokens create deploy -a datacore|launchpad-api|papermite-api|admindash-api`; store as `FLY_API_TOKEN_DATACORE`, `FLY_API_TOKEN_LAUNCHPAD`, `FLY_API_TOKEN_PAPERMITE`, `FLY_API_TOKEN_ADMINDASH` on the `production` environment
- [ ] 9.3 Generate a Cloudflare API token scoped to `Pages:Edit` for the three frontend projects; store as `CLOUDFLARE_API_TOKEN` on the `production` environment
- [ ] 9.4 Store `CLOUDFLARE_ACCOUNT_ID` on the `production` environment

## 10. Release deploy workflow

- [ ] 10.1 Create `.github/workflows/deploy.yml` triggered by `release: published` and `workflow_dispatch` (with `module` and `version` inputs; `module` choices: `datacore`, `launchpad`, `papermite`, `admindash`)
- [ ] 10.2 Add a `parse-tag` job that parses `github.event.release.tag_name` (or the dispatch input) into a `module` output and fails fast on unknown prefixes
- [ ] 10.3 Add a `deploy-datacore` job conditional on `module == 'datacore'`, running inside `environment: production`, that: logs in to GHCR, builds `datacore/Dockerfile`, tags as `ghcr.io/<owner>/datacore:<tag>`, pushes, then runs `flyctl deploy --image ... -a datacore` using `FLY_API_TOKEN_DATACORE`
- [ ] 10.4 Add `deploy-launchpad-api` with the same pattern using `FLY_API_TOKEN_LAUNCHPAD`
- [ ] 10.5 Add `deploy-papermite-api` with the same pattern using `FLY_API_TOKEN_PAPERMITE`
- [ ] 10.6 Add `deploy-admindash-api` conditional on `module == 'admindash'`, running inside `environment: production`, with the same Docker-build-and-deploy pattern using `FLY_API_TOKEN_ADMINDASH` and the `admindash/backend/Dockerfile`
- [ ] 10.7 Add `deploy-launchpad-frontend` conditional on `module == 'launchpad'`, running inside `environment: production`, that calls the Cloudflare Pages API to trigger a production deployment of the `launchpad-frontend` project (or runs `wrangler pages deploy`)
- [ ] 10.8 Add `deploy-papermite-frontend` with the same pattern
- [ ] 10.9 Add `deploy-admindash-frontend` conditional on `module == 'admindash'`. Note: an `admindash-v*` release tag fires both `deploy-admindash-api` (Fly.io) and `deploy-admindash-frontend` (Cloudflare Pages) in the same workflow run
- [ ] 10.10 Ensure `workflow_dispatch` mode skips the Docker build and pulls the existing image tag for backends (rollback path)
- [ ] 10.11 Add a summary step at the end of each job that prints the deployed version, the image digest (for backends), and the Cloudflare Pages deployment URL (for frontends) to the Actions run summary

## 11. Cloudflare Pages projects

- [ ] 11.1 In the Cloudflare dashboard, create a Pages project `launchpad-frontend` connected to the repo, set production branch to `main`, root directory to `launchpad/frontend`, build command `npm run build`, output directory `dist`
- [ ] 11.2 Set production environment variables on the `launchpad-frontend` project: `VITE_API_BASE_URL=https://api.launchpad.floatify.com` and any other required `VITE_*` values
- [ ] 11.3 Create Pages project `papermite-frontend` with the same pattern, root `papermite/frontend`, `VITE_API_BASE_URL=https://api.papermite.floatify.com`
- [ ] 11.4 Create Pages project `admindash` with the same pattern, root `admindash/frontend`. Set `VITE_ADMINDASH_API_URL=https://api.admin.floatify.com` so the SPA targets the new admindash-api Fly.io app.
- [ ] 11.5 Write `launchpad/frontend/public/_headers` with a strict CSP including `frame-ancestors 'none'`, explicit `script-src`, and `connect-src` listing the matching API origin
- [ ] 11.6 Write `papermite/frontend/public/_headers` similarly
- [ ] 11.7 Write `admindash/frontend/public/_headers` similarly
- [ ] 11.8 Verify a first production build completes for each project on the temporary `*.pages.dev` URL before adding custom domains

## 12. DNS and custom domains

- [ ] 12.1 In Cloudflare DNS for `floatify.com`, add CNAME/A records for `launchpad`, `api.launchpad`, `papermite`, `api.papermite`, `admin`, and `api.admin` pointing at the Fly.io and Pages endpoints
- [ ] 12.2 Add the custom domain to each Cloudflare Pages project in the dashboard and verify the domain status becomes `Active`
- [ ] 12.3 Add the custom domain to each public Fly.io app via `flyctl certs add api.launchpad.floatify.com -a launchpad-api`, `flyctl certs add api.papermite.floatify.com -a papermite-api`, `flyctl certs add api.admin.floatify.com -a admindash-api` and verify certificate issuance
- [ ] 12.4 Verify all six subdomains load successfully over HTTPS end-to-end

## 13. Admindash access posture confirmation

- [ ] 13.1 Confirm that admindash is treated as a public customer-facing surface, NOT behind Cloudflare Access. School administrators must be able to log in from any browser. (This task replaces the earlier "Cloudflare Access for admindash" task group, which was based on the incorrect assumption that admindash is an internal Floatify ops tool. See design.md Decision 6 for the rationale.)
- [ ] 13.2 Verify the admindash login flow works end-to-end after DNS cutover: navigate to `https://admin.floatify.com`, log in with a test school admin user, observe that the browser hits `https://api.admin.floatify.com/auth/login`, that admindash-api forwards to DataCore via the private network, and that the JWT lands in the browser
- [ ] 13.3 Note in `docs/deployment/follow-ups.md` that a separate Floatify-internal ops/observability dashboard will eventually need its own surface (e.g., `ops.floatify.com`) with Cloudflare Access in front of it. That is a different change and is not built here.

## 14. Dependabot and repo hygiene

- [ ] 14.1 Add `.github/dependabot.yml` with updates enabled for `pip` (per backend `pyproject.toml`), `npm` (per frontend `package.json`), and `github-actions` ecosystems
- [ ] 14.2 Protect the `main` branch in repo settings: require pull request reviews, disallow force pushes, require signed commits if feasible
- [ ] 14.3 Add a branch protection rule for release tags matching `*-v*` requiring the tag to be created by a repo admin (if supported), or document the policy in `CONTRIBUTING.md`

## 15. First production deploy end-to-end

- [ ] 15.1 Cut a `datacore-v0.1.0` GitHub Release; verify the deploy workflow runs, awaits approval, is approved, builds the image, pushes to GHCR, and deploys to Fly.io
- [ ] 15.2 Verify `datacore.internal:5800` is reachable from `launchpad-api` and `admindash-api` by SSHing in via `flyctl ssh console -a launchpad-api` (and `-a admindash-api`) and curling the endpoint
- [ ] 15.3 Cut a `launchpad-v0.1.0` release; verify both the backend Fly.io app and the Cloudflare Pages frontend rebuild and deploy
- [ ] 15.4 Cut a `papermite-v0.1.0` release; verify the same
- [ ] 15.5 Cut an `admindash-v0.1.0` release; verify both `admindash-api` (Fly.io) and `admindash` (Cloudflare Pages) deploy in the same workflow run, then walk through the admindash login + main flows from a browser to verify end-to-end
- [ ] 15.6 Verify that cutting a new `datacore-v0.1.1` release does not restart, redeploy, or rebuild any other module
- [ ] 15.7 Verify that cutting a new `admindash-v0.1.1` release does not restart, redeploy, or rebuild `datacore`, `launchpad-api`, `papermite-api`, or any other frontend

## 16. Rollback verification

- [ ] 16.1 Practice a rollback: use `workflow_dispatch` with `module=datacore` and `version=datacore-v0.1.0` and verify the previous image is deployed without rebuild
- [ ] 16.2 Practice a Cloudflare Pages rollback via the dashboard on one of the frontend projects

## 17. Documentation

- [ ] 17.1 Update top-level `CLAUDE.md` with production URLs (six subdomains), the release-tag convention, the deploy workflow location, and links to the relevant runbooks
- [ ] 17.2 Add `docs/deployment/release-runbook.md` covering: how to cut a release, how to approve a deploy, how to roll back, how to read Fly.io logs, how to renew Cloudflare tokens
- [ ] 17.3 Add `docs/deployment/architecture.md` with a diagram (ASCII is fine) of the production topology: Cloudflare → Pages/Fly → DataCore private network. Include all four Fly.io backends (`datacore`, `launchpad-api`, `papermite-api`, `admindash-api`) and clearly show that `datacore` has no public DNS while the other three are Cloudflare-fronted.
- [ ] 17.4 Document the deferred follow-ups in `docs/deployment/follow-ups.md` so they are not forgotten:
  - LanceDB off-site backup to Cloudflare R2
  - Papermite upload hardening (file size limits, MIME validation)
  - JWT → httpOnly cookie migration
  - Cloudflare Tunnel upgrade (replacing the IP allowlist)
  - **Floatify-internal ops/observability dashboard** — separate surface from the customer-facing admindash, would live at `ops.floatify.com` (or similar), would be the right place for Cloudflare Access SSO. Not built in this change.
  - GHCR image cleanup workflow
  - Per-tenant rate limiting on the public backends
