"""Tenant-scope enforcement dependencies.

Every route with a {tenant_id} path parameter must require that the
authenticated user belongs to that tenant. The SQL guard is defense in
depth for the raw query passthrough — it is the sole admindash-side tenant
check on /api/query, which has no {tenant_id} path param.

This is a lexical guard, not a SQL parser. It deliberately errs on the side
of rejecting anything it cannot confidently classify as tenant-prefixed
(including CTE references like `FROM cte` — nothing in admindash currently
builds SQL with a WITH clause through this route, so that's intentional,
not a known-good case being over-blocked).
"""
import re

from fastapi import Depends, HTTPException, status

from app.auth import require_authenticated_user

# Keywords that introduce one or more table references, optionally
# comma-separated (e.g. "FROM a, b"). LanceDB table names are
# {tenant}_entities / {tenant}_models / {tenant}_sequences plus `global`.
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
# alias, a comma, more SQL) is left for the caller to split on.
_TABLE_TOKEN = re.compile(
    r'\s*(?:"(?P<dq>[^"]+)"|`(?P<bt>[^`]+)`|\[(?P<br>[^\]]+)\]|(?P<bare>[A-Za-z_]\w*))'
)


def require_tenant_match(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    if user.get("tenant_id") != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token tenant does not match requested tenant",
        )
    return user


def _clause_after(sql: str, start: int) -> str:
    """Text from `start` up to the next clause-terminating keyword (or EOS)."""
    stop = _CLAUSE_STOP.search(sql, start)
    return sql[start:stop.start()] if stop else sql[start:]


def assert_tenant_scoped_sql(sql: str, tenant_id: str) -> None:
    prefix = f"{tenant_id.lower()}_"
    for keyword in _TABLE_KEYWORDS.finditer(sql):
        clause = _clause_after(sql, keyword.end())
        for segment in clause.split(","):
            match = _TABLE_TOKEN.match(segment)
            if not match:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Query contains a table reference that could not be verified as tenant-scoped",
                )
            table = match.group("dq") or match.group("bt") or match.group("br") or match.group("bare")
            if not table or not table.lower().startswith(prefix):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Query references non-tenant table '{table}'",
                )
