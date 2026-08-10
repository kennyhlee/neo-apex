import { describe, expect, it } from 'vitest';
import { finishStageId, orderStages, stageDepths } from '../spine.ts';
import { ENROLLMENT_MACHINE, SIGNUP_MACHINE } from './fixtures.ts';

describe('stageDepths', () => {
  it('measures BFS distance from the initial stage', () => {
    expect(stageDepths(SIGNUP_MACHINE)).toEqual({
      draft: 0,
      waitlisted: 1,
      confirmed: 1,
      dropped: 1,
      offered: 2,
      completed: 2,
    });
  });

  it('gives an unreachable stage a depth beyond every reachable one', () => {
    const machine = {
      states: [
        ...SIGNUP_MACHINE.states,
        { state_id: 'orphan', name: 'Orphan', kind: 'active' as const },
      ],
      transitions: SIGNUP_MACHINE.transitions,
    };
    expect(stageDepths(machine).orphan).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('orderStages', () => {
  it('orders signup along the spine, exits last', () => {
    const { ordered } = orderStages(SIGNUP_MACHINE);
    expect(ordered.map((s) => s.state_id)).toEqual([
      'draft',
      'waitlisted',
      'confirmed',
      'offered',
      'completed',
      'dropped',
    ]);
  });

  it('does not strand an exit target in the middle of the spine', () => {
    // `withdrawn` is one hop from `draft`, so pure BFS order puts it third
    // of nine — between `waitlisted` and `in_review`. It is an exit target,
    // not a step along the way, so it sorts after the finish.
    const { ordered } = orderStages(ENROLLMENT_MACHINE);
    expect(ordered.map((s) => s.state_id)).toEqual([
      'draft',
      'submitted',
      'waitlisted',
      'in_review',
      'pending_items',
      'approved',
      'enrolled',
      'withdrawn',
      'declined',
    ]);
  });

  it('sorts an unreachable stage after the reachable spine but before the exits', () => {
    const machine = {
      states: [
        ...SIGNUP_MACHINE.states,
        { state_id: 'orphan', name: 'Orphan', kind: 'active' as const },
      ],
      transitions: SIGNUP_MACHINE.transitions,
    };
    const ids = orderStages(machine).ordered.map((s) => s.state_id);
    expect(ids.indexOf('orphan')).toBeGreaterThan(ids.indexOf('completed'));
    expect(ids.indexOf('orphan')).toBeLessThan(ids.indexOf('dropped'));
  });

  it('returns declaration order when there is no initial stage', () => {
    const machine = {
      states: SIGNUP_MACHINE.states.map((s) =>
        s.kind === 'initial' ? { ...s, kind: 'active' as const } : s,
      ),
      transitions: SIGNUP_MACHINE.transitions,
    };
    const { ordered } = orderStages(machine);
    expect(ordered.map((s) => s.state_id)).toEqual(SIGNUP_MACHINE.states.map((s) => s.state_id));
  });
});

describe('finishStageId', () => {
  it('is the deepest terminal stage, not the first one declared', () => {
    expect(finishStageId(SIGNUP_MACHINE)).toBe('completed');
  });

  it('breaks a depth tie by declaration order', () => {
    const machine = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' as const },
        { state_id: 'y', name: 'Y', kind: 'terminal' as const },
        { state_id: 'z', name: 'Z', kind: 'terminal' as const },
      ],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'y', action: 'go', actor: 'staff' as const, guards: [], effects: [] },
        { transition_id: 't2', from: 'a', to: 'z', action: 'stop', actor: 'staff' as const, guards: [], effects: [] },
      ],
    };
    expect(finishStageId(machine)).toBe('y');
  });

  it('is null when nothing is terminal', () => {
    const machine = {
      states: [{ state_id: 'a', name: 'A', kind: 'initial' as const }],
      transitions: [],
    };
    expect(finishStageId(machine)).toBeNull();
  });

  it('prefers a reachable terminal over an unreachable one, regardless of depth', () => {
    // The editor's own "add a stage, promote it to terminal" flow: `done` is
    // the real, reachable finish; `orphan` is a freshly-added stage with no
    // move pointing at it yet, so its depth is UNREACHABLE — deeper than any
    // reachable stage could ever be.
    const machine = {
      states: [
        { state_id: 'draft', name: 'Draft', kind: 'initial' as const },
        { state_id: 'done', name: 'Done', kind: 'terminal' as const },
        { state_id: 'orphan', name: 'Orphan', kind: 'terminal' as const },
      ],
      transitions: [
        {
          transition_id: 't1',
          from: 'draft',
          to: 'done',
          action: 'submit',
          actor: 'staff' as const,
          guards: [],
          effects: [],
        },
      ],
    };
    expect(finishStageId(machine)).toBe('done');
  });

  it('falls back to the deepest-then-declared rule when every terminal is unreachable', () => {
    const machine = {
      states: [
        { state_id: 'draft', name: 'Draft', kind: 'initial' as const },
        { state_id: 'orphan1', name: 'Orphan 1', kind: 'terminal' as const },
        { state_id: 'orphan2', name: 'Orphan 2', kind: 'terminal' as const },
      ],
      transitions: [],
    };
    // Both are UNREACHABLE (tied depth), so declaration order decides —
    // same rule as the depth-tie case above, just applied among orphans.
    expect(finishStageId(machine)).toBe('orphan1');
  });

  it('still picks the shipped templates’ finish stages', () => {
    expect(finishStageId(ENROLLMENT_MACHINE)).toBe('enrolled');
    expect(finishStageId(SIGNUP_MACHINE)).toBe('completed');
  });
});
