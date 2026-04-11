## ADDED Requirements

### Requirement: Each frontend is a dedicated Cloudflare Pages project

The system SHALL host each of the `launchpad` frontend, `papermite` frontend, and `admindash` frontend as a distinct Cloudflare Pages project in the same Cloudflare account that serves `floatify.com`. Each project MUST build only its own service's source directory and MUST be independently deployable and independently revertable.

#### Scenario: Each project builds only its own directory
- **WHEN** the `launchpad-frontend` Cloudflare Pages project runs a build
- **THEN** the build command operates only on `launchpad/frontend` and does not build `papermite/frontend` or `admindash/frontend`

#### Scenario: Reverting one project does not affect others
- **WHEN** an operator uses the Cloudflare Pages dashboard to roll back the `papermite-frontend` project to a previous deployment
- **THEN** `launchpad-frontend` and `admindash` continue serving their current production deployments unchanged

### Requirement: Custom domains mapped under floatify.com

The frontend Cloudflare Pages projects SHALL be served on the following custom domains, configured via Cloudflare DNS and Cloudflare Pages custom domain settings:

- `launchpad.floatify.com` → `launchpad-frontend` Pages project
- `papermite.floatify.com` → `papermite-frontend` Pages project
- `admin.floatify.com` → `admindash` Pages project

TLS certificates MUST be provisioned and renewed automatically by Cloudflare.

#### Scenario: Production URL serves the app
- **WHEN** a user navigates to `https://launchpad.floatify.com/`
- **THEN** the browser receives a valid TLS response from Cloudflare Pages and loads the Launchpad frontend HTML

#### Scenario: TLS auto-renewal
- **WHEN** a TLS certificate for any of the three frontend domains approaches expiry
- **THEN** Cloudflare Pages automatically renews the certificate without human intervention

### Requirement: Strict Content-Security-Policy headers

Each frontend SHALL ship a `_headers` file (placed in its `public/` directory so Cloudflare Pages serves it) that sets a strict Content-Security-Policy for production. The policy MUST at minimum: disallow inline script execution except where unavoidable via nonce or hash, restrict script sources to `self` and any explicitly required third-party origins, restrict connect sources to the frontend's own origin and its paired API origin, and include `frame-ancestors 'none'` to prevent clickjacking.

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

Each frontend Cloudflare Pages project SHALL receive its production API URLs via Cloudflare Pages production environment variables (`VITE_*` prefixed). The frontend code MUST read these at build time. The frontend MUST NOT hardcode `localhost` or developer-machine URLs in production builds.

#### Scenario: Production build uses production API URL
- **WHEN** Cloudflare Pages runs a production build of `launchpad-frontend` with `VITE_API_BASE_URL=https://api.launchpad.floatify.com`
- **THEN** the resulting JavaScript bundle makes API calls to `https://api.launchpad.floatify.com`

#### Scenario: Localhost URL is not present in production bundle
- **WHEN** a developer inspects the production `launchpad-frontend` JavaScript bundle
- **THEN** the bundle does not contain a `http://localhost:5510` reference for the runtime API base URL

### Requirement: Build triggered by push to main

Each frontend Cloudflare Pages project SHALL be configured so that its production environment builds and deploys on push to the `main` branch of the repository, scoped to changes under its own source directory when possible. Build failures MUST NOT silently succeed.

#### Scenario: Push to main triggers build
- **WHEN** a commit is pushed to `main` that modifies `launchpad/frontend/src/App.tsx`
- **THEN** Cloudflare Pages starts a production build of the `launchpad-frontend` project

#### Scenario: Failed build does not replace production
- **WHEN** a production build of `launchpad-frontend` fails (for example, TypeScript errors)
- **THEN** the previous production deployment continues to serve traffic and the failed deployment is not promoted

### Requirement: Release-tag push triggers frontend production deploy

When a GitHub Release is published with a frontend-module-prefixed tag (`launchpad-v*`, `papermite-v*`, or `admindash-v*`), the corresponding Cloudflare Pages project SHALL be triggered to rebuild and deploy its production environment.

#### Scenario: Admindash release triggers Pages deploy
- **WHEN** a GitHub Release is published with tag `admindash-v0.5.0`
- **THEN** the `admindash` Cloudflare Pages project is triggered via the Cloudflare API to rebuild and deploy its production environment

#### Scenario: Datacore release does not trigger any frontend deploy
- **WHEN** a GitHub Release is published with tag `datacore-v1.2.0`
- **THEN** no Cloudflare Pages project rebuilds in response
