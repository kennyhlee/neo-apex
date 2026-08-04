# enrollx/backend/app/tenancy.py
"""Tenant + role enforcement. Every authenticated enrollx route uses this.

Routes with a {tenant_id} path parameter use `require_staff_tenant`, which
checks both the caller's role (must be admin or staff) and that the token's
tenant matches the path's tenant_id.

/api/query has no {tenant_id} path param — DataCore scopes a query by the
request body's `tenant_id` field, not by table naming (DataCore always
registers the tenant's table under the fixed alias `data`; see
datacore/src/datacore/query.py). So for that route:

  - `require_staff` checks only the caller's role; the route itself checks
    tenant match against the body.
  - `assert_query_tenant_match` is the REAL tenant-match check: the body's
    tenant_id must equal the caller's own tenant.
  - `assert_sql_uses_data_alias` is defense in depth: every table reference
    in the SQL must be exactly the `data` alias DataCore registers, which
    blocks DuckDB function-table escapes such as `FROM read_csv(...)` /
    `FROM read_parquet(...)` (DataCore only disables external access when
    called with `external=True`, which this route does not use).
"""
import re

from fastapi import Depends, HTTPException, status

from app.auth import require_authenticated_user

STAFF_ROLES = {"admin", "staff"}

# Keywords that introduce one or more table references, optionally
# comma-separated (e.g. "FROM a, b").
_TABLE_KEYWORDS = re.compile(r"\b(?:from|join|into|update)\b", re.IGNORECASE)

# Keywords/tokens that end a table-reference list — bounds how far past a
# FROM/JOIN/INTO/UPDATE keyword we scan for comma-separated table names.
_CLAUSE_STOP = re.compile(
    r"\b(?:where|on|group|order|limit|having|union|join|inner|left|right|"
    r"full|cross|natural|using|set|values|returning|window|for)\b|;",
    re.IGNORECASE,
)

# A single table-reference token: a double-quoted, backtick-quoted, or
# bracket-quoted identifier, or a bare identifier. Anything trailing (an
# alias, a comma, more SQL, or a function-call's "(...)") is left for the
# caller to split on.
_TABLE_TOKEN = re.compile(
    r'\s*(?:"(?P<dq>[^"]+)"|`(?P<bt>[^`]+)`|\[(?P<br>[^\]]+)\]|(?P<bare>[A-Za-z_]\w*))'
)

_DATA_ALIAS = "data"


def require_staff_tenant(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Requires admin or staff role")
    if user.get("tenant_id") != tenant_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Token tenant does not match requested tenant"
        )
    return user


def require_staff(user=Depends(require_authenticated_user)) -> dict:
    """For routes without a tenant path param (e.g. /api/query)."""
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Requires admin or staff role")
    return user


def assert_query_tenant_match(request_tenant_id, user: dict) -> None:
    """Real tenant-match check for /api/query: the body's tenant_id (the
    field DataCore actually scopes the query by) must equal the caller's own
    tenant. A missing/non-string tenant_id is also rejected — DataCore
    requires it, so its absence is not a legitimate request."""
    if not isinstance(request_tenant_id, str) or request_tenant_id != user.get("tenant_id"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Request tenant_id does not match token tenant",
        )


def _clause_after(sql: str, start: int) -> str:
    """Text from `start` up to the next clause-terminating keyword (or EOS)."""
    stop = _CLAUSE_STOP.search(sql, start)
    return sql[start:stop.start()] if stop else sql[start:]


def assert_sql_uses_data_alias(sql: str) -> None:
    """Defense in depth for /api/query: every table reference in the SQL must
    be exactly the `data` alias (case-insensitive, quoting stripped) that
    DataCore registers the tenant's table under. Anything else — another
    name, a DuckDB table function like read_csv(...), a CTE reference — is
    rejected, since `data` is the only legitimate table shape this route
    ever needs."""
    for keyword in _TABLE_KEYWORDS.finditer(sql):
        clause = _clause_after(sql, keyword.end())
        for segment in clause.split(","):
            match = _TABLE_TOKEN.match(segment)
            if not match:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Query contains a table reference that could not be verified",
                )
            table = match.group("dq") or match.group("bt") or match.group("br") or match.group("bare")
            if not table or table.lower() != _DATA_ALIAS:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Query references disallowed table '{table}'",
                )
