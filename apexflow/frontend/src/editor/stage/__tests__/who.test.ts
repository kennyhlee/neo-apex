import { describe, expect, it } from 'vitest';
import { membersForWho, NEW_ORDER } from '../write.ts';
import { readStageModel } from '../read.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from './fixtures.ts';
import type { MoveGroup } from '../types.ts';

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
    // `drop`'s hand-authored ids (`t_drop_${from}_${actor}`, see fixtures.ts's
    // `dropPair`) happen to be byte-identical to the format `membersForWho`
    // mints for a brand-new member (`t_${action}_${from}_${actor}`) — so a
    // mutant that deletes the "reuse the existing member" branch and always
    // mints would still pass the assertion above for THIS fixture, by
    // coincidence, while a review round confirmed this exact vacuity. `order`
    // is the tell an id-shape assertion cannot fake: only a freshly minted
    // member carries `NEW_ORDER`, so this line catches what the id
    // comparison above cannot.
    expect(next.every((m) => m.order !== NEW_ORDER)).toBe(true);
  });

  it('narrowing to one actor keeps that actor’s existing rows', () => {
    const next = membersForWho(drop, 'staff');
    expect(next.every((m) => m.actor === 'staff')).toBe(true);
    expect(next.every((m) => m.transition_id.endsWith('_staff'))).toBe(true);
    // Same vacuity as above: `t_drop_${from}_staff` is what both the
    // fixture AND a from-scratch mint would produce. `order` is the
    // assertion that actually distinguishes "kept the existing row" from
    // "minted a new one that happens to look the same".
    expect(next.every((m) => m.order !== NEW_ORDER)).toBe(true);
  });

  it('a who change that changes nothing round-trips the machine untouched', () => {
    const unchanged = { ...model, groups: model.groups.map((g) => ({ ...g, members: membersForWho(g, g.who) })) };
    expect(unchanged.groups.flatMap((g) => g.members.map((m) => m.transition_id)).sort()).toEqual(
      SIGNUP_MACHINE.transitions.map((t) => t.transition_id).sort(),
    );
  });

  it('keeps a hand-authored admin-only actor_role guard on a no-op Who change', () => {
    // primitives.py documents `actor_role` as authorable with any role
    // list, not just the editor's own `{roles:['staff','admin']}`
    // convention. A no-op Who edit (re-picking the value already selected)
    // must not silently widen `{roles:['admin']}` to the editor's default —
    // that would be a real machine change hiding behind an unrelated click.
    const adminOnly = { primitive: 'actor_role', params: { roles: ['admin'] } };
    const group: MoveGroup = {
      key: 'k-admin-only',
      action: 'approve',
      to: 'approved',
      who: 'staff',
      guards: [],
      effects: [],
      members: [
        { transition_id: 't_approve', from: 'in_review', actor: 'staff', roleGuard: adminOnly, order: 0 },
      ],
    };
    const next = membersForWho(group, group.who);
    expect(next).toEqual(group.members);
    expect(next[0].roleGuard).toEqual(adminOnly);
  });
});
