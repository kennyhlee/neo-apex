// The default chips are data, so most of what could go wrong with them is
// dull. Three things are not.
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUICK_ACTIONS, MAX_QUICK_ACTIONS } from '../quickActions.ts';

/**
 * The verbs `SYSTEM_PROMPT` tells the model to answer with `show_flow` — see
 * `apexflow/backend/app/chat/agent.py`. Kept here so a reworded chip that
 * stops triggering the flow card fails a test instead of quietly returning a
 * paragraph of prose.
 */
const FLOW_TRIGGER_VERBS = ['see', 'show', 'draw', 'visualise', 'explain'];

describe('default quick actions', () => {
  // `loadQuickActions` slices a STORED list to the cap but returns the
  // defaults unsliced, so going over it renders chips the editor will not
  // let anyone add back after deleting.
  it('fits within the cap the editor enforces', () => {
    expect(DEFAULT_QUICK_ACTIONS.length).toBeLessThanOrEqual(MAX_QUICK_ACTIONS);
  });

  // The editor keys its rows by index, so two identical chips are two rows
  // that look interchangeable and are not.
  it('has no duplicates, and nothing blank', () => {
    expect(new Set(DEFAULT_QUICK_ACTIONS).size).toBe(DEFAULT_QUICK_ACTIONS.length);
    for (const item of DEFAULT_QUICK_ACTIONS) {
      expect(item.trim()).toBe(item);
      expect(item.length).toBeGreaterThan(0);
    }
  });

  it('offers a way to see a workflow drawn', () => {
    const asksToSee = DEFAULT_QUICK_ACTIONS.filter((q) =>
      FLOW_TRIGGER_VERBS.some((verb) => q.toLowerCase().includes(verb)),
    );
    expect(asksToSee.length).toBeGreaterThanOrEqual(2);
    // One for the workflow already open, one for picking another — the two
    // paths `show_flow` supports (its `entity_id` defaults to the open draft).
    expect(asksToSee.some((q) => /this workflow/i.test(q))).toBe(true);
    expect(asksToSee.some((q) => /my workflows|one of/i.test(q))).toBe(true);
  });
});
