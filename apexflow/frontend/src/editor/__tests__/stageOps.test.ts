import { describe, expect, it } from 'vitest';
import { isExitGroup, readStageModel } from '../stage/read.ts';
import { NEW_ORDER, NEW_STAGE_INDEX, roleGuardFor, writeMachine } from '../stage/write.ts';
import { addExit, addMove, addStage, canAddExit, newStage, removeStage } from '../stageOps.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from '../stage/__tests__/fixtures.ts';
import type { Stage, StageModel } from '../stage/types.ts';

const model = () => readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);

/** All member transition ids in a model, sorted for order-insensitive compares. */
function transitionIds(m: StageModel): string[] {
  return m.groups.flatMap((g) => g.members.map((mm) => mm.transition_id)).sort();
}

function stage(stage_id: string, kind: Stage['kind']): Stage {
  return { stage_id, name: stage_id, kind, depth: 0, declaredIndex: 0, step_ids: [] };
}

// ---------------------------------------------------------------------------
// newStage — the cadd3b8 rule, verbatim.
// ---------------------------------------------------------------------------
describe('newStage', () => {
  it('is initial for an empty machine', () => {
    expect(newStage([]).kind).toBe('initial');
  });

  it('is terminal when an initial stage exists but no terminal does', () => {
    expect(newStage([stage('draft', 'initial')]).kind).toBe('terminal');
  });

  it('is active when both an initial and a terminal already exist', () => {
    expect(newStage([stage('draft', 'initial'), stage('done', 'terminal')]).kind).toBe('active');
  });

  it('mints a fresh, unique stage_id, an empty name, and no steps', () => {
    const a = newStage([]);
    const b = newStage([]);
    expect(a.stage_id).not.toBe(b.stage_id);
    expect(a.name).toBe('');
    expect(a.step_ids).toEqual([]);
    expect(a.declaredIndex).toBe(NEW_STAGE_INDEX);
  });
});

// ---------------------------------------------------------------------------
// addStage
// ---------------------------------------------------------------------------
describe('addStage', () => {
  it('leaves every existing stage and every group untouched, and appends one new stage carrying NEW_STAGE_INDEX', () => {
    const before = model();
    const after = addStage(before);
    expect(after.stages.slice(0, before.stages.length)).toEqual(before.stages);
    expect(after.groups).toEqual(before.groups);
    expect(after.stages).toHaveLength(before.stages.length + 1);
    const added = after.stages[after.stages.length - 1];
    expect(added.declaredIndex).toBe(NEW_STAGE_INDEX);
    // Signup already has both an initial and a terminal stage, so the new
    // stage fills neither missing role — it is 'active'.
    expect(added.kind).toBe('active');
  });

  it('round-trips: writeMachine + readStageModel sees the same transitions, plus the new stage', () => {
    const before = model();
    const after = addStage(before);
    const reread = readStageModel(writeMachine(after), SIGNUP_STEPS);
    expect(transitionIds(reread)).toEqual(transitionIds(before));
    expect(reread.stages).toHaveLength(before.stages.length + 1);
  });
});

// ---------------------------------------------------------------------------
// removeStage
// ---------------------------------------------------------------------------
describe('removeStage — signup "offered"', () => {
  const before = model();
  const { model: after, steps: afterSteps } = removeStage(before, 'offered', SIGNUP_STEPS);
  const idsAfter = new Set(transitionIds(after));

  it('removes the stage itself', () => {
    expect(after.stages.some((s) => s.stage_id === 'offered')).toBe(false);
  });

  it('removes the group targeting it (t_offer_spot)', () => {
    expect(idsAfter.has('t_offer_spot')).toBe(false);
  });

  it('removes every group leaving it (accept/decline/rescind offer, and the offered drop pair)', () => {
    expect(idsAfter.has('t_accept_offer')).toBe(false);
    expect(idsAfter.has('t_decline_offer')).toBe(false);
    expect(idsAfter.has('t_rescind_offer')).toBe(false);
    expect(idsAfter.has('t_drop_offered_family')).toBe(false);
    expect(idsAfter.has('t_drop_offered_staff')).toBe(false);
  });

  it('leaves every other transition byte-identical', () => {
    const removed = new Set([
      't_offer_spot',
      't_accept_offer',
      't_decline_offer',
      't_rescind_offer',
      't_drop_offered_family',
      't_drop_offered_staff',
    ]);
    const survivingBefore = SIGNUP_MACHINE.transitions.filter((t) => !removed.has(t.transition_id));
    const writtenAfter = writeMachine(after).transitions;
    for (const original of survivingBefore) {
      expect(writtenAfter.find((t) => t.transition_id === original.transition_id)).toEqual(original);
    }
    expect(writtenAfter).toHaveLength(survivingBefore.length);
  });

  it('strips the stage from every step\'s available_in, keeping the step', () => {
    const offerNotice = afterSteps.find((s) => s.step_id === 'offer_notice');
    expect(offerNotice).toBeDefined();
    expect(offerNotice?.available_in).toEqual([]);
    // No step anywhere still names the removed stage.
    expect(afterSteps.some((s) => s.available_in.includes('offered'))).toBe(false);
    // Same step count — steps are stripped, never deleted.
    expect(afterSteps).toHaveLength(SIGNUP_STEPS.length);
  });

  it('round-trips: the surviving transition ids match exactly', () => {
    const reread = readStageModel(writeMachine(after), afterSteps);
    const expected = transitionIds(before).filter(
      (id) =>
        ![
          't_offer_spot',
          't_accept_offer',
          't_decline_offer',
          't_rescind_offer',
          't_drop_offered_family',
          't_drop_offered_staff',
        ].includes(id),
    );
    expect(transitionIds(reread)).toEqual(expected);
  });
});

describe('removeStage — group survival', () => {
  it('drops a group entirely when it loses its last member (confirmed drop pair, 2 members)', () => {
    const before = model();
    const confirmedDrop = before.groups.find(
      (g) => g.action === 'drop' && g.members.every((m) => m.from === 'confirmed'),
    );
    expect(confirmedDrop).toBeDefined();
    expect(confirmedDrop?.members).toHaveLength(2);

    const { model: after } = removeStage(before, 'confirmed', SIGNUP_STEPS);
    expect(after.groups.some((g) => g.key === confirmedDrop?.key)).toBe(false);
  });

  it('keeps a group that still has members from other stages (the six-member drop group)', () => {
    const before = model();
    const sixMemberDrop = before.groups.find(
      (g) => g.action === 'drop' && g.members.length === 6,
    );
    expect(sixMemberDrop).toBeDefined();

    const { model: after } = removeStage(before, 'draft', SIGNUP_STEPS);
    const survivor = after.groups.find((g) => g.key === sixMemberDrop?.key);
    expect(survivor).toBeDefined();
    // Loses draft's 2 members (family/staff), keeps waitlisted's and offered's.
    expect(survivor?.members).toHaveLength(4);
    expect(survivor?.members.every((m) => m.from !== 'draft')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addMove
// ---------------------------------------------------------------------------
describe('addMove', () => {
  it('produces a single unguarded, order-last member for the source stage', () => {
    const before = model();
    const after = addMove(before, 'confirmed');
    const added = after.groups[after.groups.length - 1];
    expect(added.members).toHaveLength(1);
    expect(added.members[0].order).toBe(NEW_ORDER);
    expect(added.members[0].roleGuard).toBeNull();
    expect(added.members[0].from).toBe('confirmed');
    expect(added.who).toBe('staff');
  });

  it("its action does not equal any existing action leaving that stage", () => {
    const before = model();
    const after = addMove(before, 'confirmed');
    const added = after.groups[after.groups.length - 1];
    const existingActions = before.groups
      .filter((g) => g.members.some((m) => m.from === 'confirmed'))
      .map((g) => g.action);
    expect(existingActions).not.toContain(added.action);
  });

  it('increments past a colliding default action name', () => {
    const before: StageModel = {
      stages: [stage('a', 'initial'), stage('b', 'terminal')],
      finishStageId: 'b',
      groups: [
        {
          key: 'k',
          action: 'move',
          to: 'b',
          who: 'staff',
          guards: [],
          effects: [],
          members: [{ transition_id: 't1', from: 'a', actor: 'staff', roleGuard: null, order: 0 }],
        },
      ],
    };
    const after = addMove(before, 'a');
    const added = after.groups[after.groups.length - 1];
    expect(added.action).not.toBe('move');
    expect(added.action).toBe('move_2');
  });

  it('defaults the target to the next stage in model order after the source', () => {
    const before = model();
    // Signup's spine order is draft, waitlisted, confirmed, offered,
    // completed, dropped (see read.test.ts) — the stage after 'draft' is
    // 'waitlisted'.
    const after = addMove(before, 'draft');
    const added = after.groups[after.groups.length - 1];
    expect(added.to).toBe('waitlisted');
  });

  it('defaults the target to the finish stage when the source is last in model order', () => {
    const before = model();
    const last = before.stages[before.stages.length - 1];
    const after = addMove(before, last.stage_id);
    const added = after.groups[after.groups.length - 1];
    expect(added.to).toBe(before.finishStageId);
  });

  it('round-trips: writeMachine + readStageModel adds exactly one transition id', () => {
    const before = model();
    const after = addMove(before, 'confirmed');
    const reread = readStageModel(writeMachine(after), SIGNUP_STEPS);
    const added = after.groups[after.groups.length - 1];
    expect(transitionIds(reread)).toEqual(
      [...transitionIds(before), added.members[0].transition_id].sort(),
    );
  });

  it('two successive calls on the same stage produce distinct transition ids', () => {
    // `transition_id` is machine-global, but uniqueness of the DEFAULT
    // action name is only scoped to (from, action) — a second `addMove` on
    // the same stage picks a different action ('move', then 'move_2'), but
    // the id must not collide even where the action alone would not be
    // enough to guarantee that (e.g. a hand-authored transition already
    // named `t_move_<stage>_staff` under a different action).
    const before = model();
    const once = addMove(before, 'confirmed');
    const twice = addMove(once, 'confirmed');
    const firstId = once.groups[once.groups.length - 1].members[0].transition_id;
    const secondId = twice.groups[twice.groups.length - 1].members[0].transition_id;
    expect(firstId).not.toBe(secondId);
  });
});

// ---------------------------------------------------------------------------
// addExit / canAddExit
// ---------------------------------------------------------------------------
describe('canAddExit', () => {
  it('is true for signup (dropped is a non-finish terminal)', () => {
    expect(canAddExit(model())).toBe(true);
  });

  it('is false for a model whose only terminal stage is the finish', () => {
    const only: StageModel = {
      stages: [stage('a', 'initial'), stage('b', 'terminal')],
      finishStageId: 'b',
      groups: [],
    };
    expect(canAddExit(only)).toBe(false);
  });
});

describe('addExit', () => {
  it('produces one member per non-terminal stage per actor, every member carrying a role guard', () => {
    const before = model();
    const after = addExit(before);
    const added = after.groups[after.groups.length - 1];
    const nonTerminalCount = before.stages.filter((s) => s.kind !== 'terminal').length;
    expect(added.members).toHaveLength(nonTerminalCount * 2);
    expect(added.who).toBe('both');
    expect(added.members.every((m) => m.roleGuard !== null)).toBe(true);
    expect(added.members.every((m) => m.order === NEW_ORDER)).toBe(true);
    // One family + one staff member per non-terminal stage.
    for (const s of before.stages.filter((x) => x.kind !== 'terminal')) {
      const forStage = added.members.filter((m) => m.from === s.stage_id);
      expect(forStage.map((m) => m.actor).sort()).toEqual(['family', 'staff']);
      expect(forStage.find((m) => m.actor === 'family')?.roleGuard).toEqual(roleGuardFor('family'));
      expect(forStage.find((m) => m.actor === 'staff')?.roleGuard).toEqual(roleGuardFor('staff'));
    }
  });

  it('targets the first terminal stage that is not the finish', () => {
    const before = model();
    const after = addExit(before);
    const added = after.groups[after.groups.length - 1];
    expect(added.to).toBe('dropped');
    expect(added.to).not.toBe(before.finishStageId);
  });

  it('round-trips: writeMachine + readStageModel adds exactly the new members, still folded as one "both" group', () => {
    const before = model();
    const after = addExit(before);
    const added = after.groups[after.groups.length - 1];
    const reread = readStageModel(writeMachine(after), SIGNUP_STEPS);
    expect(transitionIds(reread)).toEqual(
      [...transitionIds(before), ...added.members.map((m) => m.transition_id)].sort(),
    );
    const rereadGroup = reread.groups.find((g) => g.action === added.action);
    expect(rereadGroup).toBeDefined();
    expect(rereadGroup?.who).toBe('both');
    expect(rereadGroup?.members).toHaveLength(added.members.length);
    // The property `addExit` exists to produce: the reread group renders in
    // the Exits panel (isExitGroup), not as a move on each non-terminal
    // stage card.
    expect(isExitGroup(rereadGroup!, reread)).toBe(true);
  });

  it('is a no-op when canAddExit is false', () => {
    const only: StageModel = {
      stages: [stage('a', 'initial'), stage('b', 'terminal')],
      finishStageId: 'b',
      groups: [],
    };
    expect(addExit(only)).toEqual(only);
  });
});
