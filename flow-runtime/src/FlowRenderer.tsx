import { useEffect, useRef, useState } from 'react';
import type {
  ApplicationItem, ApplicationSummary, FlowBlock, FlowMode,
  PaymentPlanKind, RegistrationConfigDef, RequiredDoc,
} from './types';
import { APPLICATION_ENTITY_TYPE, DONE_ITEM_STATUSES } from './types';
import { defaultSchoolYear, formFields } from './blockConfig';
import { validateFlowField } from './validateField';
import { FlowLocaleContext, flowLocale, useFlowLocale, useFlowT, type Locale } from './i18n';
import { FormBlock } from './blocks/FormBlock';
import { DocumentsBlock } from './blocks/DocumentsBlock';
import { PaymentPlanBlock } from './blocks/PaymentPlanBlock';
import { PaymentBlock } from './blocks/PaymentBlock';
import { MessageBlock } from './blocks/MessageBlock';
import { ReviewBlock } from './blocks/ReviewBlock';
import './flow-runtime.css';

export interface FlowRendererProps {
  config: RegistrationConfigDef;
  mode: FlowMode;
  /** Host-supplied locale. Falls back to `flowLocale()` (a one-time
   *  localStorage read) when omitted. */
  locale?: Locale;
  /** null in preview mode (builder). */
  application: ApplicationSummary | null;
  /** [] in preview mode. */
  items: ApplicationItem[];
  /**
   * Parsed draft_data: { [block_id]: Record<fieldName, unknown>,
   * payment_plan_selection?: 'pay_in_full' | 'deposit' }.
   */
  values: Record<string, unknown>;
  /** Persist draft values (action save_draft). Debounced autosave + step advance. */
  onSaveDraft: (values: Record<string, unknown>) => Promise<void>;
  /**
   * Mark one item complete (action complete_item).
   *
   * No payload parameter: `complete_item` accepts only `item_id` and an
   * optional `payload_ref: string` (a document reference), so the
   * `Record<string, unknown>` this used to declare advertised a capability no
   * host could ever use — and both hosts ignored it. The form values it
   * carried are already persisted by the `onSaveDraft` that `advance()` awaits
   * immediately beforehand.
   */
  onCompleteItem: (itemId: string) => Promise<void>;
  /**
   * Upload one file for one named doc; host presigns, PUTs, completes the item.
   *
   * `itemId` is the application_item's DataCore **entity_id** (the value
   * `ApplicationItem.item_id` carries — see that type). It is supplied because
   * `DocumentsBlock` has already resolved the item and withholding it forced
   * every host into re-deriving it with `items.find(i => i.block_id ===
   * blockId && i.title === doc.name)` — a title-string match on
   * staff-authored free text, exactly the fragility `PaymentBlock` was
   * deliberately rewritten away from. Optional so the change stays additive;
   * a host should treat `undefined` as "no such item" rather than falling back
   * to matching by title.
   */
  onUploadDocument: (
    blockId: string, doc: RequiredDoc, file: File, itemId?: string,
  ) => Promise<void>;
  /** Start Stripe Checkout for the payment item. */
  onCheckout: (itemId: string) => Promise<void>;
  /** Submit the application (action submit; review block only). */
  onSubmit: () => Promise<void>;
  /** Staff mode only: open the host's offline-payment recorder for the item. */
  onRecordOfflinePayment?: (itemId: string) => void;
  /**
   * The school's display name, shown pre-filled and NON-EDITABLE on an
   * application-model form block alongside the school year.
   *
   * Which school an application belongs to is implied by the tenant, so it is
   * never collected from the applicant — `school_id` is in
   * `ENGINE_OWNED_APPLICATION_FIELDS` for exactly that reason. This prop is
   * how the applicant still SEES which school they are applying to on the
   * form itself. Host-supplied because flow-runtime never fetches: enrollx
   * reads it from the signed-in user's tenant, familyhub from the public
   * config bundle's `tenant.name`.
   */
  schoolName?: string;
}

const AUTOSAVE_MS = 1500;

function FlowRendererInner({
  config, mode, application, items, values,
  onSaveDraft, onCompleteItem, onUploadDocument, onCheckout, onSubmit,
  onRecordOfflinePayment, schoolName,
}: Omit<FlowRendererProps, 'locale'>) {
  const t = useFlowT();
  // Handed to `validateFlowField`, which is pure and so cannot use a hook —
  // without it, validation messages alone would not re-translate on a
  // language toggle, though every block component now does.
  const locale = useFlowLocale();
  const blocks = config.blocks;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveTimer = useRef<number | undefined>(undefined);
  const sectionRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);

  // Re-seed local draft when the host loads a different application.
  const appId = application?.application_id ?? null;
  useEffect(() => {
    setDraft(values);
    setStep(0);
    setShowErrors(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // Focus management on step change (a11y): move focus to the new block's
  // heading so keyboard/screen-reader users land on the content that
  // changed, without stealing focus on first mount.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    sectionRef.current?.focus();
  }, [step]);

  const scheduleAutosave = (next: Record<string, unknown>) => {
    if (mode === 'preview') return;
    window.clearTimeout(saveTimer.current);
    // `.catch(() => {})`: the host toasts the failure and rethrows, so the
    // rejection is already reported — swallowing it here only stops it
    // escaping to the global unhandled-rejection handler and drowning real
    // errors in console noise. Same reasoning at every `void` site below.
    saveTimer.current = window.setTimeout(
      () => { void onSaveDraft(next).catch(() => {}); }, AUTOSAVE_MS);
  };

  /**
   * Flush any pending debounced autosave immediately.
   *
   * `advance()` already does this before moving on, but jumping straight to a
   * step via the step rail used to call `setStep(i)` with no flush at all. The
   * gap that opens is a money bug, not a cosmetic one: select "deposit", click
   * the Payment step inside the 1500 ms debounce window, click Pay — checkout
   * re-reads `draft_data.payment_plan_selection` FROM THE SERVER, which still
   * holds the previous value. If that was `pay_in_full`, the UI shows the
   * deposit amount while Stripe charges the full amount. Narrow window,
   * but it is exactly "amount shown ≠ amount charged".
   *
   * `.catch(() => {})` because the host already surfaces save failures via its
   * own toast and rethrows; without it the rejection escapes to the global
   * unhandled-rejection handler (A11).
   */
  const flushAutosave = () => {
    if (mode === 'preview') return;
    window.clearTimeout(saveTimer.current);
    void onSaveDraft(draftRef.current).catch(() => {});
  };

  const itemsFor = (block: FlowBlock) => items.filter((i) => i.block_id === block.block_id);
  const isDone = (i: ApplicationItem) =>
    (DONE_ITEM_STATUSES as readonly string[]).includes(i.status);

  const planChoice =
    typeof draft.payment_plan_selection === 'string' ? draft.payment_plan_selection : '';

  const blockValues = (block: FlowBlock): Record<string, unknown> =>
    (draft[block.block_id] as Record<string, unknown> | undefined) ?? {};

  const setFieldValue = (block: FlowBlock, name: string, value: unknown) => {
    setDraft((prev) => {
      const next = {
        ...prev,
        [block.block_id]: {
          ...((prev[block.block_id] as Record<string, unknown> | undefined) ?? {}),
          [name]: value,
        },
      };
      scheduleAutosave(next);
      return next;
    });
  };

  const setPlanChoice = (kind: PaymentPlanKind) => {
    setDraft((prev) => {
      const next = { ...prev, payment_plan_selection: kind };
      scheduleAutosave(next);
      return next;
    });
  };

  const formErrors = (block: FlowBlock): Record<string, string | null> => {
    const vals = blockValues(block);
    const out: Record<string, string | null> = {};
    for (const f of formFields(block)) {
      out[f.name] = validateFlowField(f, vals[f.name], locale);
    }
    return out;
  };

  /** Step-rail completeness (indicator only; gating is item-based below). */
  const blockComplete = (block: FlowBlock): boolean => {
    switch (block.type) {
      case 'message': return true;
      case 'review': return false;
      case 'payment_plan': return planChoice !== '';
      default: {
        const its = itemsFor(block);
        if (its.length === 0) return false;
        const blocking = its.filter((i) => i.blocking);
        return (blocking.length > 0 ? blocking : its).every(isDone);
      }
    }
  };

  // Spec §5: only BLOCKING items gate submission; submit is legal from
  // draft (first submission) and pending_items (after fixing a rejection).
  const blockingOutstanding = items.filter((i) => i.blocking && !isDone(i));
  const canSubmit =
    mode !== 'preview' &&
    application != null &&
    (application.status === 'draft' || application.status === 'pending_items') &&
    blockingOutstanding.length === 0;

  const advance = async () => {
    const block = blocks[step];
    if (block.type === 'form') {
      const errs = formErrors(block);
      if (Object.values(errs).some(Boolean)) { setShowErrors(true); return; }
    }
    setShowErrors(false);
    if (mode !== 'preview') {
      setBusy(true);
      try {
        window.clearTimeout(saveTimer.current);
        await onSaveDraft(draftRef.current);
        if (block.type === 'form') {
          const item = itemsFor(block)[0];
          if (item && !isDone(item)) await onCompleteItem(item.item_id);
        }
      } finally {
        setBusy(false);
      }
    }
    setStep((s) => Math.min(s + 1, blocks.length - 1));
  };

  const submit = async () => {
    if (mode === 'preview') return;
    setBusy(true);
    try {
      window.clearTimeout(saveTimer.current);
      await onSaveDraft(draftRef.current);
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };

  const renderBlock = (block: FlowBlock) => {
    switch (block.type) {
      case 'form': {
        // Only the application-model block gets the school/year context: on a
        // student or family block those facts belong to the application, not
        // to the row being filled in, and repeating them on every step is
        // noise.
        const isApplicationBlock =
          block.config.entity_type === APPLICATION_ENTITY_TYPE;
        const context = isApplicationBlock ? [
          { label: t('school'), value: schoolName ?? '' },
          { label: t('schoolYear'),
            value: application?.school_year ?? defaultSchoolYear() },
        ] : undefined;
        return (
          <FormBlock blockId={block.block_id} fields={formFields(block)}
            values={blockValues(block)} errors={formErrors(block)}
            showErrors={showErrors} readOnly={busy} context={context}
            onChange={(name, value) => setFieldValue(block, name, value)} />
        );
      }
      case 'documents':
        return (
          <DocumentsBlock block={block} items={itemsFor(block)} mode={mode}
            onUpload={onUploadDocument} />
        );
      case 'payment_plan':
        // PaymentPlanBlock has no `mode` prop of its own — preview must be
        // enforced here via `disabled`, or a builder preview could "select"
        // a plan that looks persisted.
        return (
          <PaymentPlanBlock block={block} value={planChoice}
            disabled={busy || mode === 'preview'}
            onChange={setPlanChoice} />
        );
      case 'payment':
        // Deliberately NOT itemsFor(block): Plan 3's webhook
        // (stripe_webhook.py:158-169) creates the "Balance payment" item
        // with block_id copied from the payment_plan block
        // (checkout_service.py's get_payment_plan_block), not from this
        // payment block — so a strict block_id match would silently drop
        // the balance item from the UI. `kind === 'payment'` is the only
        // block-scoped signal both items reliably share (items.py:60-63
        // for the original item, stripe_webhook.py:163 for the balance
        // item); this assumes at most one payment block per flow, which
        // the rest of this file and PaymentBlock already assume.
        // `block.block_id` (this payment block's OWN id) is passed through
        // so PaymentBlock can classify the balance item structurally
        // (block_id mismatch), not by matching its title string.
        return (
          <PaymentBlock config={config} planChoice={planChoice}
            items={items.filter((i) => i.kind === 'payment')}
            paymentBlockId={block.block_id} mode={mode}
            onCheckout={onCheckout} onRecordOfflinePayment={onRecordOfflinePayment} />
        );
      case 'message':
        return <MessageBlock block={block} />;
      case 'review':
        return (
          <ReviewBlock config={config} items={items} planChoice={planChoice}
            canSubmit={canSubmit} outstanding={blockingOutstanding}
            busy={busy} mode={mode} onSubmit={submit} />
        );
      default:
        return null;
    }
  };

  if (blocks.length === 0) return <p className="fr-empty">{t('noFields')}</p>;
  const current = blocks[Math.min(step, blocks.length - 1)];

  return (
    <div className="flow-renderer" data-flow-mode={mode}>
      {mode === 'preview' && (
        <p className="fr-preview-notice" role="status">{t('previewNotice')}</p>
      )}

      <nav aria-label={t('stepsNav')}>
        <ol className="fr-steps">
          {blocks.map((b, i) => (
            <li key={b.block_id}>
              <button type="button" className="fr-step-btn"
                aria-current={i === step ? 'step' : undefined}
                onClick={() => { flushAutosave(); setShowErrors(false); setStep(i); }}>
                {blockComplete(b)
                  ? <span className="fr-step-done" aria-hidden="true">✓</span>
                  : <span aria-hidden="true">{i + 1}</span>}
                <span className="fr-sr-only">{t('step')} {i + 1}: </span>
                {b.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section ref={sectionRef} className="fr-block" tabIndex={-1} aria-label={current.title}>
        <h2 className="fr-block-title">{current.title}</h2>
        {renderBlock(current)}
      </section>

      <div className="fr-footer">
        {step > 0 ? (
          <button type="button" className="fr-btn" disabled={busy}
            onClick={() => { flushAutosave(); setShowErrors(false); setStep((s) => s - 1); }}>
            {t('back')}
          </button>
        ) : <span />}
        <span className="fr-footer-spacer" />
        {step < blocks.length - 1 && (
          <button type="button" className="fr-btn fr-btn--primary" disabled={busy}
            onClick={() => void advance().catch(() => {})}>
            {busy ? t('saving') : t('next')}
          </button>
        )}
      </div>
    </div>
  );
}

export function FlowRenderer({ locale, ...rest }: FlowRendererProps) {
  const resolvedLocale = locale ?? flowLocale();
  return (
    <FlowLocaleContext.Provider value={resolvedLocale}>
      <FlowRendererInner {...rest} />
    </FlowLocaleContext.Provider>
  );
}
