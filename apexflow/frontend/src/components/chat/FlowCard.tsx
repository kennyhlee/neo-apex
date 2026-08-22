// The assistant's answer to "show me the flow": a compact, readable summary
// of the workflow's spine, and a button into the editor's Flow view.
//
// It draws NOTHING with characters. That is the whole point — the drawer is
// 380px, and a diagram made of box-drawing glyphs cannot fit in it at any
// width (see components/chat/markdownFences.ts for what that used to look
// like). The full picture lives in the editor, which has a pane for it.
//
// Where the machine comes from, in order:
//   1. the open draft, via `editorBridge.read()` — unsaved edits included, so
//      the card and the Flow tab can never disagree;
//   2. otherwise a fetch of the saved row.
// Case 1 matters: the assistant is most often asked about the workflow the
// admin is currently editing, and that draft usually differs from the row.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEditorBridge } from '../../chat/editorBridge.ts';
import { getBundle } from '../../api/designer.ts';
import { readStageModel } from '../../editor/stage/read.ts';
import { buildFlowLayout } from '../../editor/flow/layout.ts';
import { summariseFlow, type FlowSummary } from '../../editor/flow/summary.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';
import type { MachineDef, WorkflowStepDef } from '../../types/designer.ts';
import './FlowCard.css';

/** `complete_program` -> `Complete program`. Same presentational rule the
 * Flow view uses; the authored id is what the machine stores. */
function humanize(action: string): string {
  const spaced = action.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type Source = { state: 'loading' } | { state: 'ready'; summary: FlowSummary } | { state: 'error' };

const summarise = (machine: MachineDef, steps: WorkflowStepDef[]) =>
  summariseFlow(buildFlowLayout(readStageModel(machine, steps)));

/**
 * The open draft's summary, or null when this card's workflow is not the one
 * in the editor.
 *
 * Read during RENDER, exactly as `PatchCard` reads the bridge: the registry
 * is not reactive, and holding the handle would defeat the point — it is
 * replaced on every edit, so a captured one would keep drawing the draft as
 * it looked when the card arrived. A stale read is harmless here because
 * this only draws.
 */
function readLive(entityId: string): FlowSummary | null {
  const bridge = getEditorBridge();
  if (bridge?.entityId !== entityId) return null;
  const { machine, steps } = bridge.read();
  return summarise(machine, steps);
}

export function FlowCard({
  entityId,
  name,
  tenantId,
}: {
  entityId: string;
  name: string;
  tenantId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The open draft wins, and costs no fetch and no render pass.
  const live = readLive(entityId);
  const hasLive = live !== null;
  const [remote, setRemote] = useState<Source>({ state: 'loading' });

  useEffect(() => {
    if (hasLive) return;
    let cancelled = false;
    void (async () => {
      try {
        const { definition } = await getBundle(tenantId, entityId);
        if (!cancelled) {
          setRemote({
            state: 'ready',
            summary: summarise(definition.machine, definition.steps),
          });
        }
      } catch {
        // A card that cannot load its workflow says so and still offers the
        // button — the editor can load it, and may explain why better.
        if (!cancelled) setRemote({ state: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `hasLive` rather than `live`: the summary is a fresh object every
    // render, so depending on it would refetch on every render.
  }, [entityId, tenantId, hasLive]);

  const source: Source = live ? { state: 'ready', summary: live } : remote;

  /** The editor reads its open tab straight out of `?view=`, so opening the
   * Flow view is just a navigation. That works whether or not the editor is
   * already mounted, and whether or not this card's workflow is the one on
   * screen — neither of which a card living in a drawer outside the router
   * can assume. `encodeURIComponent` because a `stage_id`-style authored id
   * may contain a slash or a space. */
  const open = () => navigate(`/definitions/${encodeURIComponent(entityId)}?view=flow`);

  return (
    <div className="flow-card">
      <div className="flow-card__head">
        <span className="flow-card__name">{name}</span>
        {source.state === 'ready' && (
          <span className="flow-card__meta">
            {t('assistant.flowCard.counts')
              .replace('{stages}', String(source.summary.stageCount))
              .replace('{moves}', String(source.summary.moveCount))
              .replace('{exits}', String(source.summary.exitCount))}
          </span>
        )}
      </div>

      <div className="flow-card__body">
        {source.state === 'loading' && (
          <p className="flow-card__muted">{t('common.loading')}</p>
        )}
        {source.state === 'error' && (
          <p className="flow-card__muted">{t('assistant.flowCard.loadError')}</p>
        )}
        {source.state === 'ready' && (
          <ol className="flow-card__chain">
            {source.summary.chain.map((link) => (
              <li key={link.node.stage_id}>
                <div className={`flow-card__stage flow-card__stage--${stageTone(link.node)}`}>
                  <span className="flow-card__stage-name">{link.node.name}</span>
                  <span className="flow-card__stage-kind">
                    {link.node.isFinish
                      ? t('editor.flow.finish')
                      : t(`editor.stage.kind.${link.node.kind}`)}
                  </span>
                </div>
                {link.next && (
                  <div className="flow-card__move">
                    <span className={`flow-card__who flow-card__who--${link.next.who}`}>
                      {t(`editor.move.who.${link.next.who}`)}
                    </span>
                    <span>{humanize(link.next.action)}</span>
                    {link.next.guardCount > 0 && (
                      <span className="flow-card__guard">{t('editor.flow.conditional')}</span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {source.state === 'ready' && source.summary.detourNames.length > 0 && (
          <p className="flow-card__aside">
            {t('assistant.flowCard.detour').replace(
              '{stages}',
              source.summary.detourNames.join(' → '),
            )}
          </p>
        )}

        {source.state === 'ready' &&
          source.summary.exits.map((exit) => (
            <p className="flow-card__exit" key={exit.key}>
              {t('assistant.flowCard.exit')
                .replace('{action}', humanize(exit.action))
                .replace('{stages}', exit.fromNames.join(', '))
                .replace('{target}', exit.name)}
            </p>
          ))}
      </div>

      <div className="flow-card__foot">
        <button type="button" className="btn btn-primary btn-sm" onClick={open}>
          {t('assistant.flowCard.open')}
        </button>
      </div>
    </div>
  );
}

/** Which accent the stage chip carries — the same three the Flow view uses. */
function stageTone(node: { kind: string; isFinish: boolean }): string {
  if (node.isFinish) return 'finish';
  return node.kind === 'initial' ? 'initial' : 'active';
}
