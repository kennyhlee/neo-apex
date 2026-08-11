// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Source of truth: apexflow/backend/app/workflows/primitives.py (GUARDS, EFFECTS).
// Regenerate:     cd apexflow/backend && uv run python scripts/generate_primitive_names_ts.py
//
// Editing this file by hand will be overwritten on the next run, and
// apexflow's tests/test_primitive_names_generated.py drift test fails if it
// disagrees with the Python registries.

/** `GUARDS` registry keys, in the registry's declaration order. */
export const GUARD_NAMES: readonly string[] = [
  'all_blocking_items_complete', 'items_in_status', 'capacity_available', 'data_condition', 'date_window', 'actor_role',
];

/** `EFFECTS` registry keys, in the registry's declaration order. */
export const EFFECT_NAMES: readonly string[] = [
  'commit_sections', 'set_entity_field', 'send_email', 'issue_link', 'start_due_clocks', 'set_context',
];
