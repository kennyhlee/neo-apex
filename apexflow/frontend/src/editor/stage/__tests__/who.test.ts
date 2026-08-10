import { describe, expect, it } from 'vitest';
import { membersForWho, membersForScope, NEW_ORDER, writeMachine } from '../write.ts';
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

  // The exact two-click sequence that used to mint a duplicate id: rename
  // one group's action to match another group's, then widen Who to "both".
  // Signup's `t_complete_program` leaves `confirmed` as staff; the `drop`
  // group also leaves `confirmed` (family + staff). Rename complete_program
  // to `drop` and widen it, and the deterministic
  // `t_${action}_${from}_${actor}` name it mints for the family row is
  // `t_drop_confirmed_family` — a transition_id the drop group already
  // holds. `transition_id` is machine-global, so that is two rows with one
  // id in the written machine.
  it('minting a member for an action that collides with another group does not reuse its transition_id', () => {
    const complete = model.groups.find((g) => g.action === 'complete_program')!;
    const renamed: MoveGroup = { ...complete, action: 'drop' };
    const widened: MoveGroup = { ...renamed, who: 'both', members: membersForWho(renamed, 'both') };
    const model2 = {
      ...model,
      groups: model.groups.map((g) => (g.key === complete.key ? widened : g)),
    };
    const ids = writeMachine(model2).transitions.map((t) => t.transition_id);
    expect(ids).toHaveLength(new Set(ids).size);
    // And specifically: the minted family row did NOT land on the drop
    // group's existing id.
    const minted = widened.members.find((m) => m.actor === 'family')!;
    expect(minted.transition_id).not.toBe('t_drop_confirmed_family');
    expect(minted.transition_id.startsWith('t_drop_confirmed_family_')).toBe(true);
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

describe('membersForScope', () => {
  it('re-scoping to the same stages changes nothing', () => {
    const same = membersForScope(drop, [...new Set(drop.members.map((m) => m.from))]);
    expect(same).toEqual(drop.members);
  });

  // Same hazard as `membersForWho`'s collision test above, reached through
  // the Exits panel's scope checkboxes instead: tick a stage into a group
  // whose action matches a DIFFERENT group that already leaves that stage.
  it('scoping a group into a stage another group already leaves under the same action mints a distinct id', () => {
    const complete = model.groups.find((g) => g.action === 'complete_program')!;
    // `complete_program` leaves `confirmed`; `drop` leaves confirmed, draft,
    // waitlisted and offered. Rename it to `drop` and scope it onto `draft`,
    // where `t_drop_draft_staff` already exists.
    const renamed: MoveGroup = { ...complete, action: 'drop' };
    const scoped: MoveGroup = {
      ...renamed,
      members: membersForScope(renamed, ['confirmed', 'draft']),
    };
    const model2 = {
      ...model,
      groups: model.groups.map((g) => (g.key === complete.key ? scoped : g)),
    };
    const ids = writeMachine(model2).transitions.map((t) => t.transition_id);
    expect(ids).toHaveLength(new Set(ids).size);
    const minted = scoped.members.find((m) => m.from === 'draft')!;
    expect(minted.transition_id).not.toBe('t_drop_draft_staff');
    expect(minted.transition_id.startsWith('t_drop_draft_staff_')).toBe(true);
  });

  it('adding a stage adds one member per actor and touches nothing else', () => {
    const froms = [...new Set(drop.members.map((m) => m.from))];
    const next = membersForScope(drop, [...froms, 'completed']);
    expect(next).toHaveLength(drop.members.length + 2);
    const added = next.filter((m) => m.from === 'completed');
    expect(added.map((m) => m.actor).sort()).toEqual(['family', 'staff']);
    expect(next.filter((m) => m.from !== 'completed')).toEqual(drop.members);
  });

  it('removing a stage removes exactly its members', () => {
    const froms = [...new Set(drop.members.map((m) => m.from))].filter((f) => f !== 'draft');
    const next = membersForScope(drop, froms);
    expect(next.some((m) => m.from === 'draft')).toBe(false);
    expect(next).toHaveLength(drop.members.length - 2);
  });

  it('keeps a hand-authored admin-only actor_role guard on a no-op re-scope', () => {
    // Same rationale as membersForWho's twin test above: `actor_role` is
    // authorable with any role list, not just the editor's own
    // `{roles:['staff','admin']}` convention. Re-scoping to the SAME stages
    // (the "untick then re-tick" no-op, or any scope edit that doesn't touch
    // this particular stage) must not silently widen a hand-authored
    // `{roles:['admin']}` to the editor's default — that would be a real
    // machine change hiding behind an unrelated scope click. `drop`'s
    // fixture members only ever carry the standard family/staff guards, so
    // this needs its own hand-built group to be able to see the difference
    // at all.
    const adminOnly = { primitive: 'actor_role', params: { roles: ['admin'] } };
    const group: MoveGroup = {
      key: 'k-admin-only-scope',
      action: 'approve',
      to: 'approved',
      who: 'staff',
      guards: [],
      effects: [],
      members: [
        {
          transition_id: 't_approve_in_review_staff',
          from: 'in_review',
          actor: 'staff',
          roleGuard: adminOnly,
          order: 0,
        },
      ],
    };
    const next = membersForScope(group, ['in_review']);
    expect(next).toEqual(group.members);
    expect(next[0].roleGuard).toEqual(adminOnly);
  });

  it('untick then re-tick restores the original machine, re-minting only the re-added ids', () => {
    const froms = [...new Set(drop.members.map((m) => m.from))];
    const shrunk = { ...drop, members: membersForScope(drop, froms.filter((f) => f !== 'draft')) };
    const restored = { ...shrunk, members: membersForScope(shrunk, froms) };
    const model2 = { ...model, groups: model.groups.map((g) => (g.key === drop.key ? restored : g)) };
    const out = writeMachine(model2);

    expect(out.transitions).toHaveLength(SIGNUP_MACHINE.transitions.length);

    // Every transition the untick never touched keeps its id AND its content
    // byte-for-byte. That is the property this test has always been for: a
    // scope edit must not renumber or rewrite its neighbours.
    const reAdded = ['t_drop_draft_family', 't_drop_draft_staff'];
    for (const before of SIGNUP_MACHINE.transitions) {
      if (reAdded.includes(before.transition_id)) continue;
      expect(out.transitions.find((t) => t.transition_id === before.transition_id)).toEqual(before);
    }

    // The two re-added ones are genuinely NEW transitions — the untick
    // deleted the originals — so `membersForScope` mints fresh, suffixed
    // ids for them rather than reusing a deterministic name that a
    // hand-authored or same-action transition elsewhere may already hold.
    // Everything about them except the id must still match the original.
    for (const id of reAdded) {
      const before = SIGNUP_MACHINE.transitions.find((t) => t.transition_id === id)!;
      const after = out.transitions.find((t) => t.transition_id.startsWith(`${id}_`));
      expect({ id, found: after !== undefined }).toEqual({ id, found: true });
      expect(after!.transition_id).not.toBe(id);
      expect({ ...after!, transition_id: id }).toEqual(before);
    }
  });
});
