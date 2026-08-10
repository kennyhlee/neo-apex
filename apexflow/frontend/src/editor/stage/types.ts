// The stage model — a lossless view of `workflow_definition.machine` in the
// vocabulary a registrar uses. Nothing here is stored; every field maps back
// onto a `MachineDef` (see ./write.ts).
//
// The load-bearing idea is `MoveMember`: a group remembers the exact
// transitions it was read from, including their declaration order and the
// `actor_role` guard that was folded into `who`. That is what makes
// round-tripping possible — the write path reproduces an untouched
// transition rather than re-deriving it.
import type { EffectRef, GuardRef, StateDef, TransitionDef } from '../../types/designer.ts';

/**
 * "Who can do it". `'both'` means a family/staff PAIR of transitions —
 * `TransitionDef.actor` is single-valued, so "a family or staff member may
 * withdraw" is two rows in the machine and one control in the editor.
 * `'automatic'` maps to `actor: 'system'`.
 */
export type Who = 'family' | 'staff' | 'both' | 'automatic';

/**
 * One authored transition, remembered as it was read.
 *
 * `roleGuard` is the `actor_role` guard that was absorbed into the group's
 * `who`, or `null` if the transition carried none. It must be re-emitted
 * verbatim: adding an `actor_role` guard to a transition that was authored
 * WITHOUT one turns a structurally-unguarded transition into a guarded one,
 * which changes how `validate.py`'s `_unguarded_branch_errors` reads its
 * whole `(from, action)` group.
 *
 * `order` is the transition's index in the original `machine.transitions`
 * array. `_unguarded_branch_errors` requires an unguarded transition to be
 * declared LAST within its `(from, action)` group, so order is semantic,
 * not cosmetic.
 */
export interface MoveMember {
  transition_id: string;
  from: string;
  actor: TransitionDef['actor'];
  roleGuard: GuardRef | null;
  order: number;
}

/**
 * A set of transitions identical apart from their source stage — the
 * grouping key is `(action, to, who, guards, effects)`, i.e. everything
 * except `from` (design ruling, Amendment B).
 *
 * Keying on `(action, to)` alone is not enough and this is measured, not
 * theoretical: signup's eight `drop` transitions all share an action and a
 * target, but only the one leaving `confirmed` may carry
 * `set_entity_field{ref: "enrollment", field: "status", value: "Withdrawn"}`
 * — the other three stages have no committed enrollment row and
 * `_effect_set_entity_field` raises 409. Under the looser key they collapse
 * into one card that cannot represent both shapes, and the round-trip fails.
 */
export interface MoveGroup {
  /** Stable within one read. Not persisted; used as a React key and for
   * lookups between the panel and the model. */
  key: string;
  action: string;
  to: string;
  who: Who;
  /** Guards with the absorbed `actor_role` removed. */
  guards: GuardRef[];
  effects: EffectRef[];
  /** One per (from, actor) pair. Never empty. */
  members: MoveMember[];
}

export interface Stage {
  stage_id: string;
  name: string;
  /** Still written to the machine, still never picked by the author. */
  kind: StateDef['kind'];
  /** Shortest-path distance from the initial stage. Drives spine order. */
  depth: number;
  /** Index in the original `machine.states` array. `stages` is sorted into
   * spine order for display, which need not match declaration order; this
   * lets `writeMachine` write `states` back in the order the machine
   * declared them, rather than in spine order. */
  declaredIndex: number;
  /** Steps whose `available_in` contains this stage, in definition order. */
  step_ids: string[];
}

export interface StageModel {
  /** Spine order: by depth, then original declaration order. */
  stages: Stage[];
  groups: MoveGroup[];
  /** The terminal stage forward progress ends at, or `null` if the machine
   * has no terminal stage. Presentational only — see `isExitGroup`. */
  finishStageId: string | null;
}
