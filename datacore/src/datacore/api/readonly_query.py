"""Read-only external query endpoint.

A guardrail over the shared QueryEngine for untrusted (e.g. LLM-authored) SQL.
Validates the SQL is a single read statement, caps rows, and runs it through the
existing engine with external access disabled. Does NOT reimplement execution.

The SQL shape guard below is the SOURCE OF TRUTH for the copies in
admindash/backend/app/tenancy.py and enrollx/backend/app/tenancy.py. It is
defense in depth, not the authoritative control: the authoritative control is
`QueryEngine.query(..., external=True)`, which sets DuckDB's
`enable_external_access=false` so filesystem/network access fails at the engine
regardless of what the guard did or did not spot.
"""
import re
from enum import Enum

import duckdb
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datacore.query import QueryEngine, TableNotFoundError
from datacore.store import Store

router = APIRouter(tags=["readonly-query"])
_store: Store | None = None

READONLY_MAX_ROWS = 200


# ── BEGIN shared SQL shape guard ──────────────────────────────────────────
# SOURCE OF TRUTH: datacore/src/datacore/api/readonly_query.py. This block is
# copied verbatim into admindash/backend/app/tenancy.py and
# enrollx/backend/app/tenancy.py — those services must not take a package
# dependency on datacore. Keep the three copies byte-identical; the copies
# assert it (see each service's guard tests).

# DuckDB filesystem/network *function* calls, matched only as `name(` so a
# column named e.g. read_receipts is not rejected. Families, not literal
# names: the alias/auto spellings (`read_csv_auto`, `read_json_auto`,
# `read_ndjson`) and the scan/attach helpers (`parquet_scan`, `sqlite_scan`,
# `postgres_attach`, `scan_arrow_ipc`) reach the filesystem exactly the way
# `read_csv` does, and a name-by-name list goes stale every DuckDB release.
_DENY = re.compile(
    r"\b(read_\w+|write_\w*|\w*_scan|scan_\w+|\w*_attach|glob|sniff_csv|system)\s*\(",
    re.IGNORECASE,
)

# `$$…$$` / `$tag$…$tag$` dollar-quote delimiters. `$1` (a bind parameter) does
# not match, by design.
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_]\w*)?\$")
_IDENT_CHAR = re.compile(r"\w")
_PLAIN_IDENT = re.compile(r"[A-Za-z_]\w*\Z")

# String literals survive scrubbing as this placeholder so the table-reference
# check below can still see *where* a literal was.
_STR = "''"

_TOKEN = re.compile(r"''|[A-Za-z_]\w*|\S", re.DOTALL)

# Words that may legitimately precede a `(` that opens a *query* rather than a
# function call. Anything else before `(` means a function call, and two
# standard SQL functions put a string literal directly after FROM inside one:
# `EXTRACT(part FROM 'x')` and `TRIM(BOTH 'x' FROM 'y')`.
_QUERY_PAREN_PREV = frozenset({
    "all", "and", "any", "as", "between", "by", "case", "distinct", "else",
    "except", "exists", "from", "having", "ilike", "in", "intersect", "is",
    "join", "lateral", "like", "not", "on", "or", "returning", "select",
    "then", "union", "using", "values", "when", "where", "with",
})

# Keywords that end a FROM clause, after which a string literal is an ordinary
# expression again (`… JOIN b ON b.x = 'foo'`).
_FROM_CLAUSE_END = frozenset({
    "except", "group", "having", "intersect", "limit", "offset", "on",
    "order", "qualify", "returning", "select", "union", "using", "where",
    "window",
})


def _strip_literals_and_comments(sql: str) -> str:
    """Blank out string literals and comments so the deny scan sees only SQL
    *code*.

    This is what lets a legitimate query filter on a value that happens to
    contain a SQL keyword — `first_name ILIKE '%from%'`, the literal shape the
    command palette builds — without tripping the guard.

    String literals ('…', E'…', $tag$…$tag$) collapse to the placeholder `''`
    rather than vanishing, because DuckDB's replacement scan makes a bare
    literal in table position a file read (`SELECT * FROM '/etc/passwd'`) and
    that check needs to know a literal was there.

    A quoted identifier keeps its content when the content is a plain
    identifier — DuckDB resolves `"read_csv"(...)` as the function, so the name
    must stay visible to the scan. Anything else inside quotes (`"/etc/x.csv"`,
    which the replacement scan also honours) collapses to the same `''`
    placeholder.

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
            out.append(f" {_STR} ")
            continue

        # "…" / `…` quoted identifiers
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
            text = "".join(content)
            out.append(f" {text} " if _PLAIN_IDENT.match(text) else f" {_STR} ")
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
                out.append(f" {_STR} ")
                continue

        out.append(c)
        i += 1

    return "".join(out)


def _sql_shape_error(sql: str) -> str | None:
    """Return why `sql` is not an acceptable read query, or None if it is.

    Defense in depth, NOT the authoritative control — see the caller docstrings.
    Three checks, in order:

    1. Single statement, and it starts with SELECT/WITH (leading `(` allowed,
       so `(SELECT …) UNION (SELECT …)` is a read like any other).
    2. No DuckDB filesystem/network function call anywhere (`_DENY`).
    3. No string literal in table-reference position — DuckDB's replacement
       scan turns `FROM '/etc/passwd'`, `FROM data, '/etc/passwd'` and
       `CROSS JOIN '/etc/passwd'` into file reads with no function call to
       match on.

    Write/DDL keywords (COPY, ATTACH, INSTALL, DELETE, …) are rejected by (1)
    rather than by a bare-word denylist: DuckDB accepts every one of them as an
    ordinary identifier, and tenants author their own field names, so
    `SELECT load FROM data` and `ORDER BY copy` are legitimate queries. Since a
    second statement is impossible (no `;`), the only statement positions are
    the start and the slot right after a WITH clause's CTE list, and both are
    checked.
    """
    try:
        s = _strip_literals_and_comments(sql)
    except ValueError as e:
        return f"Query could not be parsed safely: {e}"

    s = s.strip()
    while s.endswith(";"):
        s = s[:-1].strip()
    if not s:
        return "Query is empty"
    if ";" in s:
        return "Only a single statement is allowed"
    if _DENY.search(s):
        return "Query contains a disallowed keyword or function"

    tokens = _TOKEN.findall(s)
    head = 0
    while head < len(tokens) and tokens[head] == "(":
        head += 1
    if head >= len(tokens) or tokens[head].lower() not in ("select", "with"):
        return "Only SELECT/WITH read queries are allowed"

    not_read = "Only SELECT/WITH read queries are allowed"
    frames = [{"call": False, "select": False, "from": False}]
    expect_table = False
    with_depth: int | None = None
    after_cte = False
    prev = ""

    for tok in tokens:
        low = tok.lower()

        if after_cte and tok != ")":
            # The statement keyword that follows a WITH clause's CTE list.
            # `WITH c AS (SELECT 1) DELETE FROM data` is valid DuckDB.
            if low == ",":
                after_cte = False           # another CTE follows
            elif low == "select" or tok == "(":
                after_cte = False
                with_depth = None
            else:
                return not_read

        if tok == "(":
            frames.append({
                "call": bool(_PLAIN_IDENT.match(prev))
                and prev.lower() not in _QUERY_PAREN_PREV,
                "select": False,
                "from": False,
            })
            expect_table = False
        elif tok == ")":
            if len(frames) > 1:
                frames.pop()
            expect_table = False
            if with_depth is not None and len(frames) - 1 == with_depth:
                after_cte = True
        elif tok == _STR:
            if expect_table:
                return "A string literal is not allowed as a table reference"
        else:
            frame = frames[-1]
            if low == "with" and with_depth is None:
                with_depth = len(frames) - 1
            if low == "select":
                frame["select"] = True
                frame["from"] = False
                expect_table = False
            elif low == "from":
                # A FROM inside a function call with no SELECT of its own is
                # EXTRACT(part FROM x) / TRIM(chars FROM x), not a FROM clause.
                frame["from"] = (not frame["call"]) or frame["select"]
                expect_table = frame["from"]
            elif low == "join" or tok == ",":
                expect_table = frame["from"]
            elif low in _FROM_CLAUSE_END:
                frame["from"] = False
                expect_table = False
            else:
                expect_table = False

        prev = tok

    return None
# ── END shared SQL shape guard ────────────────────────────────────────────


class TableName(str, Enum):
    entities = "entities"
    models = "models"
    tenants = "tenants"


class ReadOnlyQueryRequest(BaseModel):
    tenant_id: str
    table: TableName
    sql: str


def validate_readonly_sql(sql: str) -> str:
    """Return cleaned single-statement read SQL, or raise ValueError."""
    error = _sql_shape_error(sql)
    if error:
        raise ValueError(error)
    s = sql.strip()
    while s.endswith(";"):
        s = s[:-1].strip()
    return s


def register_readonly_query_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


@router.post("/api/query/readonly")
def readonly_query(req: ReadOnlyQueryRequest):
    """Execute a validated read-only SQL query against a tenant's data."""
    try:
        clean = validate_readonly_sql(req.sql)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    table_type = "entities" if req.table == TableName.tenants else req.table.value
    wrapped = f"SELECT * FROM ({clean}) AS _q"
    qe = QueryEngine(_store)
    try:
        result = qe.query(
            tenant_id=req.tenant_id, table_type=table_type,
            sql=wrapped, limit=READONLY_MAX_ROWS, external=True,
        )
    except TableNotFoundError:
        return {"data": [], "total": 0}
    except duckdb.Error as e:
        # The (untrusted, LLM-authored) SQL failed to execute — bad column, type
        # conversion, an attempt at filesystem access that `external=True`
        # refused, etc. Any such failure is a query problem, so return 400 with
        # the message and let the caller self-correct. 500 is reserved for
        # genuine non-query failures below.
        raise HTTPException(status_code=400, detail=f"SQL error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")

    for row in result["rows"]:
        row.pop("vector", None)
    return {"data": result["rows"], "total": result["total"]}
