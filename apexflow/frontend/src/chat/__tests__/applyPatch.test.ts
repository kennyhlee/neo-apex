// Contract tests for `applyPatch` — the function the patch card calls to turn
// a chat `proposal` frame's ops into the next machine/steps.
//
// This suite IS the contract. `applyPatch` deliberately imports nothing from
// `src/editor/`, so the two semantics it inherits from there — the
// single-initial rule (`stageOps.ts::setStageKind`) and `remove_stage`'s
// three-way cleanup (`stageOps.ts::removeStage`) — are re-stated in this
// module and pinned ONLY here. A regression in either is invisible to
// `stageOps.test.ts`.
//
// Every fixture is deep-frozen: `applyPatch` is pure, and in an ES module
// (always strict mode) a write to a frozen object throws, so the freeze turns
// "accidentally mutated the caller's draft" from a silent aliasing bug into a
// test failure.
import { describe, expect, it } from 'vitest';
import { PatchApplyError, applyPatch } from '../applyPatch.ts';
import type { PatchOp } from '../patchOps.ts';
import type { MachineDef, WorkflowStepDef } from '../../types/designer.ts';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.getOwnPropertyNames(value).forEach((key) => {
      deepFreeze((value as Record<string, unknown>)[key]);
    });
    Object.freeze(value);
  }
  return value;
}

const machineFixture = (): MachineDef =>
  deepFreeze({
    states: [
      { state_id: 'draft', name: 'Draft', kind: 'initial' },
      { state_id: 'review', name: 'Review', kind: 'active' },
      { state_id: 'done', name: 'Done', kind: 'terminal' },
    ],
    transitions: [
      {
        transition_id: 't_submit',
        from: 'draft',
        to: 'review',
        action: 'submit',
        actor: 'family',
        guards: [],
        effects: [],
      },
      {
        transition_id: 't_accept',
        from: 'review',
        to: 'done',
        action: 'accept',
        actor: 'staff',
        guards: [],
        effects: [],
      },
    ],
  } satisfies MachineDef);

const stepsFixture = (): WorkflowStepDef[] =>
  deepFreeze([
    {
      step_id: 'student',
      type: 'form',
      title: 'Student',
      required: true,
      blocking: true,
      available_in: ['draft', 'review'],
      config: {
        sections: [
          {
            section_id: 'sec_student',
            entity_model: 'student',
            title: 'Student',
            fields: [{ name: 'first_name', required: true }],
            mode: 'create',
          },
          {
            section_id: 'sec_family',
            entity_model: 'family',
            title: 'Family',
            fields: [{ name: 'surname', required: true }],
            mode: 'match_or_create',
          },
        ],
      },
    },
    {
      step_id: 'docs',
      type: 'documents',
      title: 'Documents',
      required: false,
      blocking: false,
      available_in: ['review'],
      config: {},
    },
  ] satisfies WorkflowStepDef[]);

/** Runs `ops` against fresh frozen fixtures. */
function run(ops: PatchOp[]) {
  return applyPatch(machineFixture(), stepsFixture(), ops);
}

// --- stages ------------------------------------------------------------------

describe('applyPatch — stage ops', () => {
  it('add_stage appends a StateDef', () => {
    const { machine } = run([
      { op: 'add_stage', stage_id: 'waitlist', name: 'Waitlist', kind: 'active' },
    ]);

    expect(machine.states).toHaveLength(4);
    expect(machine.states[3]).toEqual({
      state_id: 'waitlist',
      name: 'Waitlist',
      kind: 'active',
    });
  });

  it('add_stage with kind "initial" demotes the existing initial to active', () => {
    const { machine } = run([
      { op: 'add_stage', stage_id: 'intake', name: 'Intake', kind: 'initial' },
    ]);

    expect(machine.states.filter((s) => s.kind === 'initial').map((s) => s.state_id)).toEqual([
      'intake',
    ]);
    expect(machine.states.find((s) => s.state_id === 'draft')?.kind).toBe('active');
  });

  it('add_stage with a duplicate stage_id throws, naming the id', () => {
    expect(() =>
      run([{ op: 'add_stage', stage_id: 'review', name: 'Review again', kind: 'active' }]),
    ).toThrow(PatchApplyError);
    expect(() =>
      run([{ op: 'add_stage', stage_id: 'review', name: 'Review again', kind: 'active' }]),
    ).toThrow(/review/);
  });

  it('rename_stage renames only the named stage', () => {
    const { machine } = run([{ op: 'rename_stage', stage_id: 'review', name: 'Under review' }]);

    expect(machine.states.map((s) => s.name)).toEqual(['Draft', 'Under review', 'Done']);
    expect(machine.states[1].kind).toBe('active');
  });

  it('rename_stage on a missing stage throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'rename_stage', stage_id: 'nope', name: 'X' }])).toThrow(
      PatchApplyError,
    );
    expect(() => run([{ op: 'rename_stage', stage_id: 'nope', name: 'X' }])).toThrow(/nope/);
  });

  it('set_stage_kind changes one stage kind', () => {
    const { machine } = run([{ op: 'set_stage_kind', stage_id: 'review', kind: 'terminal' }]);

    expect(machine.states.find((s) => s.state_id === 'review')?.kind).toBe('terminal');
    expect(machine.states.find((s) => s.state_id === 'draft')?.kind).toBe('initial');
  });

  it('set_stage_kind to "initial" demotes the existing initial to active', () => {
    const { machine } = run([{ op: 'set_stage_kind', stage_id: 'review', kind: 'initial' }]);

    expect(machine.states.filter((s) => s.kind === 'initial').map((s) => s.state_id)).toEqual([
      'review',
    ]);
    expect(machine.states.find((s) => s.state_id === 'draft')?.kind).toBe('active');
  });

  it('set_stage_kind to "initial" on the stage that already holds it does not demote itself', () => {
    const { machine } = run([{ op: 'set_stage_kind', stage_id: 'draft', kind: 'initial' }]);

    expect(machine.states.filter((s) => s.kind === 'initial').map((s) => s.state_id)).toEqual([
      'draft',
    ]);
  });

  it('set_stage_kind on a missing stage throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'set_stage_kind', stage_id: 'ghost', kind: 'active' }])).toThrow(
      /ghost/,
    );
  });

  it('remove_stage drops the state, every transition touching it (from OR to), and its available_in entries', () => {
    const { machine, steps } = run([{ op: 'remove_stage', stage_id: 'review' }]);

    expect(machine.states.map((s) => s.state_id)).toEqual(['draft', 'done']);
    // `t_submit` points TO review, `t_accept` comes FROM it — both go.
    expect(machine.transitions).toEqual([]);
    expect(steps[0].available_in).toEqual(['draft']);
    expect(steps[1].available_in).toEqual([]);
    // The steps themselves survive — only the stage reference is stripped.
    expect(steps.map((s) => s.step_id)).toEqual(['student', 'docs']);
  });

  it('remove_stage keeps transitions that touch neither side', () => {
    const { machine } = run([{ op: 'remove_stage', stage_id: 'done' }]);

    expect(machine.transitions.map((t) => t.transition_id)).toEqual(['t_submit']);
  });

  it('remove_stage on a missing stage throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'remove_stage', stage_id: 'gone' }])).toThrow(/gone/);
  });
});

// --- moves -------------------------------------------------------------------

describe('applyPatch — move ops', () => {
  it('add_move appends a TransitionDef carrying the wire `from` key', () => {
    const { machine } = run([
      {
        op: 'add_move',
        transition_id: 't_withdraw',
        from: 'draft',
        to: 'done',
        action: 'withdraw',
        actor: 'family',
        guards: [{ primitive: 'actor_role', params: { role: 'parent' } }],
        effects: [],
      },
    ]);

    expect(machine.transitions).toHaveLength(3);
    expect(machine.transitions[2]).toEqual({
      transition_id: 't_withdraw',
      from: 'draft',
      to: 'done',
      action: 'withdraw',
      actor: 'family',
      guards: [{ primitive: 'actor_role', params: { role: 'parent' } }],
      effects: [],
    });
    expect(machine.transitions[2]).not.toHaveProperty('op');
  });

  it('add_move with a duplicate transition_id throws, naming the id', () => {
    expect(() =>
      run([
        {
          op: 'add_move',
          transition_id: 't_submit',
          from: 'draft',
          to: 'done',
          action: 'x',
          actor: 'staff',
          guards: [],
          effects: [],
        },
      ]),
    ).toThrow(/t_submit/);
  });

  it('update_move shallow-merges the patch onto the transition', () => {
    const { machine } = run([
      { op: 'update_move', transition_id: 't_submit', patch: { to: 'done', actor: 'staff' } },
    ]);

    expect(machine.transitions[0]).toEqual({
      transition_id: 't_submit',
      from: 'draft',
      to: 'done',
      action: 'submit',
      actor: 'staff',
      guards: [],
      effects: [],
    });
    expect(machine.transitions[1].to).toBe('done');
  });

  it('update_move on a missing transition throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'update_move', transition_id: 't_nope', patch: { to: 'x' } }])).toThrow(
      PatchApplyError,
    );
    expect(() => run([{ op: 'update_move', transition_id: 't_nope', patch: { to: 'x' } }])).toThrow(
      /t_nope/,
    );
  });

  it('remove_move drops exactly one transition', () => {
    const { machine } = run([{ op: 'remove_move', transition_id: 't_accept' }]);

    expect(machine.transitions.map((t) => t.transition_id)).toEqual(['t_submit']);
  });

  it('remove_move on a missing transition throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'remove_move', transition_id: 't_missing' }])).toThrow(/t_missing/);
  });
});

// --- steps -------------------------------------------------------------------

const newStep = (step_id: string) => ({
  step_id,
  type: 'message' as const,
  title: 'Welcome',
  required: false,
  blocking: false,
  available_in: ['draft'],
});

describe('applyPatch — step ops', () => {
  it('add_step appends when position is absent and materializes the optional config', () => {
    const { steps } = run([{ op: 'add_step', step: newStep('welcome') }]);

    expect(steps.map((s) => s.step_id)).toEqual(['student', 'docs', 'welcome']);
    // `AddStepOp.step.config` is optional on the wire (`StepDef.config` has a
    // server-side default_factory) while `WorkflowStepDef.config` is required.
    expect(steps[2].config).toEqual({});
  });

  it('add_step appends when position is null', () => {
    const { steps } = run([{ op: 'add_step', step: newStep('welcome'), position: null }]);

    expect(steps.map((s) => s.step_id)).toEqual(['student', 'docs', 'welcome']);
  });

  it('add_step inserts at position', () => {
    const { steps } = run([{ op: 'add_step', step: newStep('welcome'), position: 1 }]);

    expect(steps.map((s) => s.step_id)).toEqual(['student', 'welcome', 'docs']);
  });

  it('add_step preserves a config the op did carry', () => {
    const { steps } = run([
      { op: 'add_step', step: { ...newStep('welcome'), config: { body: 'hi' } }, position: 0 },
    ]);

    expect(steps[0].config).toEqual({ body: 'hi' });
  });

  it('add_step clamps a negative position to the front rather than counting from the end', () => {
    const { steps } = run([{ op: 'add_step', step: newStep('welcome'), position: -1 }]);

    expect(steps.map((s) => s.step_id)).toEqual(['welcome', 'student', 'docs']);
  });

  it('add_step clamps an out-of-range position to the end', () => {
    const { steps } = run([{ op: 'add_step', step: newStep('welcome'), position: 99 }]);

    expect(steps.map((s) => s.step_id)).toEqual(['student', 'docs', 'welcome']);
  });

  it('add_step with a duplicate step_id throws, naming the id', () => {
    expect(() => run([{ op: 'add_step', step: newStep('docs') }])).toThrow(/docs/);
  });

  it('update_step shallow-merges title onto the step', () => {
    const { steps } = run([
      { op: 'update_step', step_id: 'student', patch: { title: 'Student details' } },
    ]);

    expect(steps[0].title).toBe('Student details');
    expect(steps[0].required).toBe(true);
    // Untouched keys survive the merge, including nested config.
    expect(steps[0].config).toEqual(stepsFixture()[0].config);
  });

  it('update_step merges show_if, which has no dedicated op', () => {
    const showIf = { all: [{ field: 'grade', op: 'eq', value: '1' }] };
    const { steps } = run([{ op: 'update_step', step_id: 'docs', patch: { show_if: showIf } }]);

    expect(steps[1].show_if).toEqual(showIf);
    expect(steps[1].title).toBe('Documents');
  });

  it('update_step on a missing step throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'update_step', step_id: 'nosuch', patch: { title: 'x' } }])).toThrow(
      PatchApplyError,
    );
    expect(() => run([{ op: 'update_step', step_id: 'nosuch', patch: { title: 'x' } }])).toThrow(
      /nosuch/,
    );
  });

  it('remove_step drops exactly one step', () => {
    const { steps } = run([{ op: 'remove_step', step_id: 'student' }]);

    expect(steps.map((s) => s.step_id)).toEqual(['docs']);
  });

  it('remove_step on a missing step throws PatchApplyError naming the id', () => {
    expect(() => run([{ op: 'remove_step', step_id: 'phantom' }])).toThrow(/phantom/);
  });
});

// --- sections ----------------------------------------------------------------

const newSection = (section_id: string) => ({
  section_id,
  entity_model: 'contact',
  title: 'Contact',
  fields: [{ name: 'email', required: false }],
  mode: 'create' as const,
});

describe('applyPatch — section ops', () => {
  it('add_section appends to step.config.sections', () => {
    const { steps } = run([
      { op: 'add_section', step_id: 'student', section: newSection('sec_contact') },
    ]);

    const sections = steps[0].config.sections as { section_id: string }[];
    expect(sections.map((s) => s.section_id)).toEqual([
      'sec_student',
      'sec_family',
      'sec_contact',
    ]);
  });

  it('add_section creates the sections array on a step that has none', () => {
    const { steps } = run([
      { op: 'add_section', step_id: 'docs', section: newSection('sec_contact') },
    ]);

    expect(steps[1].config.sections).toEqual([newSection('sec_contact')]);
  });

  it('add_section with a duplicate section_id on that step throws, naming the id', () => {
    expect(() =>
      run([{ op: 'add_section', step_id: 'student', section: newSection('sec_family') }]),
    ).toThrow(/sec_family/);
  });

  it('add_section on a missing step throws PatchApplyError naming the step id', () => {
    expect(() =>
      run([{ op: 'add_section', step_id: 'ghost_step', section: newSection('sec_contact') }]),
    ).toThrow(/ghost_step/);
  });

  it('update_section shallow-merges the patch onto the section', () => {
    const { steps } = run([
      {
        op: 'update_section',
        step_id: 'student',
        section_id: 'sec_family',
        patch: { title: 'Household', mode: 'create' },
      },
    ]);

    const sections = steps[0].config.sections as Record<string, unknown>[];
    expect(sections[1]).toEqual({
      section_id: 'sec_family',
      entity_model: 'family',
      title: 'Household',
      fields: [{ name: 'surname', required: true }],
      mode: 'create',
    });
    expect(sections[0].title).toBe('Student');
  });

  it('update_section on a missing section throws PatchApplyError naming the id', () => {
    expect(() =>
      run([
        { op: 'update_section', step_id: 'student', section_id: 'sec_nope', patch: { title: 'x' } },
      ]),
    ).toThrow(PatchApplyError);
    expect(() =>
      run([
        { op: 'update_section', step_id: 'student', section_id: 'sec_nope', patch: { title: 'x' } },
      ]),
    ).toThrow(/sec_nope/);
  });

  it('remove_section drops exactly one section', () => {
    const { steps } = run([
      { op: 'remove_section', step_id: 'student', section_id: 'sec_student' },
    ]);

    const sections = steps[0].config.sections as { section_id: string }[];
    expect(sections.map((s) => s.section_id)).toEqual(['sec_family']);
  });

  it('remove_section on a missing section throws PatchApplyError naming the id', () => {
    expect(() =>
      run([{ op: 'remove_section', step_id: 'student', section_id: 'sec_absent' }]),
    ).toThrow(/sec_absent/);
  });
});

// --- definition-level --------------------------------------------------------

describe('applyPatch — set_channel_access', () => {
  it('reports the new channel access', () => {
    const result = run([{ op: 'set_channel_access', value: 'family' }]);

    expect(result.channelAccess).toBe('family');
  });

  it('leaves channelAccess undefined when no set_channel_access op was applied', () => {
    const result = run([{ op: 'rename_stage', stage_id: 'draft', name: 'Started' }]);

    expect(result.channelAccess).toBeUndefined();
  });
});

// --- cross-cutting -----------------------------------------------------------

describe('applyPatch — purity and atomicity', () => {
  it('does not mutate the input machine or steps', () => {
    const machine = machineFixture();
    const steps = stepsFixture();

    applyPatch(machine, steps, [
      { op: 'add_stage', stage_id: 'waitlist', name: 'Waitlist', kind: 'initial' },
      { op: 'remove_stage', stage_id: 'review' },
      { op: 'update_step', step_id: 'student', patch: { title: 'Changed' } },
      {
        op: 'update_section',
        step_id: 'student',
        section_id: 'sec_student',
        patch: { title: 'Changed' },
      },
      { op: 'add_section', step_id: 'docs', section: newSection('sec_new') },
    ]);

    expect(machine).toEqual(machineFixture());
    expect(steps).toEqual(stepsFixture());
  });

  it('applies nothing when a later op is bad — the caller keeps its draft', () => {
    const machine = machineFixture();
    const steps = stepsFixture();

    expect(() =>
      applyPatch(machine, steps, [
        { op: 'rename_stage', stage_id: 'draft', name: 'Started' },
        { op: 'remove_move', transition_id: 't_ghost' },
      ]),
    ).toThrow(PatchApplyError);

    expect(machine).toEqual(machineFixture());
    expect(steps).toEqual(stepsFixture());
  });

  it('applies ops in order, so a later op sees an earlier one', () => {
    const { machine, steps } = run([
      { op: 'add_stage', stage_id: 'waitlist', name: 'Waitlist', kind: 'active' },
      { op: 'rename_stage', stage_id: 'waitlist', name: 'Wait list' },
      { op: 'add_step', step: newStep('welcome'), position: 0 },
      { op: 'update_step', step_id: 'welcome', patch: { title: 'Hello' } },
    ]);

    expect(machine.states[3].name).toBe('Wait list');
    expect(steps[0].title).toBe('Hello');
  });

  it('returns the inputs unchanged for an empty op list', () => {
    const { machine, steps, channelAccess } = run([]);

    expect(machine).toEqual(machineFixture());
    expect(steps).toEqual(stepsFixture());
    expect(channelAccess).toBeUndefined();
  });

  it('PatchApplyError is an Error subclass with a usable name', () => {
    try {
      run([{ op: 'remove_move', transition_id: 't_ghost' }]);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PatchApplyError);
      expect((err as Error).name).toBe('PatchApplyError');
      expect((err as Error).message).toContain('t_ghost');
    }
  });
});
