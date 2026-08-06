// Per-transition guard/effect list, catalog-driven (task-8-brief.md's
// binding rule) — one instance handles ONE list (guards OR effects) of ONE
// transition; TransitionPanel.tsx renders two side by side.
//
// Param-form generation binds to the ACTUAL catalog shape
// (`app/api/designer.py`'s `_param_dict`, `PrimitiveParam` in
// types/designer.ts — `{name, kind, required, enum?, constraint?}`), not
// task-8-brief.md's own looser prose vocabulary (str/int/bool/enum/
// state-list/section-list/step-list/field-ref) — see
// `types/designer.ts`'s `PrimitiveParamKind` doc comment
// (# ADJUST(bindings)) for the full reconciliation. In short:
//   - "enum" is not a kind; it's `PrimitiveParam.enum` layered on kind
//     "string" (checked before the generic kind switch below).
//   - state-list / section-list / step-list / field-ref are not kinds
//     either — they're widget choices made by (primitive, param.name) PAIR,
//     special-cased before the generic kind-based fallback:
//       * `count_states` (any primitive) -> state multiselect
//       * `commit_sections.section_ids` -> multiselect of declared sections
//       * `step_ids` (any primitive: `start_due_clocks`, `items_in_status`)
//         -> multiselect of declared steps
//       * `set_entity_field.ref`/`.field` -> a coupled ref+field picker,
//         rendered as ONE unit instead of two independent generic params
//         (`SetEntityFieldFields` below) — see that component's doc comment.
import { useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import ShowIfBuilder, { type SourceGroup } from './ShowIfBuilder.tsx';
import { ENGINE_OWNED_INSTANCE_FIELDS } from '../types/designer.ts';
import type {
  ConditionGroupDef,
  EntityModelsMap,
  PrimitiveEntry,
  PrimitiveParam,
  StateDef,
} from '../types/designer.ts';
import './editor.css';

/** `GuardRef`/`EffectRef` are structurally identical (`{primitive, params}`)
 * — this file operates on that shared shape so one component serves both
 * lists; callers pass/receive the real `GuardRef[]`/`EffectRef[]`, which
 * satisfy this structurally. */
interface PrimitiveRef {
  primitive: string;
  params: Record<string, unknown>;
}

interface GuardEffectComposerProps {
  /** Which list this instance renders — drives both the i18n key prefix
   * (`editor.machine.{kindLabel}s.*`, same closed-enum dynamic-key pattern
   * StepEditor.tsx's `editor.step.type.${step.type}` already establishes in
   * this codebase) and nothing else; the param-form logic itself is
   * identical for guards and effects. */
  kindLabel: 'guard' | 'effect';
  refs: PrimitiveRef[];
  /** This kind's slice of the catalog (`catalog.guards` or `catalog.effects`). */
  primitives: PrimitiveEntry[];
  models: EntityModelsMap;
  states: StateDef[];
  /** Declared `section_id`s across every form step (Steps tab) — the
   * `commit_sections.section_ids` picker's menu. */
  declaredSectionIds: string[];
  /** Declared `step_id`s (Steps tab) — the `step_ids` picker's menu
   * (`start_due_clocks`, `items_in_status`). */
  declaredStepIds: string[];
  /** `data_condition.condition`'s ShowIfBuilder source menu — same shape
   * StepEditor.tsx builds for step `show_if`. */
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  onChange: (next: PrimitiveRef[]) => void;
}

export default function GuardEffectComposer({
  kindLabel,
  refs,
  primitives,
  models,
  states,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  onChange,
}: GuardEffectComposerProps) {
  const { t } = useTranslation();

  function paramsFor(name: string): PrimitiveParam[] {
    return primitives.find((p) => p.name === name)?.params ?? [];
  }

  function addPrimitive(e: ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value;
    e.target.value = '';
    if (!name) return;
    onChange([...refs, { primitive: name, params: {} }]);
  }

  function updateParams(idx: number, nextParams: Record<string, unknown>) {
    onChange(refs.map((r, i) => (i === idx ? { ...r, params: nextParams } : r)));
  }

  function removeAt(idx: number) {
    onChange(refs.filter((_, i) => i !== idx));
  }

  return (
    <div className="guard-effect-composer">
      <div className="guard-effect-header">
        <span className="guard-effect-heading">{t(`editor.machine.${kindLabel}s.heading`)}</span>
        <select
          className="guard-effect-add-select"
          value=""
          disabled={readOnly || primitives.length === 0}
          onChange={addPrimitive}
        >
          <option value="">{t(`editor.machine.${kindLabel}s.addPlaceholder`)}</option>
          {primitives.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {refs.length === 0 ? (
        <p className="guard-effect-empty">{t(`editor.machine.${kindLabel}s.empty`)}</p>
      ) : (
        <ul className="primitive-list">
          {refs.map((item, idx) => (
            <PrimitiveCard
              key={idx}
              item={item}
              paramSpecs={paramsFor(item.primitive)}
              onChangeParams={(next) => updateParams(idx, next)}
              onRemove={() => removeAt(idx)}
              readOnly={readOnly}
              states={states}
              declaredSectionIds={declaredSectionIds}
              declaredStepIds={declaredStepIds}
              models={models}
              sourceGroups={sourceGroups}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/** One hint per distinct `constraint` string across a primitive's params
 * (a constraint set on both `date_window.start` and `.end` alike — see
 * `validate.py`'s `ParamSpec.constraint` doc comment — must only render
 * once, not twice). Currently only the `"at_least_one_of:a,b,..."` shape is
 * understood; an unrecognized constraint string is silently skipped rather
 * than rendering something meaningless. */
function computeConstraintHints(
  paramSpecs: PrimitiveParam[],
  params: Record<string, unknown>,
  t: (key: string) => string,
): string[] {
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const spec of paramSpecs) {
    if (!spec.constraint || seen.has(spec.constraint)) continue;
    seen.add(spec.constraint);
    const match = /^at_least_one_of:(.+)$/.exec(spec.constraint);
    if (!match) continue;
    const names = match[1].split(',');
    if (!names.some((n) => hasValue(params[n]))) {
      hints.push(t('editor.machine.param.atLeastOneOf').replace('{fields}', names.join(', ')));
    }
  }
  return hints;
}

function PrimitiveCard({
  item,
  paramSpecs,
  onChangeParams,
  onRemove,
  readOnly,
  states,
  declaredSectionIds,
  declaredStepIds,
  models,
  sourceGroups,
}: {
  item: PrimitiveRef;
  paramSpecs: PrimitiveParam[];
  onChangeParams: (next: Record<string, unknown>) => void;
  onRemove: () => void;
  readOnly: boolean;
  states: StateDef[];
  declaredSectionIds: string[];
  declaredStepIds: string[];
  models: EntityModelsMap;
  sourceGroups: SourceGroup[];
}) {
  const { t } = useTranslation();
  const params = item.params ?? {};

  function setParam(name: string, value: unknown) {
    const next = { ...params };
    if (value === undefined) delete next[name];
    else next[name] = value;
    onChangeParams(next);
  }

  const hints = computeConstraintHints(paramSpecs, params, t);
  const isSetEntityField = item.primitive === 'set_entity_field';

  return (
    <li className="primitive-card">
      <div className="primitive-card-header">
        <span className="primitive-name">{item.primitive}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} disabled={readOnly}>
          {t('editor.machine.primitive.remove')}
        </button>
      </div>

      {hints.length > 0 && (
        <ul className="inline-hints" role="alert">
          {hints.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}

      {isSetEntityField ? (
        <SetEntityFieldFields params={params} models={models} onChange={onChangeParams} readOnly={readOnly} />
      ) : paramSpecs.length === 0 ? (
        <p className="primitive-no-params">{t('editor.machine.primitive.noParams')}</p>
      ) : (
        <div className="param-list">
          {paramSpecs.map((spec) => (
            <ParamField
              key={spec.name}
              primitive={item.primitive}
              param={spec}
              value={params[spec.name]}
              onChange={(v) => setParam(spec.name, v)}
              readOnly={readOnly}
              states={states}
              declaredSectionIds={declaredSectionIds}
              declaredStepIds={declaredStepIds}
              sourceGroups={sourceGroups}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

function ParamField({
  primitive,
  param,
  value,
  onChange,
  readOnly,
  states,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
}: {
  primitive: string;
  param: PrimitiveParam;
  value: unknown;
  onChange: (next: unknown) => void;
  readOnly: boolean;
  states: StateDef[];
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
}) {
  const { t } = useTranslation();
  let control: ReactNode;

  if (param.name === 'count_states') {
    control = (
      <ChipMultiSelect
        options={states.map((s) => ({ value: s.state_id, label: s.name ? `${s.state_id} — ${s.name}` : s.state_id }))}
        selected={toStringArray(value)}
        onChange={onChange}
        readOnly={readOnly}
        emptyHint={t('editor.machine.param.noStatesHint')}
      />
    );
  } else if (primitive === 'commit_sections' && param.name === 'section_ids') {
    control = (
      <ChipMultiSelect
        options={declaredSectionIds.map((id) => ({ value: id, label: id }))}
        selected={toStringArray(value)}
        onChange={onChange}
        readOnly={readOnly}
        emptyHint={t('editor.machine.param.noSectionsHint')}
      />
    );
  } else if (param.name === 'step_ids') {
    control = (
      <ChipMultiSelect
        options={declaredStepIds.map((id) => ({ value: id, label: id }))}
        selected={toStringArray(value)}
        onChange={onChange}
        readOnly={readOnly}
        emptyHint={t('editor.machine.param.noStepsHint')}
      />
    );
  } else if (param.kind === 'condition') {
    control = (
      <ShowIfBuilder
        value={(value as ConditionGroupDef | null | undefined) ?? null}
        onChange={onChange}
        sourceGroups={sourceGroups}
        readOnly={readOnly}
      />
    );
  } else if (param.kind === 'date') {
    control = (
      <input
        type="date"
        value={typeof value === 'string' ? value : ''}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  } else if (param.enum && param.enum.length > 0) {
    control = (
      <select
        value={typeof value === 'string' ? value : ''}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{t('editor.machine.param.selectValuePlaceholder')}</option>
        {param.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  } else if (param.kind === 'list' || param.kind === 'string_or_list') {
    control = <FreeTagEditor value={toStringArray(value)} onChange={onChange} readOnly={readOnly} />;
  } else {
    control = (
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <label className="param-field">
      <span className="param-field-label">
        {param.name}
        {param.required && <span className="param-required-badge">{t('editor.machine.param.required')}</span>}
      </span>
      {control}
    </label>
  );
}

function ChipMultiSelect({
  options,
  selected,
  onChange,
  readOnly,
  emptyHint,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
  emptyHint: string;
}) {
  if (options.length === 0) {
    return <p className="param-multiselect-empty">{emptyHint}</p>;
  }
  return (
    <div className="param-multiselect">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        return (
          <label key={opt.value} className="param-chip">
            <input
              type="checkbox"
              checked={checked}
              disabled={readOnly}
              onChange={(e) => {
                const next = e.target.checked ? [...selected, opt.value] : selected.filter((v) => v !== opt.value);
                onChange(next);
              }}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

function FreeTagEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const trimmed = draft.trim();
    if (trimmed) onChange([...value, trimmed]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="param-tag-editor">
      {value.map((v, idx) => (
        <span key={`${v}-${idx}`} className="param-tag">
          {v}
          {!readOnly && (
            <button type="button" onClick={() => removeAt(idx)} aria-label={t('editor.showIf.removeTag')}>
              &times;
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          className="param-tag-input"
          value={draft}
          placeholder={t('editor.showIf.listPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
        />
      )}
    </div>
  );
}

/**
 * `set_entity_field`'s `ref`/`field` params, rendered as ONE coupled unit
 * rather than two independent generic params — `field`'s legal options (and
 * whether it's even a select vs free text) depend entirely on the CURRENT
 * `ref` value (task-8-brief.md's binding rule: "ref select ('instance' or
 * an entity model from bundle models) + field select"):
 *
 *   - `ref === "instance"`: there is no enumerable field list to select
 *     from — `primitives.py`'s `_effect_set_entity_field` writes ANY key
 *     into the `workflow_instance` row's base_data for this ref (confirmed
 *     by reading that function: `base[field] = value`, no schema check) —
 *     every one of the row's FIXED fields is already in
 *     `ENGINE_OWNED_INSTANCE_FIELDS` (`engine.py`'s own `create_instance`
 *     base dict, cross-checked field-for-field against
 *     `schema.py.ENGINE_OWNED_FIELDS`), so "instance fields minus
 *     engine-owned" is a free-text field (there's nothing left to enumerate)
 *     with a client-side hint mirroring `validate.py`'s
 *     `_effect_params_set_entity_field` ban when the typed name collides.
 *   - `ref` is an entity model name (a `models` key): `field` becomes a
 *     select of that model's base+custom field names — no engine-owned
 *     filtering here, since that ban is `ref === "instance"`-only per
 *     `validate.py:514`.
 *   - `ref` unset: `field` stays a disabled free-text placeholder — nothing
 *     to resolve options against yet.
 *
 * Changing `ref` resets `field` to empty — the previous ref's field
 * universe is meaningless under a different ref.
 */
function SetEntityFieldFields({
  params,
  models,
  onChange,
  readOnly,
}: {
  params: Record<string, unknown>;
  models: EntityModelsMap;
  onChange: (next: Record<string, unknown>) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const ref = typeof params.ref === 'string' ? params.ref : '';
  const field = typeof params.field === 'string' ? params.field : '';
  const modelKeys = Object.keys(models).sort((a, b) => a.localeCompare(b));
  const isInstance = ref === 'instance';
  const model = !isInstance ? models[ref] : undefined;
  const engineOwnedHit = isInstance && field !== '' && ENGINE_OWNED_INSTANCE_FIELDS.includes(field);

  function setRef(nextRef: string) {
    onChange({ ...params, ref: nextRef, field: '' });
  }
  function setField(nextField: string) {
    onChange({ ...params, field: nextField });
  }

  return (
    <div className="set-entity-field-row">
      <label className="param-field">
        <span className="param-field-label">{t('editor.machine.param.ref')}</span>
        <select value={ref} disabled={readOnly} onChange={(e) => setRef(e.target.value)}>
          <option value="" disabled>
            {t('editor.machine.param.selectRefPlaceholder')}
          </option>
          <option value="instance">{t('editor.machine.param.refInstance')}</option>
          {modelKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>

      <label className="param-field">
        <span className="param-field-label">{t('editor.machine.param.field')}</span>
        {isInstance ? (
          <input
            type="text"
            value={field}
            placeholder={t('editor.machine.param.fieldPlaceholder')}
            disabled={readOnly}
            onChange={(e) => setField(e.target.value)}
          />
        ) : model ? (
          <select value={field} disabled={readOnly} onChange={(e) => setField(e.target.value)}>
            <option value="" disabled>
              {t('editor.machine.param.selectFieldPlaceholder')}
            </option>
            {[...model.base_fields, ...model.custom_fields].map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={field}
            placeholder={t('editor.machine.param.fieldPlaceholder')}
            disabled={readOnly || !ref}
            onChange={(e) => setField(e.target.value)}
          />
        )}
      </label>

      {engineOwnedHit && (
        <p className="param-hint-warning">
          {t('editor.machine.param.engineOwnedWarning').replace('{field}', field)}
        </p>
      )}
    </div>
  );
}
