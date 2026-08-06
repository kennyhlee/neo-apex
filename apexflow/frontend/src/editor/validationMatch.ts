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

// --- Machine ids (Task 8) ---------------------------------------------------
//
// Same substring-match contract as the step/section matchers above, verified
// against `validate.py`'s f-strings: `_reachability_errors` /
// `_outgoing_transition_errors` both emit `state '{id}' ...` (single-quoted,
// exact id); `_guard_effect_ref_errors` / `_commit_sections_ref_errors` /
// `_state_ref_errors` all emit `transition '{id}' ...`. `_state_errors`'s two
// "no initial state" / "N initial states [...]" messages name NO single id
// (a count, or a sorted LIST) and so intentionally attach to neither
// matcher — MachineEditor surfaces those only via the top-level validation
// rail, same as `_unguarded_branch_errors`'s multi-unguarded message below.
//
// `_unguarded_branch_errors`'s "at most one unguarded" message names its
// offending ids as a Python list repr (`transitions ['t1', 't2'] are all
// unguarded...`) rather than the singular `transition '{id}'` form every
// other message uses — that plural message does NOT match
// `errorsForTransition` for either id (no `transition '` substring occurs;
// only `transitions [` does). MachineEditor computes that exact rule
// client-side instead (from `machine.transitions` directly, not from these
// backend strings) precisely so the "more than one unguarded" / "unguarded
// not last" hints don't depend on this string-matching gap.

/** Errors naming this state by id — `state '{id}'` (single-quoted, exact
 * id), never prefix-anchored (unlike `errorsForSection`) since these
 * messages don't share a section/step-style leading-mention convention. */
export function errorsForState(errors: string[], stateId: string): string[] {
  const marker = `state '${stateId}'`;
  return errors.filter((e) => e.includes(marker));
}

/** Errors naming this transition by id — `transition '{id}'` (single-quoted,
 * exact id). See module note above for the one shape (multi-unguarded) this
 * deliberately does not catch. */
export function errorsForTransition(errors: string[], transitionId: string): string[] {
  const marker = `transition '${transitionId}'`;
  return errors.filter((e) => e.includes(marker));
}
