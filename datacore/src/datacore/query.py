"""DuckDB + Arrow SQL query engine over LanceDB tables."""

import json

import duckdb
import pyarrow as pa
import toon

from datacore.store import Store


class TableNotFoundError(Exception):
    """Raised when a query targets a table that doesn't exist."""


class QueryEngine:
    """SQL query engine over LanceDB tables using DuckDB + Apache Arrow.

    Loads tenant-scoped LanceDB tables as Arrow tables and executes
    SQL queries via DuckDB. Custom fields stored as TOON documents
    are flattened into queryable columns.
    """

    def __init__(self, store: Store):
        self.store = store

    def query(
        self,
        tenant_id: str,
        table_type: str,
        sql: str,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict:
        """Execute a SQL query against a tenant's table.

        Args:
            tenant_id: tenant scope
            table_type: "models" or "entities"
            sql: SQL query string — use the table alias "data" to reference
                 the table (e.g., "SELECT * FROM data WHERE ...")
            limit: max rows to return (pagination)
            offset: rows to skip (pagination)

        Returns:
            {"rows": [...], "total": int}

        Raises:
            TableNotFoundError: if the tenant's table doesn't exist
        """
        arrow_table = self.store.get_table_as_arrow(tenant_id, table_type)
        if arrow_table is None:
            raise TableNotFoundError(
                f"Table '{table_type}' not found for tenant '{tenant_id}'"
            )

        # For entities, flatten custom fields into queryable columns
        if table_type == "entities":
            arrow_table = self._flatten_custom_fields(arrow_table)

        # For models, parse model_definition JSON
        if table_type == "models":
            arrow_table = self._parse_json_column(
                arrow_table, "model_definition"
            )

        # Register the arrow table and execute SQL via DuckDB
        con = duckdb.connect()
        con.register("data", arrow_table)

        # Get total count (before pagination)
        count_sql = f"SELECT COUNT(*) AS total FROM ({sql}) AS _counted"
        total = con.execute(count_sql).fetchone()[0]

        # Apply pagination
        paginated_sql = sql
        if limit is not None:
            paginated_sql += f" LIMIT {limit}"
        if offset is not None:
            paginated_sql += f" OFFSET {offset}"

        result = con.execute(paginated_sql)
        columns = [desc[0] for desc in result.description]
        rows = [dict(zip(columns, row)) for row in result.fetchall()]

        con.close()

        return {"rows": rows, "total": total}

    def _flatten_custom_fields(self, arrow_table: pa.Table) -> pa.Table:
        """Flatten _custom_fields TOON into individual columns.

        Parses the _custom_fields column (TOON-encoded string) from each row,
        collects all unique keys, and adds them as new columns to the
        Arrow table so DuckDB can query them directly.
        """
        custom_col = arrow_table.column("_custom_fields")
        all_values = custom_col.to_pylist()

        # Parse TOON-encoded strings
        parsed = []
        all_keys: dict[str, None] = {}  # ordered set
        for val in all_values:
            if val and val.strip():
                d = toon.decode(val) if isinstance(val, str) else val
                if not isinstance(d, dict):
                    d = {}
                parsed.append(d)
                for k in d:
                    all_keys[k] = None
            else:
                parsed.append({})

        if not all_keys:
            return arrow_table

        # Add each custom field as a new column
        for key in all_keys:
            values = []
            for row in parsed:
                v = row.get(key)
                if isinstance(v, (dict, list)):
                    v = json.dumps(v)
                values.append(v)
            arrow_table = arrow_table.append_column(
                key, pa.array(values, type=pa.string())
            )

        # Also flatten base_data JSON into columns
        arrow_table = self._flatten_json_column(arrow_table, "base_data")

        return arrow_table

    def _flatten_json_column(
        self, arrow_table: pa.Table, column_name: str
    ) -> pa.Table:
        """Flatten a JSON string column into individual columns."""
        col = arrow_table.column(column_name)
        all_values = col.to_pylist()

        parsed = []
        all_keys: dict[str, None] = {}
        for val in all_values:
            if val:
                d = json.loads(val) if isinstance(val, str) else val
                parsed.append(d)
                for k in d:
                    all_keys[k] = None
            else:
                parsed.append({})

        for key in all_keys:
            # Skip if column already exists (e.g., from custom fields)
            if key in arrow_table.column_names:
                continue
            values = []
            for row in parsed:
                v = row.get(key)
                # Serialize non-scalar values (lists, dicts) as JSON strings
                if isinstance(v, (dict, list)):
                    v = json.dumps(v)
                values.append(v)
            arrow_table = arrow_table.append_column(
                key, pa.array(values, type=pa.string())
            )

        return arrow_table

    def _parse_json_column(
        self, arrow_table: pa.Table, column_name: str
    ) -> pa.Table:
        """Parse a JSON string column into a struct-like representation.

        For models, we flatten model_definition so fields inside it
        are queryable.
        """
        return self._flatten_json_column(arrow_table, column_name)
