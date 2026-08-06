// flow-runtime/src/blockConfig.ts
import type {
  ApplicationItem, FlowBlock, FlowField, PaymentPlanKind, PaymentPlanOption,
  RegistrationConfigDef, RequiredDoc,
} from './types';
import { APPLICATION_ENTITY_TYPE, ENGINE_OWNED_APPLICATION_FIELDS } from './types';

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
 * `snake_case` field name -> "Title Case" display label.
 *
 * Shared by `FormBlock.tsx` (registration-era) and `StepRenderer.tsx`
 * (apexflow-era) so the same field name reads identically in both
 * renderers rather than risking two copies drifting apart.
 */
export function labelOf(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

/**
 * The academic year straddling `now`, rolling over each July: `${y}-${y+1}`
 * where `y` is `now`'s year when the month is July or later, else the
 * previous year. `getMonth()` is 0-indexed, so `>= 6` IS July.
 *
 * Lives here so both channels derive the identical default: the staff New
 * Application form prefills it, the parent start page shows it read-only,
 * and familyhub-backend restates the same rule in Python
 * (`_school_year_for_date`, `familyhub/backend/app/api/registration.py`) --
 * a staff-side host restating it must match exactly (enrollx's
 * `engine.default_school_year` did, pre-Task-12).
 */
export function defaultSchoolYear(now: Date = new Date()): string {
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/** A tenant model definition, as both hosts already hold it. */
export interface ModelFieldSource {
  base_fields: FlowField[];
  custom_fields: FlowField[];
}

/**
 * The fields a `form` block sourced from an entity model should render.
 *
 * THE ONE derivation, shared by every host, because the two rules below are
 * easy to get subtly different and a mistake is visible to parents:
 *
 * 1. The entity's own `{entityType}_id` is auto-generated and never editable
 *    (project convention) — always excluded.
 * 2. For `registration_application` ONLY, the engine owns every base field
 *    (`ENGINE_OWNED_APPLICATION_FIELDS`), so only the tenant's
 *    `custom_fields` are offered — those are the agreement/signature fields
 *    model setup extracted from the real admission packet. The engine-owned
 *    exclusion is deliberately NOT applied to other entity types: `status`
 *    is a perfectly legitimate `student` field and dropping it there would
 *    silently delete a field staff rely on.
 *
 * Restated server-side by a staff host's model-field hydration (enrollx's
 * `engine.model_form_fields`, pre-Task-12) to hydrate the parent channel
 * (familyhub holds no DataCore credential). No staff host currently calls
 * this function -- apexflow has no frontend yet (Phase 2) -- so it is
 * presently unused but kept exported for that future host.
 */
export function hydratedFormFields(
  entityType: string, model: ModelFieldSource,
): FlowField[] {
  const isApplication = entityType === APPLICATION_ENTITY_TYPE;
  const fields = isApplication
    ? model.custom_fields
    : [...model.base_fields, ...model.custom_fields];
  const excluded = new Set<string>([`${entityType}_id`]);
  if (isApplication) {
    for (const name of ENGINE_OWNED_APPLICATION_FIELDS) excluded.add(name);
  }
  return fields.filter((f) => !excluded.has(f.name));
}
