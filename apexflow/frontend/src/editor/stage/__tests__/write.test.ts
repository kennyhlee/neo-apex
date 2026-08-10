import { describe, expect, it } from 'vitest';
import { readStageModel } from '../read.ts';
import { actorsFor, NEW_ORDER, NEW_STAGE_INDEX, roleGuardFor, writeMachine } from '../write.ts';
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

  it('writes stages in declaredIndex order', () => {
    expect(writeMachine(model).states).toEqual([
      { state_id: 'a', name: 'A', kind: 'initial' },
      { state_id: 'z', name: 'Z', kind: 'terminal' },
    ]);
  });

  // `model.stages` above happens to already be array-ordered the same as its
  // `declaredIndex` values, so the previous test alone cannot tell a correct
  // `writeMachine` from one that (bug) just echoes `model.stages` in array
  // order. This fixture deliberately disagrees: the array lists `z` before
  // `a`, but `declaredIndex` says `a` (0) comes before `z` (1). Deleting
  // `writeMachine`'s `.sort((a, b) => a.declaredIndex - b.declaredIndex)`
  // makes this fail while leaving the test above green.
  it('sorts by declaredIndex even when the stages array disagrees with it', () => {
    const reordered: StageModel = {
      ...model,
      stages: [
        { stage_id: 'z', name: 'Z', kind: 'terminal', depth: 1, declaredIndex: 1, step_ids: [] },
        { stage_id: 'a', name: 'A', kind: 'initial', depth: 0, declaredIndex: 0, step_ids: [] },
      ],
    };
    expect(writeMachine(reordered).states).toEqual([
      { state_id: 'a', name: 'A', kind: 'initial' },
      { state_id: 'z', name: 'Z', kind: 'terminal' },
    ]);
  });

  it('places a newly added stage after every pre-existing one, stably', () => {
    const withNewStages: StageModel = {
      ...model,
      stages: [
        { stage_id: 'new2', name: 'New 2', kind: 'active', depth: 2, declaredIndex: NEW_STAGE_INDEX, step_ids: [] },
        { stage_id: 'z', name: 'Z', kind: 'terminal', depth: 1, declaredIndex: 1, step_ids: [] },
        { stage_id: 'new1', name: 'New 1', kind: 'active', depth: 2, declaredIndex: NEW_STAGE_INDEX, step_ids: [] },
        { stage_id: 'a', name: 'A', kind: 'initial', depth: 0, declaredIndex: 0, step_ids: [] },
      ],
    };
    // Both pre-existing stages (a, z) come first in declaredIndex order;
    // the two NEW_STAGE_INDEX stages come last, in their original relative
    // (array) order — `new2` before `new1` — because sort is stable.
    expect(writeMachine(withNewStages).states.map((s) => s.state_id)).toEqual(['a', 'z', 'new2', 'new1']);
  });
});

describe('NEW_ORDER hazard: guarded member after an unguarded pre-existing one', () => {
  // `NEW_ORDER` guarantees only that a new member sorts after every
  // pre-existing one in its group — see write.ts's doc comment on
  // `NEW_ORDER`. It does NOT guarantee the result satisfies
  // `validate.py`'s `_unguarded_branch_errors`, which requires the
  // unguarded transition in a `(from, action)` group to be declared last.
  // This is real, not hypothetical: signup's shipped `(offered,
  // decline_offer)` group is exactly one unguarded transition,
  // `t_decline_offer`, legal only because it is last (and only) in its
  // group. Model that shape here, add a GUARDED sibling with `order:
  // NEW_ORDER`, and confirm `writeMachine` puts the new guarded transition
  // AFTER the old unguarded one — backwards from what `_unguarded_branch_
  // errors` would require. `writeMachine` has no opinion on this; it writes
  // what the model says. Producing a valid order for a mixed group is the
  // editor's job, not this translation layer's. This test pins today's
  // write-what-you're-given behaviour so it doesn't go undiscovered.
  it('still writes the new guarded member after the pre-existing unguarded one', () => {
    const model: StageModel = {
      stages: [
        { stage_id: 'offered', name: 'Offered', kind: 'active', depth: 0, declaredIndex: 0, step_ids: [] },
        { stage_id: 'declined', name: 'Declined', kind: 'terminal', depth: 1, declaredIndex: 1, step_ids: [] },
      ],
      finishStageId: null,
      groups: [
        {
          key: 'k-existing-unguarded',
          action: 'decline_offer',
          to: 'declined',
          who: 'staff',
          guards: [],
          effects: [],
          members: [
            {
              transition_id: 't_decline_offer',
              from: 'offered',
              actor: 'staff',
              roleGuard: null,
              order: 0,
            },
          ],
        },
        {
          key: 'k-new-guarded',
          action: 'decline_offer',
          to: 'declined',
          who: 'staff',
          guards: [{ primitive: 'date_window', params: { end: '2026-12-31' } }],
          effects: [],
          members: [
            {
              transition_id: 't_decline_offer_guarded',
              from: 'offered',
              actor: 'staff',
              roleGuard: null,
              order: NEW_ORDER,
            },
          ],
        },
      ],
    };
    expect(writeMachine(model).transitions.map((t) => t.transition_id)).toEqual([
      't_decline_offer',
      't_decline_offer_guarded',
    ]);
  });
});

describe('memberToTransition does not alias the source MoveGroup/MoveMember', () => {
  // F3: a shallow `[...group.guards]`/`[...group.effects]` copies the
  // ARRAY but not its ELEMENTS — every emitted transition would then hold
  // the SAME `GuardRef`/`EffectRef` objects the live `MoveGroup` still
  // owns. An in-place edit after a save (`group.effects[0].params.x = ...`)
  // would silently mutate the machine just written, and for a split
  // `_withdraw_pair`/`_drop_pair` sibling it would mutate the sibling too.
  // Structural `toEqual` cannot see this — only identity (`toBe`) can.
  it('clones every guard/effect element, including the roleGuard', () => {
    const roleGuard = { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } };
    const guard = { primitive: 'date_window', params: { end: '2026-12-31' } };
    const effect = { primitive: 'send_email', params: { template: 'x' } };
    const model: StageModel = {
      stages: [
        { stage_id: 'a', name: 'A', kind: 'initial', depth: 0, declaredIndex: 0, step_ids: [] },
        { stage_id: 'z', name: 'Z', kind: 'terminal', depth: 1, declaredIndex: 1, step_ids: [] },
      ],
      finishStageId: 'z',
      groups: [
        {
          key: 'k',
          action: 'go',
          to: 'z',
          who: 'staff',
          guards: [guard],
          effects: [effect],
          members: [{ transition_id: 't', from: 'a', actor: 'staff', roleGuard, order: 0 }],
        },
      ],
    };
    const out = writeMachine(model);
    expect(out.transitions[0].guards[0]).not.toBe(roleGuard);
    expect(out.transitions[0].guards[1]).not.toBe(guard);
    expect(out.transitions[0].effects[0]).not.toBe(effect);
    // Still structurally identical — cloning must be exact, not lossy.
    expect(out.transitions[0].guards).toEqual([roleGuard, guard]);
    expect(out.transitions[0].effects).toEqual([effect]);
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

describe('renaming a stage', () => {
  it('changes only the name and leaves every transition untouched', async () => {
    const { readStageModel } = await import('../read.ts');
    const { SIGNUP_MACHINE, SIGNUP_STEPS } = await import('./fixtures.ts');
    const model = readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);
    const renamed = {
      ...model,
      stages: model.stages.map((s) => (s.stage_id === 'offered' ? { ...s, name: 'Offer Out' } : s)),
    };
    const out = writeMachine(renamed);
    expect(out.transitions).toEqual(SIGNUP_MACHINE.transitions);
    expect(out.states.find((s) => s.state_id === 'offered')?.name).toBe('Offer Out');
    expect(out.states.filter((s) => s.state_id !== 'offered')).toEqual(
      SIGNUP_MACHINE.states.filter((s) => s.state_id !== 'offered'),
    );
  });
});
