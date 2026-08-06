# apexflow/backend/app/auth.py
"""Auth dependencies for apexflow backend.

Ported from enrollx/backend/app/auth.py (JWT validation) +
enrollx/backend/app/tenancy.py (tenant/role enforcement, `require_staff_tenant`
only) + enrollx/backend/app/api/internal.py (`require_internal_key`) — see
docs/superpowers/plans/2026-08-05-apexflow-plan1-interface-map.md §2.
Consolidated into one module for this scaffold's file list (task-1-brief.md
lists only app/auth.py, not a separate tenancy.py/api/internal.py); enrollx
keeps these split across three files.

`require_staff` (no-tenant-path-param routes) was NOT ported — nothing in
this service needs a no-tenant role check yet. `assert_query_tenant_match`
and `assert_sql_is_safe_read` (the shared SQL-shape guard), deferred by the
note this docstring used to carry, are now ported: they live in
app/tenancy.py (Task 1 of Plan 2), alongside a byte-identical copy of the
guard block from datacore/src/datacore/api/readonly_query.py, imported by
app/api/query.py. `/api/query` itself needs no new dependency here — it
uses `require_authenticated_user` below, the same as admindash's
`/api/query` route (interface map §6b); its {tenant_id}-bearing sibling
routes in app/api/entities.py use `require_staff_tenant` (map §6a's
`require_tenant_match` binding, per the note below).
"""
import hmac as hmac_mod

import httpx
from fastapi import Depends, Header, HTTPException, Request, status

from app.config import settings

STAFF_ROLES = {"admin", "staff"}


def require_authenticated_user(request: Request) -> dict:
    """Validate the bearer token by calling DataCore /auth/me.

    Returns the parsed user dict from DataCore on success. The original
    Authorization header is attached as `_token` so route handlers can forward
    it to downstream calls.

    Raises HTTPException 401 on missing/malformed header or non-2xx from DataCore.
    Raises HTTPException 502 if DataCore is unreachable.
    """
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )

    try:
        resp = httpx.get(
            f"{settings.datacore_url}/auth/me",
            headers={"Authorization": auth_header},
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DataCore is unreachable",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    try:
        user = resp.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DataCore returned an invalid response",
        )

    user["_token"] = auth_header
    return user


def require_role(*roles: str):
    """Factory for role-checking dependencies (mirrors launchpad)."""

    def dependency(user=Depends(require_authenticated_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(roles)}",
            )
        return user

    return dependency


# ADJUST(bindings): task-1-brief.md's Interfaces section calls this dependency
# `require_tenant_match`. That name does not exist anywhere in enrollx (see
# interface map §2, §F) — it belongs to admindash/backend/app/tenancy.py:291,
# a different service's dependency of a similar shape. enrollx's real
# equivalent, and what this is ported as, is `require_staff_tenant`
# (enrollx/backend/app/tenancy.py:297) — a Task 0 decision. `require_tenant_match`
# is the plan's name for this same dependency; do not add an import alias of
# that name, since no other module in this codebase uses it.
def require_staff_tenant(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    """For routes with a {tenant_id} path param. Checks BOTH that the caller's
    role is admin/staff AND that the token's tenant matches the path's
    tenant_id (403 on either failure)."""
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Requires admin or staff role")
    if user.get("tenant_id") != tenant_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Token tenant does not match requested tenant"
        )
    return user


def require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    """BINDING dependency name (interface map §2 — later tasks' tests
    reference it). Constant-time compare of the X-Internal-Key header against
    settings.internal_key. 401 on missing/mismatched key, no JWT involved —
    this is the internal/facade channel's auth, entirely separate from
    require_authenticated_user. `router = APIRouter(dependencies=[Depends(require_internal_key)])`
    is the pattern for gating a whole router, same as enrollx's api/internal.py.
    """
    if not x_internal_key or not hmac_mod.compare_digest(x_internal_key, settings.internal_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal key")
