// THE test. The design calls round-tripping "the single most important
// correctness property in the whole feature", and this is where it is
// pinned: open a real shipped definition, change nothing, save, and the
// machine that comes back must be the machine that went in.
import { describe, expect, it } from 'vitest';
import { readStageModel } from '../read.ts';
import { writeMachine } from '../write.ts';
import {
  ENROLLMENT_MACHINE,
  ENROLLMENT_STEPS,
  SIGNUP_MACHINE,
  SIGNUP_STEPS,
} from './fixtures.ts';
import type { MachineDef, WorkflowStepDef } from '../../../types/designer.ts';

const TEMPLATES: [string, MachineDef, WorkflowStepDef[]][] = [
  ['enrollment', ENROLLMENT_MACHINE, ENROLLMENT_STEPS],
  ['signup', SIGNUP_MACHINE, SIGNUP_STEPS],
];

describe.each(TEMPLATES)('round trip: %s', (_name, machine, steps) => {
  const out = () => writeMachine(readStageModel(machine, steps));

  it('produces an identical machine', () => {
    expect(out()).toEqual(machine);
  });

  it('preserves transition declaration order exactly', () => {
    expect(out().transitions.map((t) => t.transition_id)).toEqual(
      machine.transitions.map((t) => t.transition_id),
    );
  });

  it('loses no transition and invents none', () => {
    expect(out().transitions).toHaveLength(machine.transitions.length);
  });

  it('preserves every guard list, including the actor_role guards', () => {
    const before = machine.transitions.map((t) => [t.transition_id, t.guards] as const);
    const after = out().transitions.map((t) => [t.transition_id, t.guards] as const);
    expect(after).toEqual(before);
  });

  it('preserves every effect list', () => {
    const before = machine.transitions.map((t) => [t.transition_id, t.effects] as const);
    const after = out().transitions.map((t) => [t.transition_id, t.effects] as const);
    expect(after).toEqual(before);
  });

  it('preserves state ids, names, and kinds', () => {
    expect(out().states).toEqual(machine.states);
  });

  it('is idempotent under a second pass', () => {
    expect(writeMachine(readStageModel(out(), steps))).toEqual(machine);
  });
});

describe('round trip: hand-authored irregularities', () => {
  // The design's fallback rule: "any transition that does not fit a group
  // renders as an explicit move on its stage, never silently dropped."
  it('keeps a lone irregular transition that matches no other', () => {
    const machine: MachineDef = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' },
        { state_id: 'b', name: 'B', kind: 'active' },
        { state_id: 'z', name: 'Z', kind: 'terminal' },
      ],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'b', action: 'go', actor: 'staff', guards: [], effects: [] },
        {
          transition_id: 't2',
          from: 'a',
          to: 'z',
          action: 'quit',
          actor: 'staff',
          guards: [{ primitive: 'date_window', params: { end: '2026-12-31' } }],
          effects: [],
        },
        { transition_id: 't3', from: 'b', to: 'z', action: 'quit', actor: 'staff', guards: [], effects: [] },
      ],
    };
    const model = readStageModel(machine, []);
    // t2 and t3 share (action, to) but differ in guards — two groups, not one.
    expect(model.groups.filter((g) => g.action === 'quit')).toHaveLength(2);
    expect(writeMachine(model)).toEqual(machine);
  });

  it('round-trips a transition whose actor_role does not match its actor', () => {
    const machine: MachineDef = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' },
        { state_id: 'z', name: 'Z', kind: 'terminal' },
      ],
      transitions: [
        {
          transition_id: 't1',
          from: 'a',
          to: 'z',
          action: 'odd',
          actor: 'staff',
          guards: [{ primitive: 'actor_role', params: { roles: ['family'] } }],
          effects: [],
        },
      ],
    };
    expect(writeMachine(readStageModel(machine, []))).toEqual(machine);
  });
});
