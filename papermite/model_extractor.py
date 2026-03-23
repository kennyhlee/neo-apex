"""
CLI helper to extract a Tenant and a single Program from text documents using Pydantic AI,
then assign deterministic IDs via the tenant and program ID generators.
"""

import argparse
from pathlib import Path
from typing import Optional

from pydantic_ai import Agent

from apex.models.models import Program, Tenant
from apex.utils.program_id_generator import ProgramIdGenerator
from apex.utils.tenant_id_generator import TenantIdGenerator

DEFAULT_MODEL = "openai:gpt-5"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _tenant_prompt(doc: str) -> str:
    return f"""Extract a Tenant. Leave tenant_id blank ("" or null) if missing. Do NOT invent IDs.
Return ONLY JSON for Tenant.
---
{doc}
"""


def _program_prompt(doc: str, tenant_id: str) -> str:
    return f"""Extract a Program. tenant_id (if present) is {tenant_id}.
Leave program_id blank ("" or null) if missing. Do NOT invent IDs. Return ONLY JSON for Program.
---
{doc}
"""


def _generate_tenant_id(tenant: Tenant) -> str:
    return TenantIdGenerator.generate(tenant.display_name or tenant.name or "tenant")


def _generate_program_id(tenant_id: str, program: Program) -> str:
    return ProgramIdGenerator.generate(tenant_id, program.name or "program")


def extract(tenant_doc: Path, program_doc: Path, model_id: str = DEFAULT_MODEL) -> tuple[Tenant, Program]:
    tenant_agent = Agent(model_id, output_type=Tenant)
    program_agent = Agent(model_id, output_type=Program)

    tenant_text = _read_text(tenant_doc)
    program_text = _read_text(program_doc)

    tenant_res = tenant_agent.run_sync(_tenant_prompt(tenant_text))
    tenant = tenant_res.output
    tenant_id = _generate_tenant_id(tenant)
    tenant.tenant_id = tenant_id

    program_res = program_agent.run_sync(_program_prompt(program_text, tenant_id))
    program = program_res.output
    program.program_id = _generate_program_id(tenant_id, program)
    if not program.tenant_id:
        program.tenant_id = tenant_id

    return tenant, program


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Extract Tenant and Program from text docs using Pydantic AI.")
    parser.add_argument("tenant_doc", type=Path, help="Path to tenant text document")
    parser.add_argument("program_doc", type=Path, help="Path to program text document")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LLM model id (default: %(default)s)")
    args = parser.parse_args(argv)

    tenant, program = extract(args.tenant_doc, args.program_doc, model_id=args.model)

    print("Tenant:")
    print(tenant.model_dump_json(indent=2))
    print("\nProgram:")
    print(program.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
