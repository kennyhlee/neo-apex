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
     │   -api   │         │   -api   │       │   -api   │       (Cloudflare IP allowlist)
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
| `datacore` | Python/FastAPI backend | Fly.io (`sjc`) | **none** | `datacore.flycast:5800` |
| `launchpad-api` | Python/FastAPI backend | Fly.io (`sjc`) | `api.launchpad.floatify.com` | `launchpad-api.flycast:5510` |
| `papermite-api` | Python/FastAPI backend | Fly.io (`sjc`) | `api.papermite.floatify.com` | `papermite-api.flycast:5710` |
| `admindash-api` | Python/FastAPI backend | Fly.io (`sjc`, scale-to-zero) | `api.admin.floatify.com` | `admindash-api.flycast:5610` |
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
5. `admindash-api`'s `require_authenticated_user` dependency calls `http://datacore.flycast:5800/auth/me` with the bearer token
6. DataCore validates the JWT (signing secret present locally), returns the user object
7. `admindash-api` forwards the `/api/query` body to `http://datacore.flycast:5800/api/query` with the original Authorization header
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
