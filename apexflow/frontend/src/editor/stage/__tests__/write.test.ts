import { describe, expect, it } from 'vitest';
import { readStageModel } from '../read.ts';
import { actorsFor, NEW_ORDER, roleGuardFor, writeMachine } from '../write.ts';
import type { StageModel } from '../types.ts';
import type { MachineDef } from '../../../types/designer.ts';

describe('roleGuardFor', () => {
  it('writes exactly what the shipped templates write', () => {
    expect(roleGuardFor('family')).toEqual({ primitive: 'actor_role', params: { roles: ['family'] } });
    expect(roleGuardFor('staff')).toEqual({
      primitive: 'actor_role',
      params: { roles: ['staff', 'admin'] },
    });
  });
});

describe('actorsFor', () => {
  it('expands "both" to the family/staff pair', () => {
    expect(actorsFor('both')).toEqual(['family', 'staff']);
  });
  it('maps "automatic" to the system actor', () => {
    expect(actorsFor('automatic')).toEqual(['system']);
  });
});

describe('writeMachine', () => {
  const model: StageModel = {
    stages: [
      { stage_id: 'a', name: 'A', kind: 'initial', depth: 0, declaredIndex: 0, step_ids: [] },
      { stage_id: 'z', name: 'Z', kind: 'terminal', depth: 1, declaredIndex: 1, step_ids: [] },
    ],
    finishStageId: 'z',
    groups: [
      {
        key: 'k-new',
        action: 'finish',
        to: 'z',
        who: 'staff',
        guards: [],
        effects: [],
        members: [
          { transition_id: 't_new', from: 'a', actor: 'staff', roleGuard: null, order: NEW_ORDER },
        ],
      },
      {
        key: 'k-old',
        action: 'start',
        to: 'z',
        who: 'family',
        guards: [],
        effects: [],
        members: [{ transition_id: 't_old', from: 'a', actor: 'family', roleGuard: null, order: 0 }],
      },
    ],
  };

  it('places a newly added transition after every pre-existing one', () => {
    expect(writeMachine(model).transitions.map((t) => t.transition_id)).toEqual(['t_old', 't_new']);
  });

  it('writes stages back as states in model order', () => {
    expect(writeMachine(model).states).toEqual([
      { state_id: 'a', name: 'A', kind: 'initial' },
      { state_id: 'z', name: 'Z', kind: 'terminal' },
    ]);
  });
});

describe('roleGuard index is not preserved (documented, not a bug)', () => {
  // `MoveMember.roleGuard` records the absorbed `actor_role` guard but not
  // its original position within the transition's `guards` array.
  // `memberToTransition` always re-inserts it at index 0. Both shipped
  // templates put `actor_role` first, so the real-template round-trip tests
  // cannot see this; a hand-authored transition with `actor_role` anywhere
  // else comes back with it moved to the front. Guard order within one
  // transition is not semantically load-bearing — `validate.py`'s
  // `_unguarded_branch_errors` only checks emptiness of a transition's guard
  // list, and guards are ANDed together — so this is an accepted fidelity
  // gap, not a correctness one.
  it('moves a non-leading actor_role guard to the front on write', () => {
    const machine: MachineDef = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' },
        { state_id: 'z', name: 'Z', kind: 'terminal' },
      ],
      transitions: [
        {
          transition_id: 't1',
          from: 'a',
          to: 'z',
          action: 'go',
          actor: 'staff',
          guards: [
            { primitive: 'date_window', params: { end: '2026-12-31' } },
            { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } },
          ],
          effects: [],
        },
      ],
    };
    const out = writeMachine(readStageModel(machine, []));
    expect(out.transitions[0].guards).toEqual([
      { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } },
      { primitive: 'date_window', params: { end: '2026-12-31' } },
    ]);
    // Not a round trip: the guard order differs from the input, by design.
    expect(out.transitions[0].guards).not.toEqual(machine.transitions[0].guards);
  });
});
