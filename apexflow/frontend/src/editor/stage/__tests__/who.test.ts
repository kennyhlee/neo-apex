import { describe, expect, it } from 'vitest';
import { membersForWho } from '../write.ts';
import { readStageModel } from '../read.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from './fixtures.ts';

const model = readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);
const offerSpot = model.groups.find((g) => g.action === 'offer_spot')!;
const drop = model.groups.find((g) => g.action === 'drop')!;

describe('membersForWho', () => {
  it('does not add an actor_role guard to a group that never had one', () => {
    const next = membersForWho(offerSpot, 'family');
    expect(next).toHaveLength(1);
    expect(next[0].roleGuard).toBeNull();
    expect(next[0].actor).toBe('family');
  });

  it('adds the pair’s actor_role guards when widening to both', () => {
    const next = membersForWho(offerSpot, 'both');
    expect(next.map((m) => m.actor).sort()).toEqual(['family', 'staff']);
    expect(next.map((m) => m.roleGuard?.params)).toEqual(
      expect.arrayContaining([{ roles: ['family'] }, { roles: ['staff', 'admin'] }]),
    );
  });

  it('preserves the existing transition_id when the actor is unchanged', () => {
    const next = membersForWho(drop, 'both');
    expect(next.map((m) => m.transition_id).sort()).toEqual(
      drop.members.map((m) => m.transition_id).sort(),
    );
  });

  it('narrowing to one actor keeps that actor’s existing rows', () => {
    const next = membersForWho(drop, 'staff');
    expect(next.every((m) => m.actor === 'staff')).toBe(true);
    expect(next.every((m) => m.transition_id.endsWith('_staff'))).toBe(true);
  });

  it('a who change that changes nothing round-trips the machine untouched', () => {
    const unchanged = { ...model, groups: model.groups.map((g) => ({ ...g, members: membersForWho(g, g.who) })) };
    expect(unchanged.groups.flatMap((g) => g.members.map((m) => m.transition_id)).sort()).toEqual(
      SIGNUP_MACHINE.transitions.map((t) => t.transition_id).sort(),
    );
  });
});
