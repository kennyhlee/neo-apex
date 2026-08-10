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

/** Members the editor created this session sort after everything read from
 * disk. `Number.MAX_SAFE_INTEGER` (not Infinity) so it survives
 * JSON.stringify in any debugging path. */
export const NEW_ORDER = Number.MAX_SAFE_INTEGER;

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
  const guards = member.roleGuard ? [member.roleGuard, ...group.guards] : [...group.guards];
  return {
    transition_id: member.transition_id,
    from: member.from,
    to: group.to,
    action: group.action,
    actor: member.actor,
    guards,
    effects: [...group.effects],
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
