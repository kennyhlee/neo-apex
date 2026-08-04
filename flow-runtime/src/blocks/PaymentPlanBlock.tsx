// flow-runtime/src/blocks/PaymentPlanBlock.tsx
import type { FlowBlock, PaymentPlanKind } from '../types';
import { planAmounts, plansOf } from '../blockConfig';
import { formatCents } from '../money';
import { useFlowT } from '../i18n';

export interface PaymentPlanBlockProps {
  block: FlowBlock;
  /** Current draft_data.payment_plan_selection ('' when unset). */
  value: string;
  disabled: boolean;
  onChange: (kind: PaymentPlanKind) => void;
}

export function PaymentPlanBlock({ block, value, disabled, onChange }: PaymentPlanBlockProps) {
  const t = useFlowT();
  const plans = plansOf(block);
  const amounts = planAmounts(block);
  const groupName = `fr-plan-${block.block_id}`;

  const labelFor = (kind: PaymentPlanKind) =>
    kind === 'pay_in_full'
      ? `${t('planPayInFull')} — ${formatCents(amounts.amount_full)}`
      : `${t('planDeposit')} — ${formatCents(amounts.deposit_amount)}`;

  if (plans.length === 0) return <p className="fr-empty">{t('noFields')}</p>;

  return (
    <fieldset className="fr-fieldset">
      <legend className="fr-legend">{t('choosePlan')}</legend>
      <div className="fr-choice-group">
        {plans.map((plan) => (
          <label key={plan.type} className="fr-choice-label">
            <input type="radio" name={groupName} value={plan.type} disabled={disabled}
              checked={value === plan.type} onChange={() => onChange(plan.type)} />
            {labelFor(plan.type)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
