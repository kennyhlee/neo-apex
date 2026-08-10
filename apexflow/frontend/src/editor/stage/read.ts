// machine + steps -> StageModel. Pure; no React, no fetch.
//
// Grouping key: (action, to, actor class, guards-without-actor_role,
// effects) — everything except `from` (design ruling, Amendment B). Two
// transitions join a group only when they are indistinguishable apart from
// where they leave from, which is exactly the condition under which one
// Exits-panel card can faithfully re-emit both.
//
// "Actor class" folds `family`/`staff` to `'human'` and leaves `system` on
// its own — see `groupKey`'s doc comment for why that is coarser than it
// sounds, and `isRectangle`/`splitByActor` below for the pass that corrects
// for it.
import type { GuardRef, MachineDef, TransitionDef, WorkflowStepDef } from '../../types/designer.ts';
import type { MoveGroup, MoveMember, Stage, StageModel, Who } from './types.ts';
import { finishStageId, orderStages } from './spine.ts';

/** Stable, order-insensitive-per-key JSON for use in a grouping key. Params
 * are authored objects whose key order is whatever the backend serialized;
 * two params dicts with the same content must produce the same key. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** Structural deep copy for `GuardRef`/`EffectRef` values headed into the
 * returned model. `GuardRef`/`EffectRef` are plain JSON wire objects by
 * construction (`schema.py`), so `JSON.parse(JSON.stringify(...))` is exact
 * and cheap. Without this, `readStageModel`'s output shares object identity
 * with `machine`'s: Task 4's round-trip test would then pass trivially on
 * the aliased fields instead of actually comparing values, and an editor
 * task doing `group.effects.push(...)` in place would silently mutate the
 * definition the model was read from. */
function cloneRef<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitActorRole(guards: GuardRef[]): { roleGuard: GuardRef | null; rest: GuardRef[] } {
  const idx = guards.findIndex((g) => g.primitive === 'actor_role');
  if (idx === -1) return { roleGuard: null, rest: guards };
  return {
    roleGuard: guards[idx],
    // Only the FIRST actor_role is absorbed. A transition carrying two is
    // pathological; the second stays in `rest` and renders as an ordinary
    // guard rather than being dropped.
    rest: [...guards.slice(0, idx), ...guards.slice(idx + 1)],
  };
}

function whoForActor(actor: TransitionDef['actor']): Who {
  return actor === 'system' ? 'automatic' : actor;
}

/** Two members merge into `who: 'both'` only when BOTH a family and a staff
 * actor are present in the group. `groupKey` only folds `family`/`staff`
 * down to `'human'`, so at this point a mixed set always means exactly
 * `{family, staff}` — a group's actor class can never mix `human` and
 * `system` members, since `groupKey` keys those two classes apart. Whether
 * that mixed set is a COMPLETE family/staff pair per source stage (and
 * therefore may safely stay one group) is a separate question, checked
 * after grouping by `isRectangle` — this function only folds the actor set
 * itself. */
function foldWho(members: MoveMember[]): Who {
  const actors = new Set(members.map((m) => m.actor));
  if (actors.size === 1) return whoForActor(members[0].actor);
  return 'both';
}

/**
 * The grouping key. Note what is IN it, and what is deliberately coarse:
 * the actor is folded only to `'human'` vs `'system'`, NOT to "a complete
 * family+staff pair or not". That means a LONE family transition from one
 * stage and a LONE staff transition from a different stage — sharing
 * everything else — DO share a key at this stage, exactly the shape
 * `_drop_pair`/`_withdraw_pair` rely on when both members leave the SAME
 * stage.
 *
 * That coarseness is corrected after grouping, not here: `isRectangle`
 * checks whether every source stage in the resulting group has both a
 * family and a staff member, and `splitByActor` breaks the group apart when
 * it doesn't — see `readStageModel`. Folding the actor any more precisely
 * INTO the key (e.g. by `from`) would defeat the point of grouping at all,
 * since `from` is exactly the field two transitions are allowed to differ
 * on.
 */
function groupKey(t: TransitionDef, rest: GuardRef[]): string {
  const actorClass = t.actor === 'system' ? 'system' : 'human';
  // `action`/`to` are unconstrained strings server-side (schema.py); a
  // delimiter-joined key would let an author-typed value containing the
  // delimiter merge two groups that should stay distinct. JSON.stringify
  // over the parts array escapes each part, so no part's content can bleed
  // into a neighboring part's slot.
  return JSON.stringify([t.action, t.to, actorClass, stableJson(rest), stableJson(t.effects)]);
}

/**
 * A group may keep `who: 'both'` only if every distinct `from` among its
 * members has BOTH a family member and a staff member — the exact shape
 * `_drop_pair`/`_withdraw_pair` emit. A group with only one actor overall
 * (including every `system` group) trivially satisfies this.
 */
function isRectangle(members: MoveMember[]): boolean {
  const actors = new Set(members.map((m) => m.actor));
  if (actors.size < 2) return true;
  const byFrom = new Map<string, Set<TransitionDef['actor']>>();
  for (const m of members) {
    const set = byFrom.get(m.from) ?? new Set<TransitionDef['actor']>();
    set.add(m.actor);
    byFrom.set(m.from, set);
  }
  for (const set of byFrom.values()) {
    if (!(set.has('family') && set.has('staff'))) return false;
  }
  return true;
}

/**
 * Splits a group that failed `isRectangle` into one group per actor. This
 * is what stops a lone family transition from one stage and a lone staff
 * transition from another — which shared a `groupKey` deliberately, see
 * above — from being reported as one `who: 'both'` control. Tasks 8/9
 * expand a `'both'` group by cross-producting its source stages with BOTH
 * actors; doing that to a non-rectangular group would invent transitions
 * that were never authored.
 *
 * Each sibling gets its OWN `guards`/`effects` arrays (`cloneRef`, not the
 * source group's arrays by reference): a shallow `{...group}` spread would
 * leave every sibling pointing at the same array objects, so an in-place
 * `group.effects.push(...)` on one sibling (Tasks 6-9 edit `MoveGroup`s in
 * place) would silently mutate every other sibling too. `cloneRef` already
 * broke the alias to `machine`'s objects (see its doc comment); this reuses
 * it to also break the alias BETWEEN siblings, which is a distinct hazard
 * `cloneRef`'s original call sites don't touch — this function is the only
 * place one `MoveGroup`'s fields are copied into more than one output
 * `MoveGroup`.
 */
function splitByActor(group: MoveGroup): MoveGroup[] {
  const byActor = new Map<TransitionDef['actor'], MoveMember[]>();
  for (const m of group.members) {
    const list = byActor.get(m.actor) ?? [];
    list.push(m);
    byActor.set(m.actor, list);
  }
  return [...byActor.entries()].map(([actor, members]) => ({
    ...group,
    key: `${group.key}#${actor}`,
    who: whoForActor(actor),
    guards: group.guards.map(cloneRef),
    effects: group.effects.map(cloneRef),
    members,
  }));
}

export function readStageModel(machine: MachineDef, steps: WorkflowStepDef[]): StageModel {
  const { ordered, depths } = orderStages(machine);

  const stages: Stage[] = ordered.map((state) => ({
    stage_id: state.state_id,
    name: state.name,
    kind: state.kind,
    depth: depths[state.state_id],
    step_ids: steps
      .filter((step) => step.available_in.includes(state.state_id))
      .map((step) => step.step_id),
  }));

  const byKey = new Map<string, MoveGroup>();
  machine.transitions.forEach((t, order) => {
    const { roleGuard, rest } = splitActorRole(t.guards);
    const key = groupKey(t, rest);
    const member: MoveMember = {
      transition_id: t.transition_id,
      from: t.from,
      actor: t.actor,
      roleGuard: roleGuard ? cloneRef(roleGuard) : null,
      order,
    };
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push(member);
      existing.who = foldWho(existing.members);
      return;
    }
    byKey.set(key, {
      key,
      action: t.action,
      to: t.to,
      who: whoForActor(t.actor),
      // Deep-copied so the returned model shares no object identity with
      // `machine` — see `cloneRef`'s doc comment.
      guards: rest.map(cloneRef),
      effects: t.effects.map(cloneRef),
      members: [member],
    });
  });

  // Correct `groupKey`'s deliberate coarseness: a group only keeps
  // `who: 'both'` if it is a complete family/staff rectangle. Anything else
  // splits into one group per actor.
  const resolved = [...byKey.values()].flatMap((g) => (isRectangle(g.members) ? [g] : splitByActor(g)));

  // Groups in first-member declaration order, so the panels read in the same
  // order the machine declares.
  const groups = resolved.sort(
    (a, b) => Math.min(...a.members.map((m) => m.order)) - Math.min(...b.members.map((m) => m.order)),
  );

  return { stages, groups, finishStageId: finishStageId(machine) };
}

/**
 * An exit is a group landing on a TERMINAL stage that is not the finish.
 *
 * Purely presentational: it decides whether a group renders in the Exits
 * panel or as a move on its stage. Both surfaces edit the same `MoveGroup`
 * and both write back through `writeMachine`, so getting this wrong makes
 * the editor less readable, never incorrect.
 */
export function isExitGroup(group: MoveGroup, model: StageModel): boolean {
  const target = model.stages.find((s) => s.stage_id === group.to);
  if (!target || target.kind !== 'terminal') return false;
  return target.stage_id !== model.finishStageId;
}
