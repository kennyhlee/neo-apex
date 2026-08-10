#!/usr/bin/env python
"""Generate `apexflow/frontend/src/editor/stage/primitiveNames.generated.ts`
from `app.workflows.primitives`' `GUARDS`/`EFFECTS` registries.

`app/workflows/primitives.py`'s `GUARDS` and `EFFECTS` dicts are the single
authority for the guard/effect primitive vocabulary. The stage editor's
`phrases.ts` needs the exact same name list so its allowlist-coverage test
(`phrases.test.ts`) can fail when a primitive is added to the backend
registry and the frontend hasn't accounted for it yet -- the whole reason
that test exists.

Why a generated `.ts` inside `apexflow/frontend/src` rather than in
`flow-runtime` (contrast `generate_item_status_ts.py`, which targets
`flow-runtime`): this file is consumed only by `apexflow/frontend`, not by
all three frontends, so there's no reason to route it through the
`flow-runtime` `file:` dependency -- doing so would add exactly the
cross-package resolution risk that dependency has already caused once
(`TS2307: Cannot find module 'react'`). An intra-package import has no
such concern.

Run after any change to `GUARDS`/`EFFECTS`:

    cd apexflow/backend && uv run python scripts/generate_primitive_names_ts.py

`tests/test_primitive_names_generated.py::test_generated_ts_matches_the_registries`
fails if the committed file and the registries disagree, so forgetting to
re-run this is a red suite, not a silent drift.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.workflows.primitives import EFFECTS, GUARDS  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
TARGET = REPO_ROOT / "apexflow" / "frontend" / "src" / "editor" / "stage" / "primitiveNames.generated.ts"

BANNER = """// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Source of truth: apexflow/backend/app/workflows/primitives.py (GUARDS, EFFECTS).
// Regenerate:     cd apexflow/backend && uv run python scripts/generate_primitive_names_ts.py
//
// Editing this file by hand will be overwritten on the next run, and
// apexflow's tests/test_primitive_names_generated.py drift test fails if it
// disagrees with the Python registries.
"""


def _quoted(values) -> str:
    return ", ".join(f"'{v}'" for v in values)


def render() -> str:
    guard_names = list(GUARDS.keys())
    effect_names = list(EFFECTS.keys())
    return f"""{BANNER}
/** `GUARDS` registry keys, in the registry's declaration order. */
export const GUARD_NAMES: readonly string[] = [
  {_quoted(guard_names)},
];

/** `EFFECTS` registry keys, in the registry's declaration order. */
export const EFFECT_NAMES: readonly string[] = [
  {_quoted(effect_names)},
];
"""


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(render())
    print(f"wrote {TARGET.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
