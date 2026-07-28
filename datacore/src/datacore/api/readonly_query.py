"""Read-only external query endpoint.

A guardrail over the shared QueryEngine for untrusted (e.g. LLM-authored) SQL.
Validates the SQL is a single read statement, caps rows, and runs it through the
existing engine with filesystem access disabled. Does NOT reimplement execution.
"""
import re
from enum import Enum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datacore.query import QueryEngine, TableNotFoundError
from datacore.store import Store

router = APIRouter(tags=["readonly-query"])
_store: Store | None = None

READONLY_MAX_ROWS = 200

# Write/DDL statement keywords, plus DuckDB file/external FUNCTION calls (matched
# as `name(` so a column named e.g. read_receipts is not rejected).
_DENY = re.compile(
    r"\b(insert|update|delete|drop|alter|create|attach|detach|copy|install|load|"
    r"pragma|export|import|call)\b"
    r"|\b(read_csv|read_parquet|read_json|read_text|read_blob)\s*\("
    r"|\bwrite_\w*\s*\("
    r"|\bsystem\s*\(",
    re.IGNORECASE,
)


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
    s = sql.strip()
    while s.endswith(";"):
        s = s[:-1].strip()
    if not s:
        raise ValueError("Empty query.")
    if ";" in s:
        raise ValueError("Only a single statement is allowed.")
    first = s.split(None, 1)[0].lower()
    if first not in ("select", "with"):
        raise ValueError("Only SELECT/WITH read queries are allowed.")
    if _DENY.search(s):
        raise ValueError("Query contains a disallowed keyword or function.")
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
    except Exception as e:
        msg = str(e)
        if "Catalog Error" in msg or "Parser Error" in msg or "Binder Error" in msg:
            raise HTTPException(status_code=400, detail=f"SQL error: {msg}")
        raise HTTPException(status_code=500, detail=f"Query failed: {msg}")

    for row in result["rows"]:
        row.pop("vector", None)
    return {"data": result["rows"], "total": result["total"]}
