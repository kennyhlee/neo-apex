# Semantic Search for Entity Analytics

## Context

Datacore is a tenant-scoped LanceDB storage library for NeoApex. It currently supports exact-match SQL queries via QueryEngine but has no semantic search capability. The add-student-entry feature requires semantic analytics — finding similar entities, querying by meaning, and filtering by natural language descriptions.

LanceDB natively supports vector search alongside structured data, making it possible to add embeddings without introducing a separate vector store.

## Goals

- Add vector embeddings to entity records for semantic similarity search
- Support natural language queries over structured entity data (e.g., "students with special needs")
- Support finding similar entities (e.g., "students similar to Kenny Lee")
- Expose semantic search via both Python API and REST endpoint

## Non-Goals

- LLM processing of search results (future — requires chat UI design)
- Document retrieval / PDF chunk search (separate RAG use case)
- Auto-routing between SQL and semantic search (caller decides)
- Batch re-index command (auto-embed on write is sufficient)
- Authentication / authorization

## Decisions

### Decision 1: Voyage AI `voyage-3` embeddings

Use Voyage AI `voyage-3` model (1024 dimensions) via the `voyageai` SDK. API key read from `VOYAGE_API_KEY` environment variable.

Chosen over OpenAI embeddings (slightly lower retrieval quality) and local sentence-transformers (heavy PyTorch dependency). At a few thousand records per tenant, cost is negligible (~$0.003 per 1,000 records).

### Decision 2: Vector column on existing entities table (Approach 1)

Add a `vector` column to `ENTITIES_SCHEMA` rather than creating a separate vector index table. This keeps one table per tenant, enables single-query vector search + filter, and avoids sync complexity between tables.

### Decision 3: Auto-embed on every write

Store constructor requires an `Embedder` instance. Every `put_entity()` call auto-embeds by flattening `base_data` + `custom_fields` into text and generating a vector. No optional/null vectors — every entity row is guaranteed to have an embedding.

### Decision 4: Embed all fields

Embedding input combines all fields from `base_data` and `custom_fields` into a single text string:

```
"entity_type: student, first_name: Wei, last_name: Chen, grade_level: 2nd, school: Hoover, medical_conditions: None"
```

Text flattening logic lives in the Embedder module.

### Decision 5: Two separate search interfaces

SQL query (existing `QueryEngine.query()`) and semantic search (new `QueryEngine.semantic_search()`) are separate methods and endpoints. The caller decides which to use. No auto-routing.

- Exact filters → SQL: `POST /api/query/{tenant_id}`
- Fuzzy/meaning-based → semantic: `GET /api/search/{tenant_id}?q=...`

## Architecture

### New module: `src/datacore/embedder.py`

Responsible for text flattening and embedding generation.

```python
class Embedder:
    def __init__(self):  # reads VOYAGE_API_KEY from env
    def embed(self, fields: dict) -> list[float]  # single entity
    def embed_batch(self, fields_list: list[dict]) -> list[list[float]]  # batch
```

- Flattens dict keys/values into a single text string
- Calls Voyage AI `voyage-3` API
- Raises clear error if `VOYAGE_API_KEY` is not set

### Schema change: `ENTITIES_SCHEMA`

Add vector column:

```python
ENTITIES_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),
    pa.field("entity_id", pa.string()),
    pa.field("base_data", pa.string()),
    pa.field("custom_fields", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), 1024)),
] + _META_FIELDS)
```

### Store changes

- `Store.__init__` requires an `Embedder` instance
- `put_entity()` auto-embeds: flattens `base_data` + `custom_fields` → calls `embedder.embed()` → stores vector alongside entity data
- No changes to read methods — they return whatever's in the row including the vector

### QueryEngine changes

New method:

```python
def semantic_search(
    self,
    tenant_id: str,
    query: str,
    entity_type: str | None = None,
    limit: int = 10,
    distance_threshold: float | None = None,
) -> dict:
```

- Embeds the query text via `Embedder`
- Runs LanceDB vector search on `{tenant_id}_entities`
- Optional `entity_type` filter
- Returns `{"results": [...], "total": int}` with `_distance` per result
- Results sorted by distance (most similar first)

### REST endpoint

```
GET /api/search/{tenant_id}?q=...&entity_type=...&limit=10
```

- `q` — required, search text
- `entity_type` — optional filter
- `limit` — optional, default 10

Returns:
```json
{
  "results": [
    {
      "entity_id": "...",
      "entity_type": "student",
      "base_data": {},
      "custom_fields": {},
      "_distance": 0.12
    }
  ],
  "total": 3
}
```

### Dependencies

Add `voyageai` SDK to `pyproject.toml`.

### Data migration

Delete existing `acme_entities` table data (3 records without vectors). Start fresh — all new entities will have vectors from auto-embed.

## Risks / Trade-offs

- **Voyage AI dependency** — external API required for all entity writes. If the API is down, `put_entity()` fails. Acceptable for current scale; could add a queue/retry later.
- **Breaking change to Store constructor** — `Store.__init__` now requires an `Embedder` instance. All existing callers (tests, `create_app`, papermite) must be updated. Pre-production, so this is safe.
- **Embedding all fields** — some fields (like `entity_id`) add noise. Acceptable trade-off for simplicity; can refine field selection later if search quality suffers.
- **No LLM layer** — semantic search returns raw results without synthesis. Future work with chat UI.
