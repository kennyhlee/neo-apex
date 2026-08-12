// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Source of truth: apexflow/backend/app/workflows/shared.py (ItemStatus).
// Regenerate:     cd apexflow/backend && uv run python scripts/generate_item_status_ts.py
//
// Editing this file by hand will be overwritten on the next run, and
// apexflow's tests/test_item_status.py drift test fails if it disagrees
// with the Python enum.

/** The closed vocabulary of `workflow_item.status`. */
export type ItemStatus =
  | 'not_started'
  | 'submitted'
  | 'verified'
  | 'waived'
  | 'rejected';

/** Every status, in the enum's declaration order. */
export const ITEM_STATUSES: readonly ItemStatus[] = [
  'not_started', 'submitted', 'verified', 'waived', 'rejected',
];

/** Statuses that count as "done" for blocking-completeness checks. */
export const ITEM_DONE_STATUSES: readonly ItemStatus[] = [
  'submitted', 'verified', 'waived',
];
