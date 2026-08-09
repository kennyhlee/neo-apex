# Deployment Follow-Ups

Deferred hardening and nice-to-haves. These are intentionally out of scope for the initial deployment-pipeline change and should be tracked as separate OpenSpec changes when prioritized.

## Security hardening

- **Cloudflare Tunnel** instead of IP allowlist for public Fly.io backends. The IP allowlist middleware (`app/middleware/cloudflare_ip.py`) closes the WAF-bypass hole but still has a public Fly IP. Cloudflare Tunnel runs a `cloudflared` sidecar in each Fly.io machine that opens an outbound connection to Cloudflare — the origin has no public IP at all. Stricter but more complex to set up and maintain.

- **Papermite upload hardening** — file size limits enforced at the Fly.io proxy layer, MIME type allowlist, magic-byte validation, ClamAV scanning. Currently the `/api/extract/` endpoint accepts anything a client uploads.

- **R2 bucket-level object-size cap for DataCore's document blob API** — `POST /api/documents/{tenant_id}` rejects a declared `size` above 20 MB (`document_routes.MAX_SIZE_BYTES`), but that check is **advisory only**. `datacore/src/datacore/documents.py::presign_upload` binds `Content-Type` into the S3v4 signature; S3v4 PUT presigning has no length-range field, so the returned URL accepts a body of any size for the full TTL (`DATACORE_R2_URL_TTL_SECONDS`, default 900s). A caller that declares 1 KB and uploads 5 GB is not stopped by anything in the application. **Fix at the bucket:** set a Cloudflare R2 object-size limit (bucket rule / Worker in front of the bucket) matching the 20 MB application limit, so the enforcement lives where the bytes actually land. Deliberately *not* fixed by switching to `generate_presigned_post` (whose policy *can* express a length range) — that would change the upload contract the parent-upload and staff-upload plans build against, and should be a considered change rather than a fix-pass side effect.

- **JWT → httpOnly cookie migration** — admindash currently stores JWTs in `localStorage`, which is vulnerable to XSS. Move to httpOnly SameSite=Strict cookies. This is a cross-cutting change that affects all four backends + all three frontends + the CORS credential policy.

- **MFA in DataCore's auth layer** — DataCore currently does JWT + bcrypt password auth with no second factor. Adding TOTP MFA would protect against credential stuffing.

- **Cloudflare IP range auto-refresh** — the current middleware hardcodes the Cloudflare IP ranges. A follow-up should fetch the list from `https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6` at container start, or bake the fetch into the Dockerfile at build time.

- **Dependabot auto-merge** — configure auto-merge for Dependabot PRs with patch-level version bumps after CI passes.

- **Image signing and SBOM** — sign images with `cosign` and generate SBOMs via `syft` as part of the deploy workflow.

- **apexflow-api / familyhub-api bring-up — DEPLOYED (2026-08-08), DNS remaining.** Repo artifacts complete (commit `9e98354`); both Fly apps created, production secrets set (`FAMILYHUB_APEXFLOW_INTERNAL_KEY` == `APEXFLOW_INTERNAL_KEY`), deploy tokens in GitHub as `FLY_API_TOKEN_APEXFLOW`/`FLY_API_TOKEN_FAMILYHUB`, first `fly deploy` green on both. **Verified live in production:** apexflow `/health` 200 and familyhub `/api/health` 200 (allowlist-exempt); every other route 403 direct-to-Fly (Cloudflare IP allowlist active, so the apps are already fail-closed *before* DNS exists); `Referrer-Policy: no-referrer` present including on the 403s; production boot succeeded with real secrets (validators satisfied).
  **Gotcha recorded in `apexflow/fly.toml`:** an app with both `[http_service]` and a raw `[[services]]` block gets NO auto-allocated public IPs on first deploy — machines look healthy while nothing is reachable. Fix: `fly ips allocate-v6`, `allocate-v4 --shared`, `allocate-v6 --private` (papermite's set). familyhub (http_service only) auto-allocated.
  **DNS + Fly certs DONE (2026-08-08):** proxied CNAMEs `api.apexflow.floatify.com` → `apexflow-api.fly.dev` and `api.familyhub.floatify.com` → `familyhub-api.fly.dev` added (matching the existing `api.*` pattern), and Fly origin certs issued for both via the documented gray-cloud trick (`provisioning.md` §9.2) — both now `Status = Issued`, "verified and active", then re-proxied.

- **BLOCKED: the two new `api.*` hostnames have no Cloudflare EDGE cert until their frontends deploy.** `https://api.apexflow.floatify.com` and `https://api.familyhub.floatify.com` currently fail the TLS handshake at the Cloudflare edge (SSL alert 40). Root cause, verified by reading the live edge certs: Universal SSL covers only `floatify.com` + `*.floatify.com` (one label deep). The working siblings are covered because a Worker exists at `<module>.floatify.com`, which makes Cloudflare issue a cert with `*.{module}.floatify.com` — confirmed on all three: `api.admin` is covered by `DNS:admin.floatify.com, DNS:*.admin.floatify.com`, and likewise for launchpad and papermite. `apexflow.floatify.com` and `familyhub.floatify.com` do not exist in the zone at all (their frontend Workers are unbuilt — parked as out-of-scope), so no `*.apexflow.floatify.com` / `*.familyhub.floatify.com` cert exists.
  **This is fail-closed, not a hole:** the handshake simply fails, and the Fly origin is independently protected by the IP allowlist. **Fixes, pick one:** (a) deploy the apexflow/familyhub frontend Workers at `apexflow.floatify.com` / `familyhub.floatify.com` — the edge cert then covers the `api.*` child automatically, no extra cost, and matches the existing three modules; or (b) buy Advanced Certificate Manager / enable Total TLS for multi-level subdomain coverage. Until then, use the `*.fly.dev` hostnames (allowlist-protected) for any server-to-server testing. Internal service-to-service traffic is unaffected — it uses `.flycast`, not these hostnames.

- **R2 provisioning for the documents seam — DONE (2026-08-08)**: R2 enabled (operator-approved), bucket `neoapex-documents`, scoped token `neoapex-datacore-documents` (Object Read & Write), `DATACORE_R2_*` exported in `~/.zshrc`, DataCore restarted, presign→PUT→GET smoke-verified, and both channels' upload flows live-verified end-to-end. The bucket has a CORS policy (origins localhost:5620/5600 + https://familyhub.floatify.com + https://admin.floatify.com; GET/PUT; content-type; max-age 3600) — REQUIRED for browser uploads; its absence was a live-caught defect. Still open: the bucket-level 20 MB object-size cap (see the R2 size-cap item above) and adding future frontend origins to the CORS rule.

- **admindash/fly.toml secret-name comment bug** — the header comment lists unprefixed `ENVIRONMENT`/`CORS_ALLOWED_ORIGINS`, but admindash's config uses `env_prefix="ADMINDASH_"`. The DEPLOYED secrets are correctly prefixed (verified `fly secrets list -a admindash-api`, 2026-08-08) — comment-only bug; fix on next touch. The new apexflow/familyhub fly.tomls document prefixed names correctly.

## Reliability / ops

- **Reconcile the two frontend deploy paths (Cloudflare Git build vs `deploy.yml`)** — the three frontend Worker projects (`launchpad-frontend`, `papermite-frontend`, `admindash`) are git-connected, so Cloudflare auto-builds+deploys on every push to `main`. This is redundant with `deploy.yml`'s `wrangler-action` (which deploys on `<module>-v*` release tags) **and bypasses the `production` approval gate** — a merge to `main` ships the frontend before any release/approval. It also surfaces a failing `Workers Builds: papermite-frontend` check on PRs (papermite is the only project with non-production-branch builds enabled). **Fix:** disconnect Git from all three Worker projects so `deploy.yml` is the single gated deploy path (or, to keep Git for main convenience, at least turn off *Build for non-production branches* so PR checks stay green). See `provisioning.md` Step 7. Dashboard action; can also be scripted via the Cloudflare API with a token scoped to `Account → Workers Scripts → Edit`.

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
