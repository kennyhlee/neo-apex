// flow-runtime/src/blockConfig.ts
import type { FlowBlock, FlowField, PaymentPlanOption, RequiredDoc } from './types';

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
