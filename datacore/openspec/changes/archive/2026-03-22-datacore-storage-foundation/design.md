## Context

NeoApex currently has vector storage embedded in papermite's `lance_store.py`, using LanceDB with PyArrow schemas. Datacore will extract this into a general-purpose, tenant-scoped storage package that any NeoApex project can depend on, adding DuckDB+Arrow for SQL querying.

## Goals / Non-Goals

**Goals:**
- General-purpose LanceDB abstraction not tied to any specific domain model
- Tenant isolation as a first-class concern (one set of tables per tenant, no cross-tenant queries)
- SQL query capability via DuckDB reading Arrow tables from LanceDB
- Installable Python package with clean public API
- Version history with configurable max versions per entity type

**Non-Goals:**
- REST API / HTTP endpoints (consuming projects build their own)
- Migrating papermite's data (follow-up change)
- Authentication or permission enforcement (consuming projects handle this)
- Cross-tenant queries (by design, for isolation and blast radius containment)
- Vector similarity search (future capability — this change is structured data CRUD + SQL)

## Decisions

### Decision 1: Package layout — `src/datacore/`

Use the `src` layout (`src/datacore/`) with `pyproject.toml` and hatchling build backend, matching papermite's conventions.

Public API surface:
- `datacore.store` — LanceDB CRUD (Store class)
- `datacore.query` — DuckDB+Arrow SQL (QueryEngine class)

### Decision 2: Two tables per tenant

Each tenant gets exactly two LanceDB tables:

- **`{tenant_id}_models`** — model/schema definitions (field names, types, required flags). This is the "meta" layer describing what entity types look like.
- **`{tenant_id}_entities`** — all entity data (student records, staff records, etc.) filtered by `entity_type` metadata column. Base model fields + TOON custom fields.

Table naming convention: `{tenant_id}_models`, `{tenant_id}_entities`

```
t1_models:    entity_type | _version | _status | _change_id | model_definition | _created_at | _updated_at
t1_entities:  entity_type | entity_id | _version | _status | _change_id | base_data | _custom_fields | _created_at | _updated_at
```

**Rationale:**
- Stronger tenant isolation — storage issues don't cross tenant boundaries
- No cross-tenant queries needed (by design)
- No table sprawl — 2 tables per tenant regardless of entity type count
- Clean separation: model definitions (structure) vs entity records (data)
- DuckDB filters on `entity_type` column for entity-specific queries

### Decision 3: TOON custom fields storage

Custom fields (not in the base model) are stored as a TOON-encoded document in a `_custom_fields` column (string), using the `python-toon` library for token-efficient serialization. The SQL query layer decodes and flattens these into virtual columns so DuckDB can filter on them like regular fields.

Custom field keys must not conflict with base data keys — `put_entity()` validates this and raises `ValueError` on overlap.

### Decision 4: DuckDB + Arrow query integration

`QueryEngine` loads a LanceDB table as an Arrow table, then registers it with DuckDB for SQL execution. Tenant scoping selects the correct table (no WHERE clause injection needed). Pagination returns both result rows and a total count.

```python
engine = QueryEngine(store)
results = engine.query(
    tenant_id="t1",
    table_type="entities",
    sql="SELECT * FROM data WHERE entity_type = 'student' AND city = 'Springfield'",
    limit=20, offset=0
)
# → loads t1_entities table, registers as "data" in DuckDB, executes SQL
# → returns {"rows": [...], "total": 142}
```

### Decision 5: Version history

Every record includes `_version`, `_status` (active/archived), `_created_at`, `_updated_at` metadata.

**Models table (`{tenant_id}_models`):**
- Versioning is **per entity type** — each entity type's definition has its own independent version history
- Each entity type has one active version; older versions are archived
- A `change_id` correlates entity type updates that happened in the same operation (e.g., student v6 + staff v4 from the same document upload share a `change_id`)
- This enables grouped rollback: find all records with the same `change_id` and revert them together
- Max versions: **default 100** per entity type, configurable
- On new version: current active definition for that entity type is archived, new one inserted with incremented version

**Entities table (`{tenant_id}_entities`):**
- Versioning is **per entity record** (per `entity_id`) — each entity instance has its own version history
- Max versions is **per entity type**, configurable (e.g., student max=10, staff max=20)
- Default max versions for all entity types: **5** (if not configured per type)
- When a new version exceeds the max, the oldest version (by timestamp) is deleted
- On new version: previous active record is archived, new record inserted with incremented version

### Decision 6: Dependencies

- `lancedb>=0.6` — vector storage
- `pyarrow` — schema and columnar data (comes with lancedb)
- `duckdb>=0.10` — SQL query engine
- `python-toon>=0.1` — TOON serialization for custom fields (token-efficient alternative to JSON)
