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
