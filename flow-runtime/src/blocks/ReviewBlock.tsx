// flow-runtime/src/blocks/ReviewBlock.tsx
import type { ApplicationItem, FlowMode, RegistrationConfigDef } from '../types';
import { DONE_ITEM_STATUSES } from '../types';
import { useFlowT } from '../i18n';

export interface ReviewBlockProps {
  config: RegistrationConfigDef;
  items: ApplicationItem[];
  /** draft_data.payment_plan_selection ('' when unset). */
  planChoice: string;
  canSubmit: boolean;
  outstanding: ApplicationItem[];
  busy: boolean;
  mode: FlowMode;
  onSubmit: () => Promise<void>;
}

export function ReviewBlock({
  config, items, planChoice, canSubmit, outstanding, busy, mode, onSubmit,
}: ReviewBlockProps) {
  const t = useFlowT();
  const isDone = (i: ApplicationItem) =>
    (DONE_ITEM_STATUSES as readonly string[]).includes(i.status);

  const blockDone = (blockId: string, type: string): boolean => {
    if (type === 'payment_plan') return planChoice !== '';
    const its = items.filter((i) => i.block_id === blockId);
    if (its.length === 0) return false;
    return its.filter((i) => i.blocking).every(isDone) &&
      (its.some((i) => i.blocking) ? true : its.every(isDone));
  };

  return (
    <div className="fr-review">
      <ul className="fr-review-list">
        {config.blocks
          .filter((b) => b.type !== 'review' && b.type !== 'message')
          .map((b) => {
            const done = blockDone(b.block_id, b.type);
            return (
              <li key={b.block_id} className={done ? 'fr-review-done' : 'fr-review-open'}>
                <span aria-hidden="true">{done ? '✓' : '○'}</span> {b.title}
              </li>
            );
          })}
      </ul>

      {outstanding.length > 0 && (
        <p className="fr-review-warn" role="status">
          {t('outstandingBefore')} {outstanding.map((i) => i.title).join(', ')}
        </p>
      )}

      {/* `.catch(() => {})` on onSubmit: FlowRenderer's `submit()` propagates
          the host's rethrow (which the host has already toasted), so without
          it the rejection escapes to the global unhandled-rejection handler. */}
      <button type="button" className="fr-btn fr-btn--primary"
        disabled={!canSubmit || busy || mode === 'preview'}
        onClick={() => void onSubmit().catch(() => {})}>
        {busy ? t('submitting') : t('submitApplication')}
      </button>
    </div>
  );
}
