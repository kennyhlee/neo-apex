// flow-runtime/src/StepRenderer.tsx
import { useId } from 'react';
import type {
  Condition, ConditionGroupDef, ConditionItem, FlowField, WorkflowSectionDef, WorkflowStepDef,
} from './types';
import type { ModelFieldSource } from './blockConfig';
import { sectionFields } from './sectionFields';
import { useFlowT } from './i18n';

// ---- evaluateCondition: pure port of conditions.py -------------------------

/**
 * Distinguishes "key present with an explicit `null`/`undefined` value"
 * from "key absent" while walking condition data — the two evaluate
 * differently for `empty`/`not_empty`/`truthy` (mirrors
 * `conditions.py`'s `_MISSING` sentinel and `_lookup`).
 */
const MISSING: unique symbol = Symbol('missing');

function lookup(source: string, data: Record<string, unknown>): unknown {
  return Object.prototype.hasOwnProperty.call(data, source) ? data[source] : MISSING;
}

/** Mirrors `conditions.py`'s `_EMPTY_VALUES = (None, "", [], {})`. Deliberately
 *  excludes `0`/`false`: a present-but-falsy scalar is not the same thing as
 *  an empty string/list/dict, and `truthy` already covers the falsy-value
 *  case. */
function isEmptyValue(value: unknown): boolean {
  if (value === null) return true;
  if (value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/** Structural equality for JSON-shaped values, matching Python `==` for the
 *  scalar/list/dict operands `eq`/`ne`/`in` compare against. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (
    a !== null && b !== null && typeof a === 'object' && typeof b === 'object' &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function evalLeaf(cond: Condition, data: Record<string, unknown>): boolean {
  const raw = lookup(cond.source, data);
  const missing = raw === MISSING;
  const op = cond.op;

  if (op === 'empty') {
    if (missing) return true;
    return isEmptyValue(raw);
  }
  if (op === 'not_empty') {
    if (missing) return false;
    return !isEmptyValue(raw);
  }
  if (op === 'truthy') {
    if (missing) return false;
    return Boolean(raw);
  }

  // eq/ne/in: missing source evaluates as if the value were `null`
  // (conditions.py's `None`).
  const value = missing ? null : raw;
  if (op === 'eq') return deepEqual(value, cond.value);
  if (op === 'ne') return !deepEqual(value, cond.value);
  if (op === 'in') {
    // `Condition`'s own validator guarantees `value` is a list whenever
    // `op === 'in'` server-side (schema.py); a non-array here means a
    // caller constructed a Condition without going through validation, so
    // this defensively treats it as an empty list rather than throwing.
    const list = Array.isArray(cond.value) ? cond.value : [];
    return list.some((item) => deepEqual(value, item));
  }

  throw new Error(`unknown condition op: ${op as string}`);
}

function isConditionGroup(item: ConditionItem): item is ConditionGroupDef {
  return !('op' in item);
}

function evalItem(item: ConditionItem, data: Record<string, unknown>): boolean {
  return isConditionGroup(item) ? evaluateCondition(item, data) : evalLeaf(item, data);
}

/**
 * Evaluate a `ConditionGroupDef` against a flat `data` map, keyed
 * `"{section_id}.{field}"` / `"context.{key}"` (`conditions.py`'s own
 * doc comment). This is a direct, semantics-exact port of
 * `apexflow/backend/app/workflows/conditions.py`'s `evaluate_condition` —
 * MUST stay in lockstep with that file, which remains the server-side
 * source of truth (Plan 3 re-evaluates `show_if` server-side and the two
 * must agree):
 *
 * - `all`: true iff every item is true (vacuously true for an empty list).
 * - `any`: true iff at least one item is true (vacuously false for an
 *   empty list).
 * - `not`: list-shaped like `all`/`any` rather than a single operand — true
 *   iff NONE of the items are true (the negation of `any`; vacuously true
 *   for an empty list). `conditions.py`'s own docstring flags this as a
 *   deliberate reading since the spec does not spell out `not`'s
 *   aggregation over >1 item explicitly.
 * - A leaf `Condition` whose `source` is absent from `data` entirely:
 *   `empty` -> true, `not_empty`/`truthy` -> false, `eq`/`ne`/`in` treat the
 *   value as if it were `null`.
 * - `empty`/`not_empty` treat `null`/`""`/`[]`/`{}` as empty, but NOT `0` or
 *   `false` — a present falsy scalar is not the same as an empty value.
 *
 * `ConditionGroupDef`'s Python counterpart's model validator guarantees
 * exactly one of `all`/`any`/`not` is set, so the final branch here is
 * unreachable in well-formed data and only guards a malformed group.
 *
 * Pure — no I/O, no React — so Plan 3 can exercise it directly (e.g. a
 * fixture-driven parity test against `conditions.py`) without any DOM/
 * network setup.
 */
export function evaluateCondition(group: ConditionGroupDef, data: Record<string, unknown>): boolean {
  if (group.all !== undefined) return group.all.every((item) => evalItem(item, data));
  if (group.any !== undefined) return group.any.some((item) => evalItem(item, data));
  if (group.not !== undefined) return !group.not.some((item) => evalItem(item, data));
  throw new Error('ConditionGroup has none of all/any/not set');
}

// ---- StepRenderer -----------------------------------------------------------

/**
 * Flat draft/condition-data map.
 *
 * Non-repeat section fields live at `"{section_id}.{field}"` — exactly the
 * data keys `conditions.py` itself documents — so `show_if` condition data
 * can be read straight off the draft with no reshaping. A repeat section's
 * rows live at the bare `section_id` key as an array of per-field records
 * and are never flattened into dotted keys: Plan 1's rule that repeat
 * sections contribute nothing to condition data. A host may seed
 * `"context.{key}"` entries directly; they pass through untouched. A
 * `message` step's acknowledgement checkbox (when `config.ack`) lives at
 * `"{step_id}.ack"`.
 */
export type WorkflowDraft = Record<string, unknown>;

function formSections(step: WorkflowStepDef): WorkflowSectionDef[] {
  const sections = step.config.sections;
  return Array.isArray(sections) ? (sections as WorkflowSectionDef[]) : [];
}

/** Shape of one entry in a `documents` step's `config.docs`
 *  (`templates/enrollment.py`'s `_steps()`, apexflow's own doc dict — NOT
 *  the registration-era `RequiredDoc` in `types.ts`, whose
 *  `due_days_after_approval` key apexflow spells `due_days_after_state`;
 *  this renderer only needs the three fields below). */
interface WorkflowDoc {
  name: string;
  description?: string;
  sensitive?: boolean;
}

function stepDocs(step: WorkflowStepDef): WorkflowDoc[] {
  const docs = step.config.docs;
  if (!Array.isArray(docs)) return [];
  return docs.filter((d): d is WorkflowDoc => typeof d === 'object' && d !== null && typeof (d as { name?: unknown }).name === 'string');
}

function stepMessageBody(step: WorkflowStepDef): string {
  return typeof step.config.body === 'string' ? step.config.body : '';
}

function stepRequiresAck(step: WorkflowStepDef): boolean {
  return Boolean(step.config.ack);
}

/**
 * Condition data built from `draft`, scoped to exactly what `show_if` is
 * allowed to see: non-repeat form-section fields (`"{section_id}.{field}"`)
 * and any host-seeded `"context.{key}"` entries. Derived from `steps`
 * rather than by pattern-matching `draft`'s own keys, so a repeat section's
 * bare `section_id` array key (no dot) or a message step's `"{step_id}.ack"`
 * key can never leak in by accident.
 */
function buildConditionData(steps: WorkflowStepDef[], draft: WorkflowDraft): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of formSections(step)) {
      if (section.repeat) continue; // Plan 1 rule.
      for (const pick of section.fields) {
        const key = `${section.section_id}.${pick.name}`;
        if (Object.prototype.hasOwnProperty.call(draft, key)) data[key] = draft[key];
      }
    }
  }
  for (const key of Object.keys(draft)) {
    if (key.startsWith('context.')) data[key] = draft[key];
  }
  return data;
}

function labelOf(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FieldControlProps {
  id: string;
  field: FlowField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

/** Field rendering by model field type (brief §"Field rendering"):
 *  str/email/phone -> text input, number -> number, bool -> checkbox,
 *  date/datetime -> date input, selection -> select with options. */
function FieldControl({ id, field, value, disabled, onChange }: FieldControlProps) {
  const str = value != null ? String(value) : '';

  switch (field.type) {
    case 'number':
      return (
        <input id={id} type="number" className="fr-input" disabled={disabled} value={str}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      );
    case 'bool':
      return (
        <input id={id} type="checkbox" disabled={disabled}
          checked={value === true || value === 'true'}
          onChange={(e) => onChange(e.target.checked)} />
      );
    case 'date':
    case 'datetime':
      return (
        <input id={id} type="date" className="fr-input" disabled={disabled} value={str}
          onChange={(e) => onChange(e.target.value)} />
      );
    case 'selection':
      return (
        <select id={id} className="fr-input" disabled={disabled} value={str}
          onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled hidden>{'—'}</option>
          {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    default: // str/email/phone
      return (
        <input id={id} type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          className="fr-input" disabled={disabled} value={str}
          onChange={(e) => onChange(e.target.value)} />
      );
  }
}

interface FieldRowProps {
  idPrefix: string;
  field: FlowField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

function FieldRow({ idPrefix, field, value, disabled, onChange }: FieldRowProps) {
  const t = useFlowT();
  const id = `${idPrefix}-${field.name}`;
  return (
    <div className={`fr-field${field.type === 'bool' ? ' fr-field--checkbox' : ''}`}>
      <label htmlFor={id}>
        {labelOf(field.name)}
        {field.required && (
          <>
            <span className="fr-required" aria-hidden="true">*</span>
            <span className="fr-sr-only"> ({t('required')})</span>
          </>
        )}
      </label>
      <FieldControl id={id} field={field} value={value} disabled={disabled} onChange={onChange} />
    </div>
  );
}

interface SectionRendererProps {
  step: WorkflowStepDef;
  section: WorkflowSectionDef;
  model: ModelFieldSource | undefined;
  draft: WorkflowDraft;
  onDraftChange: (next: WorkflowDraft) => void;
}

function SectionRenderer({ step, section, model, draft, onDraftChange }: SectionRendererProps) {
  const baseId = useId();
  const fields = sectionFields(section, model);
  const idPrefix = `${baseId}-${step.step_id}-${section.section_id}`;

  if (fields.length === 0) return null;

  if (!section.repeat) {
    // Non-repeat fields are stored flat at "{section_id}.{field}" (also the
    // show_if condition-data key) — read/write directly at that key rather
    // than through a nested object, matching the brief's data-key spec.
    const setField = (name: string, value: unknown) => {
      onDraftChange({ ...draft, [`${section.section_id}.${name}`]: value });
    };
    return (
      <div className="fr-form-fields">
        {fields.map((field) => (
          <FieldRow key={field.name} idPrefix={idPrefix} field={field}
            value={draft[`${section.section_id}.${field.name}`]}
            disabled={false} onChange={(v) => setField(field.name, v)} />
        ))}
      </div>
    );
  }

  // Repeat section: an "add another" list of rows, honoring min/max.
  // Rows contribute nothing to show_if condition data (Plan 1 rule) — they
  // live at the bare section_id key, not flattened into dotted keys.
  const { min, max } = section.repeat;
  const rawRows = draft[section.section_id];
  const rows: Record<string, unknown>[] = Array.isArray(rawRows)
    ? (rawRows as Record<string, unknown>[])
    : Array.from({ length: Math.max(min, 0) }, () => ({}));

  const setRows = (next: Record<string, unknown>[]) => {
    onDraftChange({ ...draft, [section.section_id]: next });
  };
  const setRowField = (index: number, name: string, value: unknown) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, [name]: value } : row)));
  };
  const addRow = () => {
    if (rows.length >= max) return;
    setRows([...rows, {}]);
  };
  const removeRow = (index: number) => {
    if (rows.length <= min) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  return (
    <div className="fr-repeat-section">
      {rows.map((row, index) => (
        <div key={index} className="fr-repeat-row">
          <div className="fr-form-fields">
            {fields.map((field) => (
              <FieldRow key={field.name} idPrefix={`${idPrefix}-${index}`} field={field}
                value={row[field.name]} disabled={false}
                onChange={(v) => setRowField(index, field.name, v)} />
            ))}
          </div>
          <button type="button" className="fr-btn" disabled={rows.length <= min}
            onClick={() => removeRow(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="fr-btn" disabled={rows.length >= max} onClick={addRow}>
        Add another
      </button>
    </div>
  );
}

function DocumentsStep({ step }: { step: WorkflowStepDef }) {
  const t = useFlowT();
  const docs = stepDocs(step);
  if (docs.length === 0) return <p className="fr-empty">{t('noFields')}</p>;
  return (
    <ul className="fr-doc-list">
      {docs.map((doc) => (
        <li key={doc.name} className="fr-doc-row">
          <div className="fr-doc-info">
            <strong>{doc.name}</strong>
            {doc.description && <p>{doc.description}</p>}
            {doc.sensitive && <span className="fr-doc-flag">{t('sensitiveDoc')}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MessageStep({ step, draft, onDraftChange }: {
  step: WorkflowStepDef; draft: WorkflowDraft; onDraftChange: (next: WorkflowDraft) => void;
}) {
  const baseId = useId();
  const body = stepMessageBody(step);
  const paragraphs = body.split('\n').filter((p) => p.trim() !== '');
  const ackKey = `${step.step_id}.ack`;
  const ackId = `${baseId}-${ackKey}`;
  return (
    <div className="fr-message-body">
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {stepRequiresAck(step) && (
        <div className="fr-field fr-field--checkbox">
          <label htmlFor={ackId}>
            <input id={ackId} type="checkbox" checked={draft[ackKey] === true}
              onChange={(e) => onDraftChange({ ...draft, [ackKey]: e.target.checked })} />
            {' '}I acknowledge this message.
          </label>
        </div>
      )}
    </div>
  );
}

function FormStep({ step, models, draft, onDraftChange }: {
  step: WorkflowStepDef; models: Record<string, ModelFieldSource>;
  draft: WorkflowDraft; onDraftChange: (next: WorkflowDraft) => void;
}) {
  const t = useFlowT();
  const sections = formSections(step);
  if (sections.length === 0) return <p className="fr-empty">{t('noFields')}</p>;
  return (
    <>
      {sections.map((section) => (
        <SectionRenderer key={section.section_id} step={step} section={section}
          model={models[section.entity_model]} draft={draft} onDraftChange={onDraftChange} />
      ))}
    </>
  );
}

export interface StepRendererProps {
  steps: WorkflowStepDef[];
  /** Entity model definitions, keyed by `entity_model` name (a
   *  `WorkflowSectionDef.entity_model` value, e.g. `"family"`/`"student"`),
   *  each shaped like `base_model.json`'s per-entity-type entry
   *  (`{base_fields: [...], custom_fields: [...]}`, §8 of the interface
   *  map) — the same `ModelFieldSource` `blockConfig.ts` already exports. */
  models: Record<string, ModelFieldSource>;
  /** Only `"preview"` today — the designer's live preview. Kept as a
   *  literal (not widened to `FlowMode`) because a real family/staff
   *  runtime for workflow instances doesn't exist yet (Plan 2 is the
   *  designer only); widen this when that runtime lands. */
  mode: 'preview';
  draft: WorkflowDraft;
  onDraftChange: (next: WorkflowDraft) => void;
}

/**
 * Generalized live-preview renderer for a workflow definition's steps —
 * the apexflow-designer analogue of `FlowRenderer`, but for
 * `WorkflowStepDef`/`WorkflowSectionDef` (definition-time, entity-model
 * driven) rather than `FlowBlock` (registration-era, config-authored).
 * Deliberately NOT wizard-paged like `FlowRenderer`: the designer's live
 * preview needs to show the whole definition-so-far including which steps
 * `show_if` currently hides, not walk an applicant through it one step at a
 * time.
 *
 * `show_if` is evaluated client-side via `evaluateCondition` against data
 * built from `draft` (see `buildConditionData`) — a step whose `show_if`
 * evaluates false is skipped entirely (not shown greyed-out), matching how
 * the real engine would never surface it.
 */
export function StepRenderer({ steps, models, mode, draft, onDraftChange }: StepRendererProps) {
  void mode; // reserved: only "preview" exists today, kept as an explicit prop for forward-compat.
  const conditionData = buildConditionData(steps, draft);
  const visible = steps.filter((step) => !step.show_if || evaluateCondition(step.show_if, conditionData));

  if (visible.length === 0) return null;

  return (
    <div className="fr-step-renderer">
      {visible.map((step) => (
        <section key={step.step_id} className="fr-block" aria-label={step.title}>
          <h2 className="fr-block-title">{step.title}</h2>
          {step.type === 'form' && (
            <FormStep step={step} models={models} draft={draft} onDraftChange={onDraftChange} />
          )}
          {step.type === 'documents' && <DocumentsStep step={step} />}
          {step.type === 'message' && (
            <MessageStep step={step} draft={draft} onDraftChange={onDraftChange} />
          )}
        </section>
      ))}
    </div>
  );
}
