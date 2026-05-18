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

- **Multi-region Fly.io topology** — currently single-region (`sjc`). If uptime requirements tighten, replicate the backends to a second region. DataCore would need a different strategy (LanceDB replication is not trivial).

- **Staging environment** — a second Fly.io org + Cloudflare Worker preview deployments (non-production branches) would give us a place to test deploys before hitting production. Currently deploys go straight to prod after approval.

- **GHCR image cleanup** — the registry grows unbounded as releases accumulate. A scheduled cleanup workflow should prune images older than N days, keeping the last K releases per module.

- **Per-tenant rate limiting** — currently there's no rate limiting at any layer. At minimum, limit login attempts to protect against credential stuffing.

- **Monitoring and alerting** — Fly.io's built-in metrics are enough to start, but there's no paging on downtime. Sentry for error tracking, UptimeRobot or a similar service for HTTP uptime, and ideally Prometheus/Grafana for metrics.

- **papermite image size optimization** — the papermite Docker image is ~5.8GB due to torch + transformers + docling. Options: use a slimmer base (torch-slim), multi-stage build with minimal runtime layer, audit transitive deps to see if torch is really needed or can be replaced. Large images slow down Fly.io deploys and rollbacks.

- **papermite-api memory scale-back to 2GB** — `papermite-api` was scaled 2GB → 4GB on 2026-04-30 in response to a docling/RapidOCR OOM on the `/api/extract` path. The root cause shipped in `papermite-v0.3.0` (extraction_pipeline consolidation) and the runtime path is now docling-free for PDFs when `PAPERMITE_PARSER_BACKEND=claude_merged` (current production setting). After a soak window of stable PDF traffic with no DOCX-driven memory spikes, `papermite-api` should be safe to scale back to 2GB via `flyctl scale memory 2048 --app papermite-api` and a `papermite/fly.toml` update. DOCX uploads still load docling, so monitor specifically for DOCX-driven RSS spikes before scaling down.

## Platform evolution

- **Floatify-internal ops dashboard** — a separate surface (e.g., `ops.floatify.com`) for Floatify employees to monitor across all tenant schools, debug customer issues, and support engineering. This is where Cloudflare Access SSO belongs (not on admindash, which is customer-facing). Gets its own deployment change.

- **GitHub OIDC federation with Fly.io** — replace long-lived Fly.io deploy tokens with ephemeral OIDC tokens issued by GitHub Actions. Fly.io's OIDC support is maturing; revisit in 6 months.

- **School operations domain logic** — admindash-api is a thin proxy today. Real business logic (enrollment workflows, program rules, RBAC, audit logging) lands in follow-up OpenSpec changes on top of the existing admindash-api scaffolding.

## Application / cross-service follow-ups

- **admindash session-cache invalidation for model_definitions** — `admindash/frontend/src/contexts/ModelContext.tsx` caches the per-entity `model_definition` in React state. `clearCache()` is defined but never called. After a model is edited in Papermite (rename, add/remove custom field, type change, options change), admindash continues to render the previously-loaded definition for the session lifetime — table headers, form labels, and the column-selection menu all read from the cached object. Hard-refresh should clear the cache (React state is destroyed on full page reload), but at least one report of stale-after-refresh exists that hasn't been reproduced under controlled conditions yet. Fix candidates, in order of effort: (1) call `clearCache()` from the `logout()` flow in `AuthContext`; (2) add a short TTL (~30s, matching the `DashboardContext` pattern) so the cache self-invalidates; (3) listen for a model-changed signal from Papermite. Surfaced during papermite-v0.4.0 manual verification. Repro recipe lives in the PR #73 thread.

- **`AddFieldForm` should reject duplicate custom-field names** — `papermite/frontend/src/components/AddFieldForm.tsx::handleSubmit` only validates `if (!name.trim()) return;` and doesn't check for collisions against existing `field_mappings`. Same per-entity uniqueness rule that `EntityCard.handleFieldNameChange` (shipped in papermite-v0.4.0) applies to renames should also apply on add. Today a user can click "+ Add custom field" and type the name of an existing field; the new mapping is appended to `field_mappings` and `entity.entity[name]` silently overwrites the existing value. Sibling bug to issue #67. The validation logic can be lifted out of `EntityCard` into a small shared helper.
