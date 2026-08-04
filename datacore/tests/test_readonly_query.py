import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from datacore.api import readonly_query as rq
from datacore.api.readonly_query import _DENY


def test_validate_accepts_select_and_with():
    assert rq.validate_readonly_sql("SELECT * FROM data") == "SELECT * FROM data"
    assert rq.validate_readonly_sql(
        "  WITH x AS (SELECT 1 AS n) SELECT * FROM x ;").startswith("WITH")


@pytest.mark.parametrize("bad", [
    "",
    "INSERT INTO data VALUES (1)",
    "UPDATE data SET x = 1",
    "DELETE FROM data",
    "DROP TABLE data",
    "SELECT 1; DROP TABLE data",
    "SELECT * FROM read_csv('/etc/hosts')",
    "ATTACH 'x.db' AS y",
    "COPY data TO '/tmp/x.csv'",
    "PRAGMA database_list",
])
def test_validate_rejects_non_readonly(bad):
    with pytest.raises(ValueError):
        rq.validate_readonly_sql(bad)


def test_validate_allows_column_named_like_function():
    # 'read_receipts' is a column, not the read_csv/read_* function call.
    assert "read_receipts" in rq.validate_readonly_sql(
        "SELECT read_receipts FROM data")


def test_endpoint_returns_rows_without_vector(seeded_store):
    rq._store = seeded_store
    out = rq.readonly_query(rq.ReadOnlyQueryRequest(
        tenant_id="t1", table="entities",
        sql="SELECT * FROM data WHERE entity_type = 'student'"))
    assert out["total"] == 3
    assert len(out["data"]) == 3
    assert all("vector" not in row for row in out["data"])


def test_endpoint_rejects_write(seeded_store):
    rq._store = seeded_store
    with pytest.raises(HTTPException) as ei:
        rq.readonly_query(rq.ReadOnlyQueryRequest(
            tenant_id="t1", table="entities", sql="DELETE FROM data"))
    assert ei.value.status_code == 400


def test_endpoint_maps_execution_error_to_400(seeded_store):
    """A DuckDB execution error (e.g. type conversion) must be 400, not 500, so the
    caller (LLM) can self-correct instead of seeing a system failure."""
    rq._store = seeded_store
    with pytest.raises(HTTPException) as ei:
        rq.readonly_query(rq.ReadOnlyQueryRequest(
            tenant_id="t1", table="entities",
            sql="SELECT CAST('x' AS INTEGER) AS n"))
    assert ei.value.status_code == 400
    assert "SQL error" in str(ei.value.detail)


# ── BEGIN shared SQL guard corpus ─────────────────────────────────────────
# SOURCE OF TRUTH: datacore/tests/test_readonly_query.py. Copied verbatim into
# admindash/backend/tests/test_tenancy.py and
# enrollx/backend/tests/test_auth_guards.py, the way the guard itself is.
# Requires `re`, `pytest`, `Path` and the service's own `_DENY` in scope.

ESCAPES = [
    # The five file-reading table functions the name-by-name list had…
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM read_parquet('s3://evil/x.parquet')",
    "SELECT * FROM read_json('/etc/passwd')",
    "SELECT read_text('/etc/passwd')",
    "SELECT read_blob('/etc/passwd')",
    # …and the alias/auto spellings and scan helpers it missed. Each of these
    # was verified to reach the filesystem when external access is on.
    "SELECT * FROM read_csv_auto('/etc/passwd')",
    "SELECT * FROM read_json_auto('/etc/passwd')",
    "SELECT * FROM read_ndjson('/etc/passwd')",
    "SELECT * FROM parquet_scan('/etc/passwd')",
    "SELECT * FROM glob('/etc/*')",
    "SELECT * FROM sniff_csv('/etc/passwd')",
    "SELECT * FROM sqlite_scan('/tmp/x.db', 't')",
    "SELECT * FROM scan_arrow_ipc([{'ptr': 1}])",
    "SELECT * FROM postgres_attach('dbname=evil')",
    "SELECT * FROM write_csv('/tmp/exfil.csv')",
    "SELECT system('ls')",
    # Quoting the function name must not hide it — DuckDB still resolves it.
    "SELECT * FROM \"read_csv\"('/etc/passwd')",
    # DuckDB's replacement scan: a string literal in table position reads a
    # file with no function call to match on. Every table position counts —
    # FROM, comma-join, JOIN, subquery, CTE, and the quoted-identifier and
    # dollar-quoted spellings.
    "SELECT * FROM '/etc/passwd'",
    "SELECT * FROM data, '/etc/passwd'",
    "SELECT * FROM data CROSS JOIN '/etc/passwd'",
    "SELECT * FROM (SELECT * FROM '/etc/passwd')",
    "WITH c AS (SELECT * FROM '/etc/passwd') SELECT * FROM c",
    "SELECT * FROM data WHERE entity_id IN (SELECT a FROM '/etc/passwd')",
    "SELECT * FROM $$/etc/passwd$$",
    "SELECT * FROM \"/etc/passwd\"",
    # Write/DDL statements. Rejected by statement position rather than by a
    # bare-word denylist, so a tenant field named `copy` still works — see
    # LEGITIMATE.
    "INSERT INTO data VALUES (1)",
    "UPDATE data SET x = 1",
    "DELETE FROM data",
    "DROP TABLE data",
    "ALTER TABLE data ADD COLUMN x INT",
    "CREATE TABLE evil AS SELECT 1",
    "ATTACH '/tmp/evil.db' AS evil",
    "DETACH evil",
    "COPY data TO '/tmp/exfil.csv'",
    "COPY (SELECT * FROM data) TO '/tmp/exfil.csv'",
    "INSTALL httpfs",
    "LOAD httpfs",
    "PRAGMA database_list",
    "EXPORT DATABASE '/tmp/dump'",
    "IMPORT DATABASE '/tmp/dump'",
    "CALL pragma_version()",
    # The only statement position that is not the start of the string:
    # `WITH … ) DELETE …` is valid DuckDB.
    "WITH c AS (SELECT 1) DELETE FROM data",
    "WITH c AS (SELECT 1) INSERT INTO data VALUES (2)",
    # Stacked statement, and an escape hidden behind a comment.
    "SELECT * FROM data; ATTACH '/tmp/evil.db' AS evil",
    "SELECT * FROM data -- ok\nUNION SELECT * FROM read_csv('/etc/passwd')",
    # A scanner desynced from the parser is how a guard like this gets
    # bypassed, so an unterminated literal or comment is refused, not guessed.
    "SELECT * FROM data WHERE a = 'oops",
    "SELECT * FROM data /* oops",
    "",
]

LEGITIMATE = [
    # The four shapes the table-name allowlist wrongly rejected.
    "SELECT * FROM data WHERE first_name ILIKE '%from%'",
    "WITH x AS (SELECT * FROM data) SELECT * FROM x",
    "SELECT * FROM (SELECT * FROM data) t",
    "SELECT * FROM data",
    # The real shape every dashboard query uses.
    "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'",
    # escapeSql() doubles quotes; the scan must not desync on it.
    "SELECT * FROM data WHERE last_name ILIKE '%O''Brien%'",
    # Keyword-bearing literals — what typing "update" into ⌘K builds.
    "SELECT * FROM data WHERE first_name ILIKE '%update%' LIMIT 5",
    "SELECT * FROM data WHERE first_name ILIKE '%join%' LIMIT 5",
    # Tenant-authored field names that happen to be DuckDB statement keywords.
    # ProgramPage.tsx and StudentsPage.tsx interpolate model-defined field
    # names into ORDER BY / GROUP BY / select lists, so these are reachable by
    # a tenant simply naming a field `load` or `copy`.
    "SELECT load FROM data",
    "SELECT * FROM data ORDER BY copy",
    "SELECT import, call, export, pragma FROM data",
    "SELECT 1 AS load, 2 AS copy FROM data",
    "SELECT read_receipts FROM data",
    # A parenthesised set operation is a read like any other.
    "(SELECT * FROM data) UNION (SELECT * FROM data)",
    # Quoted / bracketed alias forms.
    'SELECT * FROM "data"',
    "SELECT * FROM [data]",
    'SELECT "first name" FROM data',
    # Standard SQL that puts a string literal directly after FROM *inside a
    # function call* — not a table reference.
    "SELECT EXTRACT(year FROM '2020-01-01')",
    "SELECT TRIM(BOTH 'x' FROM 'xabcx')",
    # A literal inside the FROM clause, in a join predicate.
    "SELECT * FROM data a JOIN data b ON b.parent_id = 'p1'",
    "SELECT * FROM data d1, data d2 WHERE d1.entity_type = 'student'",
    # Roll-up shapes Plans 2–4 need.
    "WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b",
    "SELECT * FROM data WHERE entity_id IN (SELECT parent_id FROM data)",
    "SELECT coalesce(first_name, 'n/a') FROM data",
    "SELECT * FROM data /* note */ WHERE a = 'z'",
]

_GUARD_FILES = (
    "datacore/src/datacore/api/readonly_query.py",
    "admindash/backend/app/tenancy.py",
    "enrollx/backend/app/tenancy.py",
)


def _repo_root():
    for parent in Path(__file__).resolve().parents:
        if (parent / "services.json").exists():
            return parent
    return None


def test_escape_corpus_covers_every_deny_branch():
    """Genuinely exercise `_DENY`, rather than asserting coverage on trust.

    The alternatives are pulled out of the compiled pattern, so a branch added
    later with no escape to match it fails here instead of shipping untested.
    """
    body = _DENY.pattern[_DENY.pattern.index("(") + 1:_DENY.pattern.index(")")]
    branches = body.split("|")
    assert len(branches) >= 8, branches
    for branch in branches:
        probe = re.compile(r"\b" + branch + r"\s*\(", re.IGNORECASE)
        assert any(probe.search(sql) for sql in ESCAPES), f"no escape exercises {branch}"


def test_guard_block_is_byte_identical_in_all_three_services():
    """The guard is a deliberate copy, not an import. Drift is the failure mode
    this whole arrangement risks, so assert it directly."""
    root = _repo_root()
    if root is None:
        pytest.skip("repo root (services.json) not found")
    paths = [root / f for f in _GUARD_FILES]
    if not all(p.exists() for p in paths):
        pytest.skip("not a full-suite checkout")
    blocks = []
    for p in paths:
        text = p.read_text(encoding="utf-8")
        blocks.append(text[text.index("# ── BEGIN shared SQL shape guard"):
                          text.index("# ── END shared SQL shape guard")])
    assert blocks[0] == blocks[1] == blocks[2]
# ── END shared SQL guard corpus ───────────────────────────────────────────


@pytest.mark.parametrize("sql", ESCAPES)
def test_validate_rejects_every_escape(sql):
    with pytest.raises(ValueError):
        rq.validate_readonly_sql(sql)


@pytest.mark.parametrize("sql", LEGITIMATE)
def test_validate_allows_every_legitimate_shape(sql):
    rq.validate_readonly_sql(sql)
