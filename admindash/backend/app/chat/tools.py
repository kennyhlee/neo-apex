import json

from pydantic_ai import Agent, RunContext

from app.chat.datacore import (
    ChatDeps,
    dc_create,
    dc_duplicate_check,
    dc_query,
    sql_literal,
)

_ACTIVE = "_status = 'active'"

# System / non-domain columns excluded when listing or matching searchable fields.
_SYS_COLS = frozenset({
    "vector", "base_data", "custom_fields", "entity_id", "entity_type",
    "tenant_id", "name",
})


def _norm_value(v: object) -> str:
    """Normalize a stored field value to comparable text. Selection fields are
    stored JSON-encoded (e.g. '["Aunt"]'); decode them to 'Aunt'."""
    if v is None:
        return ""
    s = str(v)
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return ", ".join(str(x) for x in arr)
        except (ValueError, TypeError):
            pass
    return s


def _searchable_fields(row: dict) -> set[str]:
    """Domain field names on a flattened student row (base + custom)."""
    return {k for k in row if k not in _SYS_COLS and not k.startswith("_")}


def _resolve_field(requested: str, available: set[str]) -> str | None:
    """Map a user phrase ('Preferred Pickup') to an actual field name
    ('preferred_pickup'), tolerating spaces/case and partial matches."""
    key = requested.strip().lower().replace(" ", "_")
    if key in available:
        return key
    partial = sorted(f for f in available if key in f or f in key)
    return partial[0] if partial else None


def _fmt_students(rows: list[dict]) -> str:
    if not rows:
        return "No matching students found."
    lines = []
    for r in rows[:25]:
        lines.append(
            f"- {r.get('first_name','')} {r.get('last_name','')} "
            f"(id={r.get('entity_id','?')}, status={r.get('status','?')})"
        )
    more = "" if len(rows) <= 25 else f"\n…and {len(rows) - 25} more."
    return "\n".join(lines) + more


def register_read_tools(agent: Agent) -> None:
    @agent.tool
    async def find_student(
        ctx: RunContext[ChatDeps],
        first_name: str | None = None,
        last_name: str | None = None,
    ) -> str:
        """Find students by first and/or last name (case-insensitive contains)."""
        where = [f"entity_type = 'student'", _ACTIVE]
        if first_name:
            where.append(f"LOWER(first_name) LIKE LOWER({sql_literal('%' + first_name + '%')})")
        if last_name:
            where.append(f"LOWER(last_name) LIKE LOWER({sql_literal('%' + last_name + '%')})")
        rows = await dc_query(ctx.deps, f"SELECT * FROM data WHERE {' AND '.join(where)}")
        return _fmt_students(rows)

    @agent.tool
    async def get_student(ctx: RunContext[ChatDeps], student_id: str) -> str:
        """Get a single student by entity id."""
        rows = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'student' "
            f"AND entity_id = {sql_literal(student_id)} AND {_ACTIVE}",
        )
        return _fmt_students(rows)

    @agent.tool
    async def count_students(ctx: RunContext[ChatDeps], status: str | None = None) -> str:
        """Count students, optionally filtered by status (e.g. 'Enrolled')."""
        where = ["entity_type = 'student'", _ACTIVE]
        if status:
            where.append(f"status = {sql_literal(status)}")
        rows = await dc_query(ctx.deps, f"SELECT entity_id FROM data WHERE {' AND '.join(where)}")
        label = f" with status {status!r}" if status else ""
        return f"{len(rows)} student(s){label}."

    @agent.tool
    async def list_programs(ctx: RunContext[ChatDeps]) -> str:
        """List all programs."""
        rows = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'program' AND {_ACTIVE}",
        )
        if not rows:
            return "No programs found."
        return "\n".join(
            f"- {r.get('name') or r.get('program_name','?')} (id={r.get('entity_id','?')})"
            for r in rows[:50]
        )

    @agent.tool
    async def list_students_in_program(ctx: RunContext[ChatDeps], program_name: str) -> str:
        """List students enrolled in a program, by program name."""
        progs = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'program' AND {_ACTIVE} "
            f"AND (LOWER(name) LIKE LOWER({sql_literal('%' + program_name + '%')}) "
            f"OR LOWER(program_name) LIKE LOWER({sql_literal('%' + program_name + '%')}))",
        )
        if not progs:
            return f"No program matching {program_name!r}."
        pid = progs[0].get("entity_id")
        if not pid:
            return f"Program {program_name!r} found but has no id."
        enr = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'enrollment' AND {_ACTIVE} "
            f"AND program_id = {sql_literal(pid)}",
        )
        student_ids = [e.get("student_id") for e in enr if e.get("student_id")]
        if not student_ids:
            return f"No students enrolled in {program_name!r}."
        id_list = ", ".join(sql_literal(s) for s in student_ids)
        students = await dc_query(
            ctx.deps,
            f"SELECT * FROM data WHERE entity_type = 'student' AND {_ACTIVE} "
            f"AND entity_id IN ({id_list})",
        )
        return _fmt_students(students)

    @agent.tool
    async def list_leads(ctx: RunContext[ChatDeps], stage: str | None = None) -> str:
        """List leads, optionally filtered by stage."""
        where = ["entity_type = 'lead'", _ACTIVE]
        if stage:
            where.append(f"stage = {sql_literal(stage)}")
        rows = await dc_query(ctx.deps, f"SELECT * FROM data WHERE {' AND '.join(where)}")
        if not rows:
            return "No matching leads found."
        return "\n".join(
            f"- {r.get('guardian_name','?')} "
            f"(student={r.get('student_first_name','')}, stage={r.get('stage','?')}, "
            f"id={r.get('entity_id','?')})"
            for r in rows[:25]
        )

    @agent.tool
    async def list_student_fields(ctx: RunContext[ChatDeps]) -> str:
        """List the student fields that can be searched (base and custom, e.g.
        preferred_pickup, medical_conditions, school). Use this when unsure of a
        field's exact name before calling search_students."""
        rows = await dc_query(
            ctx.deps,
            f"SELECT * EXCLUDE (vector) FROM data WHERE entity_type = 'student' "
            f"AND {_ACTIVE} LIMIT 1",
        )
        if not rows:
            return "No students exist yet, so there are no fields to search."
        fields = sorted(_searchable_fields(rows[0]))
        return "Searchable student fields: " + ", ".join(fields)

    @agent.tool
    async def search_students(
        ctx: RunContext[ChatDeps],
        field: str,
        value: str | None = None,
        match: str = "contains",
    ) -> str:
        """Find students by ANY field, including custom fields (e.g.
        preferred_pickup, medical_conditions, school, transportation).
        match='set'      -> students where the field has any non-empty value (ignores value)
        match='equals'   -> field equals value (case-insensitive)
        match='contains' -> field contains value (case-insensitive; the default)
        Example: field='preferred pickup', value='Aunt', match='contains'."""
        rows = await dc_query(
            ctx.deps,
            f"SELECT * EXCLUDE (vector) FROM data WHERE entity_type = 'student' "
            f"AND {_ACTIVE}",
        )
        if not rows:
            return "No active students."
        available = _searchable_fields(rows[0])
        fname = _resolve_field(field, available)
        if not fname:
            return (
                f"No student field matching {field!r}. Searchable fields: "
                + ", ".join(sorted(available))
            )
        m = (match or "contains").lower()
        want = (value or "").strip().lower()
        hits: list[tuple[dict, str]] = []
        for r in rows:
            text = _norm_value(r.get(fname))
            low = text.lower()
            if m in ("set", "has", "present"):
                ok = bool(text.strip())
            elif m in ("equals", "is", "eq"):
                ok = bool(want) and low == want
            else:
                ok = bool(want) and want in low
            if ok:
                hits.append((r, text))
        if not hits:
            cond = f"{m} {value!r}" if value else "is set"
            return f"No students found where {fname} {cond}."
        cond = f"{m} {value!r}" if value else "is set"
        lines = [
            f"- {r.get('first_name','')} {r.get('last_name','')} "
            f"(id={r.get('entity_id','?')}) — {fname}: {text}"
            for r, text in hits[:40]
        ]
        more = "" if len(hits) <= 40 else f"\n…and {len(hits) - 40} more."
        return f"{len(hits)} student(s) where {fname} {cond}:\n" + "\n".join(lines) + more


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
