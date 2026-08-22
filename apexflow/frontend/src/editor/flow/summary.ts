// FlowLayout -> what fits in a 380px chat card.
//
// The Flow TAB has a whole pane and draws everything. The card has one narrow
// column, so it shows the spine — the path from the start to the finish —
// and says the rest in a line. Pure, so what gets kept and what gets
// collapsed is decided somewhere it can be argued with.
import type { FlowEdge, FlowExit, FlowLayout, FlowNode } from './types.ts';
import type { Who } from '../stage/types.ts';

export interface FlowChainLink {
  node: FlowNode;
  /** The move from this stage to the NEXT stage in the chain, or undefined
   * for the last one (and for a stage whose successor is only reachable via
   * the rail — the detour line covers that case). */
  next?: { action: string; who: Who; guardCount: number };
}

export interface FlowSummary {
  chain: FlowChainLink[];
  /** Rail stages, named, in row order — collapsed into one "via …" line. */
  detourNames: string[];
  exits: FlowExit[];
  stageCount: number;
  moveCount: number;
  exitCount: number;
}

export function summariseFlow(layout: FlowLayout): FlowSummary {
  // Spine order is row order among spine nodes. With no initial stage there
  // is no spine at all and `layout` puts every node in one column, which is
  // exactly what should be listed — a card that renders blank because the
  // machine has no start tells the author nothing.
  const chainNodes = layout.nodes
    .filter((n) => n.column === 'spine')
    .sort((a, b) => a.row - b.row);

  const byPair = new Map<string, FlowEdge>();
  for (const edge of layout.edges) {
    const key = `${edge.from}>${edge.to}`;
    // First wins: `layout.edges` follows the machine's own transition order,
    // so a stage with two moves to the same place shows the one declared
    // first rather than an arbitrary one.
    if (!byPair.has(key)) byPair.set(key, edge);
  }

  const chain: FlowChainLink[] = chainNodes.map((node, i) => {
    const successor = chainNodes[i + 1];
    const edge = successor ? byPair.get(`${node.stage_id}>${successor.stage_id}`) : undefined;
    return edge
      ? { node, next: { action: edge.action, who: edge.who, guardCount: edge.guardCount } }
      : { node };
  });

  return {
    chain,
    detourNames: layout.nodes
      .filter((n) => n.column === 'rail')
      .sort((a, b) => a.row - b.row)
      .map((n) => n.name),
    exits: layout.exits,
    stageCount: layout.nodes.length,
    moveCount: layout.edges.length,
    exitCount: layout.exits.length,
  };
}
