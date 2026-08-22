// The Flow tab: a read-only drawing of the machine.
//
// This component owns NO machine knowledge and writes nothing. It renders a
// `FlowLayout` (from `layout.ts`) using the coordinates in `geometry.ts`, and
// its only outward signal is `onSelectStage` — which the editor page turns
// into "switch to Stages and reveal that card". Authoring stays where it was.
//
// Exits and the legend are HTML rather than SVG on purpose: they are a list
// and a key, they need to wrap on a narrow pane, and `ExitsPanel` already
// establishes that cross-cutting exits read as rules rather than as arrows.
import { useMemo } from 'react';
import { useTranslation } from '../../hooks/useTranslation.ts';
import { buildFlowLayout } from './layout.ts';
import {
  LABELS_PER_ROW,
  NODE_H,
  NODE_W,
  canvasHeight,
  canvasWidth,
  edgePath,
  labelSlot,
  nodeBox,
} from './geometry.ts';
import type { FlowEdge, FlowNode } from './types.ts';
import type { StageModel } from '../stage/types.ts';
import './FlowView.css';

/** `complete_program` -> `Complete program`. Presentational only — the
 * authored id is what the Stages tab edits and what the machine stores. */
function humanize(action: string): string {
  const spaced = action.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface FlowViewProps {
  model: StageModel;
  /** Called with a `stage_id` when the reader activates a stage. */
  onSelectStage: (stageId: string) => void;
}

export default function FlowView({ model, onSelectStage }: FlowViewProps) {
  const { t } = useTranslation();
  const layout = useMemo(() => buildFlowLayout(model), [model]);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((n) => [n.stage_id, n])),
    [layout.nodes],
  );

  if (layout.nodes.length === 0 && layout.exits.length === 0) {
    return <p className="flow-empty">{t('editor.stages.empty')}</p>;
  }

  const width = canvasWidth(layout);
  const height = canvasHeight(layout);

  // Moves grouped by source, so each stage's labels stack in the gap beneath
  // it. Order follows `layout.edges`, which follows the machine's own
  // transition order.
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of layout.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  function kindCaption(node: FlowNode): string {
    if (node.isFinish) return t('editor.flow.finish');
    return t(`editor.stage.kind.${node.kind}`);
  }

  function stepCaption(node: FlowNode): string {
    return node.stepCount === 0
      ? t('editor.flow.noSteps')
      : t('editor.flow.steps').replace('{n}', String(node.stepCount));
  }

  function activate(stageId: string) {
    onSelectStage(stageId);
  }

  return (
    <div className="flow-view">
      <div className="flow-canvas-scroll">
        <svg
          className="flow-canvas"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="group"
          aria-label={t('editor.flow.diagramLabel')}
        >
          <defs>
            {(['family', 'staff', 'both', 'automatic'] as const).map((who) => (
              <marker
                key={who}
                id={`flow-arrow-${who}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,1 L9,5 L0,9 z" className={`flow-arrowhead flow-who-${who}`} />
              </marker>
            ))}
          </defs>

          {/* Edges first, so a node paints over the point where a line meets
              it rather than the line ending on top of the border. */}
          <g className="flow-edges">
            {layout.edges.map((edge) => {
              const d = edgePath(edge, nodeById);
              if (!d) return null;
              return (
                <path
                  key={edge.key}
                  d={d}
                  className={`flow-edge flow-who-${edge.who}${edge.backward ? ' flow-edge-back' : ''}`}
                  markerEnd={`url(#flow-arrow-${edge.who})`}
                />
              );
            })}
          </g>

          <g className="flow-nodes">
            {layout.nodes.map((node) => {
              const box = nodeBox(node);
              const label = t('editor.flow.openStage').replace('{name}', node.name);
              return (
                <g
                  key={node.stage_id}
                  className="flow-node"
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  onClick={() => activate(node.stage_id)}
                  onKeyDown={(e) => {
                    // Enter and Space are what a role="button" owes a
                    // keyboard user; an SVG <g> gets neither for free.
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                      e.preventDefault();
                      activate(node.stage_id);
                    }
                  }}
                >
                  <rect
                    x={box.x}
                    y={box.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={9}
                    className={`flow-node-box flow-kind-${node.isFinish ? 'finish' : node.kind}`}
                  />
                  <rect
                    x={box.x}
                    y={box.y}
                    width={4}
                    height={NODE_H}
                    rx={2}
                    className={`flow-node-stripe flow-kind-${node.isFinish ? 'finish' : node.kind}`}
                  />
                  <text className="flow-node-name" x={box.x + 16} y={box.y + 23}>
                    {node.name}
                  </text>
                  <text className="flow-node-meta" x={box.x + 16} y={box.y + 39}>
                    {kindCaption(node)}
                  </text>
                  <text className="flow-node-meta" x={box.x + 16} y={box.y + 51}>
                    {stepCaption(node)}
                  </text>
                </g>
              );
            })}
          </g>

          <g className="flow-labels">
            {layout.nodes.flatMap((node) =>
              (outgoing.get(node.stage_id) ?? []).map((edge, i) => {
                // Beyond what the row gap holds, labels would run into the
                // next stage. Drop the overflow rather than overlap it; the
                // line is still drawn, and the Stages tab lists every move.
                if (i >= LABELS_PER_ROW) return null;
                const slot = labelSlot(node, i);
                const target = nodeById.get(edge.to);
                return (
                  <text
                    key={edge.key}
                    className="flow-label"
                    x={slot.x}
                    y={slot.y}
                    textAnchor={slot.anchor}
                  >
                    <tspan className={`flow-label-dot flow-who-${edge.who}`}>&#9679;</tspan>
                    <tspan dx="6">{humanize(edge.action)}</tspan>
                    <tspan className="flow-label-target" dx="5">
                      &#8594; {target?.name ?? edge.to}
                    </tspan>
                    {edge.guardCount > 0 && (
                      <tspan className="flow-label-guard" dx="6">
                        {t('editor.flow.conditional')}
                      </tspan>
                    )}
                  </text>
                );
              }),
            )}
          </g>
        </svg>
      </div>

      {layout.exits.length > 0 && (
        <section className="flow-exits">
          <h4>{t('editor.exits.heading')}</h4>
          <ul>
            {layout.exits.map((exit) => (
              <li key={exit.key}>
                <span className="flow-exit-target">{exit.name}</span>
                <span className="flow-exit-action">{humanize(exit.action)}</span>
                <span className="flow-exit-from">
                  {t('editor.flow.exitFrom').replace('{stages}', exit.fromNames.join(', '))}
                </span>
                <span className="flow-exit-who">{t(`editor.move.who.${exit.who}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="flow-legend">
        {(['family', 'staff', 'automatic'] as const).map((who) => (
          <li key={who}>
            <span className={`flow-legend-line flow-who-${who}`} aria-hidden="true" />
            {t(`editor.flow.legend.${who}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
