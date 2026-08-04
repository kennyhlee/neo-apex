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
  - `assert_sql_is_safe_read` is defense in depth on the SQL's *shape*: a
    single SELECT/WITH statement with no DuckDB filesystem/network function
    call (`read_csv(...)`, `read_parquet(...)`, `COPY ... TO`, `ATTACH`, …).
    DataCore's own /api/query now runs with `external=True`, which disables
    external access at the engine; this guard is the secondary layer.
"""
import re

from fastapi import Depends, HTTPException, status

from app.auth import require_authenticated_user

STAFF_ROLES = {"admin", "staff"}

# Write/DDL statement keywords, plus DuckDB file/external FUNCTION calls
# (matched as `name(` so a column named e.g. read_receipts is not rejected).
#
# SOURCE OF TRUTH: datacore/src/datacore/api/readonly_query.py::_DENY. This is
# a deliberate copy, not an import — enrollx must not take a package
# dependency on datacore. Keep the two lists in sync.
_DENY = re.compile(
    r"\b(insert|update|delete|drop|alter|create|attach|detach|copy|install|load|"
    r"pragma|export|import|call)\b"
    r"|\b(read_csv|read_parquet|read_json|read_text|read_blob)\s*\("
    r"|\bwrite_\w*\s*\("
    r"|\bsystem\s*\(",
    re.IGNORECASE,
)

# `$$…$$` / `$tag$…$tag$` dollar-quote delimiters. `$1` (a bind parameter) does
# not match, by design.
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_]\w*)?\$")
_IDENT_CHAR = re.compile(r"\w")


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


def _strip_literals_and_comments(sql: str) -> str:
    """Blank out string literals and comments so the deny scan sees only SQL
    *code*.

    This is what lets a legitimate query filter on a value that happens to
    contain a SQL keyword — `first_name ILIKE '%from%'`, the literal shape the
    command palette builds — without tripping the guard.

    Quoted identifiers keep their contents (only the quote characters become
    spaces): DuckDB resolves `"read_csv"(...)` as the function, so the name
    must stay visible to the scan.

    Raises ValueError on an unterminated literal or comment. A scanner that
    has desynced from the parser is exactly how a guard like this gets
    bypassed, so refuse rather than guess.
    """
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]

        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j
            out.append(" ")
            continue

        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            if j == -1:
                raise ValueError("unterminated block comment")
            i = j + 2
            out.append(" ")
            continue

        # '…' (doubled '' escapes) and E'…' (backslash escapes)
        if c == "'" or (
            c in "Ee"
            and i + 1 < n
            and sql[i + 1] == "'"
            and (i == 0 or not _IDENT_CHAR.match(sql[i - 1]))
        ):
            backslash_escapes = c != "'"
            j = i + 2 if backslash_escapes else i + 1
            while True:
                if j >= n:
                    raise ValueError("unterminated string literal")
                ch = sql[j]
                if backslash_escapes and ch == "\\":
                    j += 2
                    continue
                if ch == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            i = j + 1
            out.append(" ")
            continue

        # "…" / `…` quoted identifiers — content is kept, quotes are not
        if c in '"`':
            close = c
            j = i + 1
            content: list[str] = []
            while True:
                if j >= n:
                    raise ValueError("unterminated quoted identifier")
                if sql[j] == close:
                    if j + 1 < n and sql[j + 1] == close:
                        content.append(close)
                        j += 2
                        continue
                    break
                content.append(sql[j])
                j += 1
            out.append(" " + "".join(content) + " ")
            i = j + 1
            continue

        if c == "$":
            match = _DOLLAR_TAG.match(sql, i)
            if match:
                tag = match.group(0)
                j = sql.find(tag, match.end())
                if j == -1:
                    raise ValueError("unterminated dollar-quoted string")
                i = j + len(tag)
                out.append(" ")
                continue

        out.append(c)
        i += 1

    return "".join(out)


def assert_sql_is_safe_read(sql: str) -> None:
    """Defense in depth for /api/query: the SQL must be a single SELECT/WITH
    statement containing no DuckDB filesystem/network function call and no
    write/DDL keyword.

    This is a denylist of *escape mechanisms*, not an allowlist of table
    names — the shape `datacore/src/datacore/api/readonly_query.py` already
    uses for untrusted SQL. It therefore permits CTEs, subqueries and joins
    (which capacity roll-ups and activity aggregation need) while still
    blocking the class this guard exists for: reaching the filesystem or
    network from inside a query.

    Tenant scope is NOT enforced here — `assert_query_tenant_match` does
    that, against the body's tenant_id, which is the field DataCore actually
    scopes by.
    """
    try:
        scrubbed = _strip_literals_and_comments(sql)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Query could not be parsed safely: {e}",
        )

    s = scrubbed.strip()
    while s.endswith(";"):
        s = s[:-1].strip()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Query is empty"
        )
    if ";" in s:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a single statement is allowed",
        )
    if s.split(None, 1)[0].lower() not in ("select", "with"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only SELECT/WITH read queries are allowed",
        )
    if _DENY.search(s):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Query contains a disallowed keyword or function",
        )
