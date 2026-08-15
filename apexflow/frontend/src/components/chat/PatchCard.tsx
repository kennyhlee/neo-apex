// The review card for a `patch` proposal: the assistant's edits reach the open
// draft only when the operator presses Apply here.
//
// Four decisions worth stating, because none of them are obvious from the
// code alone:
//
// 0. THE CARD IS PINNED TO THE DRAFT IT WAS PROPOSED FOR, via
//    `originEntityId`. This panel never unmounts (the drawer lives outside
//    `<Routes>`) and proposals are held in message state, so a card outlives
//    the route it was born on. `resolveEditorTarget` is what refuses to let
//    it apply anywhere else — see its doc comment for why the obvious check
//    (bridge id vs route id) is a tautology.
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
// 3. SUCCESS IS NOT VALIDITY, AND SUCCESS IS NOT PERSISTENCE. Apply mutates
//    the in-memory draft and stops there. `draftStore` has no autosave (see
//    its `markDirty`), so the OPERATOR'S EXPLICIT SAVE is what PUTs, validates,
//    and refreshes the rail; until then the rail still describes the last saved
//    row. `assistant.patchAppliedMsg` therefore promises only "applied to the
//    editor" and points at Save — it claims neither validity nor persistence,
//    both of which would be wrong roughly whenever it mattered. That string is
//    also replayed to the model as history, so an overclaim would teach the
//    assistant its edits had already landed.
import { useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import type { Proposal } from '../../api/chat.ts';
import { resolveEditorTarget, type BridgeRefusal } from '../../chat/editorBridge.ts';
import type { ChannelAccess, SetChannelAccessOp } from '../../chat/patchOps.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';

/**
 * The i18n key for each refusal `resolveEditorTarget` can return.
 *
 * `not_ready` maps to NO note on purpose: the editor is on the right draft and
 * simply has not published its handle yet (still loading, or mid-switch), so
 * the state is transient and self-correcting — any explanation would be wrong
 * a beat later. The other two are conditions the operator has to act on, and
 * they get different sentences: `other_draft` is not a read-only problem, and
 * telling someone to open a new draft version when their real problem is that
 * they navigated away would send them to create a draft they do not need.
 */
const REFUSAL_NOTE: Record<BridgeRefusal, string | null> = {
  other_draft: 'assistant.otherDraft',
  not_ready: null,
  read_only: 'assistant.readOnly',
};

/**
 * Channel-access values to the labels the DESIGNER already uses for them
 * (`EditorPage`'s select, `DefinitionsPage`'s column). Reused rather than
 * given assistant-local copies so the card cannot drift into calling `family`
 * something the editor two panes over does not.
 */
const CHANNEL_LABEL: Record<ChannelAccess, string> = {
  staff_only: 'definitions.channel.staffOnly',
  family: 'definitions.channel.family',
};

export function PatchCard({
  proposal,
  originEntityId,
  onDone,
}: {
  proposal: Extract<Proposal, { action: 'patch' }>;
  /** The draft that was open when this patch was proposed — `Msg.proposalOrigin`. */
  originEntityId: string | null;
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
  // a re-render, whose own `resolveEditorTarget` call then produces the
  // disabled state and the note. Deriving the refusal from a re-read rather than
  // latching a boolean keeps it self-healing — if the bridge comes back, so
  // does the button.
  const [, forceRecheck] = useState(0);

  // Derived from the router the same way `ChatPanel` derives the chat context,
  // so "which draft is open" has one definition on the chat side.
  const routeEntityId =
    matchPath('/definitions/:entityId', location.pathname)?.params.entityId ?? null;
  const { bridge, refusal } = resolveEditorTarget(originEntityId, routeEntityId);
  const note = refusal ? REFUSAL_NOTE[refusal] : null;
  // An empty patch is legal on the wire (`validate_ops` accepts `ops: []`) and
  // shows up when the model narrates a change it never encoded. Apply is
  // DISABLED rather than a no-op success: succeeding would append "applied to
  // the editor", which would be a straight lie about a draft nothing touched.
  const empty = proposal.ops.length === 0;
  // One literal `op` value, matched directly — see the comment at the render
  // site for why this stays a filter and never grows into an op-label map.
  const channelOps = proposal.ops.filter(
    (op): op is SetChannelAccessOp => op.op === 'set_channel_access',
  );

  const apply = () => {
    // Re-read rather than trusting the render-time `bridge`: between paint and
    // click the draft can have been published or the route changed, and the
    // store's mutators self-guard, so applying through a stale handle would
    // report success having written nothing.
    const live = resolveEditorTarget(originEntityId, routeEntityId).bridge;
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
      {/* A channel change is the one op whose consequence is invisible in the
          stage editor — it decides whether families can reach this workflow at
          all — and the model's prose `summary` is free to omit it. So it gets
          one always-correct line of its own, derived from the ops rather than
          from anything the model wrote.

          This is a NARROW FILTER FOR ONE OP, deliberately not the first entry
          in a per-op label map. Decision 1 above stands: a `switch` over
          `PatchOp` that looked exhaustive would silently drop an op from a
          newer backend. Filtering for one known literal cannot — an op it does
          not match simply stays counted by `patchOpCount`, which is exactly
          the fallback everything else still relies on. */}
      {channelOps.map((op, i) => (
        <p className="chat-card__meta" key={i}>
          {t('assistant.patchChannelAccess').replace(
            '{value}',
            t(CHANNEL_LABEL[op.value]),
          )}
        </p>
      ))}
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
            {note && !empty && <p className="chat-card__note">{t(note)}</p>}
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
