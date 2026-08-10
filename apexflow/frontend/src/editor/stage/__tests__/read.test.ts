import { describe, expect, it } from 'vitest';
import type { MachineDef } from '../../../types/designer.ts';
import { isExitGroup, readStageModel } from '../read.ts';
import { ENROLLMENT_MACHINE, ENROLLMENT_STEPS, SIGNUP_MACHINE, SIGNUP_STEPS } from './fixtures.ts';

const model = () => readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);

// Shared by the F2 "does not merge..." test and the F5 split-sibling
// identity tests below: A family-only exit from `a` and a staff-only exit
// from `b`, otherwise identical (same action/to/guards/effects) — the
// shape that shares a `groupKey` before `isRectangle` splits it apart.
// Non-empty `guards`/`effects` (not `[]`) so the F5 tests can prove the two
// split siblings don't share array/object identity, not just that two
// distinct empty arrays happen to compare unequal by reference.
const AB_QUIT_MACHINE: MachineDef = {
  states: [
    { state_id: 'a', name: 'A', kind: 'initial' },
    { state_id: 'b', name: 'B', kind: 'active' },
    { state_id: 'z', name: 'Z', kind: 'terminal' },
  ],
  transitions: [
    {
      transition_id: 't1',
      from: 'a',
      to: 'z',
      action: 'quit',
      actor: 'family',
      guards: [{ primitive: 'always_true', params: {} }],
      effects: [{ primitive: 'send_email', params: { template: 'goodbye' } }],
    },
    {
      transition_id: 't2',
      from: 'b',
      to: 'z',
      action: 'quit',
      actor: 'staff',
      guards: [{ primitive: 'always_true', params: {} }],
      effects: [{ primitive: 'send_email', params: { template: 'goodbye' } }],
    },
  ],
};

describe('readStageModel — stages', () => {
  it('reads every state as a stage, in spine order', () => {
    expect(model().stages.map((s) => s.stage_id)).toEqual([
      'draft',
      'waitlisted',
      'confirmed',
      'offered',
      'completed',
      'dropped',
    ]);
  });

  it('puts each step in every stage its available_in names', () => {
    const stages = Object.fromEntries(model().stages.map((s) => [s.stage_id, s.step_ids]));
    expect(stages.draft).toEqual(['welcome', 'signup_form']);
    expect(stages.waitlisted).toEqual(['waitlist_notice']);
    expect(stages.completed).toEqual([]);
  });
});

describe('readStageModel — grouping', () => {
  it('collapses the eight drop transitions into TWO groups, not one', () => {
    const drops = model().groups.filter((g) => g.action === 'drop');
    expect(drops).toHaveLength(2);
    const bySize = [...drops].sort((a, b) => b.members.length - a.members.length);
    expect(bySize[0].members.map((m) => m.from).sort()).toEqual([
      'draft',
      'draft',
      'offered',
      'offered',
      'waitlisted',
      'waitlisted',
    ]);
    expect(bySize[0].effects).toEqual([]);
    expect(bySize[1].members.map((m) => m.from)).toEqual(['confirmed', 'confirmed']);
    expect(bySize[1].effects).toEqual([
      { primitive: 'set_entity_field', params: { ref: 'enrollment', field: 'status', value: 'Withdrawn' } },
    ]);
  });

  it('folds a family/staff pair into one group with who="both"', () => {
    const drops = model().groups.filter((g) => g.action === 'drop');
    expect(drops.every((g) => g.who === 'both')).toBe(true);
  });

  it('absorbs the actor_role guard into who and hides it from guards', () => {
    const drop = model().groups.find((g) => g.action === 'drop') as NonNullable<
      ReturnType<typeof model>['groups'][number]
    >;
    expect(drop.guards).toEqual([]);
    expect(drop.members.map((m) => m.roleGuard?.params)).toEqual(
      expect.arrayContaining([{ roles: ['family'] }, { roles: ['staff', 'admin'] }]),
    );
  });

  it('leaves roleGuard null on a transition that never carried one', () => {
    const offer = model().groups.find((g) => g.action === 'offer_spot');
    expect(offer?.who).toBe('staff');
    expect(offer?.members).toHaveLength(1);
    expect(offer?.members[0].roleGuard).toBeNull();
  });

  it('keeps two actions sharing one edge apart', () => {
    const back = model().groups.filter((g) => g.to === 'waitlisted' && g.members[0].from === 'offered');
    expect(back.map((g) => g.action).sort()).toEqual(['decline_offer', 'rescind_offer']);
  });

  it('does not merge the two submit branches — different targets', () => {
    const submits = model().groups.filter((g) => g.action === 'submit');
    expect(submits.map((g) => g.to).sort()).toEqual(['confirmed', 'waitlisted']);
  });

  it('records each member’s original declaration index', () => {
    const orders = model()
      .groups.flatMap((g) => g.members.map((m) => m.order))
      .sort((a, b) => a - b);
    expect(orders).toEqual(SIGNUP_MACHINE.transitions.map((_, i) => i));
  });

  it('accounts for every transition exactly once', () => {
    const ids = model().groups.flatMap((g) => g.members.map((m) => m.transition_id));
    expect(ids.sort()).toEqual(SIGNUP_MACHINE.transitions.map((t) => t.transition_id).sort());
  });
});

describe('readStageModel — object identity (F1)', () => {
  it('does not alias guards when there is no actor_role to split out', () => {
    // t_submit_waitlisted's only guard is `formComplete` — no actor_role —
    // so `splitActorRole` used to return `rest: guards`, the SAME array
    // object as `t.guards`. This is the read.ts:26 case, directly.
    const submitWaitlist = model().groups.find((g) => g.action === 'submit' && g.to === 'waitlisted');
    const sourceTransition = SIGNUP_MACHINE.transitions.find(
      (t) => t.transition_id === 't_submit_waitlisted',
    );
    expect(submitWaitlist).toBeDefined();
    expect(sourceTransition).toBeDefined();
    expect(submitWaitlist?.guards).not.toBe(sourceTransition?.guards);
    expect(submitWaitlist?.guards[0]).not.toBe(sourceTransition?.guards[0]);
    expect(submitWaitlist?.guards).toEqual(sourceTransition?.guards);
  });

  it('does not alias effects', () => {
    const dropConfirmed = model()
      .groups.filter((g) => g.action === 'drop')
      .find((g) => g.effects.length > 0);
    const sourceTransition = SIGNUP_MACHINE.transitions.find(
      (t) => t.transition_id === 't_drop_confirmed_family',
    );
    expect(dropConfirmed).toBeDefined();
    expect(sourceTransition).toBeDefined();
    expect(dropConfirmed?.effects).not.toBe(sourceTransition?.effects);
    expect(dropConfirmed?.effects[0]).not.toBe(sourceTransition?.effects[0]);
    expect(dropConfirmed?.effects).toEqual(sourceTransition?.effects);
  });

  it('mutating the returned model leaves the fixture unchanged', () => {
    const before = JSON.stringify(SIGNUP_MACHINE);
    const dropConfirmed = model()
      .groups.filter((g) => g.action === 'drop')
      .find((g) => g.effects.length > 0);
    expect(dropConfirmed).toBeDefined();
    dropConfirmed?.effects.push({ primitive: 'send_email', params: { template: 'hacked' } });
    if (dropConfirmed?.effects[0]) {
      dropConfirmed.effects[0].params.value = 'MUTATED';
    }
    expect(JSON.stringify(SIGNUP_MACHINE)).toBe(before);
  });

  it('does not alias roleGuard (F6)', () => {
    // t_drop_draft_family's only guard is the actor_role guard itself
    // (`guards: [familyRole]`) — absorbed whole into `roleGuard` by
    // read.ts's `cloneRef(roleGuard)` call.
    const sourceTransition = SIGNUP_MACHINE.transitions.find(
      (t) => t.transition_id === 't_drop_draft_family',
    );
    const member = model()
      .groups.flatMap((g) => g.members)
      .find((m) => m.transition_id === 't_drop_draft_family');
    expect(sourceTransition).toBeDefined();
    expect(member).toBeDefined();
    expect(member?.roleGuard).not.toBeNull();
    expect(member?.roleGuard).not.toBe(sourceTransition?.guards[0]);
    expect(member?.roleGuard).toEqual(sourceTransition?.guards[0]);
  });
});

describe('readStageModel — actor rectangle (F2)', () => {
  it('keeps the withdraw group whole — every source has both actors (enrollment)', () => {
    const m = readStageModel(ENROLLMENT_MACHINE, ENROLLMENT_STEPS);
    const withdraws = m.groups.filter((g) => g.action === 'withdraw');
    expect(withdraws).toHaveLength(1);
    expect(withdraws[0].members).toHaveLength(12);
    expect(withdraws[0].who).toBe('both');
  });

  it('keeps the drop groups whole at 6 and 2 members — every source has both actors (signup)', () => {
    const drops = model().groups.filter((g) => g.action === 'drop');
    expect(drops).toHaveLength(2);
    const sizes = drops.map((g) => g.members.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 6]);
    expect(drops.every((g) => g.who === 'both')).toBe(true);
  });

  it('does not merge a lone family transition with a lone staff transition from different stages', () => {
    const m = readStageModel(AB_QUIT_MACHINE, []);
    const quits = m.groups.filter((g) => g.action === 'quit');
    expect(quits).toHaveLength(2);
    expect(quits.every((g) => g.who !== 'both')).toBe(true);
    expect(quits.map((g) => g.who).sort()).toEqual(['family', 'staff']);
    expect(quits.every((g) => g.members.length === 1)).toBe(true);
  });
});

describe('readStageModel — split-sibling identity (F5)', () => {
  it('gives each split-off group its own guards/effects arrays, not shared with its sibling', () => {
    const quits = readStageModel(AB_QUIT_MACHINE, []).groups.filter((g) => g.action === 'quit');
    expect(quits).toHaveLength(2);
    const [g1, g2] = quits;
    expect(g1.guards).not.toBe(g2.guards);
    expect(g1.effects).not.toBe(g2.effects);
    expect(g1.guards[0]).not.toBe(g2.guards[0]);
    expect(g1.effects[0]).not.toBe(g2.effects[0]);
    // Same content — only identity differs.
    expect(g1.guards).toEqual(g2.guards);
    expect(g1.effects).toEqual(g2.effects);
  });

  it('mutating one split sibling leaves the other unchanged', () => {
    const [g1, g2] = readStageModel(AB_QUIT_MACHINE, []).groups.filter((g) => g.action === 'quit');
    const before = JSON.stringify(g2);
    g1.effects.push({ primitive: 'send_email', params: { template: 'hacked' } });
    g1.guards.push({ primitive: 'injected', params: {} });
    if (g1.effects[0]) g1.effects[0].params.template = 'MUTATED';
    expect(JSON.stringify(g2)).toBe(before);
  });
});

describe('isExitGroup', () => {
  it('treats a group landing on a non-finish terminal as an exit', () => {
    const m = model();
    const drops = m.groups.filter((g) => g.action === 'drop');
    expect(drops.every((g) => isExitGroup(g, m))).toBe(true);
  });

  it('does not treat the move onto the finish stage as an exit', () => {
    const m = model();
    const complete = m.groups.find((g) => g.action === 'complete_program');
    expect(complete && isExitGroup(complete, m)).toBe(false);
  });

  it('does not treat a backward move onto an active stage as an exit', () => {
    const m = model();
    const decline = m.groups.find((g) => g.action === 'decline_offer');
    expect(decline && isExitGroup(decline, m)).toBe(false);
  });
});
