// The flow model — a READ-ONLY, presentational view of a `StageModel`.
//
// Nothing here is stored and nothing here writes back. `layout.ts` derives
// this from the same `StageModel` the Stages tab renders, so a machine the
// editor can author is a machine the Flow view can draw. The authoring
// round-trip proved in `stage/__tests__/roundTrip.test.ts` is untouched by
// anything in this directory.
//
// Contrast with `stage/types.ts`, where `MoveMember.order` and
// `Stage.declaredIndex` are load-bearing because the write path reproduces
// them. Here, EVERY field is presentational: get `row` wrong and the picture
// is less helpful, never incorrect.
import type { StateDef } from '../../types/designer.ts';
import type { Who } from '../stage/types.ts';

/** Which of the two columns a node sits in. `'rail'` is the branch column to
 * the right — anything that is not on the path from the start to the finish. */
export type Column = 'spine' | 'rail';

export interface FlowNode {
  stage_id: string;
  /** `Stage.name`, falling back to `stage_id` when the author left it blank —
   * the same fallback `StageEditor`'s `stageName` map makes. */
  name: string;
  kind: StateDef['kind'];
  column: Column;
  /** 0-based, monotonic top to bottom. Unique across all nodes. */
  row: number;
  stepCount: number;
  /** True for `StageModel.finishStageId`. Terminal stages that are NOT the
   * finish never become nodes at all — they are `FlowExit.to`. */
  isFinish: boolean;
}

export interface FlowEdge {
  /** `MoveGroup.key`, which is already unique per group. Suffixed with the
   * target when one group is drawn from several source stages, so two edges
   * of the same group keep distinct React keys. */
  key: string;
  from: string;
  to: string;
  action: string;
  who: Who;
  /** Target row is at or above the source row. The only edges that leave the
   * two columns, so a cycle reads as a cycle. */
  backward: boolean;
  /** Rendered as a "this move is conditional" marker, never as prose. The
   * guard text belongs to `MoveRow` in the Stages tab; duplicating it here
   * would drift from it the first time either side changes. */
  guardCount: number;
}

export interface FlowExit {
  key: string;
  /** The terminal stage this exit lands on. Not a `FlowNode`. */
  to: string;
  name: string;
  action: string;
  who: Who;
  /** Source stages, named — signup's `drop` leaves from four of them. */
  fromNames: string[];
}

export interface FlowLayout {
  /** In row order. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  exits: FlowExit[];
  rowCount: number;
  /** False when every node is on the spine, so the view can render one
   * narrow column rather than a half-empty two-column grid. */
  hasRail: boolean;
}
