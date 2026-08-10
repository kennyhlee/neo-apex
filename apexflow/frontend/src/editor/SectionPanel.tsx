// Per-section config panel for a `form` step: entity model, mode, repeat,
// and the field picker (task-7-brief.md's binding rule). Field-picker
// exclusion rules and the model-required-field auto-include/lock behavior
// live in `./fieldPicker.ts` — this file is presentation + wiring only.
import { useEffect } from 'react';
import { humanizeSectionId } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import {
  dropForbiddenConditionalFields,
  isModelRequiredNoDefault,
  pickableFields,
  sameFieldPicks,
  syncModelRequiredFields,
} from './fieldPicker.ts';
import type {
  EntityModelDef,
  EntityModelField,
  EntityModelsMap,
  FieldPick,
  WorkflowSectionDef,
} from '../types/designer.ts';
import './editor.css';

interface SectionPanelProps {
  section: WorkflowSectionDef;
  models: EntityModelsMap;
  onChange: (next: WorkflowSectionDef) => void;
  onRemove: () => void;
  /** Pre-filtered to this section via `validationMatch.ts`'s `errorsForSection`. */
  errors: string[];
  /** True when the OWNING STEP has a `show_if` set — changes the field
   * picker's menu and locking rules (task review fix #1). */
  conditional: boolean;
  /** True when the definition isn't a draft — every control is disabled
   * (task review fix #6). */
  readOnly: boolean;
}

export default function SectionPanel({
  section,
  models,
  onChange,
  onRemove,
  errors,
  conditional,
  readOnly,
}: SectionPanelProps) {
  const { t } = useTranslation();
  const model = models[section.entity_model];
  const modelKeys = Object.keys(models).sort((a, b) => a.localeCompare(b));
  // Keep a currently-set-but-now-missing model visible (e.g. models.json
  // changed under a draft) rather than silently swapping the select to a
  // different option — the "broken" health signal already flags this.
  const entityModelOptions =
    section.entity_model && !modelKeys.includes(section.entity_model)
      ? [section.entity_model, ...modelKeys]
      : modelKeys;

  // Enforce the field-picker rules on every render where the resolved
  // model, the section's own entity_model, or `conditional` changes
  // underneath this panel — covers a freshly created section, a model
  // definition that changed after the section was authored, AND a step
  // that became/stopped-being conditional through some path other than
  // StepEditor's own show_if transition handler (e.g. bundle reload).
  //
  // Unconditional: "model-required fields auto-included and un-loosenable"
  // (task-7-brief.md DECISION) — force-include+lock every model-required
  // field that has NO declared default (browser-gate fix: a required field
  // WITH a default is exempt here too, same as on the conditional path —
  // see `fieldPicker.ts`'s `isModelRequiredNoDefault`). Conditional: never
  // auto-include/lock anything; instead DROP any pick that's no longer
  // legal (model-required, no default — task review fix #1). No read-only
  // guard needed — a read-only definition can't be edited via any of the
  // controls that would create the discrepancy this effect corrects in the
  // first place, so it just never fires there.
  useEffect(() => {
    if (!model) return;
    if (conditional) {
      const { fields, dropped } = dropForbiddenConditionalFields(section.fields, model);
      if (dropped.length > 0) onChange({ ...section, fields });
      return;
    }
    const synced = syncModelRequiredFields(section.fields, model);
    if (!sameFieldPicks(synced, section.fields)) {
      onChange({ ...section, fields: synced });
    }
    // Only re-run when the resolved model identity, the model key, or the
    // conditional flag changes — `section`/`onChange` are stable-enough
    // parent callbacks and including them would re-run this every render
    // for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, section.entity_model, conditional]);

  function setEntityModel(next: string) {
    // A field pick set belongs to the OLD model — carrying it over to a
    // different model would either dangle (field doesn't exist there) or
    // silently mean something else. Reset to a clean start: required-only
    // for an unconditional section, empty for a conditional one (nothing
    // to auto-force there).
    const nextModel = models[next];
    onChange({
      ...section,
      entity_model: next,
      fields: conditional ? [] : syncModelRequiredFields([], nextModel),
    });
  }

  function setMode(mode: 'create' | 'match_or_create') {
    onChange({ ...section, mode });
  }

  function setRepeatEnabled(enabled: boolean) {
    onChange({ ...section, repeat: enabled ? { min: 1, max: 1 } : null });
  }

  return (
    <div className="section-panel">
      <div className="section-panel-header">
        <span className="section-panel-id">{section.section_id}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} disabled={readOnly}>
          {t('editor.section.remove')}
        </button>
      </div>

      <label className="section-panel-field">
        <span>{t('editor.section.title')}</span>
        <input
          type="text"
          value={section.title ?? ''}
          placeholder={humanizeSectionId(section.section_id)}
          maxLength={80}
          disabled={readOnly}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
      </label>

      <label className="section-panel-field">
        <span>{t('editor.section.description')}</span>
        <textarea
          className="section-panel-textarea"
          rows={3}
          value={section.description ?? ''}
          maxLength={600}
          disabled={readOnly}
          onChange={(e) => onChange({ ...section, description: e.target.value })}
        />
        <small className="section-panel-hint">{t('editor.section.descriptionHint')}</small>
      </label>

      {errors.length > 0 && (
        <ul className="inline-errors" role="alert">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      {conditional && <p className="section-conditional-notice">{t('editor.section.conditionalNotice')}</p>}

      <div className="section-panel-row">
        <label className="section-panel-field">
          <span>{t('editor.section.entityModel')}</span>
          <select value={section.entity_model} onChange={(e) => setEntityModel(e.target.value)} disabled={readOnly}>
            <option value="" disabled>
              {t('editor.section.entityModelPlaceholder')}
            </option>
            {entityModelOptions.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        <label className="section-panel-field">
          <span>{t('editor.section.mode')}</span>
          <select
            value={section.mode}
            onChange={(e) => setMode(e.target.value as 'create' | 'match_or_create')}
            disabled={readOnly}
          >
            <option value="create">{t('editor.section.modeCreate')}</option>
            <option value="match_or_create">{t('editor.section.modeMatchOrCreate')}</option>
          </select>
        </label>
      </div>

      <div className="section-panel-repeat">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={section.repeat != null}
            onChange={(e) => setRepeatEnabled(e.target.checked)}
            disabled={readOnly}
          />
          {t('editor.section.repeat')}
        </label>
        {section.repeat && (
          <div className="section-panel-repeat-fields">
            <label>
              {t('editor.section.repeatMin')}
              <input
                type="number"
                min={0}
                value={section.repeat.min}
                disabled={readOnly}
                onChange={(e) =>
                  onChange({ ...section, repeat: { ...section.repeat!, min: Number(e.target.value) } })
                }
              />
            </label>
            <label>
              {t('editor.section.repeatMax')}
              <input
                type="number"
                min={0}
                value={section.repeat.max}
                disabled={readOnly}
                onChange={(e) =>
                  onChange({ ...section, repeat: { ...section.repeat!, max: Number(e.target.value) } })
                }
              />
            </label>
          </div>
        )}
      </div>

      <div className="section-panel-fields">
        <h4>{t('editor.section.fieldsHeading')}</h4>
        <FieldPickerTable
          fields={section.fields}
          model={model}
          conditional={conditional}
          readOnly={readOnly}
          onChange={(next) => onChange({ ...section, fields: next })}
        />
      </div>
    </div>
  );
}

function FieldPickerTable({
  fields,
  model,
  conditional,
  readOnly,
  onChange,
}: {
  fields: FieldPick[];
  model: EntityModelDef | undefined;
  conditional: boolean;
  readOnly: boolean;
  onChange: (next: FieldPick[]) => void;
}) {
  const { t } = useTranslation();
  const pickable = pickableFields(model, conditional);
  const byName = new Map(fields.map((f) => [f.name, f]));

  function toggleInclude(field: EntityModelField, included: boolean) {
    const next = new Map(byName);
    if (included) {
      next.set(field.name, { name: field.name, required: field.required });
    } else {
      next.delete(field.name);
    }
    onChange(Array.from(next.values()));
  }

  function toggleRequired(field: EntityModelField, required: boolean) {
    // unconditional + model-required-with-no-default — locked, never loosen
    // here. A required-with-default field is exempt from the coverage rule
    // (mirrors `validate.py`'s `_is_exempt_field`) and stays a fully
    // ordinary optional-to-toggle field even in an unconditional section.
    if (!conditional && isModelRequiredNoDefault(field)) return;
    const current = byName.get(field.name);
    if (!current) return;
    const next = new Map(byName);
    next.set(field.name, { ...current, required });
    onChange(Array.from(next.values()));
  }

  if (!model) {
    return <p className="section-fields-empty">{t('editor.section.selectModelFirst')}</p>;
  }
  if (pickable.length === 0) {
    return <p className="section-fields-empty">{t('editor.section.noFields')}</p>;
  }

  return (
    <table className="section-fields-table">
      <thead>
        <tr>
          <th>{t('editor.section.fieldsColInclude')}</th>
          <th>{t('editor.section.fieldsColField')}</th>
          <th>{t('editor.section.fieldsColRequired')}</th>
        </tr>
      </thead>
      <tbody>
        {pickable.map((field) => {
          const pick = byName.get(field.name);
          const included = pick !== undefined;
          const required = pick?.required ?? false;
          // Locking (auto-included, can't exclude/loosen) only applies to
          // an UNCONDITIONAL section's model-required-with-NO-default
          // fields (task review fix #1; browser-gate fix: a required field
          // that also declares a default is exempt here too, mirroring
          // `validate.py`'s `_is_exempt_field` — see fieldPicker.ts's
          // `isModelRequiredNoDefault` doc) — in a conditional section, a
          // model-required-no-default field is not offered at all (see
          // `pickableFields`), and a model-defaulted one is a fully
          // ordinary optional field here on either path.
          const locked = !conditional && isModelRequiredNoDefault(field);
          return (
            <tr key={field.name} className={locked ? 'section-field-locked' : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={included}
                  disabled={locked || readOnly}
                  onChange={(e) => toggleInclude(field, e.target.checked)}
                  aria-label={t('editor.section.fieldsColInclude')}
                />
              </td>
              <td className="section-field-name-cell">
                <span className="section-field-name">{field.name}</span>
                <span className="section-field-type">{field.type}</span>
                {locked && (
                  <span className="section-field-required-badge">{t('editor.section.modelRequired')}</span>
                )}
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={required}
                  disabled={!included || locked || readOnly}
                  onChange={(e) => toggleRequired(field, e.target.checked)}
                  aria-label={t('editor.section.fieldsColRequired')}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
