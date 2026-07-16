## ADDED Requirements

### Requirement: Each frontend is a dedicated Cloudflare Workers (Static Assets) project

The system SHALL host each of the `launchpad` frontend, `papermite` frontend, and `admindash` frontend as a distinct Cloudflare Workers project serving its built static assets (Workers Static Assets), configured via a per-frontend `wrangler.jsonc` in the same Cloudflare account that serves `floatify.com`. Each Worker MUST be built and deployed only from its own service's source directory and MUST be independently deployable and independently revertable.

#### Scenario: Each Worker builds only its own directory
- **WHEN** the CI workflow builds and deploys the `launchpad-frontend` Worker
- **THEN** it runs `npm run build` and `wrangler deploy` with `workingDirectory: launchpad/frontend` and does not build `papermite/frontend` or `admindash/frontend`

#### Scenario: Reverting one Worker does not affect others
- **WHEN** an operator rolls back the `papermite-frontend` Worker to a previous deployment (via `wrangler rollback` or the Cloudflare dashboard)
- **THEN** `launchpad-frontend` and `admindash` continue serving their current production deployments unchanged

### Requirement: Custom domains mapped under floatify.com

The frontend Workers SHALL be served on the following custom domains, configured via Cloudflare DNS and each Worker's `wrangler.jsonc` routes/custom-domain settings:

- `launchpad.floatify.com` → `launchpad-frontend` Worker
- `papermite.floatify.com` → `papermite-frontend` Worker
- `admin.floatify.com` → `admindash` Worker

TLS certificates MUST be provisioned and renewed automatically by Cloudflare.

#### Scenario: Production URL serves the app
- **WHEN** a user navigates to `https://launchpad.floatify.com/`
- **THEN** the browser receives a valid TLS response from Cloudflare and the Worker serves the Launchpad frontend HTML from its static assets

#### Scenario: TLS auto-renewal
- **WHEN** a TLS certificate for any of the three frontend domains approaches expiry
- **THEN** Cloudflare automatically renews the certificate without human intervention

### Requirement: Strict Content-Security-Policy headers

Each frontend SHALL ship a `_headers` file (placed in its `public/` directory so it is emitted into the build output and served by Cloudflare Workers Static Assets) that sets a strict Content-Security-Policy for production. The policy MUST at minimum: disallow inline script execution except where unavoidable via nonce or hash, restrict script sources to `self` and any explicitly required third-party origins, restrict connect sources to the frontend's own origin and its paired API origin, and include `frame-ancestors 'none'` to prevent clickjacking.

#### Scenario: CSP header is present in production responses
- **WHEN** a browser requests `https://launchpad.floatify.com/`
- **THEN** the response includes a `Content-Security-Policy` header whose value is set by the `_headers` file

#### Scenario: Inline script without nonce is blocked
- **WHEN** a malicious script tag is injected into a page and loaded by a browser enforcing the CSP
- **THEN** the browser refuses to execute the injected script and emits a CSP violation

#### Scenario: Connecting to a disallowed API origin is blocked
- **WHEN** page JavaScript attempts `fetch('https://evil.example.com/')` from `https://launchpad.floatify.com/`
- **THEN** the browser blocks the request due to the `connect-src` directive

### Requirement: Production API URLs configured via build-time environment variables

Each frontend SHALL receive its production API URLs as `VITE_*`-prefixed environment variables at build time. These are supplied by the CI deploy workflow's build step (and/or a committed `.env.production`) so the Vite build bakes them into the bundle. The frontend MUST NOT hardcode `localhost` or developer-machine URLs in production builds.

#### Scenario: Production build uses production API URL
- **WHEN** the CI workflow builds `launchpad-frontend` with `VITE_LAUNCHPAD_BACKEND_URL=https://api.launchpad.floatify.com` set in the build step
- **THEN** the resulting JavaScript bundle makes API calls to `https://api.launchpad.floatify.com`

#### Scenario: Localhost URL is not present in production bundle
- **WHEN** a developer inspects the production `launchpad-frontend` JavaScript bundle
- **THEN** the bundle does not contain a `http://localhost:5510` reference for the runtime API base URL

### Requirement: Release-tag push triggers frontend production deploy

The frontends SHALL deploy through the same release-tag pipeline as the backends, not via Cloudflare git integration. When a GitHub Release is published with a frontend-module-prefixed tag (`launchpad-v*`, `papermite-v*`, or `admindash-v*`), the `.github/workflows/deploy.yml` workflow SHALL build the corresponding frontend and run `wrangler deploy` to publish its Worker. The deploy step MUST run under the `production` GitHub Environment approval gate, and a failed build MUST NOT publish a new deployment.

#### Scenario: Admindash release triggers Worker deploy
- **WHEN** a GitHub Release is published with tag `admindash-v0.5.0` and the deploy is approved at the `production` gate
- **THEN** the workflow builds `admindash/frontend` and runs `wrangler deploy`, publishing the `admindash` Worker

#### Scenario: Datacore release does not trigger any frontend deploy
- **WHEN** a GitHub Release is published with tag `datacore-v1.2.0`
- **THEN** no frontend Worker rebuilds in response

#### Scenario: Failed build does not replace production
- **WHEN** a production build of `launchpad-frontend` fails (for example, TypeScript errors)
- **THEN** `wrangler deploy` does not run, the previous Worker deployment continues to serve traffic, and the failed deployment is not promoted
