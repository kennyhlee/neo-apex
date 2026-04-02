# Tenant Metadata & Student Next-ID Endpoint

**Date:** 2026-04-01
**Change:** smart-student-enrollment
**Scope:** datacore — tenant as entity, sequences table, next-id endpoint

## Context

The admindash frontend's `AddStudentPage` calls `GET /api/entities/{tenant}/student/next-id` to auto-generate sequential student IDs. This endpoint does not exist in datacore. Additionally, datacore has no tenant metadata storage — tenants are bare string IDs used as table name prefixes with no associated name, abbreviation, or state.

This design stores tenant metadata as a regular entity in the existing entities table, adds a lightweight sequences table for ID counters, and exposes the next-id endpoint.

## Goals

- Store tenant metadata as an entity in the existing entities table
- Add a dedicated sequences table for ID generation counters (no versioning overhead)
- Enforce tenant entity setup as a prerequisite for model and entity creation
- Expose `GET /api/entities/{tenant}/student/next-id` that returns a year-based sequential student ID
- Match the `NextIdResponse` interface the admindash frontend already expects

## Out-of-Scope Change: papermite domain.py

Add optional fields to the `Tenant` class in `papermite/backend/app/models/domain.py`:

```python
class Tenant(BaseEntity):
    ...
    license_number: Optional[str] = None
    capacity: Optional[int] = None
    accreditation: Optional[str] = None
    insurance_provider: Optional[str] = None
```

This is a small cross-repo change included here because the tenant base fields depend on it.

## Non-Goals

- Tenant management UI (handled by admindash, separate change)
- Next-ID for entity types other than student (future work)
- Tenant deletion or archival workflows

## Tenant as Entity

A tenant is stored as a regular entity in the existing `{tenant_id}_entities` table:

```
entity_type: "tenant"
entity_id:   <tenant_id>
base_data:   TOON-encoded tenant fields
custom_fields: TOON-encoded document-extracted data
```

No new table or schema changes for tenant storage. The existing `ENTITIES_SCHEMA` handles it.

### base_data Fields

Core tenant fields (matching the `Tenant` domain model from papermite):

- `tenant_id` — the tenant identifier
- `name` — tenant name (used for abbreviation derivation)
- `display_name` — optional display name
- `contact_email` — optional primary contact email
- `contact_phone` — optional primary contact phone
- `primary_address` — address
- `mailing_address` — optional mailing address
- `license_number` — optional childcare/school license number
- `capacity` — optional max enrollment capacity (integer)
- `accreditation` — optional accreditation body (e.g., "NAEYC")
- `insurance_provider` — optional insurance provider name

System-managed field (underscore-prefixed, not user-editable):

- `_abbrev` — uppercase abbreviation, auto-derived from `name` and stored so it remains stable

### custom_fields

TOON-encoded dict for additional data extracted from document processing (flexible, schema-free).

### Prerequisite Enforcement

`put_model()` and `put_entity()` check for an active tenant entity at the start. If none exists, raise `ValueError("Tenant not set up")`. Exception: `entity_type == "tenant"` skips this check (to avoid circular dependency).

### Abbreviation Rules

Uppercase abbreviation derived from tenant name (typically 3 characters, may be shorter for short tenant IDs):

| Word count | Rule | Example |
|---|---|---|
| 1 word | First 3 chars | "Summit" → `SUM` |
| 2 words | 1st char of word 1 + first 2 chars of word 2 | "Green Valley" → `GVA` |
| 3+ words | 1st char of first 3 words | "Acme Child Center" → `ACC` |
| No name / fallback | First 3 chars of tenant_id uppercased (or full ID if shorter than 3) | "t1" → `T1`, "acme" → `ACM` |

## Sequences Table

A dedicated lightweight table `{tenant_id}_sequences` for ID generation counters:

```python
SEQUENCES_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),   # "student"
    pa.field("year", pa.string()),          # "2026"
    pa.field("counter", pa.int64()),        # 14
])
```

- One row per `entity_type` + `year` combination
- **No versioning, no meta fields** — just counters
- Update in place (delete old row + insert new row)
- Scales naturally to other entity types in the future

### Store Methods

**`get_sequence(tenant_id, entity_type, year) → int`**
- Returns the current counter value, or `0` if no row exists

**`increment_sequence(tenant_id, entity_type, year) → int`**
- Atomically reads current value, increments by 1, upserts the row
- Returns the new counter value

## Student ID Format

```
{ABBREV}-{ENTITY_ABBREV}{YY}{NNNN}
```

- `ABBREV` — tenant abbreviation (e.g., `ACC`)
- `ENTITY_ABBREV` — fixed `ST` for students
- `YY` — last 2 digits of current year (2026 → `26`)
- `NNNN` — 4-digit zero-padded sequence within that year, starting from `0001`

Examples:
- First student in 2026: `ACC-ST260001`
- 500th student in 2026: `ACC-ST260500`
- First student in 2027: `ACC-ST270001`
- 10000th student in 2026: `ACC-ST2610000` (grows beyond 6 digits naturally)

## API Endpoints

### `PUT /api/tenants/{tenant_id}`

Create or update tenant metadata. Internally creates/updates an entity with `entity_type = "tenant"` and `entity_id = tenant_id`.

**Request:**
```json
{
  "base_data": {
    "tenant_id": "t1",
    "name": "Acme Child Center",
    "contact_email": "info@acme.edu",
    "contact_phone": "555-0100",
    "primary_address": "123 Main St",
    "accreditation": "NAEYC",
    "insurance_provider": "SchoolGuard"
  },
  "custom_fields": {
    "state_rating": "5-star"
  }
}
```

**Response (201 create / 200 update):**
```json
{
  "entity_type": "tenant",
  "entity_id": "t1",
  "base_data": {
    "tenant_id": "t1",
    "name": "Acme Child Center",
    "contact_email": "info@acme.edu",
    "contact_phone": "555-0100",
    "primary_address": "123 Main St",
    "accreditation": "NAEYC",
    "insurance_provider": "SchoolGuard",
    "_abbrev": "ACC"
  },
  "custom_fields": {
    "state_rating": "5-star"
  },
  "_version": 1,
  "_status": "active",
  "_change_id": "...",
  "_created_at": "...",
  "_updated_at": "..."
}
```

The `_abbrev` is derived server-side from `name`.

### `GET /api/tenants/{tenant_id}`

Returns the active tenant entity, or 404. Convenience wrapper around `get_active_entity(tenant_id, "tenant", tenant_id)`.

### `GET /api/entities/{tenant_id}/student/next-id`

1. Read tenant entity — 404 if missing
2. Get `_abbrev` from base_data
3. Derive current year (2026 → `"26"`)
4. Call `increment_sequence(tenant_id, "student", "2026")` → returns new counter (e.g., `1`)
5. Build ID: `{abbrev}-ST{yy}{seq:04d}` → `ACC-ST260001`
6. Return:

```json
{
  "next_id": "ACC-ST260001",
  "tenant_abbrev": "ACC",
  "entity_abbrev": "ST",
  "sequence": 1
}
```

### Prerequisite Enforcement at API Level

- `POST /api/entities/{tenant_id}/{entity_type}` — returns 400 `"Tenant not set up"` if no tenant entity exists (except when `entity_type == "tenant"`)
- `GET /api/models/{tenant_id}/{entity_type}` — same check (store raises `ValueError`, route catches and returns 400)

## Test Impact

### Existing Fixtures

All test fixtures using `put_model()` or `put_entity()` need a tenant entity created first:

```python
store.put_entity(
    tenant_id="t1", entity_type="tenant", entity_id="t1",
    base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
)
store.put_model(...)  # existing code
```

Affected files: `conftest.py`, `test_smoke.py`, `test_store_models.py`, `test_store_list_models.py`, `test_store_rollback.py`, `test_api.py`.

### New Tests

- **`test_sequences.py`** — `get_sequence`, `increment_sequence`, multiple entity types, year rollover, table auto-creation
- **`test_tenant_entity.py`** — tenant CRUD via API, abbreviation derivation (all word-count cases)
- **`test_next_id.py`** — API endpoint: first ID, subsequent IDs, year rollover, missing tenant → 404
- **`test_tenant_prerequisite.py`** — `put_model` without tenant → `ValueError`, `put_entity` (non-tenant) without tenant → `ValueError`, `put_entity` with `entity_type="tenant"` → succeeds without prerequisite
