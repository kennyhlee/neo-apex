// flow-runtime/src/blocks/PaymentBlock.tsx
import type { ApplicationItem, FlowMode, RegistrationConfigDef } from '../types';
import { planAmounts, plansOf } from '../blockConfig';
import { formatCents } from '../money';
import { useFlowT } from '../i18n';
import { DONE_ITEM_STATUSES } from '../types';

export interface PaymentBlockProps {
  config: RegistrationConfigDef;
  /** draft_data.payment_plan_selection ('' when unset). */
  planChoice: string;
  item: ApplicationItem | null;
  mode: FlowMode;
  onCheckout: (itemId: string) => Promise<void>;
  onRecordOfflinePayment?: (itemId: string) => void;
}

export function PaymentBlock({
  config, planChoice, item, mode, onCheckout, onRecordOfflinePayment,
}: PaymentBlockProps) {
  const t = useFlowT();
  const planBlock = config.blocks.find((b) => b.type === 'payment_plan') ?? null;
  const plans = planBlock ? plansOf(planBlock) : [];
  const amounts = planBlock ? planAmounts(planBlock) : null;
  const kinds = plans.map((p) => p.type);
  const chosen = kinds.includes(planChoice as 'pay_in_full' | 'deposit')
    ? (planChoice as 'pay_in_full' | 'deposit')
    : kinds.length === 1 ? kinds[0] : null;
  const cents = amounts && chosen
    ? (chosen === 'deposit' ? amounts.deposit_amount : amounts.amount_full)
    : null;

  const paid = item != null && (DONE_ITEM_STATUSES as readonly string[]).includes(item.status);

  return (
    <div>
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
    </div>
  );
}
