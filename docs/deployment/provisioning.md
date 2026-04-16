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
  --region sjc \
  --size 3 \
  --snapshot-retention 7
```

Confirm:

```bash
flyctl volumes list --app datacore
```

Expected: one volume named `datacore_data`, 3GB, region `sjc`.

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

Each service's `fly.toml` and `Dockerfile` live at the service root alongside `pyproject.toml`, so `flyctl deploy` picks everything up automatically — just `cd` into the service dir.

```bash
cd /path/to/NeoApex/datacore && flyctl deploy && cd -
cd /path/to/NeoApex/launchpad && flyctl deploy && cd -
cd /path/to/NeoApex/papermite && flyctl deploy && cd -
cd /path/to/NeoApex/admindash && flyctl deploy && cd -
```

Deploy `datacore` first — the three public backends reach it via `datacore.internal` and will fail their first boot if it isn't up yet.

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
