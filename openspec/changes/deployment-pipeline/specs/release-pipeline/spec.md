## ADDED Requirements

### Requirement: Module-prefixed release tag triggers single-module deploy

The release pipeline SHALL deploy exactly one module per release event, selected by the prefix of the Git tag attached to a published GitHub Release. Tag names MUST follow the pattern `<module>-v<semver>` where `<module>` is one of `datacore`, `launchpad`, `papermite`, or `admindash` and `<semver>` is a valid semantic version (optionally with a prerelease suffix such as `-rc.1`).

#### Scenario: DataCore release deploys only DataCore
- **WHEN** a user publishes a GitHub Release with tag `datacore-v1.2.0`
- **THEN** the release pipeline runs only the `deploy-datacore` job and does not start deploy jobs for `launchpad`, `papermite`, or `admindash`

#### Scenario: Unknown prefix fails fast
- **WHEN** a user publishes a GitHub Release with tag `widget-v0.1.0` (unrecognized module prefix)
- **THEN** the release pipeline fails at the tag-parsing step with a clear error message and does not start any deploy job

#### Scenario: Prerelease tag is allowed
- **WHEN** a user publishes a GitHub Release with tag `papermite-v2.0.0-rc.1` marked as a prerelease
- **THEN** the release pipeline runs the `deploy-papermite` job normally

#### Scenario: Repo-wide tag without module prefix is rejected
- **WHEN** a user publishes a GitHub Release with tag `v1.0.0` (no module prefix)
- **THEN** the release pipeline fails at the tag-parsing step and does not start any deploy job

### Requirement: Manual workflow_dispatch fallback for emergency redeploys

The release pipeline SHALL expose a `workflow_dispatch` trigger that accepts a `module` input (choice of `datacore`, `launchpad`, `papermite`, `admindash`) and a `version` input (a tag string that already exists as a GitHub Release), and deploys the specified module at the specified version without requiring a new release to be cut.

#### Scenario: Operator redeploys a known-good version
- **WHEN** an operator invokes the release workflow via `workflow_dispatch` with `module=datacore` and `version=datacore-v1.1.9`
- **THEN** the release pipeline deploys the `ghcr.io/<owner>/datacore:datacore-v1.1.9` image (or equivalent) to the `datacore` Fly.io app

#### Scenario: Dispatch with a non-existent version fails
- **WHEN** an operator invokes `workflow_dispatch` with a `version` that does not correspond to an existing GitHub Release
- **THEN** the pipeline fails at the image-lookup step with a clear error message

### Requirement: Production deploys require a human approval

Every deploy job in the release pipeline (both release-triggered and dispatch-triggered) SHALL run inside a GitHub Environment named `production` that is configured with at least one required reviewer. No deploy MUST proceed until a reviewer has clicked Approve in the GitHub Actions UI.

#### Scenario: Deploy waits for approval
- **WHEN** a GitHub Release is published for a valid module-prefixed tag
- **THEN** the deploy job enters a `waiting` state in GitHub Actions and does not execute any deploy step until a reviewer approves

#### Scenario: Rejected deploy does not ship
- **WHEN** a reviewer rejects a deploy approval
- **THEN** the deploy job terminates with a failure status and no changes are pushed to Fly.io or Cloudflare

### Requirement: Per-app scoped deploy tokens

The release pipeline SHALL use a separate Fly.io deploy token for each backend app (`datacore`, `launchpad-api`, `papermite-api`, `admindash-api`). Each deploy job MUST reference only the token for the module it deploys; a deploy job for one module MUST NOT have access to tokens for other modules.

#### Scenario: Leaked DataCore token cannot deploy Launchpad or Admindash
- **WHEN** the `FLY_API_TOKEN_DATACORE` secret is compromised
- **THEN** the attacker can at most deploy arbitrary code to the `datacore` Fly.io app and cannot deploy to `launchpad-api`, `papermite-api`, or `admindash-api`

#### Scenario: Deploy job uses only its own token
- **WHEN** the `deploy-launchpad` job runs
- **THEN** the job references `${{ secrets.FLY_API_TOKEN_LAUNCHPAD }}` as the Fly.io token and does not reference `FLY_API_TOKEN_DATACORE`, `FLY_API_TOKEN_PAPERMITE`, or `FLY_API_TOKEN_ADMINDASH`

#### Scenario: Admindash deploy uses its own token
- **WHEN** the `deploy-admindash-api` job runs
- **THEN** the job references `${{ secrets.FLY_API_TOKEN_ADMINDASH }}` as the Fly.io token and does not reference any other module's Fly.io token

### Requirement: Image build once, reuse for rollback

For backend deploys, the release pipeline SHALL build the Docker image exactly once per release, tag it with the release tag, push it to GitHub Container Registry (GHCR), and deploy to Fly.io by referencing the image tag. Rollback to a previous release MUST be possible by re-running the deploy with the previous image tag without rebuilding.

#### Scenario: New release builds and pushes image
- **WHEN** the `deploy-datacore` job runs for tag `datacore-v1.2.0`
- **THEN** the job builds `ghcr.io/<owner>/datacore:datacore-v1.2.0`, pushes it to GHCR, and calls `flyctl deploy --image ghcr.io/<owner>/datacore:datacore-v1.2.0 -a datacore`

#### Scenario: Rollback uses existing image
- **WHEN** an operator runs `workflow_dispatch` with `module=datacore` and `version=datacore-v1.1.9`
- **THEN** the job skips any Docker build step, pulls `ghcr.io/<owner>/datacore:datacore-v1.1.9` from GHCR, and deploys it without rebuilding

### Requirement: Frontend releases rebuild only the affected Cloudflare Pages project

For frontend deploys (`launchpad` frontend, `papermite` frontend, `admindash`), the release pipeline SHALL trigger a Cloudflare Pages production build of only the affected project. The release pipeline MUST NOT rebuild or redeploy frontends that are not named by the release tag prefix.

#### Scenario: Admindash release rebuilds only admindash frontend
- **WHEN** a GitHub Release is published for tag `admindash-v0.5.0`
- **THEN** the pipeline triggers a Cloudflare Pages production deployment of the `admindash` project and does not trigger deployments for the `launchpad-frontend` or `papermite-frontend` Pages projects

### Requirement: Module tags with both backend and frontend halves deploy both

For modules that have both a Fly.io backend app and a Cloudflare Pages frontend project — `launchpad` (backend `launchpad-api`, frontend `launchpad-frontend`), `papermite` (backend `papermite-api`, frontend `papermite-frontend`), and `admindash` (backend `admindash-api`, frontend `admindash`) — a single module-prefixed release tag SHALL deploy both halves in the same workflow run. Each half is its own job inside the release workflow, but a single tag triggers them together.

#### Scenario: Admindash release deploys both backend and frontend
- **WHEN** a GitHub Release is published for tag `admindash-v0.5.0`
- **THEN** the release pipeline runs both `deploy-admindash-api` (Fly.io) and `deploy-admindash` (Cloudflare Pages) jobs, and does not run any other module's deploy jobs

#### Scenario: DataCore release deploys only the backend
- **WHEN** a GitHub Release is published for tag `datacore-v1.2.0`
- **THEN** the release pipeline runs only `deploy-datacore` (Fly.io) and does not trigger any Cloudflare Pages deployment because DataCore has no frontend

### Requirement: Release event also fires existing Discord notification

The release pipeline SHALL continue to fire the existing `discord-release.yml` workflow on every `release: published` event regardless of which module is being deployed. The new deploy workflow MUST NOT break or bypass the Discord notification.

#### Scenario: Discord is notified for every release
- **WHEN** a GitHub Release is published for any module-prefixed tag
- **THEN** both the new deploy workflow and the existing `discord-release.yml` workflow are triggered by the same event
