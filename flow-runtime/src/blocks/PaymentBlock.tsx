// flow-runtime/src/blocks/PaymentBlock.tsx
import type { ApplicationItem, FlowMode, PaymentPlanKind, RegistrationConfigDef } from '../types';
import { planAmounts, plansOf } from '../blockConfig';
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
  const planBlock = config.blocks.find((b) => b.type === 'payment_plan') ?? null;
  const plans = planBlock ? plansOf(planBlock) : [];
  const amounts = planBlock ? planAmounts(planBlock) : null;
  const kinds = plans.map((p) => p.type);
  const chosen = kinds.includes(planChoice as PaymentPlanKind)
    ? (planChoice as PaymentPlanKind)
    : kinds.length === 1 ? kinds[0] : null;

  /**
   * Structural classification, NOT a title-string match: `items.py:26-63`
   * stamps the original payment item's `block_id` with this `payment`
   * block's own `block_id`; `stripe_webhook.py:158-169` stamps the later
   * "Balance payment" item's `block_id` with the `payment_plan` block's id
   * instead (via `checkout_service.get_payment_plan_block`). `validate_blocks`
   * requires every block_id in a config to be unique, so these two values
   * are guaranteed distinct — `item.block_id !== paymentBlockId` reliably
   * means "this is the balance item," with no dependence on `item.title`
   * (staff-authored free text with no reserved-word validation — a school
   * could legitimately title its `payment` block "Balance payment," which
   * would misclassify the ORIGINAL item under a title-based check).
   * `title` is display-only below, never part of this classification.
   */
  const amountFor = (item: ApplicationItem | null): number | null => {
    if (!amounts) return null;
    const isBalanceItem = item != null && item.block_id !== paymentBlockId;
    if (isBalanceItem) {
      const balance = amounts.amount_full - amounts.deposit_amount;
      return balance > 0 ? balance : null;
    }
    return chosen ? (chosen === 'deposit' ? amounts.deposit_amount : amounts.amount_full) : null;
  };

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
                <button type="button" className="fr-btn fr-btn--primary"
                  disabled={mode === 'preview' || item == null}
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
