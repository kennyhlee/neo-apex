# apexflow/backend/tests/fakes.py
"""In-memory FakeDataCore — the ONE DataCore stub mechanism for this suite.

Ported from enrollx/backend/tests/fakes.py — see interface map §5. Two
changes from the enrollx source:

1. SIGNATURE FIX (interface map §5, §D — Plan 3 follow-up #13, and Task 0's
   explicit instruction for this task): `dc_update` gains the
   `custom_fields=None` parameter the real `app.workflows.datacore.dc_update`
   has and enrollx's fake never did. `_store_row` now merges `custom_fields`
   in alongside `base_data` (flattened and stringified the same way,
   matching the real query path's flattening of both columns — see interface
   map Gotcha C), so custom-fields round-trip tests are actually exercisable
   against this fake, the way the map's §1 tenant-entity example needs.
2. `BLOCKS` / `seed_config` (enrollx's registration_config + block-definition
   fixture data) were dropped — registration-specific, no equivalent concept
   exists in apexflow-backend yet (task-1-brief.md Step 1).

Usage in every test file that touches DataCore (repeat this fixture verbatim,
or use the `fake_dc` fixture in conftest.py):

    from tests.fakes import FakeDataCore, install_fake_datacore

    @pytest.fixture
    def fake_dc(monkeypatch):
        fdc = FakeDataCore()
        install_fake_datacore(monkeypatch, fdc)
        return fdc

Rows are stored flattened (entity_id, entity_type + base_data/custom_fields
fields), which matches how DataCore's query endpoint returns entities.

Known divergences from the real DataCore service (harmless for this task's
tests today, but worth knowing before relying on the fake for something new):

1. ID-prefix format. `dc_create`/`next_id` mint ids like `TT-{XX}26####`
   (`TT` = fake placeholder, `XX` = first two letters of entity_type,
   `26` = stand-in year, `####` = a monotonic sequence). The real DataCore
   `next-id` endpoint derives a tenant-specific abbreviation instead of the
   fixed `TT` prefix. A test asserting on a specific tenant-derived prefix
   (as opposed to just checking format/shape) would not port unmodified.
2. Internal `_tenant` column. Rows in `fdc.rows` carry a `_tenant` key used
   purely for in-memory tenant scoping. Real DataCore query rows do not
   have this column — tenant scope there comes from the request body, not
   a per-row field. Only visible if you read `fdc.rows` directly instead of
   going through `list_entities`/`get_entity`/`find`.
3. Unrestricted auto-id assignment. `dc_create`/`next_id` here auto-assign
   an id for ANY entity_type. The real DataCore only does this for types
   registered in its `DEFAULT_ABBREVS` table and returns 400 for anything
   else. The fake never rejects an unknown entity_type this way.
4. No system columns. The fake omits real DataCore system columns
   (`_status`, `_version`, `_created_at`, …) entirely — rows only have
   `entity_id`/`entity_type`/`_tenant` plus flattened base_data/custom_fields.
   This is harmless only because this suite never exercises archive/restore
   or version-history behavior against the fake.
5. Update-time existence check. `dc_update` here raises `AssertionError` on
   an unknown `entity_id`. The real DataCore PUT is an upsert with no
   existence check — it would create the row. This is the safe direction
   (the fake catches a bug — updating something that was never created —
   that the real service would silently paper over), so the behavior is
   kept as-is; it is documented here only so it isn't mistaken for
   real-service parity.

STRINGIFIED READS (deliberate, load-bearing — do not "simplify" this away):
Real DataCore stores base_data/custom_fields with their types intact (TOON),
but its QUERY path flattens each field into a string column via
`datacore/src/datacore/query.py::_scalar_to_str` — bools become "true"/"false",
dict/list become JSON, everything else `str()`. So a field written as bool
`False` reads back from a query as the STRING "false", which is TRUTHY in
Python. `_store_row` mirrors `_scalar_to_str` exactly so this suite can see
that class of bug (it previously could not: the fake stored native values,
which made `if row.get("blocking")` look correct in tests while being
inverted in production).

Consequently there are two different shapes in play, matching the real
service:
  - `dc_create`/`dc_update` RETURN `{entity_id, entity_type, base_data,
    custom_fields}` with native (non-stringified) values (the real service
    echoes what it stored, before any query flattening).
  - `list_entities`/`get_entity`/`find`/`fdc.rows` yield FLATTENED rows
    whose every base_data/custom_fields-derived value is a STRING.
Assertions on a value read through the second path must expect a string.
"""
import json
import re
import uuid

from fastapi import HTTPException


def _scalar_to_str(v):
    """Verbatim mirror of datacore/src/datacore/query.py::_scalar_to_str.

    Order matters: bool is a subclass of int, so it must be checked before
    any numeric handling."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return str(v)


class FakeDataCore:
    def __init__(self):
        self.rows: list[dict] = []
        # Tenant model definitions, keyed (tenant_id, entity_type). Backs the
        # `models` table read that config hydration performs.
        self.models: dict[tuple[str, str], dict] = {}
        self.seq = 0

    @staticmethod
    def _store_row(entity_id, entity_type, tenant_id, base, custom_fields=None):
        """Build the flattened, stringified row a real query would return.

        `base` and `custom_fields` are merged onto the same row (interface
        map Gotcha C: the query path flattens both columns onto the row as
        individual top-level fields) — a caller relying on `custom_fields`
        round-tripping through `dc_update` (map §1's tenant-entity example)
        can read it back the same way it reads a base_data field.

        `None` values are preserved as None (real DataCore emits a null
        column, not the string "None") — see query.py's
        `None if v is None else _scalar_to_str(v)`."""
        row = {"entity_id": entity_id, "entity_type": entity_type, "_tenant": tenant_id}
        for k, v in {**base, **(custom_fields or {})}.items():
            row[k] = None if v is None else _scalar_to_str(v)
        return row

    # ── same signatures as app.workflows.datacore ─────────────────────────
    def dc_create(self, tenant_id, entity_type, base_data, token=None):
        base = dict(base_data)
        id_field = f"{entity_type}_id"
        if not base.get(id_field):
            self.seq += 1
            base[id_field] = f"TT-{entity_type[:2].upper()}26{self.seq:04d}"
        entity_id = uuid.uuid4().hex[:12]
        self.rows.append(self._store_row(entity_id, entity_type, tenant_id, base))
        return {"entity_id": entity_id, "entity_type": entity_type, "base_data": base}

    def dc_update(self, tenant_id, entity_type, entity_id, base_data, token=None,
                  custom_fields=None):
        """Full-replace, matching the real `dc_update`'s semantics (interface
        map §1): `custom_fields` defaults to erasing whatever was stored
        before, since a caller round-tripping custom fields must pass them
        back explicitly."""
        for i, r in enumerate(self.rows):
            if (r["entity_id"] == entity_id and r["entity_type"] == entity_type
                    and r["_tenant"] == tenant_id):
                self.rows[i] = self._store_row(entity_id, entity_type, tenant_id,
                                               dict(base_data), custom_fields)
                return {"entity_id": entity_id, "entity_type": entity_type,
                        "base_data": dict(base_data),
                        "custom_fields": dict(custom_fields or {})}
        raise AssertionError(f"update of unknown entity {entity_type}/{entity_id}")

    def next_id(self, tenant_id, entity_type, token=None):
        self.seq += 1
        return f"TT-{entity_type[:2].upper()}26{self.seq:04d}"

    # Columns that exist on every row regardless of what base_data was written.
    SYSTEM_COLUMNS = {"entity_id", "entity_type", "_status", "_tenant"}

    def list_entities(self, tenant_id, entity_type, where="", token=None):
        tenant_rows = [r for r in self.rows if r["_tenant"] == tenant_id]
        out = [dict(r) for r in tenant_rows if r["entity_type"] == entity_type]
        for field, value in self._parse_where(where):
            # Mirror DuckDB's binder error. DataCore only materializes a
            # flattened column when at least one row in the TENANT'S TABLE
            # (any entity_type — the table is flattened across all of them)
            # carries that key. Filtering on a field nothing has written yet
            # is a binder error, surfacing as a 400 from /api/query. Without
            # this the fake silently returned [] and hid a whole class of
            # "fails on the first row in every tenant" bugs.
            if field not in self.SYSTEM_COLUMNS and not any(
                    field in r for r in tenant_rows):
                raise HTTPException(
                    400,
                    f"DataCore query failed: Binder Error: Referenced column "
                    f"{field!r} not found in FROM clause")
            out = [r for r in out if str(r.get(field, "")) == value]
        return out

    def get_entity(self, tenant_id, entity_type, entity_id, token=None):
        rows = self.list_entities(tenant_id, entity_type, f"entity_id = '{entity_id}'")
        return rows[0] if rows else None

    @staticmethod
    def _no_raw_query(*args, **kwargs):
        raise AssertionError(
            "engine code must not call dc_query directly — use list_entities/get_entity")

    @staticmethod
    def _parse_where(where):
        if not where:
            return []
        pairs = []
        for part in re.split(r"\s+AND\s+", where, flags=re.IGNORECASE):
            m = re.fullmatch(r"(\w+)\s*=\s*'([^']*)'", part.strip())
            if not m:
                raise AssertionError(f"FakeDataCore cannot parse where clause: {part!r}")
            pairs.append((m.group(1), m.group(2)))
        return pairs

    # ── models table (used by config hydration) ───────────────────────────
    def set_model(self, tenant_id, entity_type, definition):
        """Seed one entity type's model definition for this tenant."""
        self.models[(tenant_id, entity_type)] = definition

    def get_model_definition(self, tenant_id, entity_type, token=None):
        return self.models.get((tenant_id, entity_type))

    # ── test conveniences ─────────────────────────────────────────────────
    def find(self, entity_type, **fields):
        return [r for r in self.rows if r["entity_type"] == entity_type
                and all(str(r.get(k, "")) == str(v) for k, v in fields.items())]


def install_fake_datacore(monkeypatch, fdc: FakeDataCore):
    from app.workflows import datacore as dc

    for name in ("dc_create", "dc_update", "next_id", "list_entities", "get_entity",
                 "get_model_definition"):
        monkeypatch.setattr(dc, name, getattr(fdc, name))
    monkeypatch.setattr(dc, "dc_query", fdc._no_raw_query)
