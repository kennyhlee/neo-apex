# enrollx/backend/tests/test_auth_guards.py
import re
from pathlib import Path

import httpx
import pytest
import respx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.tenancy import _DENY, assert_sql_is_safe_read


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}
    return f


@pytest.fixture
def as_user():
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)
    yield _as
    app.dependency_overrides.clear()


def test_entities_requires_auth():
    resp = TestClient(app).post("/api/entities/acme/student", json={"base_data": {}})
    assert resp.status_code == 401


def test_entities_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").post("/api/entities/globex/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_entities_parent_role_403(as_user):
    resp = as_user(role="parent").post("/api/entities/acme/student", json={"base_data": {}})
    assert resp.status_code == 403


# ── /api/query: auth + role ───────────────────────────────────────────────


def test_query_requires_auth():
    resp = TestClient(app).post(
        "/api/query", json={"tenant_id": "acme", "sql": "SELECT * FROM data"}
    )
    assert resp.status_code == 401


def test_query_parent_role_403(as_user):
    resp = as_user(role="parent").post(
        "/api/query", json={"tenant_id": "acme", "sql": "SELECT * FROM data"}
    )
    assert resp.status_code == 403


def test_query_malformed_json_body_returns_400(as_user):
    """Invalid JSON must be rejected with 400, not an uncaught 500."""
    resp = as_user(tenant="acme").post(
        "/api/query",
        content=b"{not valid json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


def test_query_non_object_json_body_returns_400(as_user):
    """A JSON array or scalar body must be rejected with 400, not an AttributeError 500."""
    resp = as_user(tenant="acme").post("/api/query", json=[1, 2, 3])
    assert resp.status_code == 400


# ── /api/query: corrected tenant + SQL-shape guard ─────────────────────────
#
# DataCore scopes a query by the body's tenant_id field, and always registers
# the tenant's table under the fixed alias `data` (see datacore/src/datacore/
# query.py). So /api/query has no {tenant_id} path param to guard with
# require_staff_tenant; instead the route checks the body's tenant_id against
# the token (assert_query_tenant_match) and that the SQL is a single
# escape-free read statement (assert_sql_is_safe_read).


def test_query_cross_tenant_403(as_user):
    """A body tenant_id belonging to a *different* tenant is 403 — the
    cross-tenant branch, distinct from the missing-tenant_id branch below."""
    resp = as_user(tenant="acme").post(
        "/api/query",
        json={"tenant_id": "globex", "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 403


def test_query_missing_body_tenant_id_403(as_user):
    """DataCore requires tenant_id, so its absence is not a legitimate request."""
    resp = as_user(tenant="acme").post(
        "/api/query", json={"table": "entities", "sql": "SELECT * FROM data"}
    )
    assert resp.status_code == 403


@respx.mock
def test_query_real_shape_sql_passes_guard(as_user):
    """A real-shape query against the `data` alias, with a matching body
    tenant_id, must not be blocked by either guard. DataCore is mocked so the
    request completes without depending on a live DataCore; we assert the
    guards didn't reject it (not that the overall response is 200)."""
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = as_user(tenant="acme").post(
        "/api/query",
        json={
            "tenant_id": "acme",
            "table": "entities",
            "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'",
        },
    )
    assert resp.status_code != 403


@pytest.mark.parametrize("sql", [
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM \"read_csv\"('/etc/passwd')",
    "SELECT * FROM read_parquet('s3://evil/x.parquet')",
    "COPY (SELECT * FROM data) TO '/tmp/exfil.csv'",
    "SELECT * FROM data; ATTACH '/tmp/evil.db' AS evil",
])
def test_query_function_table_escape_403(as_user, sql):
    resp = as_user(tenant="acme").post(
        "/api/query", json={"tenant_id": "acme", "sql": sql}
    )
    assert resp.status_code == 403


@respx.mock
@pytest.mark.parametrize("sql", [
    # A string literal containing a SQL keyword — the shape ⌘K/ILIKE filters build.
    "SELECT * FROM data WHERE first_name ILIKE '%from%' LIMIT 5",
    "SELECT * FROM data WHERE first_name ILIKE '%update%' LIMIT 5",
    # CTE and subquery — Plans 2–4 need both for capacity roll-ups.
    "WITH x AS (SELECT * FROM data) SELECT * FROM x",
    "SELECT * FROM (SELECT * FROM data) t",
    "SELECT * FROM data",
])
def test_query_legitimate_shapes_pass_guard(as_user, sql):
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = as_user(tenant="acme").post(
        "/api/query", json={"tenant_id": "acme", "table": "entities", "sql": sql}
    )
    assert resp.status_code != 403


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
def test_sql_guard_rejects_every_escape(sql):
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read(sql)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("sql", LEGITIMATE)
def test_sql_guard_allows_every_legitimate_shape(sql):
    assert_sql_is_safe_read(sql)
