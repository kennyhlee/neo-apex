"""LanceDB storage abstraction with tenant-scoped tables and versioning."""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import lancedb
import pyarrow as pa
import toon


def derive_abbrev(name: str | None, tenant_id: str) -> str:
    """Derive an uppercase abbreviation from a tenant name.

    Rules:
    - 1 word:  first 3 chars (or fewer if short)
    - 2 words: 1st char of word 1 + first 2 chars of word 2
    - 3+ words: 1st char of first 3 words
    - No name / empty: first 3 chars of tenant_id (or full ID if < 3)
    """
    if not name or not name.strip():
        return tenant_id[:3].upper() if len(tenant_id) >= 3 else tenant_id.upper()
    words = name.split()
    if len(words) == 1:
        return words[0][:3].upper()
    elif len(words) == 2:
        return (words[0][0] + words[1][:2]).upper()
    else:
        return (words[0][0] + words[1][0] + words[2][0]).upper()


DEFAULT_DATA_DIR = os.environ.get(
    "NEOAPEX_LANCEDB_DIR",
    str(Path(__file__).parent.parent.parent / "data" / "lancedb"),
)

# Internal metadata fields appended to every table
_META_FIELDS = [
    pa.field("_version", pa.int64()),
    pa.field("_status", pa.string()),       # "active" or "archived"
    pa.field("_change_id", pa.string()),
    pa.field("_created_at", pa.string()),
    pa.field("_updated_at", pa.string()),
]

# Default schema for models table (per entity type model definitions)
MODELS_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),
    pa.field("model_definition", pa.string()),  # JSON string
] + _META_FIELDS)

# Default schema for entities table
ENTITIES_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),
    pa.field("entity_id", pa.string()),
    pa.field("base_data", pa.string()),         # TOON-encoded document
    pa.field("custom_fields", pa.string()),    # TOON-encoded document
    pa.field("vector", pa.list_(pa.float32(), 1024)),
] + _META_FIELDS)

SEQUENCES_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),
    pa.field("year", pa.string()),
    pa.field("counter", pa.int64()),
])


class Store:
    """Tenant-scoped LanceDB storage with versioning.

    Each tenant gets two tables:
      - {tenant_id}_models: model/schema definitions per entity type
      - {tenant_id}_entities: entity data filtered by entity_type

    Versioning:
      - Models: per entity_type, default max 100 versions
      - Entities: per entity_id, configurable max per entity type, default 5
    """

    def __init__(
        self,
        data_dir: str | Path = DEFAULT_DATA_DIR,
        embedder=None,
        max_model_versions: int = 100,
        default_max_entity_versions: int = 5,
        entity_version_limits: dict[str, int] | None = None,
    ):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._db = lancedb.connect(str(self.data_dir))
        self.embedder = embedder
        self.max_model_versions = max_model_versions
        self.default_max_entity_versions = default_max_entity_versions
        self.entity_version_limits = entity_version_limits or {}

    # ── helpers ──────────────────────────────────────────────────────

    def _table_names(self) -> list[str]:
        raw = self._db.list_tables()
        if isinstance(raw, list):
            return raw
        return list(getattr(raw, "tables", []))

    def _models_table_name(self, tenant_id: str) -> str:
        return f"{tenant_id}_models"

    def _entities_table_name(self, tenant_id: str) -> str:
        return f"{tenant_id}_entities"

    def _sequences_table_name(self, tenant_id: str) -> str:
        return f"{tenant_id}_sequences"

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _new_change_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def _open_or_create(self, table_name: str, schema: pa.Schema):
        if table_name in self._table_names():
            return self._db.open_table(table_name)
        return self._db.create_table(table_name, schema=schema)

    def _get_max_version(self, table, where: str) -> int:
        rows = table.search().where(where).to_list()
        if not rows:
            return 0
        return max(r["_version"] for r in rows)

    def _max_versions_for_entity_type(self, entity_type: str) -> int:
        return self.entity_version_limits.get(
            entity_type, self.default_max_entity_versions
        )

    # ── models CRUD ─────────────────────────────────────────────────

    def put_model(
        self,
        tenant_id: str,
        entity_type: str,
        model_definition: dict,
        change_id: str | None = None,
    ) -> dict:
        """Store a model definition for an entity type.

        Archives the current active version and inserts a new one.
        Returns the stored record.
        """
        table_name = self._models_table_name(tenant_id)
        table = self._open_or_create(table_name, MODELS_SCHEMA)
        change_id = change_id or self._new_change_id()
        now = self._now()

        where = f"entity_type = '{entity_type}'"
        current_version = self._get_max_version(table, where)
        next_version = current_version + 1

        # Archive current active
        active_rows = (
            table.search()
            .where(f"{where} AND _status = 'active'")
            .to_list()
        )
        if active_rows:
            table.delete(f"{where} AND _status = 'active'")
            for row in active_rows:
                row["_status"] = "archived"
                row["_updated_at"] = now
            table.add(active_rows)

        # Insert new active
        record = {
            "entity_type": entity_type,
            "model_definition": json.dumps(model_definition),
            "_version": next_version,
            "_status": "active",
            "_change_id": change_id,
            "_created_at": now,
            "_updated_at": now,
        }
        table.add([record])

        # Trim old versions
        self._trim_model_versions(table, entity_type)

        record["model_definition"] = model_definition
        return record

    def get_active_model(
        self, tenant_id: str, entity_type: str
    ) -> dict | None:
        """Get the active model definition for an entity type."""
        table_name = self._models_table_name(tenant_id)
        if table_name not in self._table_names():
            return None

        table = self._db.open_table(table_name)
        rows = (
            table.search()
            .where(f"entity_type = '{entity_type}' AND _status = 'active'")
            .limit(1)
            .to_list()
        )
        if not rows:
            return None

        row = rows[0]
        row["model_definition"] = json.loads(row["model_definition"])
        return row

    def get_model_history(
        self, tenant_id: str, entity_type: str
    ) -> list[dict]:
        """Get all versions of a model definition, newest first."""
        table_name = self._models_table_name(tenant_id)
        if table_name not in self._table_names():
            return []

        table = self._db.open_table(table_name)
        rows = (
            table.search()
            .where(f"entity_type = '{entity_type}'")
            .to_list()
        )
        for row in rows:
            row["model_definition"] = json.loads(row["model_definition"])
        rows.sort(key=lambda r: r["_version"], reverse=True)
        return rows

    def list_models(
        self,
        tenant_id: str,
        status: str | None = None,
    ) -> list[dict]:
        """List model records across all entity types for a tenant.

        Args:
            tenant_id: tenant scope
            status: filter by "active", "archived", or None for all

        Returns:
            List of model records with deserialized model_definition.
            Empty list if the tenant has no models table.
        """
        table_name = self._models_table_name(tenant_id)
        if table_name not in self._table_names():
            return []

        table = self._db.open_table(table_name)
        where = f"_status = '{status}'" if status else "1=1"
        rows = table.search().where(where).to_list()

        for row in rows:
            if isinstance(row.get("model_definition"), str):
                row["model_definition"] = json.loads(row["model_definition"])

        rows.sort(key=lambda r: r["_version"], reverse=True)
        return rows

    def _trim_model_versions(self, table, entity_type: str) -> None:
        where = f"entity_type = '{entity_type}'"
        rows = table.search().where(where).to_list()
        if len(rows) <= self.max_model_versions:
            return
        rows.sort(key=lambda r: r["_version"], reverse=True)
        for row in rows[self.max_model_versions:]:
            table.delete(
                f"entity_type = '{entity_type}' "
                f"AND _version = {row['_version']}"
            )

    # ── entities CRUD ───────────────────────────────────────────────

    def put_entity(
        self,
        tenant_id: str,
        entity_type: str,
        entity_id: str,
        base_data: dict,
        custom_fields: dict | None = None,
        change_id: str | None = None,
    ) -> dict:
        """Store an entity record.

        Archives the current active version and inserts a new one.
        Custom fields are stored as a TOON document in custom_fields.

        Raises:
            ValueError: if custom_fields keys overlap with base_data keys
        """
        # Validate no key conflicts between base_data and custom_fields
        if custom_fields and base_data:
            conflicts = set(base_data.keys()) & set(custom_fields.keys())
            if conflicts:
                raise ValueError(
                    f"Custom field keys conflict with base data keys: {conflicts}"
                )

        table_name = self._entities_table_name(tenant_id)
        table = self._open_or_create(table_name, ENTITIES_SCHEMA)
        change_id = change_id or self._new_change_id()
        now = self._now()

        where = f"entity_type = '{entity_type}' AND entity_id = '{entity_id}'"
        current_version = self._get_max_version(table, where)
        next_version = current_version + 1

        # Archive current active
        active_rows = (
            table.search()
            .where(f"{where} AND _status = 'active'")
            .to_list()
        )
        if active_rows:
            table.delete(f"{where} AND _status = 'active'")
            for row in active_rows:
                row["_status"] = "archived"
                row["_updated_at"] = now
            table.add(active_rows)

        # Generate embedding from entity fields
        all_fields = dict(base_data)
        all_fields.update(custom_fields or {})
        vector = self.embedder.embed(all_fields) if self.embedder else [0.0] * 1024

        # Insert new active — custom fields stored as TOON format
        record = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "base_data": toon.encode(base_data),
            "custom_fields": toon.encode(custom_fields or {}),
            "vector": vector,
            "_version": next_version,
            "_status": "active",
            "_change_id": change_id,
            "_created_at": now,
            "_updated_at": now,
        }
        table.add([record])

        # Trim old versions
        self._trim_entity_versions(table, entity_type, entity_id)

        record["base_data"] = base_data
        record["custom_fields"] = custom_fields or {}
        del record["vector"]
        return record

    def get_active_entity(
        self, tenant_id: str, entity_type: str, entity_id: str
    ) -> dict | None:
        """Get the active version of an entity."""
        table_name = self._entities_table_name(tenant_id)
        if table_name not in self._table_names():
            return None

        table = self._db.open_table(table_name)
        rows = (
            table.search()
            .where(
                f"entity_type = '{entity_type}' "
                f"AND entity_id = '{entity_id}' "
                f"AND _status = 'active'"
            )
            .limit(1)
            .to_list()
        )
        if not rows:
            return None

        row = rows[0]
        row["base_data"] = toon.decode(row["base_data"]) if row["base_data"] else {}
        row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
        return row

    def get_entity_history(
        self, tenant_id: str, entity_type: str, entity_id: str
    ) -> list[dict]:
        """Get all versions of an entity, newest first."""
        table_name = self._entities_table_name(tenant_id)
        if table_name not in self._table_names():
            return []

        table = self._db.open_table(table_name)
        rows = (
            table.search()
            .where(
                f"entity_type = '{entity_type}' "
                f"AND entity_id = '{entity_id}'"
            )
            .to_list()
        )
        for row in rows:
            row["base_data"] = toon.decode(row["base_data"]) if row["base_data"] else {}
            row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
        rows.sort(key=lambda r: r["_version"], reverse=True)
        return rows

    def delete_version(
        self,
        tenant_id: str,
        table_type: str,
        version: int,
        entity_type: str | None = None,
        entity_id: str | None = None,
    ) -> bool:
        """Delete a specific version from models or entities table.

        Args:
            table_type: "models" or "entities"
            version: version number to delete
            entity_type: required for both models and entities
            entity_id: required for entities
        """
        if table_type == "models":
            table_name = self._models_table_name(tenant_id)
            where = (
                f"entity_type = '{entity_type}' AND _version = {version}"
            )
        elif table_type == "entities":
            table_name = self._entities_table_name(tenant_id)
            where = (
                f"entity_type = '{entity_type}' "
                f"AND entity_id = '{entity_id}' "
                f"AND _version = {version}"
            )
        else:
            raise ValueError(f"table_type must be 'models' or 'entities', got '{table_type}'")

        if table_name not in self._table_names():
            return False

        table = self._db.open_table(table_name)
        rows_before = len(table.search().where(where).to_list())
        if rows_before == 0:
            return False
        table.delete(where)
        return True

    # ── rollback ────────────────────────────────────────────────────

    def rollback_by_change_id(
        self, tenant_id: str, change_id: str
    ) -> dict:
        """Roll back all records associated with a change_id.

        For each affected record, deletes the version with the given change_id
        and re-activates the most recent archived version.

        Returns a summary of what was rolled back.
        """
        summary = {"models": [], "entities": []}

        for table_type in ("models", "entities"):
            if table_type == "models":
                table_name = self._models_table_name(tenant_id)
            else:
                table_name = self._entities_table_name(tenant_id)

            if table_name not in self._table_names():
                continue

            table = self._db.open_table(table_name)
            change_rows = (
                table.search()
                .where(f"_change_id = '{change_id}'")
                .to_list()
            )

            for row in change_rows:
                # Delete the change_id version
                if table_type == "models":
                    identity_where = f"entity_type = '{row['entity_type']}'"
                else:
                    identity_where = (
                        f"entity_type = '{row['entity_type']}' "
                        f"AND entity_id = '{row['entity_id']}'"
                    )

                table.delete(
                    f"{identity_where} AND _version = {row['_version']}"
                )

                # Re-activate the most recent archived version
                archived = (
                    table.search()
                    .where(f"{identity_where} AND _status = 'archived'")
                    .to_list()
                )
                if archived:
                    archived.sort(key=lambda r: r["_version"], reverse=True)
                    latest = archived[0]
                    table.delete(
                        f"{identity_where} "
                        f"AND _version = {latest['_version']}"
                    )
                    latest["_status"] = "active"
                    latest["_updated_at"] = self._now()
                    table.add([latest])

                summary[table_type].append({
                    "entity_type": row["entity_type"],
                    "rolled_back_version": row["_version"],
                })

        return summary

    def _trim_entity_versions(
        self, table, entity_type: str, entity_id: str
    ) -> None:
        max_versions = self._max_versions_for_entity_type(entity_type)
        where = (
            f"entity_type = '{entity_type}' AND entity_id = '{entity_id}'"
        )
        rows = table.search().where(where).to_list()
        if len(rows) <= max_versions:
            return
        rows.sort(key=lambda r: r["_created_at"], reverse=True)
        for row in rows[max_versions:]:
            table.delete(f"{where} AND _version = {row['_version']}")

    # ── sequences (lightweight counters) ───────────────────────────

    def get_sequence(self, tenant_id: str, entity_type: str, year: str) -> int:
        """Get the current sequence counter, or 0 if not set."""
        table_name = self._sequences_table_name(tenant_id)
        if table_name not in self._table_names():
            return 0
        table = self._db.open_table(table_name)
        rows = (
            table.search()
            .where(f"entity_type = '{entity_type}' AND year = '{year}'")
            .to_list()
        )
        if not rows:
            return 0
        return rows[0]["counter"]

    def increment_sequence(
        self, tenant_id: str, entity_type: str, year: str
    ) -> int:
        """Increment and return the sequence counter for entity_type + year."""
        table_name = self._sequences_table_name(tenant_id)
        table = self._open_or_create(table_name, SEQUENCES_SCHEMA)
        where = f"entity_type = '{entity_type}' AND year = '{year}'"
        rows = table.search().where(where).to_list()
        current = rows[0]["counter"] if rows else 0
        new_counter = current + 1
        if rows:
            table.delete(where)
        table.add([{
            "entity_type": entity_type,
            "year": year,
            "counter": new_counter,
        }])
        return new_counter

    # ── table access for QueryEngine ────────────────────────────────

    def get_table_as_arrow(
        self, tenant_id: str, table_type: str
    ) -> pa.Table | None:
        """Load a tenant's table as an Arrow table for DuckDB querying."""
        if table_type == "models":
            table_name = self._models_table_name(tenant_id)
        elif table_type == "entities":
            table_name = self._entities_table_name(tenant_id)
        else:
            raise ValueError(f"table_type must be 'models' or 'entities', got '{table_type}'")

        if table_name not in self._table_names():
            return None

        table = self._db.open_table(table_name)
        return table.to_arrow()
