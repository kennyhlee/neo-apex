// enrollx/frontend/src/pages/ConfigBuilderPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FlowRenderer } from '@neoapex/flow-runtime';
import type {
  BlockType, FlowBlock, PaymentPlanOption, RegistrationConfigDef, RequiredDoc,
} from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import type { ModelDefinition } from '../types/models.ts';
import { createEntity, escapeSql, fetchNextEntityId, postQuery, updateEntity } from '../api/client.ts';
import { publishConfig } from '../api/registration.ts';
import type { ConfigRow, ProgramRow } from '../types/registration.ts';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import BlockConfigPanel from '../components/BlockConfigPanel.tsx';
import './ConfigBuilderPage.css';

const ADDABLE: BlockType[] = ['form', 'documents', 'payment_plan', 'payment', 'message'];

function newBlockId(): string {
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newBlock(type: BlockType, title: string): FlowBlock {
  const base = { block_id: newBlockId(), type, title, required: true, blocking: true };
  switch (type) {
    case 'form': return { ...base, config: { custom_fields: [] } };
    case 'documents': return { ...base, config: { docs: [] } };
    case 'payment_plan':
      return {
        ...base,
        config: { currency: 'usd', amount_full: 0, plans: [{ type: 'pay_in_full' }] },
      };
    // A `payment` block has no config of its own: the amount is derived
    // entirely from the `payment_plan` block plus
    // `draft_data.payment_plan_selection` (checkout_service.py). The former
    // `collects: 'full' | 'deposit'` seed was read by nothing anywhere in
    // the stack — removed rather than wired to something invented.
    case 'payment': return { ...base, config: {} };
    case 'message': return { ...base, blocking: false, required: false, config: { body: '' } };
    default: return { ...base, config: {} };
  }
}

/** Spec §4: review is fixed and always last. */
function withReview(blocks: FlowBlock[], reviewTitle: string): FlowBlock[] {
  return [...blocks, {
    block_id: 'blk_review', type: 'review', title: reviewTitle,
    required: true, blocking: true, config: {},
  }];
}

/**
 * Type-faithful integer-cents check, matching the backend's `isinstance(x,
 * int)` (items.py validate_blocks) rather than `Number(...)`'s coercion —
 * `Number("10000")` and `Number(true)` both produce a valid-looking finite
 * number, which would let a stringified/boolean amount slip past this gate
 * and fail only at the real publish_config 422. A non-integer, negative, or
 * wrong-typed value is treated identically here (this function only needs to
 * flag "not safe to publish," not diagnose why) — `BlockConfigPanel`'s
 * `centsToDollars` renders any of them as an unremarkable $0.00, so this
 * check is what actually surfaces the problem to staff instead of it being
 * silently masked as a legitimate zero fee.
 */
function isValidCents(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Same integer-or-absent contract as `due_days_after_approval` throughout
 *  the backend (items.py's block-level check; `derive_items`'s per-doc
 *  `int(due_days)` truncation) — `undefined` is fine (field not set), any
 *  other non-integer is not. */
function isValidDueDays(v: unknown): boolean {
  return v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0);
}

/**
 * Client-side mirror of the backend's `validate_blocks`
 * (`enrollx/backend/app/registration/items.py:68-140`), PLUS the
 * cross-block-type cardinality rule that function does not enforce (payment
 * cardinality; INTERFACE-MAP Gap §5, this task's own responsibility since
 * Plan 4 cannot touch the backend). Operates on the AUTHORED blocks (review
 * excluded — it's structurally always last and always valid).
 *
 * publish_config re-runs the real validate_blocks server-side; this exists
 * so publish fails fast in the UI instead of round-tripping to a 422.
 */
function validateForPublish(blocks: FlowBlock[], t: (key: string) => string): string[] {
  const issues: string[] = [];
  if (blocks.length === 0) {
    issues.push(t('builder.errNoBlocks'));
    return issues;
  }

  const paymentPlanCount = blocks.filter((b) => b.type === 'payment_plan').length;
  const paymentCount = blocks.filter((b) => b.type === 'payment').length;
  if (paymentPlanCount > 1) issues.push(t('builder.tooManyPaymentPlan'));
  if (paymentCount > 1) issues.push(t('builder.tooManyPayment'));

  /**
   * Payment pairing and ordering. Three configs that pass every per-block
   * check and are still dead ends at runtime — none of which
   * `validate_blocks` catches, so the builder is the only place they can be
   * caught (INTERFACE-MAP Gap §5):
   *
   * 1. `payment_plan` with NO `payment` block — `derive_items` only creates
   *    a payment item from a `payment` block, so the family picks a plan and
   *    is never charged. Silent revenue loss with no error anywhere.
   * 2. `payment` with NO `payment_plan` — `checkout_service.get_payment_plan_block`
   *    409s at checkout; there is nothing to derive an amount from.
   * 3. `payment` ordered BEFORE `payment_plan` — the family reaches Pay
   *    before choosing, and `_plan_selection` 409s. (It happens to survive
   *    when exactly one plan is offered, since the choice is then implied,
   *    but authoring it is never intentional and the flow reads backwards,
   *    so this is enforced unconditionally.)
   */
  const paymentIdx = blocks.findIndex((b) => b.type === 'payment');
  const planIdx = blocks.findIndex((b) => b.type === 'payment_plan');
  if (planIdx >= 0 && paymentIdx < 0) issues.push(t('builder.errPlanWithoutPayment'));
  if (paymentIdx >= 0 && planIdx < 0) issues.push(t('builder.errPaymentWithoutPlan'));
  if (paymentIdx >= 0 && planIdx >= 0 && paymentIdx < planIdx) {
    issues.push(t('builder.errPaymentBeforePlan'));
  }

  blocks.forEach((b, i) => {
    const label = b.title.trim() || `${t(`builder.blockType.${b.type}`)} #${i + 1}`;
    if (!b.title.trim()) {
      issues.push(`${label}: ${t('builder.errTitleRequired')}`);
    }
    // Backend checks this on every block type, not only documents/payment_plan
    // (items.py validate_blocks: `if "due_days_after_approval" in b: ...`).
    if (!isValidDueDays(b.due_days_after_approval)) {
      issues.push(`${label}: ${t('builder.errDueDaysInvalid')}`);
    }
    if (b.type === 'documents') {
      const docs = Array.isArray(b.config.docs) ? (b.config.docs as RequiredDoc[]) : [];
      if (docs.length === 0) {
        issues.push(`${label}: ${t('builder.errDocsEmpty')}`);
      } else if (docs.some((d) => !d.name || !d.name.trim())) {
        issues.push(`${label}: ${t('builder.errDocNameRequired')}`);
      }
      // Not checked by validate_blocks itself, but `derive_items` truncates a
      // non-int per-doc due_days_after_approval via Python's `int(...)`
      // (silent, not even a 422) — worth catching client-side since the
      // backend never will.
      if (docs.some((d) => !isValidDueDays(d.due_days_after_approval))) {
        issues.push(`${label}: ${t('builder.errDueDaysInvalid')}`);
      }
    }
    if (b.type === 'payment_plan') {
      const plans = Array.isArray(b.config.plans) ? (b.config.plans as PaymentPlanOption[]) : [];
      if (plans.length === 0) {
        issues.push(`${label}: ${t('builder.errPlansEmpty')}`);
      }
      if (!isValidCents(b.config.amount_full)) {
        issues.push(`${label}: ${t('builder.errAmountInvalid')}`);
      } else if ((b.config.amount_full as number) <= 0) {
        // Same trap as the deposit range check below, one branch over, and it
        // fires on the far more common pay-in-full flow: `newBlock` seeds
        // `amount_full: 0` and `isValidCents` accepts 0, so a payment_plan
        // block left at its defaults was publishable — and
        // `checkout_service.py:161-163` rejects `amount_full <= 0` with a 409
        // for the first family to reach checkout.
        issues.push(`${label}: ${t('builder.errAmountZero')}`);
      }
      const deposit = plans.find((p) => p.type === 'deposit');
      if (deposit && !isValidCents(deposit.deposit_amount)) {
        issues.push(`${label}: ${t('builder.errDepositInvalid')}`);
      } else if (deposit && isValidCents(b.config.amount_full)) {
        // `isValidCents` accepts 0, and `togglePlan('deposit', true)` seeds
        // `deposit_amount: 0` — so a freshly-added deposit plan's DEFAULT
        // state is one `checkout_service.py:170-171` rejects with a 409
        // (`deposit_amount <= 0 or deposit_amount >= amount_full`), and
        // `stripe_webhook.py` silently skips the balance item and its
        // reminder when the balance is <= 0. Nothing else compares the two
        // amounts, so without this a school publishes a flow that looks
        // fine and the first family to pay gets an opaque error.
        const dep = deposit.deposit_amount as number;
        const full = b.config.amount_full as number;
        if (dep <= 0 || dep >= full) {
          issues.push(`${label}: ${t('builder.errDepositRange')}`);
        }
      }
    }
  });
  return issues;
}

export default function ConfigBuilderPage() {
  const { programId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const { getModel } = useModel();

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [blocks, setBlocks] = useState<FlowBlock[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [version, setVersion] = useState(1);
  const [configStatus, setConfigStatus] = useState<'draft' | 'published'>('draft');
  const [addType, setAddType] = useState<BlockType>('form');
  const [models, setModels] = useState<Record<string, ModelDefinition>>({});
  const [saving, setSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * SQL #1/#2 both filter on `entity_type` + `_status` (DataCore system
   * columns, always safe) plus `program_id`. `program_id` is written by BOTH
   * `program` (its own business id) and `registration_config` (the FK back
   * to its owning program) — two entity types, so it is never a
   * single-writer field and can't trigger the binder "column doesn't exist
   * yet" error (DISPATCH-CONTEXT's SQL hazard note). `SELECT *` throughout:
   * no per-field predicate ever names a column only one entity type writes.
   */
  const load = useCallback(async () => {
    if (!tenant) return;
    try {
      const pr = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active' AND program_id = '${escapeSql(programId)}'`);
      setProgram((pr.data[0] as unknown as ProgramRow) ?? null);

      const cr = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = 'registration_config' AND _status = 'active' AND program_id = '${escapeSql(programId)}'`);
      const rows = cr.data as unknown as ConfigRow[];
      // ConfigRow.version arrives from DataCore as a string on every row
      // (data-shape trap: every entity field is a string) — coerce before
      // comparing/sorting/incrementing.
      const latest = [...rows].sort((a, b) => Number(b.version) - Number(a.version))[0];
      if (latest) {
        setEntityId(latest.entity_id);
        setConfigId(latest.config_id);
        setVersion(Number(latest.version));
        setConfigStatus(latest.status === 'published' ? 'published' : 'draft');
        const parsed = JSON.parse(String(latest.blocks)) as FlowBlock[];
        setBlocks(parsed.filter((b) => b.type !== 'review'));
      } else {
        setEntityId(null);
        setConfigId(null);
        setVersion(1);
        setConfigStatus('draft');
        setBlocks([]);
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [tenant, programId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Hydrate entity-model fields for the preview (host responsibility —
  // flow-runtime never fetches anything itself).
  useEffect(() => {
    for (const b of blocks) {
      const et = b.type === 'form' && typeof b.config.entity_type === 'string'
        ? b.config.entity_type : null;
      if (et && !models[et]) {
        getModel(tenant, et)
          .then((m) => setModels((prev) => ({ ...prev, [et]: m })))
          .catch(() => { /* model not configured — preview shows noFields */ });
      }
    }
  }, [blocks, models, tenant, getModel]);

  const previewConfig: RegistrationConfigDef = useMemo(() => ({
    config_id: configId ?? 'preview',
    program_id: programId,
    version,
    status: 'draft',
    blocks: withReview(blocks, t('builder.reviewTitle')).map((b) => {
      const et = b.type === 'form' && typeof b.config.entity_type === 'string'
        ? b.config.entity_type : null;
      if (!et) return b;
      const m = models[et];
      // The entity's own id field is auto-generated and never staff/parent
      // editable (project convention) — exclude it from the previewed form.
      const fields = m
        ? [...m.base_fields, ...m.custom_fields].filter((f) => f.name !== `${et}_id`)
        : [];
      return { ...b, config: { ...b.config, fields } };
    }),
  }), [blocks, models, configId, programId, version, t]);

  // FlowRendererProps callbacks are irrelevant in mode="preview" — every
  // block component is verified inert there (Task 4). A function with FEWER
  // parameters than the declared type is assignable in TS, so these can be
  // zero-arg without any unused-parameter warning.
  const noopSave = async () => {};
  const noopItem = async () => {};
  const noopUpload = async () => {};
  const noopCheckout = async () => {};
  const noopSubmit = async () => {};

  const paymentPlanCount = blocks.filter((b) => b.type === 'payment_plan').length;
  const paymentCount = blocks.filter((b) => b.type === 'payment').length;
  // validate_blocks does not cap payment_plan/payment blocks at one each
  // (INTERFACE-MAP Gap §5) — Plan 3's amount derivation and Task 4's
  // PaymentBlock both assume exactly one of each, so the builder is the only
  // place left to enforce it. Proactively remove the option from "Add step"
  // once one exists...
  const addableTypes = useMemo(
    () => ADDABLE.filter((bt) => !(
      (bt === 'payment_plan' && paymentPlanCount >= 1) || (bt === 'payment' && paymentCount >= 1)
    )),
    [paymentPlanCount, paymentCount],
  );
  // ...and derive the effective selection during render instead of an Effect
  // that "clamps" addType — avoids a stale/invalid select value without
  // needing to sync state.
  const effectiveAddType = addableTypes.includes(addType) ? addType : addableTypes[0];

  // ...but still WARN live (not only at publish) if a loaded config already
  // violates it — e.g. an existing config authored before this rule existed.
  const validationErrors = useMemo(() => validateForPublish(blocks, t), [blocks, t]);

  /**
   * Focus management for the step list (a11y).
   *
   * Every reordering control can destroy the element holding focus:
   * `move(i, -1)` to index 0 DISABLES the very ↑ button that was clicked, and
   * `×` unmounts its own button outright. Either way focus falls back to
   * `<body>` and a keyboard user is silently dumped to the top of the
   * document — in the densest keyboard surface on the branch. `FlowRenderer`
   * got proper focus management on step change; this list had none.
   *
   * A ref, not state: the target is only meaningful for the single commit
   * that follows the mutation, and re-rendering to record it would be
   * pointless. The effect runs after every render but exits immediately
   * unless something queued a target.
   */
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | 'add' | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === 'add') addBtnRef.current?.focus();
    else rowRefs.current[target]?.focus();
  });

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    // Follow the row to its new position rather than leaving focus on a
    // now-possibly-disabled arrow.
    pendingFocus.current = j;
    setBlocks(next);
    setSelected(j);
  };

  const removeBlock = (i: number) => {
    const next = blocks.filter((_, j) => j !== i);
    // The next row takes the removed row's index; removing the last row falls
    // back to the previous one, and emptying the list falls back to "Add".
    pendingFocus.current = next.length === 0 ? 'add' : Math.min(i, next.length - 1);
    rowRefs.current.length = next.length;
    setBlocks(next);
    setSelected(-1);
  };

  /**
   * Persists the draft and returns the config row's DataCore **entity_id**
   * (null on failure) — NOT the business `config_id`.
   *
   * Identifier convention (DISPATCH-CONTEXT): rows carry two independent
   * ids that never match. DataCore mints `entity_id` server-side
   * (`uuid.uuid4().hex[:12]`, `datacore/src/datacore/api/routes.py:314`);
   * the business `config_id` (`{ABBREV}-RC260001`) comes from
   * `fetchNextEntityId` and is stored as an ordinary field. `publish_config`
   * resolves its path segment with `dc.get_entity(...)`
   * (`actions.py:397`), which filters `WHERE entity_id = ...`, so handing it
   * the business `config_id` 404s every time and no config can ever reach
   * `status='published'`. The `config_id` value below is written only into
   * `base_data.config_id`; it is never an argument to an action.
   */
  const saveDraft = async (): Promise<string | null> => {
    setSaving(true);
    try {
      const blocksJson = JSON.stringify(withReview(blocks, t('builder.reviewTitle')));
      // Publishing archives the old row (backend `_publish_config`); a
      // published config can never be re-published in place (409), so
      // editing further means a NEW draft row at version+1 — see
      // `nextVersion` below. The `version` written here is only a display
      // placeholder: `_publish_config` recomputes the real version from all
      // sibling configs at publish time and ignores whatever a draft carries
      // (backend comment: "a draft's version is a placeholder until publish
      // assigns the real one").
      if (entityId && configStatus === 'draft') {
        await updateEntity(tenant, 'registration_config', entityId, {
          config_id: configId, program_id: programId, version,
          status: 'draft', blocks: blocksJson,
        });
        toast({ message: t('builder.savedDraft'), tone: 'success' });
        return entityId;
      }
      const nextVersion = entityId ? version + 1 : 1;
      const cid = configId ?? (await fetchNextEntityId(tenant, 'registration_config')).next_id;
      const created = await createEntity(tenant, 'registration_config', {
        config_id: cid, program_id: programId, version: nextVersion,
        status: 'draft', blocks: blocksJson,
      });
      setEntityId(created.entity_id);
      setConfigId(cid);
      setVersion(nextVersion);
      setConfigStatus('draft');
      toast({ message: t('builder.savedDraft'), tone: 'success' });
      return created.entity_id;
    } catch (e) {
      toast({ message: t('builder.saveError'), detail: String(e), tone: 'danger' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const doPublish = async () => {
    setConfirmPublish(false);
    if (validationErrors.length > 0) {
      toast({ message: t('builder.publishBlocked'), tone: 'danger' });
      return;
    }
    // The config row's DataCore entity_id — `publishConfig`'s parameter is
    // named `configEntityId` for exactly this reason. Passing the business
    // `config_id` here 404s (see `saveDraft`'s note).
    const configEntityId = await saveDraft();
    if (!configEntityId) return;
    try {
      await publishConfig(tenant, configEntityId);
      setConfigStatus('published');
      toast({ message: t('builder.published'), tone: 'success' });
      void load();
    } catch (e) {
      toast({ message: t('builder.publishError'), detail: String(e), tone: 'danger' });
    }
  };

  return (
    <div className="builder-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('builder.title')}
          <span className="page-subtitle">
            {program?.name ?? programId} · {t('builder.version')} {version} ·{' '}
            {configStatus === 'published' ? t('status.published') : t('status.draft')}
          </span>
        </h1>
        <div className="page-header-actions">
          <Button variant="secondary" loading={saving} loadingText={t('common.loading')}
            onClick={() => void saveDraft()}>
            {t('builder.saveDraft')}
          </Button>
          <Button variant="primary"
            disabled={saving || blocks.length === 0 || validationErrors.length > 0}
            onClick={() => setConfirmPublish(true)}>
            {t('builder.publish')}
          </Button>
        </div>
      </header>

      {error && <div className="programs-error" role="alert">{error}</div>}

      {validationErrors.length > 0 && (
        <div className="builder-validation" role="alert">
          <strong>{t('builder.validationHeading')}</strong>
          <ul>
            {validationErrors.map((msg) => <li key={msg}>{msg}</li>)}
          </ul>
        </div>
      )}

      <div className="builder-columns">
        <section className="builder-list" aria-label={t('builder.blocksHeading')}>
          <h2>{t('builder.blocksHeading')}</h2>
          <ol>
            {/* `key={b.block_id}` assumes uniqueness, which this page's own
                `newBlockId()` guarantees but an externally-authored/legacy
                config could violate. Deferred: worst case is a React
                duplicate-key warning, not data corruption — edits below are
                index-based (`blocks.map((b, i) => ...)`), not keyed off
                block_id, so a collision can't cross-wire two blocks' state. */}
            {blocks.map((b, i) => (
              <li key={b.block_id}
                className={i === selected ? 'builder-row builder-row--selected' : 'builder-row'}>
                <button type="button" className="builder-row-main"
                  ref={(el) => { rowRefs.current[i] = el; }}
                  onClick={() => setSelected(i)}>
                  <span className="builder-row-type">{t(`builder.blockType.${b.type}`)}</span>
                  <span className="builder-row-title">{b.title}</span>
                </button>
                <Button variant="ghost" size="sm" icon aria-label={`${t('builder.moveUp')}: ${b.title}`}
                  disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button variant="ghost" size="sm" icon aria-label={`${t('builder.moveDown')}: ${b.title}`}
                  disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <Button variant="ghost" size="sm" icon aria-label={`${t('builder.remove')}: ${b.title}`}
                  onClick={() => removeBlock(i)}>×</Button>
              </li>
            ))}
            <li className="builder-row builder-row--fixed">
              <span className="builder-row-type">{t('builder.blockType.review')}</span>
              <span className="builder-row-title">{t('builder.reviewTitle')} ({t('builder.fixedLast')})</span>
            </li>
          </ol>
          <div className="builder-add">
            <label htmlFor="builder-add-type">{t('builder.addBlock')}</label>
            <select id="builder-add-type" value={effectiveAddType}
              onChange={(e) => setAddType(e.target.value as BlockType)}>
              {addableTypes.map((bt) => (
                <option key={bt} value={bt}>{t(`builder.blockType.${bt}`)}</option>
              ))}
            </select>
            <Button variant="secondary" ref={addBtnRef} onClick={() => {
              const b = newBlock(effectiveAddType, t(`builder.blockType.${effectiveAddType}`));
              setBlocks([...blocks, b]);
              setSelected(blocks.length);
            }}>
              {t('builder.add')}
            </Button>
          </div>
        </section>

        <section className="builder-panel" aria-label={t('builder.settingsHeading')}>
          <h2>{t('builder.settingsHeading')}</h2>
          {selected >= 0 && blocks[selected] ? (
            <BlockConfigPanel block={blocks[selected]}
              onChange={(nb) => setBlocks(blocks.map((b, i) => (i === selected ? nb : b)))} />
          ) : (
            <p className="programs-muted">{t('builder.selectBlock')}</p>
          )}
        </section>

        <section className="builder-preview" aria-label={t('builder.preview')}>
          <h2>{t('builder.preview')}</h2>
          <FlowRenderer config={previewConfig} mode="preview" application={null} items={[]}
            values={{}} onSaveDraft={noopSave} onCompleteItem={noopItem}
            onUploadDocument={noopUpload} onCheckout={noopCheckout} onSubmit={noopSubmit} />
        </section>
      </div>

      <Modal open={confirmPublish} onClose={() => setConfirmPublish(false)}
        title={t('builder.publishConfirmTitle')} size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void doPublish()}>
              {t('builder.publish')}
            </Button>
          </>
        }>
        <p>{t('builder.publishConfirmBody')}</p>
      </Modal>
    </div>
  );
}
