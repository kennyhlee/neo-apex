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
5. For modules with a frontend, builds and deploys to Cloudflare Workers (Static Assets) in parallel

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

### Option 3: Rollback a frontend via Cloudflare dashboard

Cloudflare dashboard → **Workers & Pages** → `launchpad-frontend` (or whichever) → **Deployments** → find the previous deployment → **Rollback to this deployment**.

## Reading logs

### Fly.io backends

```bash
flyctl logs --app datacore
flyctl logs --app launchpad-api
flyctl logs --app papermite-api
flyctl logs --app admindash-api
```

Add `--region sjc` if you have multi-region. Add `-i` for interactive follow.

### Cloudflare Workers frontends

Cloudflare dashboard → **Workers & Pages** → each Worker project → **Deployments** → click a deployment → **Build output** tab. Runtime logs are in the **Logs** tab.

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
