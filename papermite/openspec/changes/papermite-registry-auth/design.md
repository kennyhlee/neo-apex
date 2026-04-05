## Context

Papermite is the document ingestion gateway module in NeoApex. It currently authenticates users by loading a `test_user.json` file at startup — a dev scaffold that was never replaced with real authentication. Passwords are stored in plain text and the user list is completely disconnected from the central identity system.

LaunchPad is the authoritative identity service. It registers users into a DataCore global table named `"registry"` using bcrypt-hashed passwords, with a `RegistryStore` class that wraps DataCore's `put_global` / `get_global` / `query_global` APIs. Papermite already accepts JWT tokens issued by LaunchPad (via a shared secret fallback), but still can't validate credentials itself using those same users.

The goal is to align Papermite's own login endpoint with LaunchPad's flow so users registered through LaunchPad can authenticate directly to Papermite.

## Goals / Non-Goals

**Goals:**
- Papermite's `/api/login` reads credentials from the DataCore global registry table
- Passwords are verified with bcrypt (matching LaunchPad's storage format)
- `test_user.json` and all code that loads it are removed
- The `UserRecord` model used in Papermite matches LaunchPad's schema

**Non-Goals:**
- User registration or management within Papermite (LaunchPad owns this)
- Sharing a library/package between LaunchPad and Papermite (each service owns its code)
- Changing LaunchPad's authentication behavior
- Role-based access rule changes (existing `requires_admin` guard is unchanged)

## Decisions

### 1. Copy `RegistryStore` into Papermite rather than extract a shared package

**Decision**: Duplicate the `RegistryStore` class (and `UserRecord` model) from LaunchPad into Papermite's backend.

**Rationale**: Services in NeoApex are intentionally independent modules. Introducing a shared `neoapex-common` package creates a build/version coupling that complicates independent deployments. The `RegistryStore` is small (5 methods, ~60 lines) — duplication cost is low and the benefit of full autonomy is high.

**Alternatives considered**:
- Shared package: rejected due to coupling complexity.
- Calling LaunchPad's `/api/login` as a proxy: rejected — adds latency, a runtime dependency, and requires Papermite to know LaunchPad's internal URL.

### 2. Papermite calls DataCore directly for registry lookups

**Decision**: Papermite's `RegistryStore` connects directly to the DataCore service using the `DATACORE_URL` env var, same as LaunchPad.

**Rationale**: DataCore is the central storage layer all modules use. This is the established pattern.

### 3. Keep the LaunchPad JWT fallback in `get_current_user`

**Decision**: The existing dual-secret JWT verification (try Papermite secret, fall back to LaunchPad secret) is preserved.

**Rationale**: This allows users already authenticated by LaunchPad to access Papermite via token without re-logging in. Removing it would be a regression.

## Risks / Trade-offs

- **Users must exist in registry before deployment** → Mitigation: Verify at least one admin user is registered in LaunchPad before cutting over. Document this in migration steps.
- **DataCore unavailability breaks login** → Mitigation: DataCore is already a hard dependency for all other Papermite features; this is not a new risk.
- **test_user.json removal is irreversible for local dev** → Mitigation: Local developers must register via LaunchPad (or seed the registry via a script). No fallback will exist post-migration.

## Migration Plan

1. Ensure DataCore is running and accessible from Papermite backend.
2. Register all required Papermite users through LaunchPad (they will be in the registry table).
3. Deploy Papermite with the updated backend.
4. Delete `test_user.json` from the repo.
5. **Rollback**: Revert the backend changes and restore `test_user.json` from git history.

## Open Questions

- Should Papermite restrict login to users whose `tenant_id` matches a configured whitelist, or allow any registered user? (Current assumption: any user in the registry can log in.)
