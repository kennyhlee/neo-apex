// Attach `validateDefinition`'s flat error-string list to the step/section
// that produced it, by substring-matching the ids the backend's error
// strings name — task-7-brief.md's explicit contract ("Task 2 asserted
// error strings name ids"), verified directly against
// `apexflow/backend/app/workflows/validate.py`'s f-strings and
// `apexflow/backend/tests/test_validate.py`'s examples: every message uses
// `step '{id}'` / `section '{id}'` (single-quoted, exact id, no other
// escaping) as its own literal substring.
//
// A section-level message ALSO names its owning step (e.g. "section 'x'
// (step 'y') references..."), so a naive `step '{id}'` match would double
// up a section's own error at the step level too. Step-level matching
// excludes anything that starts with `section '` for that reason — those
// already get surfaced at the more specific section granularity.

/** Errors this step's own fields (available_in, show_if, ...) produced —
 * excludes section-scoped errors that happen to also mention this step's
 * id (those attach via `errorsForSection` instead). */
export function errorsForStep(errors: string[], stepId: string): string[] {
  const marker = `step '${stepId}'`;
  return errors.filter((e) => e.includes(marker) && !e.startsWith("section '"));
}

/** Errors naming this section by id — always prefixed `section '{id}'`
 * (`validate.py`'s `_engine_owned_field_errors` / `_section_field_existence_errors`
 * / `_coverage_errors` conditional branch, all f-string-prefixed this way). */
export function errorsForSection(errors: string[], sectionId: string): string[] {
  const marker = `section '${sectionId}'`;
  return errors.filter((e) => e.startsWith(marker));
}

// --- Machine ids ------------------------------------------------------------
//
// There are no per-state / per-transition matchers here any more. They
// existed for MachineEditor.tsx and TransitionPanel.tsx, which pinned a
// backend error to the individual state/transition row that produced it;
// both components were deleted with the Machine tab, and the stage editor has
// no equivalent row to pin to — machine-shape errors surface on the top-level
// validation rail (StageEditor's `editor.stages.errorCount` points at it),
// which is also where `_state_errors`'s "no initial state" / "N initial
// states [...]" and `_unguarded_branch_errors`'s multi-unguarded messages
// always went, since none of those name a single id to match on.
