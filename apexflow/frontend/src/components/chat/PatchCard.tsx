// The review card for a `patch` proposal: the assistant's edits reach the open
// draft only when the operator presses Apply here.
//
// Three decisions worth stating, because none of them are obvious from the
// code alone:
//
// 1. WHAT THE CARD SHOWS is the model's own `summary` plus a COUNT of ops —
//    never a per-op sentence built from a `switch` over `PatchOp`. A second
//    exhaustive-looking switch is exactly the silent-drop hazard `applyPatch`'s
//    default branch was written to close: an op from a newer backend would fall
//    through it and go unmentioned on a card the operator is meant to be
//    reviewing. The count comes from `ops.length`, so an op this build cannot
//    describe still shows up as something being changed — and `applyPatch`
//    refuses the whole patch on it anyway.
// 2. APPLY IS ALL-OR-NOTHING and purely local. `applyPatch` is pure: a throw
//    means nothing was applied, so a failed Apply leaves the draft exactly as
//    it was and the card stays actionable (the proposal is not persisted —
//    retiring the buttons on failure would lose the authored edits with them).
// 3. SUCCESS IS NOT VALIDITY. Apply mutates the in-memory draft; the store's
//    debounced PUT is what validates, and its errors land on the editor's
//    validation rail. `assistant.patchAppliedMsg` therefore says the rail is
//    updated and claims nothing about the patch being correct — a card that
//    said "valid" would be wrong roughly whenever it mattered.
import { useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import type { Proposal } from '../../api/chat.ts';
import { getEditorBridge, type EditorBridge } from '../../chat/editorBridge.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';

/**
 * The bridge this card is allowed to write through, or null.
 *
 * Null for all three refusals — no editor mounted, the open draft is a
 * published/superseded row, or the route has moved to a DIFFERENT draft than
 * the one these ops were authored against. They share one disabled state and
 * one note (`assistant.readOnly`) because the operator's next move is the same
 * in every case: get onto a draft that can take the edit, then ask again.
 *
 * `routeEntityId` is derived from the router the same way `ChatPanel` derives
 * the chat context, so "which draft is open" has exactly one definition on the
 * chat side.
 */
function usableBridge(routeEntityId: string | null): EditorBridge | null {
  const bridge = getEditorBridge();
  if (!bridge || bridge.readOnly) return null;
  if (!routeEntityId || bridge.entityId !== routeEntityId) return null;
  return bridge;
}

export function PatchCard({
  proposal,
  onDone,
}: {
  proposal: Extract<Proposal, { action: 'patch' }>;
  onDone: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a click finds the bridge gone or read-only that the last
  // render still thought was usable — the registry is not reactive, so the
  // render-time read can be a paint behind (the row was published in another
  // tab, the route moved). NOTHING reads this value: its only job is to force
  // a re-render, whose own `usableBridge` call then produces the disabled
  // state and the note. Deriving the refusal from a re-read rather than
  // latching a boolean keeps it self-healing — if the bridge comes back, so
  // does the button.
  const [, forceRecheck] = useState(0);

  const routeEntityId =
    matchPath('/definitions/:entityId', location.pathname)?.params.entityId ?? null;
  const bridge = usableBridge(routeEntityId);
  // An empty patch is legal on the wire (`validate_ops` accepts `ops: []`) and
  // shows up when the model narrates a change it never encoded. Apply is
  // DISABLED rather than a no-op success: succeeding would append "the editor
  // and validation rail are updated", which would be a straight lie about a
  // draft nothing touched.
  const empty = proposal.ops.length === 0;

  const apply = () => {
    // Re-read rather than trusting the render-time `bridge`: between paint and
    // click the draft can have been published or the route changed, and the
    // store's mutators self-guard, so applying through a stale handle would
    // report success having written nothing.
    const live = usableBridge(routeEntityId);
    if (!live) {
      forceRecheck((n) => n + 1);
      return;
    }
    setError(null);
    const err = live.apply(proposal.ops);
    if (err !== null) {
      setError(err);
      return;
    }
    setApplied(true);
    onDone(t('assistant.patchAppliedMsg'));
  };

  return (
    <div className="chat-card">
      <div className="chat-card__title">{t('assistant.patchTitle')}</div>
      {proposal.summary.length > 0 && (
        <ul className="chat-card__summary">
          {proposal.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      <p className="chat-card__meta">
        {empty
          ? t('assistant.patchNoOps')
          : t('assistant.patchOpCount').replace('{n}', String(proposal.ops.length))}
      </p>
      {error && (
        <p className="chat-card__error">
          {t('assistant.applyFailed')}: {error}
        </p>
      )}
      {applied ? (
        <p className="chat-card__applied">{t('assistant.applied')}</p>
      ) : (
        !dismissed && (
          <>
            {!bridge && !empty && <p className="chat-card__note">{t('assistant.readOnly')}</p>}
            <div className="chat-card__actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!bridge || empty}
                onClick={apply}
              >
                {t('assistant.apply')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => document.getElementById('chat-panel-input')?.focus()}
              >
                {t('assistant.adjust')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDismissed(true)}
              >
                {t('assistant.dismiss')}
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
