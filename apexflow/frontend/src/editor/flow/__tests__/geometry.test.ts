import { describe, expect, it } from 'vitest';
import { readStageModel } from '../../stage/read.ts';
import { buildFlowLayout } from '../layout.ts';
import {
  BACK_X,
  CANVAS_W,
  GUTTER_X,
  NODE_W,
  RAIL_X,
  SPINE_X,
  canvasWidth,
  edgePath,
  labelSlot,
  nodeBox,
  orthogonalPath,
} from '../geometry.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from '../../stage/__tests__/fixtures.ts';
import type { FlowEdge, FlowNode } from '../types.ts';

const node = (stage_id: string, column: 'spine' | 'rail', row: number): FlowNode => ({
  stage_id,
  name: stage_id,
  kind: 'active',
  column,
  row,
  stepCount: 0,
  isFinish: false,
});

const edge = (from: string, to: string, backward = false): FlowEdge => ({
  key: `${from}->${to}`,
  from,
  to,
  action: 'go',
  who: 'staff',
  backward,
  guardCount: 0,
});

/** Every coordinate pair in a path, so a route can be asserted by its
 * waypoints rather than by string equality against rounded-corner output. */
const coords = (d: string): Array<[number, number]> =>
  [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('orthogonalPath', () => {
  it('drops zero-length runs rather than drawing a corner on itself', () => {
    expect(orthogonalPath([[0, 0], [0, 0], [0, 50]])).toBe(orthogonalPath([[0, 0], [0, 50]]));
  });

  it('returns nothing for a degenerate polyline', () => {
    expect(orthogonalPath([[10, 10]])).toBe('');
    expect(orthogonalPath([[10, 10], [10, 10]])).toBe('');
  });

  it('never rounds a corner harder than half the shorter run', () => {
    // A 6px run cannot absorb a 10px radius; the corner must shrink instead
    // of overshooting back past its own start.
    const pts = coords(orthogonalPath([[0, 0], [6, 0], [6, 60]]));
    expect(pts.every(([x]) => x >= 0 && x <= 6)).toBe(true);
  });
});

describe('edgePath routing', () => {
  const nodes = new Map([
    ['s0', node('s0', 'spine', 0)],
    ['r1', node('r1', 'rail', 1)],
    ['r2', node('r2', 'rail', 2)],
    ['s3', node('s3', 'spine', 3)],
  ]);

  it('runs straight down the column when both ends share it', () => {
    const pts = coords(edgePath(edge('r1', 'r2'), nodes));
    const a = nodeBox(nodes.get('r1') as FlowNode);
    const b = nodeBox(nodes.get('r2') as FlowNode);
    expect(pts[0]).toEqual([a.cx, a.bottom]);
    expect(pts[pts.length - 1]).toEqual([b.cx, b.y]);
    expect(pts.every(([x]) => x === a.cx)).toBe(true);
  });

  it('leaves the spine on its right and enters the rail on its left', () => {
    const pts = coords(edgePath(edge('s0', 'r1'), nodes));
    expect(pts[0]).toEqual([SPINE_X + NODE_W, nodeBox(nodes.get('s0') as FlowNode).cy]);
    expect(pts[pts.length - 1]).toEqual([RAIL_X, nodeBox(nodes.get('r1') as FlowNode).cy]);
    expect(pts.some(([x]) => x === GUTTER_X)).toBe(true);
  });

  it('leaves the rail on its left and enters the spine on its right', () => {
    const pts = coords(edgePath(edge('r2', 's3'), nodes));
    expect(pts[0]).toEqual([RAIL_X, nodeBox(nodes.get('r2') as FlowNode).cy]);
    expect(pts[pts.length - 1]).toEqual([
      SPINE_X + NODE_W,
      nodeBox(nodes.get('s3') as FlowNode).cy,
    ]);
    expect(pts.some(([x]) => x === GUTTER_X)).toBe(true);
  });

  it('sends a backward move around the outside lane', () => {
    const pts = coords(edgePath(edge('r2', 'r1', true), nodes));
    expect(pts.some(([x]) => x === BACK_X)).toBe(true);
    // and never into the gutter, which forward moves own
    expect(pts.some(([x]) => x === GUTTER_X)).toBe(false);
  });

  it('draws nothing for a self-move or a dangling end', () => {
    expect(edgePath(edge('s0', 's0'), nodes)).toBe('');
    expect(edgePath(edge('s0', 'nope'), nodes)).toBe('');
  });

  it('keeps the gutter clear of both node columns', () => {
    expect(GUTTER_X).toBeGreaterThan(SPINE_X + NODE_W);
    expect(GUTTER_X).toBeLessThan(RAIL_X);
  });
});

describe('label slots', () => {
  // A same-column move draws its vertical at the column centre. A label that
  // started at the node's left edge would have that line through the middle
  // of it — which is what the first rendering of this view actually did.
  it('grows away from the vertical a same-column move draws', () => {
    const spine = labelSlot(node('n', 'spine', 0), 0);
    expect(spine.anchor).toBe('start');
    expect(spine.x).toBeGreaterThan(nodeBox(node('n', 'spine', 0)).cx);

    // Rail labels grow LEFT, into the gutter. Growing right would run off the
    // canvas, which is what clipped them the first time this rendered.
    const rail = labelSlot(node('n', 'rail', 0), 0);
    expect(rail.anchor).toBe('end');
    expect(rail.x).toBeLessThan(nodeBox(node('n', 'rail', 0)).cx);
    expect(rail.x).toBeLessThan(CANVAS_W);
  });

  it('stacks a stage’s moves in the gap below it, never over the next row', () => {
    const n = node('s0', 'spine', 0);
    const first = labelSlot(n, 0);
    const second = labelSlot(n, 1);
    expect(second.y).toBeGreaterThan(first.y);
    expect(first.y).toBeGreaterThan(nodeBox(n).bottom);
    // signup's busiest stage has two moves out; both must clear row 1's node
    expect(second.y).toBeLessThan(nodeBox(node('next', 'spine', 1)).y);
  });
});

describe('canvas sizing', () => {
  it('widens for a backward move, narrows without a rail', () => {
    const signup = buildFlowLayout(readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS));
    expect(canvasWidth(signup)).toBe(CANVAS_W); // has decline/rescind

    const linear = buildFlowLayout(
      readStageModel(
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
        } as never,
        [],
      ),
    );
    expect(canvasWidth(linear)).toBeLessThan(CANVAS_W);
  });
});
