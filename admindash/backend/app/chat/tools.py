import json

import httpx
from pydantic_ai import Agent, RunContext

from app.chat.datacore import (
    ChatDeps,
    dc_duplicate_check,
    dc_query,
    sql_literal,
)

_ROW_LIMIT_SHOWN = 30

# Structural/raw columns to hide when listing a type's queryable fields.
_SCHEMA_SKIP = frozenset({
    "vector", "base_data", "custom_fields", "entity_type", "tenant_id", "name",
})


def register_read_tools(agent: Agent) -> None:
    @agent.tool
    async def describe_schema(
        ctx: RunContext[ChatDeps], entity_type: str | None = None
    ) -> str:
        """List entity types and their ACTUAL queryable fields so you can write
        correct queries. With no argument, lists the entity types that have data.
        With an entity_type, lists that type's real columns (base fields AND any
        custom fields present in the records — which may exceed the model
        definition), annotated with the model's type where known."""
        if not entity_type:
            rows = await dc_query(
                ctx.deps,
                "SELECT DISTINCT entity_type FROM data WHERE _status = 'active'",
            )
            types = sorted(r.get("entity_type") for r in rows if r.get("entity_type"))
            return "Entity types: " + ", ".join(types) if types else "No data yet."

        et = entity_type.strip().lower()
        # Actual queryable columns: the engine flattens every custom key present in
        # the records into columns, so a single sample row exposes them all.
        sample = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = {sql_literal(et)} "
            f"AND _status = 'active' LIMIT 1",
        )
        if not sample:
            return f"No active {et} records exist to derive fields from."
        cols = sorted(
            k for k in sample[0]
            if k not in _SCHEMA_SKIP and not str(k).startswith("_")
        )
        # Annotate with declared types from the latest model version, if any.
        model_rows = await dc_query(
            ctx.deps,
            f"SELECT entity_type, _version, model_definition FROM data "
            f"WHERE entity_type = {sql_literal(et)} AND _status = 'active'",
            table="models",
        )
        type_map: dict[str, str] = {}
        best_ver = -1
        for r in model_rows:
            ver = int(r.get("_version") or 0)
            if ver < best_ver:
                continue
            md = r.get("model_definition") or {}
            if isinstance(md, str):
                try:
                    md = json.loads(md)
                except ValueError:
                    md = {}
            fields = (md.get("base_fields") or []) + (md.get("custom_fields") or [])
            best_ver = ver
            type_map = {f.get("name"): f.get("type") for f in fields}
        listed = ", ".join(
            f"{c}:{type_map[c]}" if type_map.get(c) else c for c in cols
        )
        return f"Fields for {et}: " + listed

    @agent.tool
    async def run_query(ctx: RunContext[ChatDeps], sql: str) -> str:
        """Run a READ-ONLY SQL query (SELECT/WITH only) against this tenant's data
        to answer any lookup, count, or aggregation. The single table is aliased
        `data`; filter by entity_type ('student','program','lead','enrollment',
        'family', ...); current records have _status='active'; selection fields are
        JSON-encoded (e.g. '["Aunt"]'). Call describe_schema first if unsure of
        field names. Only SELECT/WITH is permitted."""
        try:
            rows = await dc_query(ctx.deps, sql)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                try:
                    detail = e.response.json().get("detail", "invalid query")
                except ValueError:
                    detail = "invalid query"
                return (f"Query rejected: {detail} "
                        "Revise the SQL (SELECT/WITH only) and try again.")
            return "The query could not be run right now."
        except httpx.HTTPError:
            return "The query could not be run right now."
        if not rows:
            return "No rows matched."
        shown = rows[:_ROW_LIMIT_SHOWN]
        lines = [
            json.dumps(
                {k: v for k, v in r.items() if not str(k).startswith("_")},
                default=str,
            )
            for r in shown
        ]
        more = "" if len(rows) <= _ROW_LIMIT_SHOWN else (
            f"\n…and {len(rows) - _ROW_LIMIT_SHOWN} more row(s).")
        return f"{len(rows)} row(s):\n" + "\n".join(lines) + more


def register_write_tools(agent: Agent) -> None:
    @agent.tool
    async def propose_create_student(
        ctx: RunContext[ChatDeps],
        first_name: str | None = None,
        last_name: str | None = None,
        grade_level: str | None = None,
    ) -> str:
        """Open a create-student form for the user. Call this for ANY request to
        add / create / register / enroll a student. All arguments are optional —
        pass only the fields the user actually mentioned to pre-fill them; the
        form itself presents and collects every required field. Do NOT create the
        student yourself."""
        fields: dict = {}
        for k, v in (("first_name", first_name), ("last_name", last_name),
                     ("grade_level", grade_level)):
            if v:
                fields[k] = v
        dupes = await dc_duplicate_check(ctx.deps, "student", fields) if fields else []
        ctx.deps.pending_proposals.append(
            {"action": "create_student", "entity_type": "student",
             "fields": fields, "duplicates": dupes}
        )
        note = " Possible duplicate students were found." if dupes else ""
        return ("Opened a new-student form for the user to complete and submit."
                + note + " Tell them the form is ready to fill in.")

    @agent.tool
    async def propose_create_lead(
        ctx: RunContext[ChatDeps],
        guardian_name: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        student_first_name: str | None = None,
    ) -> str:
        """Open a create-lead form for the user. Call this for ANY request to add
        / create a lead or inquiry. All arguments are optional — pass only the
        fields the user mentioned to pre-fill them; the form presents and collects
        every required field. Do NOT create the lead yourself."""
        fields: dict = {}
        for k, v in (("guardian_name", guardian_name), ("email", email),
                     ("phone", phone), ("student_first_name", student_first_name)):
            if v:
                fields[k] = v
        ctx.deps.pending_proposals.append(
            {"action": "create_lead", "entity_type": "lead",
             "fields": fields, "duplicates": []}
        )
        return ("Opened a new-lead form for the user to complete and submit. "
                "Tell them the form is ready to fill in.")

    @agent.tool
    async def propose_create_program(
        ctx: RunContext[ChatDeps],
        name: str | None = None,
    ) -> str:
        """Open a create-program form for the user. Call this for ANY request to
        add / create a program. The name argument is optional — pass it only if
        the user gave one, to pre-fill it; the form presents and collects every
        required field. Do NOT create the program yourself."""
        fields: dict = {}
        if name:
            fields["name"] = name
        ctx.deps.pending_proposals.append(
            {"action": "create_program", "entity_type": "program",
             "fields": fields, "duplicates": []}
        )
        return ("Opened a new-program form for the user to complete and submit. "
                "Tell them the form is ready to fill in.")
