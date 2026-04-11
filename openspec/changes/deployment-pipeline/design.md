## Context

NeoApex is a monorepo with five active services: `datacore` (Python/FastAPI + LanceDB, central auth and storage), `launchpad` (Python backend + React frontend, tenant onboarding), `papermite` (Python backend + React frontend, document ingestion + AI extraction), `admindash` (the **school operations product** used by school administrator customers — React frontend backed by a new `admindash/backend/` FastAPI service introduced in the parallel `admindash-backend-api` change), and `ui-tokens` (shared CSS package, not independently deployed). All services currently run locally via `start-services.sh` with ports defined in `services.json`. There is no production hosting, no CI/CD, no container builds, and the only existing `.github/workflow` is `discord-release.yml`, which posts to Discord when a GitHub Release is published.

**Important reframing during review:** an earlier version of this design treated admindash as an internal Floatify ops tool and proposed Cloudflare Access in front of it. That was wrong — admindash users are school administrators (customers of Floatify-customer schools), not Floatify employees, so an SSO allowlist does not fit. Admindash is a customer-facing product on the same footing as launchpad and papermite. The "Cloudflare Access for admindash" decision has been removed from this change. A future Floatify-internal ops/observability dashboard (a different surface that does not exist yet) would be the right home for Cloudflare Access; that would be its own change.

The team is two people. The priorities stated by the user are **reliability** and **ease of maintenance** over cost minimization, and the domain `floatify.com` is already registered on Cloudflare with an existing marketing page. There is no existing Fly.io or Kubernetes footprint. DataCore is the single source of truth for authentication (JWT/bcrypt) and tenant-scoped data, so its blast radius if compromised is larger than any other service.

Multi-tenancy is enforced in application code: tenant IDs are embedded in JWTs and API routes check `user.tenant_id == request.tenant_id`. The auth layer does not yet support MFA. The JWT is stored in `localStorage` per existing convention.

This change depends on the parallel `admindash-backend-api` change being implemented first, so that an `admindash/backend/` FastAPI service exists locally to be containerized and deployed to Fly.io. The dependency is one-directional and easy to satisfy because `admindash-backend-api` is intentionally scoped to "build and validate locally" without touching production.

## Goals / Non-Goals

**Goals:**

- Each module can be deployed independently on its own release cadence — a new `papermite` release must never require redeploying `datacore`, `launchpad`, `admindash`, or `admindash-backend`
- Deploys are triggered by a single, low-ambiguity action (publishing a GitHub Release with a module-prefixed tag) with a manual approval gate before anything ships
- Production is publicly accessible over HTTPS on `floatify.com` subdomains with TLS managed by the hosting platform (no certbot, no renewal scripts)
- The DataCore service, which holds all tenant data and mints auth tokens, is not reachable from the public internet at all
- All four backends (`datacore`, `launchpad-api`, `papermite-api`, `admindash-backend`) are deployed as Fly.io apps; the three public ones (`launchpad-api`, `papermite-api`, `admindash-backend`) are reachable only via Cloudflare's IP ranges so the WAF cannot be bypassed
- Admindash is a public customer-facing product surface — school administrators must be able to log in from any browser, anywhere, with their school-issued credentials, the same way customers reach `launchpad.floatify.com` or `papermite.floatify.com`
- Secrets scoped per app and per environment so that any single leaked token has bounded blast radius
- Monthly cost stays under ~$30 for a 2-person team
- Zero manual OS, kernel, TLS cert, or reverse proxy maintenance

**Non-Goals:**

- Multi-region or high-availability topology (single-region is acceptable for phase 1)
- Blue/green or canary deploys (rolling restart via Fly.io defaults is acceptable)
- Horizontal autoscaling (vertical scaling only for phase 1)
- Off-site LanceDB backup to Cloudflare R2 (deferred to a follow-up change; Fly.io volume snapshots only for phase 1)
- Migrating the `localStorage` JWT to httpOnly cookies (architectural change, separate initiative)
- Hardening document upload handling in Papermite (separate security initiative)
- Deploying the placeholder modules `apexflow`, `enrollx`, `familyhub`, `sampledoc` (empty directories)
- Deploying `ui-tokens` as a standalone service (it is a shared CSS package consumed at build time by the frontends)
- Staging/preview environments (phase 1 is production-only; PR previews on Cloudflare Pages are a nice-to-have not guaranteed by this change)
- A separate Floatify-internal ops/observability dashboard for Floatify employees (would be a different surface from the customer-facing admindash, would legitimately use Cloudflare Access SSO, but does not exist today and is its own future change)
- Building any school-operations domain logic (enrollment workflows, program rules, RBAC, audit log) — that is the responsibility of follow-up changes that build on top of `admindash-backend-api`

## Decisions

### Decision 1: Fly.io for backends, Cloudflare Pages for frontends

**Choice:** Host the four Python FastAPI backends (`datacore`, `launchpad-api`, `papermite-api`, `admindash-backend`) on Fly.io, one app per service. Host the three React frontends on Cloudflare Pages, one project per frontend. Use Cloudflare DNS (already in place for `floatify.com`) to route traffic.

**Alternatives considered:**

- **Docker on a single VPS (Hetzner/DigitalOcean)** — cheapest (~$5/mo) but requires OS patching, manual TLS setup, reverse proxy config, backup scripts, and on-call for a 2-person team. Rejected on maintenance grounds.
- **Railway** — simpler DX than Fly.io but pricing scales per seat ($40/mo for 2 Pro seats before usage). Volume support less mature than Fly's, which matters for LanceDB. Rejected on cost + data-layer maturity.
- **Render** — similar to Railway; comparable cost, slightly less mature volume story. Acceptable fallback but no decisive advantage over Fly.io.
- **Kubernetes (GKE/EKS/AKS)** — operational overhead is prohibitive for a 2-person team ($75–200/mo plus Kubernetes expertise tax). Rejected as overkill.
- **Vercel/Netlify for frontends** — viable free alternatives to Cloudflare Pages, but Cloudflare Pages keeps everything (DNS, TLS, marketing site, Access, Pages) in one account the user already has. Rejected on vendor consolidation grounds.

**Rationale:** Fly.io offers per-app deploys (fits "one at a time" requirement natively), built-in TLS, automatic health checks and restarts, persistent volumes with snapshots, and scoped deploy tokens — all at ~$15–25/mo for this workload. Cloudflare Pages is free, globally CDN-backed, and lives in the account the user already operates for `floatify.com`. Together they deliver the reliability/maintenance priorities at the cost ceiling.

### Decision 2: DataCore on Fly's private network only

**Choice:** Configure the `datacore` Fly.io app with no public HTTP service. It is reachable only via Fly's internal `datacore.internal` DNS from sibling Fly apps in the same organization. `launchpad-api`, `papermite-api`, and `admindash-backend` are all configured with `DATACORE_URL=http://datacore.internal:5800` (or the per-service equivalent env var) in production.

**Alternatives considered:**

- **Public DataCore behind Cloudflare + WAF rules** — adds a WAF layer but still exposes the auth/storage origin to credential stuffing, zero-day scanning, and DDoS. A WAF is defense in depth, not a substitute for network isolation.
- **Cloudflare Tunnel terminating at DataCore** — airtight, but adds a `cloudflared` sidecar to maintain inside the container and complicates intra-Fly routing for sibling backends.

**Rationale:** DataCore holds every JWT secret and every tenant's data. The only callers that legitimately need to reach it are the three sibling backends running in the same Fly org. Making it unreachable from the public internet eliminates an entire category of risk (credential stuffing, API fuzzing, zero-day scanners) for zero architectural cost. The admindash frontend, which historically called DataCore directly from the browser, no longer does so once `admindash-backend-api` lands — admindash now talks only to `admindash-backend`, which talks to `datacore.internal`. This decision is safe to make because the prerequisite frontend retargeting is the responsibility of the parallel `admindash-backend-api` change.

### Decision 3: Release trigger = GitHub Release with module-prefixed tag

**Choice:** Deploys are triggered by the `release: published` event. Tag naming convention is `<module>-v<semver>`, e.g., `datacore-v1.2.0`, `launchpad-v0.3.1`, `papermite-v2.0.0-rc.1`, `admindash-v0.4.0`. A single workflow file reads `github.event.release.tag_name`, parses the prefix, and dispatches to a per-module deploy job using a matrix filter. Only the job matching the prefix runs; the others are skipped.

**Alternatives considered:**

- **One workflow file per module** — more files but each is simpler. Trade-off is duplicated boilerplate and harder cross-cutting changes (e.g., upgrading the shared login-to-Fly step).
- **Path-based auto-deploy on push to `main`** — no tags needed, less friction, but removes the intentional release step. Rejected because the user explicitly wants deploys keyed to "new releases" and the existing `discord-release.yml` already uses the release event.
- **`workflow_dispatch` manual trigger only** — deploy is a dropdown click in the Actions UI. Rejected as the primary mechanism because it doesn't produce a release artifact for changelog/Discord, but it is still added as a secondary trigger for emergency redeploys.
- **Repo-wide monorepo tags (`v1.2.0`)** — deploys everything on every release. Directly violates the "one at a time" requirement.

**Rationale:** The prefix convention keeps per-module release history discoverable (`gh release list | grep ^datacore-v`), plays nicely with the existing `discord-release.yml` (already listens to `release: published`), and lets a single workflow file encode the routing logic in <50 lines. `workflow_dispatch` is added as a secondary entry point for emergency redeploys without needing to cut a new release tag.

### Decision 4: Per-app scoped Fly.io deploy tokens, stored as per-module GitHub secrets

**Choice:** Generate four separate Fly.io deploy tokens (`flyctl tokens create deploy -a datacore`, `-a launchpad-api`, `-a papermite-api`, `-a admindash-backend`) and store them as `FLY_API_TOKEN_DATACORE`, `FLY_API_TOKEN_LAUNCHPAD`, `FLY_API_TOKEN_PAPERMITE`, `FLY_API_TOKEN_ADMINDASH` in GitHub repo secrets. The per-module deploy job references only the matching token.

**Alternatives considered:**

- **Single org-scoped `FLY_API_TOKEN`** — simpler but a leak compromises all four apps.
- **GitHub OIDC federation with Fly.io** — best practice, but Fly.io's OIDC support is still maturing and adds setup complexity. Worth revisiting in a follow-up change.

**Rationale:** Four scoped tokens bounds leak blast radius to a single service. Cost of the extra ceremony is near-zero (one-time `flyctl tokens create` per app). OIDC is a future improvement.

### Decision 5: `production` GitHub Environment with required reviewer

**Choice:** Define a `production` environment in GitHub repo settings with at least one required reviewer. All deploy jobs reference `environment: production`. No deploy can run without a human clicking "Approve" in the Actions UI.

**Alternatives considered:**

- **Auto-deploy on release** — fastest path from tag to production, but removes the last human check. A compromised release tag or a rushed release with broken migrations ships without friction.
- **Slack/Discord bot approval** — nicer UX but adds an external dependency and another secret.

**Rationale:** The approval click is free and adds a ~30 second delay to deploys — negligible compared to the cost of rolling back a bad release. It also doubles as a "second set of eyes" control: on a 2-person team, the non-releasing person can approve, catching obvious mistakes (wrong tag, typo in release notes).

### Decision 6: Admindash is a public customer-facing surface, NOT behind Cloudflare Access

**Choice:** `admin.floatify.com` (the admindash frontend) and `api.admin.floatify.com` (the new admindash-backend) are deployed as public surfaces on the same footing as `launchpad.floatify.com` / `api.launchpad.floatify.com` and `papermite.floatify.com` / `api.papermite.floatify.com`. Authentication is the standard DataCore JWT flow proxied through `admindash-backend` (per the `admindash-backend-api` change). There is no Cloudflare Access policy in front of admindash.

**Why this is a reversal of an earlier decision:** An earlier draft of this design proposed putting Cloudflare Access in front of `admin.floatify.com`. That was based on the assumption that admindash is an internal Floatify ops tool used by 1–2 employees. During review the user clarified that admindash is the **school operations product** used by school administrator customers — it is the primary interface that school staff at every Floatify-customer school use to manage their students, programs, and enrollment. It is customer-facing software, not internal tooling. Cloudflare Access SSO requires every user to be in a Floatify-controlled identity provider allowlist (Google Workspace or GitHub org), which does not fit a multi-tenant customer-facing product where each school's admin signs in with their school-issued credentials. The Cloudflare Access decision was therefore removed.

**Alternatives considered (and rejected):**

- **Cloudflare Access with per-tenant SSO providers** — technically possible but operationally a nightmare; every customer school would need to be onboarded into the Cloudflare Access policy, and the school's admin login flow would diverge from launchpad and papermite.
- **No perimeter protection at all** — what we're going with. The standard DataCore JWT auth, the same Cloudflare IP allowlist on `admindash-backend` that we use on the other public backends, strict CORS, strict CSP, and rate limiting are the layers. This matches how `launchpad-api` and `papermite-api` are protected.
- **Defer admindash deployment entirely until a separate "admin RBAC + audit" change lands** — would push the deployment-pipeline timeline back significantly. The phase 1 admindash-backend (the proxy from `admindash-backend-api`) is enough to deploy securely; richer RBAC and audit can land in subsequent changes without changing the deployment topology.

**Rationale:** Customer-facing products cannot be gated by employee-SSO. Treating admindash like launchpad and papermite (public, JWT-authenticated, Cloudflare-fronted, strict CORS/CSP, IP-allowlisted backend origin) is consistent with the rest of the customer-facing surface and is the only correct posture given the actual user base.

**Future need flagged but not in scope:** A separate Floatify-internal ops/observability dashboard (for Floatify employees to monitor across all tenant schools, debug customer issues, support engineering) would be the right home for Cloudflare Access SSO. That dashboard does not exist today. When it is built, it gets its own deployment change, its own subdomain (e.g., `ops.floatify.com`), and Cloudflare Access in front of it. Do not conflate it with the customer-facing admindash.

### Decision 7: Cloudflare IP allowlist on Fly.io public backends (not Tunnel in phase 1)

**Choice:** Configure `api.launchpad.floatify.com`, `api.papermite.floatify.com`, and `api.admin.floatify.com` Fly.io apps to reject traffic that does not originate from Cloudflare's published IP ranges. Cloudflare's IP list is fetched at container start (or hardcoded into the Fly.io services config) and the app returns 403 for non-Cloudflare source IPs.

**Alternatives considered:**

- **Cloudflare Tunnel (`cloudflared` sidecar)** — origin has no public IP at all. Strictly more secure. Requires running a sidecar inside each Fly.io machine and wiring it to the app port. Deferred to a follow-up change.
- **No origin protection** — a determined attacker finds the Fly.io IP via certificate transparency and bypasses Cloudflare's WAF. Rejected.

**Rationale:** IP allowlist is ~15 minutes of config and closes the WAF-bypass hole well enough for phase 1. Tunnel is the correct long-term answer but adds complexity we don't need in the first pass. Upgrade path is documented in the Open Questions section.

### Decision 8: Dockerfile-based builds, GHCR for image storage

**Choice:** Each backend ships a `Dockerfile` at the service root (`datacore/Dockerfile`, `launchpad/backend/Dockerfile`, `papermite/backend/Dockerfile`, `admindash/backend/Dockerfile`) based on `python:3.13-slim`. CI builds the image, tags it with the release version, pushes to `ghcr.io/<owner>/<module>:<version>`, and calls `flyctl deploy --image ghcr.io/...` to deploy without rebuilding on Fly's builders.

**Alternatives considered:**

- **`flyctl deploy` with Fly's remote builder** — simpler, but couples image build to deploy time and wastes build minutes on re-deploys or rollbacks of the same tag.
- **Docker Hub** — free tier has pull rate limits that bite production.

**Rationale:** GHCR is free for this repo, the image is built once per release tag, and rollback is as simple as `flyctl deploy --image ghcr.io/.../datacore:v1.1.9` — no rebuild needed.

### Decision 9: Frontends built by Cloudflare Pages from the repo, not from artifacts in CI

**Choice:** Each frontend is a separate Cloudflare Pages project pointed at the monorepo. Build command uses the existing `npm run build` per service. Production branch = `main`, and each Pages project is filtered to its own path (`launchpad/frontend`, `papermite/frontend`, `admindash/frontend`). Custom domain mapping and `_headers` files live in the repo under each frontend's `public/` directory.

**Alternatives considered:**

- **Build in GitHub Actions, upload to Pages via Wrangler** — more control but duplicates what Cloudflare Pages does natively.
- **Single Pages project with multi-app routing** — possible but fragile and couples all three frontends' deploy lifecycles.

**Rationale:** Cloudflare Pages' native monorepo support handles the three projects cleanly. Each project is independently deployable and independently revertable from the Cloudflare dashboard. CSP headers and redirect rules travel with the code in `_headers` / `_redirects` files.

### Decision 10: Production `VITE_*` environment variables baked at build time, not runtime

**Choice:** Each frontend's `services.json` + `VITE_*` env var approach (already partly supported per CLAUDE.md) is extended so that production builds receive the production API URLs via Cloudflare Pages' build-time environment variables. For example, `launchpad/frontend` gets `VITE_API_BASE_URL=https://api.launchpad.floatify.com` set in the Pages project's production environment.

**Rationale:** Vite bakes env vars into the bundle at build time, so runtime config swapping is not viable without a separate runtime-config pattern. The current `VITE_*` pattern is the path of least resistance.

### Decision 11: CORS fail-closed in production

**Choice:** Every backend (`datacore`, `launchpad-api`, `papermite-api`, `admindash-backend`) reads `CORS_ALLOWED_ORIGINS` from its environment. In production, this variable is set to an explicit comma-separated list (e.g., `admindash-backend` gets `https://admin.floatify.com`; `launchpad-api` gets `https://launchpad.floatify.com`). If the variable is missing or empty, the backend **refuses to start** rather than falling back to `*`.

**Rationale:** A misconfigured wildcard CORS in production would let any third-party site steal JWTs from logged-in users' browsers. Fail-closed is strictly safer than fail-open.

## Risks / Trade-offs

- **Single-region deployment on Fly.io** → For phase 1 a single region (likely `iad` or `sjc` depending on primary user base) is acceptable. If the single region goes down, all backends are down. Mitigation: Fly.io's platform SLA + volume snapshots + documented manual failover procedure. Revisit multi-region if uptime requirements tighten.
- **Fly.io volume is single-point-of-failure for LanceDB** → Daily volume snapshots are phase 1 mitigation; off-site backup to R2 is the proper fix and is deferred to a follow-up change. Risk window: up to 24 hours of data loss plus the dependency on Fly.io snapshot integrity.
- **Cloudflare IP allowlist requires keeping IPs up to date** → Cloudflare publishes its IP ranges and occasionally updates them. Mitigation: fetch the list at container start, or add a cron job / Dependabot-style PR that bumps a hardcoded list.
- **GitHub Release workflow can be triggered by any user with repo write access** → Mitigation: GitHub Environment reviewer requirement (Decision 5) plus `main` branch protection. Residual risk accepted for a 2-person team.
- **Cloudflare Pages build-time env vars mean changing an API URL requires a rebuild** → Acceptable because API URLs change rarely. If runtime config swapping becomes necessary, revisit with a separate change.
- **Admindash currently calls DataCore directly from the browser, but DataCore will be on a private network in production** → Resolved by the parallel `admindash-backend-api` change, which introduces an `admindash/backend/` proxy so admindash only ever talks to its own backend, which in turn reaches DataCore via `datacore.internal`. This change depends on `admindash-backend-api` being implemented locally first.
- **Deploy approval requires one of two people to be available** → On a 2-person team, if one person is unavailable, the other can self-approve (GitHub Environments allow the releaser to be the approver if configured, though single-user self-approval somewhat defeats the purpose). Trade-off accepted; revisit if the team grows.
- **No staging environment** → Bugs land directly in production. Mitigation: release approval gate plus one-command rollback via `flyctl deploy --image <previous-tag>`. A staging environment can be added later without reworking the release pipeline.
- **GHCR storage grows unbounded** → Phase 1 accepts this. GHCR free tier is generous; introduce a cleanup workflow in a follow-up change if needed.

## Migration Plan

This is a greenfield deployment — there is nothing running in production to migrate. The "migration" is really the first-time bring-up and cutover from local-only to production.

1. **Prerequisite**: The parallel `admindash-backend-api` change must be implemented and merged so that an `admindash/backend/` FastAPI service exists locally. This change does not need to wait for that one to be deployed anywhere — only for it to exist as committed code on `main`.
2. **Preparation (no user-visible changes)**
   - Provision Fly.io organization and apps (`datacore`, `launchpad-api`, `papermite-api`, `admindash-backend`)
   - Create Cloudflare Pages projects (`launchpad-frontend`, `papermite-frontend`, `admindash`), with custom domains not yet cut over
   - Add GitHub repo secrets and the `production` environment with reviewer policy
   - Land PRs for Dockerfiles, `fly.toml`, `_headers`, workflow YAML, and per-service production env var documentation
3. **First deploy (hidden from users)**
   - Cut a release tag for each module (e.g., `datacore-v0.1.0`) and walk each through the deploy workflow end-to-end
   - Verify Fly.io apps come up healthy on their temporary `*.fly.dev` URLs and Cloudflare Pages builds serve on their temporary `*.pages.dev` URLs
   - Run smoke tests against the temporary URLs, including admindash → admindash-backend → DataCore via the internal network
4. **DNS cutover**
   - Add Cloudflare DNS records for the six production subdomains (`launchpad`, `api.launchpad`, `papermite`, `api.papermite`, `admin`, `api.admin`), pointing at the Fly and Pages endpoints
   - Verify TLS for all six
   - Update all frontend `VITE_*` production env vars to the real subdomains (admindash specifically gets `VITE_ADMINDASH_API_URL=https://api.admin.floatify.com`) and trigger a redeploy of each frontend
5. **Decommission local-only state**
   - Update `CLAUDE.md` / per-service docs to document production URLs and the release workflow
   - Leave `start-services.sh` untouched — local development is unchanged

**Rollback strategy:**

- **Per-module rollback:** `flyctl deploy --image ghcr.io/<owner>/<module>:<previous-version> -a <app>` — no rebuild, ~30 seconds
- **Frontend rollback:** Cloudflare Pages dashboard has one-click "Rollback to previous deployment"
- **Full rollback to pre-cutover state:** Remove the six DNS records; traffic fails closed. Local development is unaffected. Fly.io apps can be suspended via `flyctl scale count 0`.

## Open Questions

1. **Which Fly.io region?** Default to `iad` (US East) unless the user's primary market is elsewhere. Confirm during implementation.
2. **Semantic versioning per module or date-based?** SemVer (`datacore-v1.2.3`) is the plan; confirm before locking the tag regex in the workflow.
3. **Should `workflow_dispatch` redeploys require a different approval level than release-triggered deploys?** Phase 1 uses the same `production` environment for both; revisit if emergency redeploys become frequent.
4. **Should `admindash-backend` use Fly's scale-to-zero?** It's a customer-facing backend so cold-start latency matters more than for an internal tool, but real usage volume is low in phase 1. Default to scale-to-zero with a `min_machines_running = 1` if cold starts are user-visible after first deploy.

## Resolved during review

- **How does admindash talk to DataCore once DataCore is on a private network?** Resolved: the parallel `admindash-backend-api` change introduces an `admindash/backend/` proxy. Admindash calls only `admindash-backend`, which calls `datacore.internal`. No browser code reaches DataCore.
- **Cloudflare Access identity provider for admindash (Google Workspace vs GitHub)?** Removed from scope: admindash is a customer-facing product, not an internal tool, and Cloudflare Access is no longer applied to admindash. If a future Floatify-internal ops dashboard is built, this question returns for that surface.
