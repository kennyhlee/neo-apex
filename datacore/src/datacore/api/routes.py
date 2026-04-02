"""API route handlers."""

import uuid

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.store import Store, derive_abbrev
from datacore.query import QueryEngine, TableNotFoundError


class CreateEntityRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


class TenantRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""

    @app.put("/api/tenants/{tenant_id}")
    def put_tenant(tenant_id: str, body: TenantRequest):
        name = body.base_data.get("name")
        abbrev = derive_abbrev(name, tenant_id)
        base_data = {**body.base_data, "_abbrev": abbrev}

        existing = store.get_active_entity(tenant_id, "tenant", tenant_id)
        result = store.put_entity(
            tenant_id=tenant_id,
            entity_type="tenant",
            entity_id=tenant_id,
            base_data=base_data,
            custom_fields=body.custom_fields,
        )
        status = 200 if existing else 201
        return JSONResponse(status_code=status, content=result)

    @app.get("/api/tenants/{tenant_id}")
    def get_tenant(tenant_id: str):
        result = store.get_active_entity(tenant_id, "tenant", tenant_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return result

    @app.get("/api/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result

    @app.post("/api/entities/{tenant_id}/{entity_type}")
    def create_entity(
        tenant_id: str, entity_type: str, body: CreateEntityRequest
    ):
        entity_id = uuid.uuid4().hex[:12]
        result = store.put_entity(
            tenant_id=tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            base_data=body.base_data,
            custom_fields=body.custom_fields,
        )
        return JSONResponse(status_code=201, content=result)

    @app.get("/api/entities/{tenant_id}/{entity_type}/query")
    def query_entities(
        tenant_id: str,
        entity_type: str,
        request: Request,
        _status: str = "active",
        sort_by: str = "last_name",
        sort_dir: str = "asc",
        limit: int | None = None,
        offset: int = 0,
    ):
        # Clamp pagination when provided
        if limit is not None:
            if limit < 1:
                limit = 20
            if limit > 50:
                limit = 50
        if offset < 0:
            offset = 0
        if sort_dir not in ("asc", "desc"):
            sort_dir = "asc"

        qe = QueryEngine(store)

        # Load and flatten table to discover available columns
        arrow_table = store.get_table_as_arrow(tenant_id, "entities")
        if arrow_table is None:
            return {"data": [], "total": 0}

        flat = qe._flatten_custom_fields(arrow_table)
        available_cols = set(flat.column_names)

        # Validate sort column
        if sort_by not in available_cols:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid sort column: '{sort_by}'",
            )

        # Build WHERE clauses
        conditions = [f"entity_type = '{entity_type}'"]

        if _status and _status != "all":
            safe_status = _status.replace("'", "''")
            conditions.append(f"_status = '{safe_status}'")

        # Dynamic field filters — any query param matching a column name
        reserved = {"_status", "sort_by", "sort_dir", "limit", "offset"}
        for key, val in request.query_params.items():
            if key in reserved or not val:
                continue
            if key in available_cols:
                safe_val = val.replace("'", "''")
                conditions.append(f"{key} ILIKE '%{safe_val}%'")

        where = " AND ".join(conditions)
        sql = f"SELECT * FROM data WHERE {where} ORDER BY {sort_by} {sort_dir.upper()}"

        try:
            result = qe.query(tenant_id, "entities", sql, limit=limit, offset=offset)
            return {"data": result["rows"], "total": result["total"]}
        except TableNotFoundError:
            return {"data": [], "total": 0}

    @app.get("/api/query/{tenant_id}/{table_type}")
    def run_query(
        tenant_id: str,
        table_type: str,
        sql: str = Query(..., description="SQL query using table alias 'data'"),
    ):
        qe = QueryEngine(store)
        try:
            result = qe.query(tenant_id, table_type, sql)
            return {"rows": result["rows"], "total": result["total"]}
        except TableNotFoundError:
            return {"rows": [], "total": 0}

    @app.get("/api/search/{tenant_id}")
    def search_entities(
        tenant_id: str,
        q: str = Query(..., description="Search query text"),
        entity_type: str | None = Query(None, description="Filter by entity type"),
        limit: int = Query(10, ge=1, le=100, description="Max results"),
    ):
        engine = QueryEngine(store)
        result = engine.semantic_search(
            tenant_id=tenant_id,
            query=q,
            entity_type=entity_type,
            limit=limit,
        )
        return result
