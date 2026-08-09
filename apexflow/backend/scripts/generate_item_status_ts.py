#!/usr/bin/env python
"""Generate `flow-runtime/src/itemStatus.generated.ts` from `ItemStatus`.

`app/workflows/shared.py::ItemStatus` is the single authority for the
`workflow_item.status` vocabulary. The three frontends all consume the
`flow-runtime` package, so emitting the TS constants there gives them the
same vocabulary without any of them hardcoding it.

Why a generated `.ts` inside `flow-runtime` rather than a root-level JSON
imported across the package boundary: `flow-runtime` is wired into each
frontend as a symlinked npm `file:` dependency, and that resolution path is
exactly what broke the CI frontend build once already (`TS2307: Cannot find
module 'react'`, fixed by installing flow-runtime's own deps). An
intra-package import has no cross-directory or Vite `fs.allow` concerns.

Run after any change to `ItemStatus`:

    cd apexflow/backend && uv run python scripts/generate_item_status_ts.py

`tests/test_item_status.py::test_generated_ts_matches_the_enum` fails if the
committed file and the enum disagree, so forgetting to re-run this is a red
suite, not a silent drift.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.workflows.shared import ITEM_DONE_STATUSES, ItemStatus  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
TARGET = REPO_ROOT / "flow-runtime" / "src" / "itemStatus.generated.ts"

BANNER = """// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Source of truth: apexflow/backend/app/workflows/shared.py (ItemStatus).
// Regenerate:     cd apexflow/backend && uv run python scripts/generate_item_status_ts.py
//
// Editing this file by hand will be overwritten on the next run, and
// apexflow's tests/test_item_status.py drift test fails if it disagrees
// with the Python enum.
"""


def _quoted(values) -> str:
    return ", ".join(f"'{v}'" for v in values)


def render() -> str:
    statuses = [s.value for s in ItemStatus]
    done = [s.value for s in ItemStatus if s in ITEM_DONE_STATUSES]
    union = "\n  | ".join(f"'{s}'" for s in statuses)
    return f"""{BANNER}
/** The closed vocabulary of `workflow_item.status`. */
export type ItemStatus =
  | {union};

/** Every status, in the enum's declaration order. */
export const ITEM_STATUSES: readonly ItemStatus[] = [
  {_quoted(statuses)},
];

/** Statuses that count as "done" for blocking-completeness checks. */
export const ITEM_DONE_STATUSES: readonly ItemStatus[] = [
  {_quoted(done)},
];
"""


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(render())
    print(f"wrote {TARGET.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
