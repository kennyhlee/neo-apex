// StageModel -> machine.
//
// The contract this file exists to keep: a group that was READ and not
// edited must be written back exactly as it was found. That is why members
// carry `transition_id`, `actor`, `roleGuard`, and `order` — the write path
// reproduces those rather than re-deriving them from `group.who`, which
// would silently normalise a hand-authored machine on first save.
//
// Declaration order is semantic, not cosmetic: `validate.py`'s
// `_unguarded_branch_errors` requires an unguarded transition to be declared
// LAST within its (from, action) group. Members keep their original `order`;
// anything the editor added carries `order: NEW_ORDER` and lands after every
// pre-existing transition.
import type { GuardRef, MachineDef, StateDef, TransitionDef } from '../../types/designer.ts';
import type { MoveGroup, MoveMember, StageModel, Who } from './types.ts';
import { cloneRef } from './clone.ts';

/**
 * Members the editor created this session sort after everything read from
 * disk. `Number.MAX_SAFE_INTEGER` (not Infinity) so it survives
 * JSON.stringify in any debugging path.
 *
 * What this DOES guarantee: a new member's transition is declared after
 * every pre-existing transition, full stop.
 *
 * What this does NOT guarantee: that the result satisfies
 * `_unguarded_branch_errors`. That rule requires the UNGUARDED transition in
 * a `(from, action)` group to be declared last. Sorting new members last is
 * sufficient only when the new member is itself unguarded, or when the
 * target `(from, action)` group has no unguarded member at all. It is
 * insufficient the moment those two things are both false — concretely: if
 * an existing unguarded transition is in the group and the editor adds a
 * GUARDED sibling to it, `NEW_ORDER` puts the new, guarded transition after
 * the old, unguarded one, which is exactly backwards. Signup's shipped
 * `(offered, decline_offer)` group is real data with this shape today: one
 * transition, `t_decline_offer`, with `guards: []`, legal precisely because
 * it is declared last (and only) in its group. Add a guarded
 * `decline_offer` from `offered` and publish would fail with "unguarded
 * transition 't_decline_offer' ... must be declared last among its group".
 *
 * `writeMachine` does not defend against this: it writes what the model
 * says, nothing more. Producing a valid ORDER for a mixed guarded/unguarded
 * group is the editor's job (validation/UI), not this translation layer's —
 * see `write.test.ts`'s "NEW_ORDER hazard" test, which pins today's
 * write-what-you're-given behaviour rather than leaving this undiscovered.
 */
export const NEW_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * Stages the editor creates this session sort after every pre-existing
 * stage, mirroring `NEW_ORDER`'s convention for `MoveMember.order`.
 * `Array.prototype.sort` is a stable sort, so several new stages — all
 * carrying this same value — keep their relative insertion order instead of
 * being scrambled against each other; they just all land after every
 * pre-existing `declaredIndex`.
 */
export const NEW_STAGE_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * The `actor_role` guard a given actor gets when the editor CREATES a
 * transition. Matches what both shipped templates author
 * (`_withdraw_pair`, `_drop_pair`) exactly, so an exit added in the editor
 * is indistinguishable from one written by hand.
 *
 * Only ever called for a NEW member, or when the author changes "Who can do
 * it" on a member that already had a roleGuard. A member read with
 * `roleGuard: null` keeps null — see this module's contract.
 */
export function roleGuardFor(actor: TransitionDef['actor']): GuardRef {
  if (actor === 'family') return { primitive: 'actor_role', params: { roles: ['family'] } };
  return { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } };
}

/** The actors a `who` expands to. `'both'` is the family/staff pair. */
export function actorsFor(who: Who): TransitionDef['actor'][] {
  if (who === 'both') return ['family', 'staff'];
  if (who === 'automatic') return ['system'];
  return [who];
}

function memberToTransition(group: MoveGroup, member: MoveMember): TransitionDef {
  // Re-insert the absorbed actor_role guard at position 0, which is where
  // both shipped templates put it and where `splitActorRole` found it.
  //
  // Every guard/effect is `cloneRef`d, not just the array that holds them:
  // the returned transition must share no object identity with the live
  // `MoveGroup`/`MoveMember`. Without this, an emitted transition's
  // `guards`/`effects` elements are the SAME objects the model still owns —
  // an in-place edit after a save (e.g. `group.effects[0].params.x = ...`)
  // would silently mutate the machine that was just written, and for a
  // split `_withdraw_pair`/`_drop_pair` sibling it would mutate the sibling
  // too. `toEqual`-based tests cannot see this; see `write.test.ts`'s
  // element-identity test.
  const guards = member.roleGuard
    ? [cloneRef(member.roleGuard), ...group.guards.map(cloneRef)]
    : group.guards.map(cloneRef);
  return {
    transition_id: member.transition_id,
    from: member.from,
    to: group.to,
    action: group.action,
    actor: member.actor,
    guards,
    effects: group.effects.map(cloneRef),
  };
}

export function writeMachine(model: StageModel): MachineDef {
  const states: StateDef[] = [...model.stages]
    .sort((a, b) => a.declaredIndex - b.declaredIndex)
    .map((stage) => ({
      state_id: stage.stage_id,
      name: stage.name,
      kind: stage.kind,
    }));

  const rows: { order: number; seq: number; transition: TransitionDef }[] = [];
  let seq = 0;
  for (const group of model.groups) {
    for (const member of group.members) {
      rows.push({ order: member.order, seq: seq++, transition: memberToTransition(group, member) });
    }
  }
  rows.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.seq - b.seq));

  return { states, transitions: rows.map((r) => r.transition) };
}
