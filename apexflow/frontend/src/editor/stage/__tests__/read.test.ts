import { describe, expect, it } from 'vitest';
import { isExitGroup, readStageModel } from '../read.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from './fixtures.ts';

const model = () => readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);

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
