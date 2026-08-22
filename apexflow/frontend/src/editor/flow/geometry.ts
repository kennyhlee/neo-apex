// Where things sit, and the path a move takes between them. Pure, so the
// routing rules can be argued with in a test rather than squinted at in a
// browser.
//
// ONE NODE PER ROW is the property everything else leans on. Because rows are
// unique, a horizontal segment drawn at a node's mid-height crosses only empty
// space in the other column — which is what makes the routes below safe
// without any collision search.
import type { Column, FlowEdge, FlowLayout, FlowNode } from './types.ts';

export const NODE_W = 190;
export const NODE_H = 58;
/** Node height plus the gap beneath it. The gap holds that node's move
 * labels, stacked — see `labelSlot`. */
export const ROW_H = 124;
export const SPINE_X = 24;
export const RAIL_X = 414;
/** The lane cross-column moves travel in. Sits between the two columns, wide
 * enough that nothing drawn in it touches a node. */
export const GUTTER_X = (SPINE_X + NODE_W + RAIL_X) / 2;
/** The lane backward moves travel in, outside both columns. Backward moves
 * are the only ones that leave the columns, so a cycle reads as a cycle. */
export const BACK_X = RAIL_X + NODE_W + 30;
export const CANVAS_W = BACK_X + 30;
const CORNER = 10;

export function columnX(column: Column): number {
  return column === 'spine' ? SPINE_X : RAIL_X;
}

export function nodeBox(node: FlowNode) {
  const x = columnX(node.column);
  const y = node.row * ROW_H;
  return { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2, right: x + NODE_W, bottom: y + NODE_H };
}

/**
 * Where a move's label sits: in the row gap beneath its SOURCE node, stacked
 * by index.
 *
 * Labelling the line itself is the obvious alternative and it is worse here.
 * A label pinned to a line has to dodge every other line and node, which
 * needs a collision search; a label in the row gap cannot collide with
 * anything, because one node per row means the gap below a node is empty
 * across the whole canvas. The cost is that a stage with several moves out
 * needs its target named on each line — which `FlowView` does.
 */
export function labelSlot(
  node: FlowNode,
  index: number,
): { x: number; y: number; anchor: 'start' | 'end' } {
  const { cx, bottom } = nodeBox(node);
  // Labels grow AWAY from their own column's centre line, because that line
  // is exactly where a same-column move draws its vertical — a label starting
  // at the node's left edge gets that line through the middle of it.
  //
  // Spine labels grow right and rail labels grow left, so both run into the
  // gutter between the columns. That is the only band wide enough for them,
  // and it means the canvas never has to widen to fit a label: rail labels
  // growing right would simply run off the edge and be clipped.
  //
  // They cannot collide with each other: one node per row means only one
  // stage's labels ever occupy a given row gap.
  const y = bottom + 16 + index * 14;
  return node.column === 'spine'
    ? { x: cx + 14, y, anchor: 'start' }
    : { x: cx - 14, y, anchor: 'end' };
}

/** How many labels fit in the row gap before they spill into the next row. */
export const LABELS_PER_ROW = Math.floor((ROW_H - NODE_H - 16) / 14);

/** An orthogonal polyline with rounded corners. Waypoints must alternate
 * horizontal and vertical runs; a zero-length run is skipped so a corner is
 * never drawn on top of itself. */
export function orthogonalPath(points: Array<[number, number]>): string {
  const pts = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1],
  );
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(CORNER, inLen / 2, outLen / 2);
    const bx = cx - Math.sign(cx - px) * r;
    const by = cy - Math.sign(cy - py) * r;
    const ax = cx + Math.sign(nx - cx) * r;
    const ay = cy + Math.sign(ny - cy) * r;
    d += ` L${bx},${by} Q${cx},${cy} ${ax},${ay}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last[0]},${last[1]}`;
  return d;
}

/**
 * The route a move takes, as an SVG path.
 *
 * Four shapes, chosen by (same column?, backward?):
 *   - same column, forward  -> straight down the column
 *   - cross column, forward -> out the side, along the gutter, in the side
 *   - backward (either)     -> out the right, around the back lane, in the right
 *   - self                  -> no path; `FlowView` badges the node instead
 */
export function edgePath(edge: FlowEdge, nodeById: Map<string, FlowNode>): string {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to || from.stage_id === to.stage_id) return '';
  const a = nodeBox(from);
  const b = nodeBox(to);

  if (edge.backward) {
    return orthogonalPath([
      [a.right, a.cy],
      [BACK_X, a.cy],
      [BACK_X, b.cy],
      [b.right, b.cy],
    ]);
  }

  if (from.column === to.column) {
    return orthogonalPath([
      [a.cx, a.bottom],
      [b.cx, b.y],
    ]);
  }

  // Cross-column: leave the side facing the other column, run the gutter,
  // enter the side facing back.
  const leaveX = from.column === 'spine' ? a.right : a.x;
  const enterX = to.column === 'spine' ? b.right : b.x;
  return orthogonalPath([
    [leaveX, a.cy],
    [GUTTER_X, a.cy],
    [GUTTER_X, b.cy],
    [enterX, b.cy],
  ]);
}

/** Total drawing height for the graph portion (exits render below, in HTML). */
export function canvasHeight(layout: FlowLayout): number {
  if (layout.rowCount === 0) return 0;
  return (layout.rowCount - 1) * ROW_H + NODE_H + 24;
}

/** Width actually needed: a workflow with no rail and no backward move does
 * not deserve a canvas sized for both. */
export function canvasWidth(layout: FlowLayout): number {
  if (layout.edges.some((e) => e.backward)) return CANVAS_W;
  if (layout.hasRail) return RAIL_X + NODE_W + 24;
  return SPINE_X + NODE_W + 24;
}
