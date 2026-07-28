from pydantic_ai import Agent, RunContext

from app.chat.datacore import (
    ChatDeps,
    dc_create,
    dc_duplicate_check,
    dc_query,
    sql_literal,
)

_ACTIVE = "_status = 'active'"


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
