// flow-runtime/src/blocks/PaymentBlock.tsx
import type { ApplicationItem, FlowMode, RegistrationConfigDef } from '../types';
import { paymentAmountFor } from '../blockConfig';
import { formatCents } from '../money';
import { useFlowT } from '../i18n';
import { DONE_ITEM_STATUSES } from '../types';

export interface PaymentBlockProps {
  config: RegistrationConfigDef;
  /** draft_data.payment_plan_selection ('' when unset). */
  planChoice: string;
  /**
   * All `kind === 'payment'` items for this application (NOT filtered to
   * this block's own `block_id` — see FlowRenderer's `case 'payment':` for
   * why). Plan 3's deposit flow yields two items over time: the original
   * payment item, and a later "Balance payment" item created when the
   * deposit settles. Both render here, each with its own derived amount.
   */
  items: ApplicationItem[];
  /**
   * The `payment` block's OWN `block_id` (not the `payment_plan` block's).
   * Used to classify which item is the balance item — see `amountFor`.
   */
  paymentBlockId: string;
  mode: FlowMode;
  onCheckout: (itemId: string) => Promise<void>;
  onRecordOfflinePayment?: (itemId: string) => void;
}

export function PaymentBlock({
  config, planChoice, items, paymentBlockId, mode, onCheckout, onRecordOfflinePayment,
}: PaymentBlockProps) {
  const t = useFlowT();

  /**
   * Amount derivation lives in `blockConfig.paymentAmountFor` — the single
   * copy shared with every host, so a host's own display of "amount due" can
   * never disagree with what this block renders. `planChoice` here is
   * FlowRenderer's live local draft value.
   */
  const amountFor = (item: ApplicationItem | null): number | null =>
    paymentAmountFor(config, planChoice, item, paymentBlockId);

  // Before any payment item exists yet (e.g. very first render, or preview
  // mode which always passes items=[]), show one placeholder row so the
  // amount is still visible with actions disabled.
  const rows: (ApplicationItem | null)[] = items.length > 0 ? items : [null];

  return (
    <ul className="fr-payment-list">
      {rows.map((item, idx) => {
        const cents = amountFor(item);
        const paid = item != null && (DONE_ITEM_STATUSES as readonly string[]).includes(item.status);
        return (
          <li key={item?.item_id ?? `fr-payment-pending-${idx}`} className="fr-payment-row">
            {item && <p className="fr-payment-title">{item.title}</p>}
            <p className="fr-legend">{t('amountDue')}</p>
            <p className="fr-payment-amount">
              {cents != null ? formatCents(cents) : t('amountAtCheckout')}
            </p>

            {paid ? (
              <p className="fr-payment-paid">
                <span aria-hidden="true">✓</span> {t('paid')}
              </p>
            ) : (
              <div className="fr-footer">
                {/* `cents == null` renders "Amount is determined at checkout",
                    which is not a real state: it means no plan is resolved, so
                    checkout would 409 on `_plan_selection`. Disable rather
                    than offer a button guaranteed to fail. */}
                <button type="button" className="fr-btn fr-btn--primary"
                  disabled={mode === 'preview' || item == null || cents == null}
                  onClick={() => { if (item) void onCheckout(item.item_id); }}>
                  {t('pay')}
                </button>
                {mode === 'staff' && onRecordOfflinePayment && (
                  <button type="button" className="fr-btn"
                    disabled={item == null}
                    onClick={() => { if (item) onRecordOfflinePayment(item.item_id); }}>
                    {t('recordOfflinePayment')}
                  </button>
                )}
                <span className="fr-footer-spacer" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
