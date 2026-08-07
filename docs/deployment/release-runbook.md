# Release Runbook — Day-to-Day Deploy Operations

This runbook covers cutting releases, approving deploys, rolling back, and reading logs. For first-time setup, see [`provisioning.md`](./provisioning.md).

## Cutting a release

Releases are triggered by GitHub Releases with module-prefixed tags:

- `datacore-v1.2.0` → deploys only `datacore`
- `launchpad-v0.3.1` → deploys `launchpad-api` + `launchpad-frontend`
- `papermite-v2.0.0-rc.1` → deploys `papermite-api` + `papermite-frontend` (prerelease is fine)
- `admindash-v0.5.0` → deploys `admindash-api` + `admindash` frontend
- `apexflow-v0.1.0` → deploys `apexflow-api` (backend only — no frontend deploy yet, parked this wave)
- `familyhub-v0.1.0` → deploys `familyhub-api` (backend only — no frontend deploy yet, parked this wave)

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

## The suite marker

Each module deploys from its own tag and its own version line, so **no single
git commit describes what is live**. `deploy/suite-manifest.json` does: it
records the set of module releases known to be good together, and the
`deployable` git tag marks the commit where that set was last promoted.

```bash
./scripts/suite.sh status     # what is live vs. the manifest
```

```
MODULE       LIVE                   MANIFEST
datacore     datacore-v0.5.0        datacore-v0.5.0        = in sync
launchpad    launchpad-v0.3.1       launchpad-v0.3.1       = in sync
papermite    papermite-v0.8.2       papermite-v0.8.2       = in sync
admindash    admindash-v0.10.4      admindash-v0.10.4      = in sync
```

After a release has proven out, promote it:

```bash
./scripts/suite.sh promote    # reads Fly, rewrites the manifest, prints the commit/tag commands
```

`promote` reads the deployed image tag off each Fly app, so the manifest
records what is **actually running** rather than what someone believed was
running. It refuses to write a partial set — a rollback point that cannot be
fully restored is worse than none.

The marker is a plain git tag, never a GitHub Release: publishing a release
triggers the deploy workflow. (The workflow now skips `suite-*` tags with a
notice rather than failing, so an accidental publish is harmless.)

## Rolling back

### Option 0: Roll the whole suite back to the last known-good set

```bash
./scripts/suite.sh rollback              # every module
./scripts/suite.sh rollback admindash    # or just one
```

Prints the plan, asks for confirmation, then dispatches a redeploy per module
from the manifest. Each still needs production approval — the script does not
bypass the gate.

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
