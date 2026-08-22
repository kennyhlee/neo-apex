// The flow card is a 380px column, so it shows the SPINE and says the rest
// in one line. What gets kept and what gets collapsed is decided here, in a
// pure function, rather than inside a component.
import { describe, expect, it } from 'vitest';
import { readStageModel } from '../../stage/read.ts';
import { buildFlowLayout } from '../layout.ts';
import { summariseFlow } from '../summary.ts';
import {
  ENROLLMENT_MACHINE,
  ENROLLMENT_STEPS,
  SIGNUP_MACHINE,
  SIGNUP_STEPS,
} from '../../stage/__tests__/fixtures.ts';
import type { MachineDef } from '../../../types/designer.ts';

const summarise = (m: MachineDef, s: never[] | typeof SIGNUP_STEPS) =>
  summariseFlow(buildFlowLayout(readStageModel(m, s as never)));

const signup = () => summarise(SIGNUP_MACHINE, SIGNUP_STEPS);
const enrollment = () => summarise(ENROLLMENT_MACHINE, ENROLLMENT_STEPS);

describe('summariseFlow', () => {
  it('walks the spine in order', () => {
    expect(signup().chain.map((l) => l.node.stage_id)).toEqual([
      'draft',
      'confirmed',
      'completed',
    ]);
    expect(enrollment().chain.map((l) => l.node.stage_id)).toEqual([
      'draft',
      'submitted',
      'in_review',
      'approved',
      'enrolled',
    ]);
  });

  // The link between two spine stages is what the card shows between them.
  it('names the move that carries each spine stage to the next', () => {
    const links = signup().chain.map((l) => l.next && [l.next.action, l.next.who]);
    expect(links).toEqual([
      ['submit', 'family'],
      ['complete_program', 'staff'],
      undefined, // nothing leaves the finish
    ]);
  });

  it('collapses the rail into a named detour', () => {
    expect(signup().detourNames).toEqual(['Waitlisted', 'Spot Offered']);
    expect(enrollment().detourNames).toEqual(['Waitlisted', 'Pending Items']);
  });

  it('counts what the header states', () => {
    const s = signup();
    // 5 drawn stages + the Dropped exit target = signup's 6 states.
    expect(s.stageCount).toBe(5);
    expect(s.moveCount).toBe(7);
    expect(s.exitCount).toBe(2); // the two drop rules
  });

  it('carries the exit rules through', () => {
    expect(signup().exits.map((e) => e.action)).toEqual(['drop', 'drop']);
  });

  it('handles a workflow with no rail', () => {
    const linear = summarise(
      {
        states: [
          { state_id: 'a', name: 'A', kind: 'initial' },
          { state_id: 'b', name: 'B', kind: 'terminal' },
        ],
        transitions: [
          {
            transition_id: 't1',
            from: 'a',
            to: 'b',
            action: 'go',
            actor: 'staff',
            guards: [],
            effects: [],
          },
        ],
      } as unknown as MachineDef,
      [],
    );
    expect(linear.detourNames).toEqual([]);
    expect(linear.chain.map((l) => l.node.stage_id)).toEqual(['a', 'b']);
  });

  it('handles an empty machine without inventing rows', () => {
    const empty = summarise({ states: [], transitions: [] } as unknown as MachineDef, []);
    expect(empty.chain).toEqual([]);
    expect(empty.stageCount).toBe(0);
    expect(empty.exitCount).toBe(0);
  });

  // With no initial stage there is no spine, but the card must still list the
  // stages rather than render blank.
  it('still lists stages when the machine has no start', () => {
    const noStart = summarise(
      {
        states: [
          { state_id: 'a', name: 'A', kind: 'active' },
          { state_id: 'b', name: 'B', kind: 'active' },
        ],
        transitions: [
          {
            transition_id: 't1',
            from: 'a',
            to: 'b',
            action: 'go',
            actor: 'staff',
            guards: [],
            effects: [],
          },
        ],
      } as unknown as MachineDef,
      [],
    );
    expect(noStart.chain.map((l) => l.node.stage_id)).toEqual(['a', 'b']);
  });
});
