// Layout is the only new algorithm in the Flow view, so it carries the
// coverage. Both shipped templates are used as fixtures because between them
// they exercise a branch, a rejoin, two backward edges, a `system` actor, a
// non-uniform exit and a resting non-finish stage — see
// `app/templates/signup.py`'s module docstring for that list.
import { describe, expect, it } from 'vitest';
import { readStageModel } from '../../stage/read.ts';
import { buildFlowLayout } from '../layout.ts';
import {
  ENROLLMENT_MACHINE,
  ENROLLMENT_STEPS,
  SIGNUP_MACHINE,
  SIGNUP_STEPS,
} from '../../stage/__tests__/fixtures.ts';
import type { MachineDef } from '../../../types/designer.ts';

const signup = () => buildFlowLayout(readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS));
const enrollment = () => buildFlowLayout(readStageModel(ENROLLMENT_MACHINE, ENROLLMENT_STEPS));

/** Node ids in row order. Row order IS the reading order of the drawing. */
const byRow = (layout: ReturnType<typeof buildFlowLayout>) =>
  [...layout.nodes].sort((a, b) => a.row - b.row).map((n) => n.stage_id);

const ids = (layout: ReturnType<typeof buildFlowLayout>, column: 'spine' | 'rail') =>
  layout.nodes.filter((n) => n.column === column).map((n) => n.stage_id);

describe('spine / rail / exit assignment', () => {
  it('puts signup on the shortest path from draft to completed', () => {
    const layout = signup();
    expect(ids(layout, 'spine')).toEqual(['draft', 'confirmed', 'completed']);
    expect(ids(layout, 'rail').sort()).toEqual(['offered', 'waitlisted']);
    expect([...new Set(layout.exits.map((e) => e.to))]).toEqual(['dropped']);
  });

  it('puts enrollment on the shortest path from draft to enrolled', () => {
    const layout = enrollment();
    expect(ids(layout, 'spine')).toEqual([
      'draft',
      'submitted',
      'in_review',
      'approved',
      'enrolled',
    ]);
    expect(ids(layout, 'rail').sort()).toEqual(['pending_items', 'waitlisted']);
    expect([...new Set(layout.exits.map((e) => e.to))].sort()).toEqual(['declined', 'withdrawn']);
  });

  it('never makes a node out of a non-finish terminal stage', () => {
    for (const layout of [signup(), enrollment()]) {
      const terminals = layout.nodes.filter((n) => n.kind === 'terminal');
      expect(terminals.every((n) => n.isFinish)).toBe(true);
    }
  });
});

describe('row assignment', () => {
  it('interleaves the waitlist detour between draft and confirmed (signup)', () => {
    expect(byRow(signup())).toEqual([
      'draft',
      'waitlisted',
      'offered',
      'confirmed',
      'completed',
    ]);
  });

  it('interleaves each detour with the spine node it departs from (enrollment)', () => {
    expect(byRow(enrollment())).toEqual([
      'draft',
      'waitlisted',
      'submitted',
      'in_review',
      'pending_items',
      'approved',
      'enrolled',
    ]);
  });

  it('assigns every node a distinct row, and rowCount covers them', () => {
    for (const layout of [signup(), enrollment()]) {
      const rows = layout.nodes.map((n) => n.row);
      expect(new Set(rows).size).toBe(rows.length);
      expect(Math.max(...rows)).toBeLessThan(layout.rowCount);
    }
  });
});

describe('edges', () => {
  it('draws every non-exit move, and nothing else', () => {
    const model = readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);
    const layout = buildFlowLayout(model);
    // signup's non-exit moves: submit->confirmed, submit->waitlisted,
    // offer_spot, accept_offer, decline_offer, rescind_offer,
    // complete_program. `drop` is the exit.
    expect(layout.edges.map((e) => e.action).sort()).toEqual([
      'accept_offer',
      'complete_program',
      'decline_offer',
      'offer_spot',
      'rescind_offer',
      'submit',
      'submit',
    ]);
    expect(layout.edges.some((e) => e.action === 'drop')).toBe(false);
  });

  it('only ever names stages that exist as nodes', () => {
    for (const layout of [signup(), enrollment()]) {
      const nodeIds = new Set(layout.nodes.map((n) => n.stage_id));
      for (const edge of layout.edges) {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      }
    }
  });

  it('gives every edge a distinct key', () => {
    for (const layout of [signup(), enrollment()]) {
      const keys = layout.edges.map((e) => e.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  // NEITHER shipped template has a non-exit move group with more than one
  // source stage (their multi-source groups are all exits, which never
  // become edges), so asserting this against the fixtures alone passes
  // whether or not the key is per-source. This machine builds the case
  // deliberately: `a -> hub` and `b -> hub` are identical apart from `from`,
  // so `read.ts` returns them as ONE group with two members, and the drawing
  // needs two lines with two React keys.
  it('draws one edge per source when a group leaves several stages', () => {
    const escalate = (from: string, id: string) => ({
      transition_id: id,
      from,
      to: 'hub',
      action: 'escalate',
      actor: 'staff' as const,
      guards: [],
      effects: [],
    });
    const layout = buildFlowLayout(
      readStageModel(
        {
          states: [
            { state_id: 'start', name: 'Start', kind: 'initial' },
            { state_id: 'a', name: 'A', kind: 'active' },
            { state_id: 'b', name: 'B', kind: 'active' },
            { state_id: 'hub', name: 'Hub', kind: 'active' },
            { state_id: 'done', name: 'Done', kind: 'terminal' },
          ],
          transitions: [
            { transition_id: 't1', from: 'start', to: 'a', action: 'toA', actor: 'staff', guards: [], effects: [] },
            { transition_id: 't2', from: 'start', to: 'b', action: 'toB', actor: 'staff', guards: [], effects: [] },
            escalate('a', 't3'),
            escalate('b', 't4'),
            { transition_id: 't5', from: 'hub', to: 'done', action: 'finish', actor: 'staff', guards: [], effects: [] },
          ],
        } as unknown as MachineDef,
        [],
      ),
    );
    const escalations = layout.edges.filter((e) => e.action === 'escalate');
    expect(escalations.map((e) => e.from).sort()).toEqual(['a', 'b']);
    expect(new Set(escalations.map((e) => e.key)).size).toBe(2);
  });

  it('marks the return-to-waitlist pair backward (signup)', () => {
    const backward = signup()
      .edges.filter((e) => e.backward)
      .map((e) => e.action)
      .sort();
    expect(backward).toEqual(['decline_offer', 'rescind_offer']);
  });

  it('marks resubmit backward (enrollment)', () => {
    const backward = enrollment()
      .edges.filter((e) => e.backward)
      .map((e) => e.action);
    expect(backward).toContain('resubmit');
  });

  it('reports system transitions as automatic (enrollment)', () => {
    const automatic = enrollment()
      .edges.filter((e) => e.who === 'automatic')
      .map((e) => e.action)
      .sort();
    expect(automatic).toEqual(['finalize_enrollment', 'flag_pending_items', 'route_to_review']);
  });

  it('counts guards without reproducing their text', () => {
    // signup's `submit -> confirmed` carries the form-complete AND capacity
    // guards; `submit -> waitlisted` carries form-complete and a negated
    // capacity check. Both are conditional; neither renders prose here.
    const submits = signup().edges.filter((e) => e.action === 'submit');
    expect(submits).toHaveLength(2);
    expect(submits.every((e) => e.guardCount > 0)).toBe(true);
  });
});

describe('exits', () => {
  // Signup's eight `drop` transitions share an action and a target but split
  // into TWO effect shapes: leaving `confirmed` must also mark the committed
  // enrollment row Withdrawn, while the other three stages have no committed
  // row to mark (see signup.py's docstring, difference 5). `read.ts` keys on
  // effects, so they are two groups — and the strip must show both rules
  // rather than collapsing them into one line that is wrong for one of them.
  it('keeps the two drop rules separate, and names every source stage', () => {
    const drops = signup().exits.filter((e) => e.action === 'drop');
    expect(drops).toHaveLength(2);
    expect(drops.flatMap((d) => d.fromNames).sort()).toEqual([
      'Confirmed',
      'Draft',
      'Spot Offered',
      'Waitlisted',
    ]);
  });

  it('keeps exits out of the edge list entirely', () => {
    for (const layout of [signup(), enrollment()]) {
      const exitTargets = new Set(layout.exits.map((e) => e.to));
      expect(layout.edges.some((e) => exitTargets.has(e.to))).toBe(false);
    }
  });
});

describe('purity', () => {
  it('does not mutate the StageModel it reads', () => {
    const model = readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);
    const before = JSON.stringify(model);
    buildFlowLayout(model);
    expect(JSON.stringify(model)).toBe(before);
  });
});

describe('degenerate machines the editor can actually create', () => {
  const stage = (id: string, kind: 'initial' | 'active' | 'terminal') => ({
    state_id: id,
    name: id,
    kind,
  });

  /** Every stage is drawn exactly once, whatever the graph looks like. */
  const drawsEveryStageOnce = (machine: MachineDef) => {
    const layout = buildFlowLayout(readStageModel(machine, []));
    const drawn = [...layout.nodes.map((n) => n.stage_id), ...layout.exits.map((e) => e.to)];
    expect(new Set(drawn).size).toBe(machine.states.length);
  };

  it('handles a machine with no initial stage', () => {
    drawsEveryStageOnce({
      states: [stage('a', 'active'), stage('b', 'active')],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'b', action: 'go', actor: 'staff', guards: [], effects: [] },
      ],
    } as unknown as MachineDef);
  });

  it('handles a machine with no terminal stage', () => {
    drawsEveryStageOnce({
      states: [stage('a', 'initial'), stage('b', 'active')],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'b', action: 'go', actor: 'staff', guards: [], effects: [] },
      ],
    } as unknown as MachineDef);
  });

  it('handles an unreachable stage', () => {
    drawsEveryStageOnce({
      states: [stage('a', 'initial'), stage('b', 'terminal'), stage('orphan', 'active')],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'b', action: 'go', actor: 'staff', guards: [], effects: [] },
      ],
    } as unknown as MachineDef);
  });

  it('handles a single stage with no moves', () => {
    const layout = buildFlowLayout(
      readStageModel({ states: [stage('only', 'initial')], transitions: [] } as unknown as MachineDef, []),
    );
    expect(layout.nodes.map((n) => n.stage_id)).toEqual(['only']);
    expect(layout.edges).toEqual([]);
    expect(layout.hasRail).toBe(false);
  });

  it('handles an empty machine', () => {
    const layout = buildFlowLayout(
      readStageModel({ states: [], transitions: [] } as unknown as MachineDef, []),
    );
    expect(layout.nodes).toEqual([]);
    expect(layout.rowCount).toBe(0);
  });

  it('reports hasRail only when something is off the spine', () => {
    expect(signup().hasRail).toBe(true);
    const linear = buildFlowLayout(
      readStageModel(
        {
          states: [stage('a', 'initial'), stage('b', 'terminal')],
          transitions: [
            { transition_id: 't1', from: 'a', to: 'b', action: 'go', actor: 'staff', guards: [], effects: [] },
          ],
        } as unknown as MachineDef,
        [],
      ),
    );
    expect(linear.hasRail).toBe(false);
  });
});
