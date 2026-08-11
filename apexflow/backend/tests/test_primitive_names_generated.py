"""The guard/effect primitive vocabulary is single-sourced in
`app.workflows.primitives`' `GUARDS`/`EFFECTS` dicts.

This is the drift alarm for
`apexflow/frontend/src/editor/stage/primitiveNames.generated.ts`, generated
from those dicts by `scripts/generate_primitive_names_ts.py` and committed.
Change `GUARDS`/`EFFECTS` without re-running the generator and this fails --
which is what lets the frontend's `phrases.test.ts` coverage assertion
actually catch a primitive added to the backend registry, rather than only
catching drift in its own hand-typed copy of the name list.
"""
import re
from pathlib import Path

from app.workflows.primitives import EFFECTS, GUARDS


def _generated_text() -> str:
    repo = Path(__file__).resolve().parents[3]
    return (
        repo / "apexflow/frontend/src/editor/stage/primitiveNames.generated.ts"
    ).read_text()


def test_generated_ts_matches_the_registries():
    generated = _generated_text()

    guard_block = generated.split("GUARD_NAMES")[1].split("= [")[1].split("]")[0]
    effect_block = generated.split("EFFECT_NAMES")[1].split("= [")[1].split("]")[0]
    generated_guards = re.findall(r"'([a-zA-Z_]+)'", guard_block)
    generated_effects = re.findall(r"'([a-zA-Z_]+)'", effect_block)

    assert generated_guards == list(GUARDS.keys()), (
        "primitiveNames.generated.ts GUARD_NAMES is stale -- run "
        "`cd apexflow/backend && uv run python scripts/generate_primitive_names_ts.py`"
    )
    assert generated_effects == list(EFFECTS.keys()), (
        "primitiveNames.generated.ts EFFECT_NAMES is stale -- run "
        "`cd apexflow/backend && uv run python scripts/generate_primitive_names_ts.py`"
    )
