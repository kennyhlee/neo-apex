// Per-section config panel for a `form` step: entity model, mode, repeat,
// and the field picker (task-7-brief.md's binding rule). Field-picker
// exclusion rules and the model-required-field auto-include/lock behavior
// live in `./fieldPicker.ts` — this file is presentation + wiring only.
import { useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { pickableFields, sameFieldPicks, syncModelRequiredFields } from './fieldPicker.ts';
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
}

export default function SectionPanel({ section, models, onChange, onRemove, errors }: SectionPanelProps) {
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

  // Enforce "model-required fields auto-included and un-loosenable" on
  // every render where the resolved model (or the section's own
  // entity_model) changes underneath this panel — covers both a freshly
  // created section and a model definition that changed after the section
  // was authored (e.g. a template-seeded draft, or a field newly marked
  // required on the model).
  useEffect(() => {
    if (!model) return;
    const synced = syncModelRequiredFields(section.fields, model);
    if (!sameFieldPicks(synced, section.fields)) {
      onChange({ ...section, fields: synced });
    }
    // Only re-run when the resolved model identity or the model key
    // changes — `section`/`onChange` are stable-enough parent callbacks and
    // including them would re-run this every render for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, section.entity_model]);

  function setEntityModel(next: string) {
    // A field pick set belongs to the OLD model — carrying it over to a
    // different model would either dangle (field doesn't exist there) or
    // silently mean something else. Reset to a clean required-only start.
    onChange({ ...section, entity_model: next, fields: syncModelRequiredFields([], models[next]) });
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
          {t('editor.section.remove')}
        </button>
      </div>

      {errors.length > 0 && (
        <ul className="inline-errors" role="alert">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="section-panel-row">
        <label className="section-panel-field">
          <span>{t('editor.section.entityModel')}</span>
          <select value={section.entity_model} onChange={(e) => setEntityModel(e.target.value)}>
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
          onChange={(next) => onChange({ ...section, fields: next })}
        />
      </div>
    </div>
  );
}

function FieldPickerTable({
  fields,
  model,
  onChange,
}: {
  fields: FieldPick[];
  model: EntityModelDef | undefined;
  onChange: (next: FieldPick[]) => void;
}) {
  const { t } = useTranslation();
  const pickable = pickableFields(model);
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
    if (field.required) return; // model-required — locked, never loosen here
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
          const locked = field.required;
          return (
            <tr key={field.name} className={locked ? 'section-field-locked' : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={included}
                  disabled={locked}
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
                  disabled={!included || locked}
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
