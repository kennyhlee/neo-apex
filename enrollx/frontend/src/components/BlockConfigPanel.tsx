// enrollx/frontend/src/components/BlockConfigPanel.tsx
import { useId } from 'react';
import type { FlowBlock, FlowField, PaymentPlanKind, PaymentPlanOption, RequiredDoc } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import Button from './ui/Button.tsx';

const ENTITY_TYPES = ['student', 'family', 'contact'] as const;
// Matches the real FlowField.type union (flow-runtime/src/types.ts) exactly,
// including 'datetime' — a custom field authored here becomes a FlowField
// consumed by FormBlock, so every type FormBlock can render must be offered.
const FIELD_TYPES = ['str', 'number', 'bool', 'date', 'datetime', 'email', 'phone', 'selection'] as const;

interface BlockConfigPanelProps {
  block: FlowBlock;
  onChange: (next: FlowBlock) => void;
}

/**
 * Per-type settings panel for one selected FlowBlock. Purely a config
 * editor: it mutates `block.config`/top-level fields via `onChange` and has
 * no knowledge of the block list, ordering, or persistence — all owned by
 * ConfigBuilderPage.
 */
export default function BlockConfigPanel({ block, onChange }: BlockConfigPanelProps) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;

  const setTop = (patch: Partial<FlowBlock>) => onChange({ ...block, ...patch });
  const setCfg = (patch: Record<string, unknown>) =>
    onChange({ ...block, config: { ...block.config, ...patch } });

  // Money: integer cents in config, dollars in the UI (DISPATCH-CONTEXT).
  const centsToDollars = (c: unknown) => (typeof c === 'number' ? c / 100 : 0);
  const dollarsToCents = (s: string) => Math.max(0, Math.round(Number(s || 0) * 100));

  // ---- form -----------------------------------------------------------
  const renderForm = () => {
    const entityType = typeof block.config.entity_type === 'string' ? block.config.entity_type : '';
    const custom = Array.isArray(block.config.custom_fields)
      ? (block.config.custom_fields as FlowField[]) : [];
    const setField = (i: number, patch: Partial<FlowField>) =>
      setCfg({ custom_fields: custom.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

    return (
      <>
        <fieldset className="bcp-fieldset">
          <legend>{t('builder.formSource')}</legend>
          <label className="bcp-choice">
            <input type="radio" name={id('src')} checked={entityType !== ''}
              onChange={() => setCfg({ entity_type: 'student', custom_fields: undefined })} />
            {t('builder.fromEntity')}
          </label>
          <label className="bcp-choice">
            <input type="radio" name={id('src')} checked={entityType === ''}
              onChange={() => setCfg({ entity_type: undefined, custom_fields: custom })} />
            {t('builder.customFields')}
          </label>
        </fieldset>

        {entityType !== '' ? (
          <div className="bcp-row">
            <label htmlFor={id('et')}>{t('builder.entityType')}</label>
            <select id={id('et')} value={entityType}
              onChange={(e) => setCfg({ entity_type: e.target.value })}>
              {ENTITY_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
            </select>
          </div>
        ) : (
          <div className="bcp-list">
            {custom.map((f, i) => (
              <div key={i} className="bcp-subrow">
                <label className="bcp-inline">
                  <span>{t('builder.fieldName')}</span>
                  <input value={f.name}
                    onChange={(e) => setField(i, { name: e.target.value })} />
                </label>
                <label className="bcp-inline">
                  <span>{t('builder.fieldType')}</span>
                  <select value={f.type}
                    onChange={(e) => setField(i, { type: e.target.value as FlowField['type'] })}>
                    {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                  </select>
                </label>
                <label className="bcp-inline bcp-check">
                  <input type="checkbox" checked={f.required}
                    onChange={(e) => setField(i, { required: e.target.checked })} />
                  <span>{t('builder.fieldRequired')}</span>
                </label>
                {f.type === 'selection' && (
                  <label className="bcp-inline">
                    <span>{t('builder.fieldOptions')}</span>
                    <input value={(f.options ?? []).join(', ')}
                      onChange={(e) => setField(i, {
                        options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                      })} />
                  </label>
                )}
                <Button variant="ghost" size="sm"
                  aria-label={`${t('builder.remove')} ${f.name || i + 1}`}
                  onClick={() => setCfg({ custom_fields: custom.filter((_, j) => j !== i) })}>
                  {t('builder.remove')}
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm"
              onClick={() => setCfg({
                custom_fields: [...custom, { name: '', type: 'str', required: false }],
              })}>
              {t('builder.addField')}
            </Button>
          </div>
        )}
      </>
    );
  };

  // ---- documents ------------------------------------------------------
  const renderDocuments = () => {
    const docs = Array.isArray(block.config.docs) ? (block.config.docs as RequiredDoc[]) : [];
    const setDoc = (i: number, patch: Partial<RequiredDoc>) =>
      setCfg({ docs: docs.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

    return (
      <div className="bcp-list">
        {docs.map((d, i) => (
          <div key={i} className="bcp-subrow">
            <label className="bcp-inline">
              <span>{t('builder.docName')}</span>
              <input value={d.name} onChange={(e) => setDoc(i, { name: e.target.value })} />
            </label>
            <label className="bcp-inline">
              <span>{t('builder.docDescription')}</span>
              <input value={d.description ?? ''}
                onChange={(e) => setDoc(i, { description: e.target.value })} />
            </label>
            <label className="bcp-inline bcp-check">
              <input type="checkbox" checked={d.sensitive}
                onChange={(e) => setDoc(i, { sensitive: e.target.checked })} />
              <span>{t('builder.docSensitive')}</span>
            </label>
            <label className="bcp-inline bcp-check">
              <input type="checkbox" checked={d.blocking}
                onChange={(e) => setDoc(i, { blocking: e.target.checked })} />
              <span>{t('builder.docBlocking')}</span>
            </label>
            {!d.blocking && (
              <label className="bcp-inline">
                <span>{t('builder.dueDays')}</span>
                <input type="number" min={0} value={d.due_days_after_approval ?? ''}
                  onChange={(e) => setDoc(i, {
                    due_days_after_approval: e.target.value === '' ? undefined : Number(e.target.value),
                  })} />
              </label>
            )}
            <Button variant="ghost" size="sm"
              aria-label={`${t('builder.remove')} ${d.name || i + 1}`}
              onClick={() => setCfg({ docs: docs.filter((_, j) => j !== i) })}>
              {t('builder.remove')}
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="sm"
          onClick={() => setCfg({
            docs: [...docs, { name: '', description: '', sensitive: false, blocking: true }],
          })}>
          {t('builder.addDoc')}
        </Button>
      </div>
    );
  };

  // ---- payment_plan (Plan 3 shape: {currency, amount_full, plans[{type,…}]}) --
  const renderPaymentPlan = () => {
    const plans = Array.isArray(block.config.plans)
      ? (block.config.plans as PaymentPlanOption[]) : [];
    const has = (kind: PaymentPlanKind) => plans.some((p) => p.type === kind);
    const depositCents = plans.find((p) => p.type === 'deposit')?.deposit_amount ?? 0;
    const togglePlan = (kind: PaymentPlanKind, on: boolean) => {
      const rest = plans.filter((p) => p.type !== kind);
      const added: PaymentPlanOption = kind === 'deposit'
        ? { type: 'deposit', deposit_amount: depositCents }
        : { type: 'pay_in_full' };
      setCfg({ currency: 'usd', plans: on ? [...rest, added] : rest });
    };

    return (
      <div className="bcp-list">
        <fieldset className="bcp-fieldset">
          <legend>{t('builder.plansOffered')}</legend>
          <label className="bcp-choice">
            <input type="checkbox" checked={has('pay_in_full')}
              onChange={(e) => togglePlan('pay_in_full', e.target.checked)} />
            {t('builder.planPayInFull')}
          </label>
          <label className="bcp-choice">
            <input type="checkbox" checked={has('deposit')}
              onChange={(e) => togglePlan('deposit', e.target.checked)} />
            {t('builder.planDeposit')}
          </label>
        </fieldset>
        <div className="bcp-row">
          <label htmlFor={id('af')}>{t('builder.amountFull')}</label>
          <input id={id('af')} type="number" min={0} step="0.01"
            value={centsToDollars(block.config.amount_full)}
            onChange={(e) => setCfg({ amount_full: dollarsToCents(e.target.value) })} />
        </div>
        {has('deposit') && (
          <div className="bcp-row">
            <label htmlFor={id('ad')}>{t('builder.depositAmount')}</label>
            <input id={id('ad')} type="number" min={0} step="0.01"
              value={centsToDollars(depositCents)}
              onChange={(e) => setCfg({
                plans: plans.map((p) => p.type === 'deposit'
                  ? { ...p, deposit_amount: dollarsToCents(e.target.value) } : p),
              })} />
          </div>
        )}
      </div>
    );
  };

  // ---- payment / message ------------------------------------------------
  const renderPayment = () => (
    <div className="bcp-row">
      <label htmlFor={id('col')}>{t('builder.collects')}</label>
      <select id={id('col')}
        value={typeof block.config.collects === 'string' ? block.config.collects : 'full'}
        onChange={(e) => setCfg({ collects: e.target.value })}>
        <option value="full">full</option>
        <option value="deposit">deposit</option>
      </select>
    </div>
  );

  const renderMessage = () => (
    <div className="bcp-row bcp-row--stack">
      <label htmlFor={id('body')}>{t('builder.messageBody')}</label>
      <textarea id={id('body')} rows={6}
        value={typeof block.config.body === 'string' ? block.config.body : ''}
        onChange={(e) => setCfg({ body: e.target.value })} />
    </div>
  );

  return (
    <div className="bcp">
      <div className="bcp-row">
        <label htmlFor={id('title')}>{t('builder.blockTitle')}</label>
        <input id={id('title')} value={block.title}
          onChange={(e) => setTop({ title: e.target.value })} />
      </div>
      <label className="bcp-inline bcp-check">
        <input type="checkbox" checked={block.blocking}
          onChange={(e) => setTop({ blocking: e.target.checked, required: e.target.checked })} />
        <span>{t('builder.blocking')}</span>
      </label>
      {!block.blocking && (
        <div className="bcp-row">
          <label htmlFor={id('due')}>{t('builder.dueDays')}</label>
          <input id={id('due')} type="number" min={0}
            value={block.due_days_after_approval ?? ''}
            onChange={(e) => setTop({
              due_days_after_approval: e.target.value === '' ? undefined : Number(e.target.value),
            })} />
        </div>
      )}

      {block.type === 'form' && renderForm()}
      {block.type === 'documents' && renderDocuments()}
      {block.type === 'payment_plan' && renderPaymentPlan()}
      {block.type === 'payment' && renderPayment()}
      {block.type === 'message' && renderMessage()}
    </div>
  );
}
