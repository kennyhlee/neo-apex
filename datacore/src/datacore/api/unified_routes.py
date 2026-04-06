"""Unified query endpoint — DuckDB SQL over tenants, models, and entities."""
from enum import Enum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datacore.query import QueryEngine, TableNotFoundError
from datacore.store import Store

router = APIRouter(tags=["default"])

_store: Store | None = None


class TableName(str, Enum):
    entities = "entities"
    models = "models"
    tenants = "tenants"


class QueryRequest(BaseModel):
    tenant_id: str
    table: TableName
    sql: str


def register_unified_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


@router.post("/api/query")
def unified_query(req: QueryRequest):
    """Execute a DuckDB SQL query against a tenant's data.

    The SQL runs against the table alias 'data'.
    Supported tables: entities, models, tenants.
    """
    qe = QueryEngine(_store)

    # "tenants" is a convenience alias — tenants are stored as entities
    table_type = "entities" if req.table == TableName.tenants else req.table.value

    try:
        result = qe.query(
            tenant_id=req.tenant_id,
            table_type=table_type,
            sql=req.sql,
        )
    except TableNotFoundError:
        return {"data": [], "total": 0}
    except Exception as e:
        error_msg = str(e)
        if "Catalog Error" in error_msg or "Parser Error" in error_msg or "Binder Error" in error_msg:
            raise HTTPException(status_code=400, detail=f"SQL error: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Query failed: {error_msg}")

    # Normalize response key from "rows" to "data"
    return {"data": result["rows"], "total": result["total"]}
