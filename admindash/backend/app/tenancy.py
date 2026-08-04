"""Tenant-scope enforcement dependencies.

Every route with a {tenant_id} path parameter must require that the
authenticated user belongs to that tenant. The SQL guard is defense in
depth for the raw query passthrough.
"""
import re

from fastapi import Depends, HTTPException, status

from app.auth import require_authenticated_user

# Table references after FROM/JOIN/INTO/UPDATE. LanceDB table names are
# {tenant}_entities / {tenant}_models / {tenant}_sequences plus `global`.
_TABLE_REF = re.compile(r"\b(?:from|join|into|update)\s+([a-zA-Z_][\w]*)", re.IGNORECASE)


def require_tenant_match(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    if user.get("tenant_id") != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token tenant does not match requested tenant",
        )
    return user


def assert_tenant_scoped_sql(sql: str, tenant_id: str) -> None:
    for table in _TABLE_REF.findall(sql):
        if not table.lower().startswith(f"{tenant_id.lower()}_"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Query references non-tenant table '{table}'",
            )
