// flow-runtime/src/blockConfig.ts
import type {
  ApplicationItem, FlowBlock, FlowField, PaymentPlanKind, PaymentPlanOption,
  RegistrationConfigDef, RequiredDoc,
} from './types';

/**
 * Fields of a form block. `config.fields` is the HOST-hydrated list (set when
 * the block draws from an entity model); `config.custom_fields` is the
 * builder-authored list. Hydration wins when present.
 */
export function formFields(block: FlowBlock): FlowField[] {
  const hydrated = block.config.fields;
  if (Array.isArray(hydrated)) return hydrated as FlowField[];
  const custom = block.config.custom_fields;
  return Array.isArray(custom) ? (custom as FlowField[]) : [];
}

export function docsOf(block: FlowBlock): RequiredDoc[] {
  const d = block.config.docs;
  return Array.isArray(d) ? (d as RequiredDoc[]) : [];
}

/** Offered plans of a payment_plan block (array of {type, deposit_amount?}). */
export function plansOf(block: FlowBlock): PaymentPlanOption[] {
  const p = block.config.plans;
  if (!Array.isArray(p)) return [];
  return (p as unknown[]).filter((o): o is PaymentPlanOption => {
    if (typeof o !== 'object' || o === null) return false;
    const t = (o as { type?: unknown }).type;
    return t === 'pay_in_full' || t === 'deposit';
  });
}

/** Amounts in integer cents: amount_full is top-level config, deposit_amount
 *  lives on the deposit plan object (Plan 3 contract). */
export function planAmounts(block: FlowBlock): { amount_full: number; deposit_amount: number } {
  const deposit = plansOf(block).find((p) => p.type === 'deposit');
  return {
    amount_full: typeof block.config.amount_full === 'number' ? block.config.amount_full : 0,
    deposit_amount: typeof deposit?.deposit_amount === 'number' ? deposit.deposit_amount : 0,
  };
}

export function messageBody(block: FlowBlock): string {
  return typeof block.config.body === 'string' ? block.config.body : '';
}

/**
 * The plan actually in effect, or null when it cannot be determined.
 *
 * A single offered plan is implied and needs no explicit selection — this is
 * the same rule `checkout_service._plan_selection` applies server-side. Any
 * other unrecognised or absent `planChoice` resolves to null, meaning "no
 * amount can be derived yet."
 *
 * `planChoice` is an explicit PARAMETER rather than something read from
 * ambient state, on purpose: see `paymentAmountFor`.
 */
export function resolvePlanKind(
  config: RegistrationConfigDef, planChoice: string,
): PaymentPlanKind | null {
  const planBlock = config.blocks.find((b) => b.type === 'payment_plan');
  if (!planBlock) return null;
  const kinds = plansOf(planBlock).map((p) => p.type);
  if (kinds.includes(planChoice as PaymentPlanKind)) return planChoice as PaymentPlanKind;
  return kinds.length === 1 ? kinds[0] : null;
}

/**
 * Amount due in integer cents for one payment item, or null when no amount
 * can be derived yet (no payment_plan block, or no plan resolved).
 *
 * THE ONE derivation of this number. It previously existed twice — once in
 * `PaymentBlock`, once re-implemented in the enrollx host for its
 * offline-payment modal — and the two copies did not merely risk drifting,
 * they were already divergent: `PaymentBlock` derived from the live local
 * draft while the host derived from server-loaded `draft_data`, which
 * `save_draft` never refreshes. They could disagree on first run with nobody
 * having edited anything, and the host could display "Amount due: $500.00"
 * beside a PaymentBlock rendering $200.00 for the same item.
 *
 * `planChoice` is an explicit parameter for exactly that reason: it forces
 * each caller to supply the selection it means, rather than quietly reaching
 * for whichever plausible state is nearest. Callers must pass the LIVE
 * selection.
 *
 * `item`/`paymentBlockId` classification is structural, not a title match:
 * `items.py` stamps the original payment item with the `payment` block's own
 * block_id, while `stripe_webhook.py` stamps the later "Balance payment" item
 * with the `payment_plan` block's id (via
 * `checkout_service.get_payment_plan_block`). `validate_blocks` guarantees
 * block_ids are unique, so a mismatch reliably means "balance item" with no
 * dependence on staff-authored title text.
 */
export function paymentAmountFor(
  config: RegistrationConfigDef,
  planChoice: string,
  item: ApplicationItem | null,
  paymentBlockId: string | null,
): number | null {
  const planBlock = config.blocks.find((b) => b.type === 'payment_plan');
  if (!planBlock) return null;
  const amounts = planAmounts(planBlock);

  const isBalanceItem =
    item != null && paymentBlockId != null && item.block_id !== paymentBlockId;
  if (isBalanceItem) {
    const balance = amounts.amount_full - amounts.deposit_amount;
    return balance > 0 ? balance : null;
  }

  const chosen = resolvePlanKind(config, planChoice);
  if (!chosen) return null;
  return chosen === 'deposit' ? amounts.deposit_amount : amounts.amount_full;
}
