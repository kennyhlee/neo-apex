"""API route handlers."""

import os
import uuid
from datetime import datetime, timezone

import toon

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.store import Store, derive_abbrev
from datacore.query import QueryEngine, TableNotFoundError

DUPLICATE_CHECK_THRESHOLD = float(
    os.environ.get("DATACORE_DUPLICATE_CHECK_THRESHOLD", "0.75")
)


class CreateEntityRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


class TenantRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


def _max_student_seq(store: Store, tenant_id: str, prefix: str) -> int:
    """Scan active students to find the highest sequence number for a prefix."""
    import re
    table_name = store._entities_table_name(tenant_id)
    if table_name not in store._table_names():
        return 0
    table = store._db.open_table(table_name)
    rows = table.search().where(
        "entity_type = 'student' AND _status = 'active'"
    ).to_list()
    pattern = re.compile(re.escape(prefix) + r"(\d+)$")
    max_seq = 0
    for row in rows:
        bd = toon.decode(row["base_data"]) if row.get("base_data") else {}
        sid = bd.get("student_id", "")
        m = pattern.match(sid)
        if m:
            max_seq = max(max_seq, int(m.group(1)))
    return max_seq


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""

    @app.get("/api/tenants")
    def list_tenants():
        """List all tenants."""
        tenants = []
        for table_name in store._table_names():
            if not table_name.endswith("_entities"):
                continue
            tenant_id = table_name.removesuffix("_entities")
            entity = store.get_active_entity(tenant_id, "tenant", tenant_id)
            if entity:
                base = entity.get("base_data", {})
                tenants.append({
                    "id": tenant_id,
                    "name": base.get("name", tenant_id),
                })
        return {"tenants": tenants}

    @app.put("/api/tenants/{tenant_id}")
    def put_tenant(tenant_id: str, body: TenantRequest):
        name = body.base_data.get("name")
        abbrev = derive_abbrev(name, tenant_id)
        base_data = {**body.base_data, "_abbrev": abbrev}

        existing = store.get_active_entity(tenant_id, "tenant", tenant_id)
        try:
            result = store.put_entity(
                tenant_id=tenant_id,
                entity_type="tenant",
                entity_id=tenant_id,
                base_data=base_data,
                custom_fields=body.custom_fields,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        status = 200 if existing else 201
        return JSONResponse(status_code=status, content=result)

    @app.get("/api/tenants/{tenant_id}")
    def get_tenant(tenant_id: str):
        result = store.get_active_entity(tenant_id, "tenant", tenant_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return result

    @app.get("/api/entities/{tenant_id}/student/next-id")
    def next_student_id(tenant_id: str):
        """Preview the next student ID without incrementing the counter."""
        tenant = store.get_active_entity(tenant_id, "tenant", tenant_id)
        if tenant is None:
            raise HTTPException(status_code=404, detail="Tenant not set up")

        abbrev = tenant["base_data"].get("_abbrev", tenant_id[:3].upper())
        year = str(datetime.now(timezone.utc).year)
        yy = year[-2:]
        prefix = f"{abbrev}-ST{yy}"

        # Use the higher of sequence counter and actual max ID in data
        counter_seq = store.get_sequence(tenant_id, "student", year)
        data_seq = _max_student_seq(store, tenant_id, prefix)
        next_seq = max(counter_seq, data_seq) + 1
        next_id = f"{prefix}{next_seq:04d}"

        return {
            "next_id": next_id,
            "tenant_abbrev": abbrev,
            "entity_abbrev": "ST",
            "sequence": next_seq,
            "approximate": True,
        }

    class SimilaritySearchRequest(BaseModel):
        first_name: str
        last_name: str
        dob: str
        primary_address: str

    @app.post("/api/entities/{tenant_id}/student/duplicate-check")
    def duplicate_check(tenant_id: str, body: SimilaritySearchRequest):
        table_name = store._entities_table_name(tenant_id)
        if table_name not in store._table_names():
            return {"matches": []}

        table = store._db.open_table(table_name)
        matched_ids: set[str] = set()
        matches = []

        def _add_match(entity_id: str, base_data: dict, score: float):
            if entity_id in matched_ids:
                return
            matched_ids.add(entity_id)
            matches.append({
                "entity_id": entity_id,
                "student_id": base_data.get("student_id", ""),
                "first_name": base_data.get("first_name", ""),
                "last_name": base_data.get("last_name", ""),
                "dob": base_data.get("dob", ""),
                "primary_address": base_data.get("primary_address", ""),
                "similarity_score": round(score, 4),
            })

        # 1. Field-based exact match on name + dob (always works, no embedder needed)
        all_rows = (
            table.search()
            .where("entity_type = 'student' AND _status = 'active'")
            .to_list()
        )
        for row in all_rows:
            bd = toon.decode(row["base_data"]) if row.get("base_data") else {}
            name_match = (
                bd.get("first_name", "").lower() == body.first_name.lower()
                and bd.get("last_name", "").lower() == body.last_name.lower()
            )
            dob_match = bd.get("dob", "") == body.dob
            if name_match and dob_match:
                _add_match(row["entity_id"], bd, 1.0)

        # 2. Vector similarity search (catches fuzzy/near matches)
        if store.embedder:
            fields = {
                "first_name": body.first_name,
                "last_name": body.last_name,
                "dob": body.dob,
                "primary_address": body.primary_address,
            }
            try:
                query_vector = store.embedder.embed(fields)
                rows = (
                    table.search(query_vector)
                    .where("entity_type = 'student' AND _status = 'active'")
                    .limit(5)
                    .to_list()
                )
                for row in rows:
                    dist = row.get("_distance", float("inf"))
                    similarity = max(0.0, 1.0 - dist / 2.0)
                    if similarity < DUPLICATE_CHECK_THRESHOLD:
                        continue
                    bd = toon.decode(row["base_data"]) if row.get("base_data") else {}
                    _add_match(row["entity_id"], bd, similarity)
            except Exception:
                pass  # Vector search is best-effort; field match above is authoritative

        matches.sort(key=lambda m: m["similarity_score"], reverse=True)
        return {"matches": matches}

    class PutModelsRequest(BaseModel):
        model_definition: dict
        source_filename: str
        created_by: str

    @app.get("/api/models/{tenant_id}")
    def list_tenant_models(tenant_id: str):
        """List all active models for a tenant, assembled into a combined definition."""
        rows = store.list_models(tenant_id, status="active")
        if not rows:
            raise HTTPException(status_code=404, detail="No models found")

        model_definition = {}
        for row in rows:
            entity_type = row["entity_type"]
            defn = row["model_definition"]
            clean_defn = {k: v for k, v in defn.items() if not k.startswith("_")}
            model_definition[entity_type] = clean_defn

        latest_row = max(rows, key=lambda r: r["_version"])
        first_defn = latest_row["model_definition"]

        return {
            "tenant_id": tenant_id,
            "version": max(row["_version"] for row in rows),
            "status": "active",
            "model_definition": model_definition,
            "source_filename": first_defn.get("_source_filename", ""),
            "created_by": first_defn.get("_created_by", ""),
            "created_at": max(row["_created_at"] for row in rows),
        }

    @app.put("/api/models/{tenant_id}")
    def put_tenant_models(tenant_id: str, body: PutModelsRequest):
        """Store a finalized model definition for a tenant."""
        def normalize(md: dict) -> dict:
            return {
                et: {
                    "base_fields": sorted(d.get("base_fields", []), key=lambda f: f["name"]),
                    "custom_fields": sorted(d.get("custom_fields", []), key=lambda f: f["name"]),
                }
                for et, d in sorted(md.items())
            }

        existing_rows = store.list_models(tenant_id, status="active")
        if existing_rows:
            existing_def = {}
            for row in existing_rows:
                et = row["entity_type"]
                defn = row["model_definition"]
                existing_def[et] = {k: v for k, v in defn.items() if not k.startswith("_")}

            if normalize(existing_def) == normalize(body.model_definition):
                latest = max(existing_rows, key=lambda r: r["_version"])
                first_defn = latest["model_definition"]
                return {
                    "tenant_id": tenant_id,
                    "version": max(r["_version"] for r in existing_rows),
                    "status": "unchanged",
                    "model_definition": existing_def,
                    "source_filename": first_defn.get("_source_filename", ""),
                    "created_by": first_defn.get("_created_by", ""),
                    "created_at": max(r["_created_at"] for r in existing_rows),
                }

        if store.get_active_entity(tenant_id, "tenant", tenant_id) is None:
            store.put_entity(
                tenant_id=tenant_id,
                entity_type="tenant",
                entity_id=tenant_id,
                base_data={"tenant_id": tenant_id},
            )

        change_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        max_version = 0

        for entity_type, definition in body.model_definition.items():
            model_def_with_meta = {
                **definition,
                "_source_filename": body.source_filename,
                "_created_by": body.created_by,
            }
            result = store.put_model(
                tenant_id=tenant_id,
                entity_type=entity_type,
                model_definition=model_def_with_meta,
                change_id=change_id,
            )
            max_version = max(max_version, result["_version"])

        return {
            "tenant_id": tenant_id,
            "version": max_version,
            "status": "finalized",
            "model_definition": body.model_definition,
            "source_filename": body.source_filename,
            "created_by": body.created_by,
            "created_at": now,
        }

    @app.get("/api/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        tenant = store.get_active_entity(tenant_id, "tenant", tenant_id)
        if tenant is None:
            raise HTTPException(status_code=400, detail="Tenant not set up")
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result

    class ArchiveRequest(BaseModel):
        entity_ids: list[str]

    @app.post("/api/entities/{tenant_id}/{entity_type}/archive")
    def archive_entities(tenant_id: str, entity_type: str, body: ArchiveRequest):
        count = 0
        for eid in body.entity_ids:
            if store.archive_entity(tenant_id, entity_type, eid):
                count += 1
        return {"archived": count}

    @app.post("/api/entities/{tenant_id}/{entity_type}")
    def create_entity(
        tenant_id: str, entity_type: str, body: CreateEntityRequest
    ):
        entity_id = uuid.uuid4().hex[:12]
        base_data = dict(body.base_data)

        # Auto-assign sequential student_id at creation time
        needs_auto_id = entity_type == "student" and not base_data.get("student_id")
        auto_id_seq = None
        if needs_auto_id:
            tenant_info = store.get_active_entity(tenant_id, "tenant", tenant_id)
            if tenant_info:
                abbrev = tenant_info["base_data"].get("_abbrev", tenant_id[:3].upper())
                year = str(datetime.now(timezone.utc).year)
                yy = year[-2:]
                prefix = f"{abbrev}-ST{yy}"
                counter_seq = store.get_sequence(tenant_id, "student", year)
                data_seq = _max_student_seq(store, tenant_id, prefix)
                auto_id_seq = max(counter_seq, data_seq) + 1
                base_data["student_id"] = f"{prefix}{auto_id_seq:04d}"

        try:
            result = store.put_entity(
                tenant_id=tenant_id,
                entity_type=entity_type,
                entity_id=entity_id,
                base_data=base_data,
                custom_fields=body.custom_fields,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Sync sequence counter to match the assigned ID
        if auto_id_seq is not None:
            current = store.get_sequence(tenant_id, "student", year)
            while current < auto_id_seq:
                store.increment_sequence(tenant_id, "student", year)
                current += 1

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

        # If sort column doesn't exist (e.g. empty table), return empty
        if sort_by not in available_cols:
            return {"data": [], "total": 0}

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
