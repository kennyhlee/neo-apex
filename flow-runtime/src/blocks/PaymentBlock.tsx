// flow-runtime/src/blocks/PaymentBlock.tsx
import type { ApplicationItem, FlowMode, PaymentPlanKind, RegistrationConfigDef } from '../types';
import { planAmounts, plansOf } from '../blockConfig';
import { formatCents } from '../money';
import { useFlowT } from '../i18n';
import { DONE_ITEM_STATUSES } from '../types';

/**
 * Mirrors `BALANCE_ITEM_TITLE` in `enrollx/backend/app/api/stripe_webhook.py:63`.
 * `ApplicationItem` (types.ts) carries no amount and no structural flag
 * distinguishing this item from the original payment item — title is the
 * only signal the backend gives us without a backend change. See the
 * `amountFor` comment below for why this can't be avoided.
 */
const BALANCE_ITEM_TITLE = 'Balance payment';

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
  mode: FlowMode;
  onCheckout: (itemId: string) => Promise<void>;
  onRecordOfflinePayment?: (itemId: string) => void;
}

export function PaymentBlock({
  config, planChoice, items, mode, onCheckout, onRecordOfflinePayment,
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
   * The balance item's due amount is `amount_full - deposit_amount` — it is
   * NEVER the plan-chosen amount, because by definition it only exists once
   * the deposit has already been paid. Everything else (the original item,
   * or the pre-item placeholder row below) uses the plan-chosen amount, same
   * as before this task. Distinguishing on `item.title` is a deliberate,
   * documented special case, not an oversight — see the module-level
   * comment on `BALANCE_ITEM_TITLE`.
   */
  const amountFor = (item: ApplicationItem | null): number | null => {
    if (!amounts) return null;
    if (item && item.title === BALANCE_ITEM_TITLE) {
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
