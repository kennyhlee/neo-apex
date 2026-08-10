// Ordered step list + per-type config panels (task-7-brief.md's binding
// rule). No drag library — reorder is up/down buttons, matching the repo's
// existing precedent (DataTable/DefinitionsPage have no drag-and-drop
// anywhere in this codebase).
import { useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import SectionPanel from './SectionPanel.tsx';
import ShowIfBuilder, { type SourceGroup } from './ShowIfBuilder.tsx';
import { errorsForStep, errorsForSection } from './validationMatch.ts';
import { dropForbiddenConditionalFieldsAcross } from './fieldPicker.ts';
import { removeStepFromStage } from './stagePlacement.ts';
import type { StepsUpdater } from './draftStore.ts';
import type {
  ConditionGroupDef,
  EntityModelsMap,
  StateDef,
  WorkflowSectionDef,
  WorkflowStepDef,
} from '../types/designer.ts';
import './editor.css';

interface StepEditorProps {
  steps: WorkflowStepDef[];
  onChange: (updater: StepsUpdater) => void;
  models: EntityModelsMap;
  states: StateDef[];
  errors: string[];
  /** True when the definition isn't a draft — disables every mutating
   * control (task review fix #6). */
  readOnly: boolean;
  /** Stage-editor mode: render only steps whose `available_in` contains this
   * stage, and create new steps into it. The component still operates on the
   * FULL `steps` array internally — filtering happens at render time only, so
   * indices, reordering, and `onChange` payloads stay whole-array. */
  stageId?: string;
  /** Suppress the `available_in` checkbox grid. In stage-editor mode a step's
   * placement is which card it sits in, so a second control for the same data
   * would be two ways to edit one field. */
  hideAvailableIn?: boolean;
}

/** Short, non-cryptographic uniqueness suffix — same precedent as
 * DefinitionsPage.tsx/TemplatesPage.tsx's own `uniqueSuffix` (collisions
 * are harmless: a person picks step/section ids indirectly via "add", not
 * by typing them, so a clash within one session is vanishingly unlikely
 * and not safety-critical). */
function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * `available_in` defaults to the machine's INITIAL state rather than `[]`.
 *
 * An empty `available_in` is a step that appears in no state at all —
 * silently inert, with nothing in the UI saying so. Defaulting to the
 * initial state means a newly added step is visible somewhere by default,
 * which is what an author almost always wants; widening or moving it is a
 * checkbox away. Falls back to `[]` only when the machine has no initial
 * state yet, since there is nothing honest to point at.
 */
function newStep(
  type: WorkflowStepDef['type'],
  states: StateDef[] = [],
): WorkflowStepDef {
  const initial = states.find((s) => s.kind === 'initial');
  return {
    step_id: `${type}-${uniqueSuffix()}`,
    type,
    title: '',
    required: false,
    blocking: false,
    available_in: initial ? [initial.state_id] : [],
    show_if: null,
    review: null,
    config: type === 'form' ? { sections: [] } : type === 'documents' ? { docs: [] } : { body: '' },
  };
}

function newSection(): WorkflowSectionDef {
  return { section_id: `section-${uniqueSuffix()}`, entity_model: '', fields: [], mode: 'create', repeat: null };
}

function getSections(step: WorkflowStepDef): WorkflowSectionDef[] {
  const raw = step.config.sections;
  return Array.isArray(raw) ? (raw as WorkflowSectionDef[]) : [];
}

function withSections(step: WorkflowStepDef, sections: WorkflowSectionDef[]): WorkflowStepDef {
  return { ...step, config: { ...step.config, sections } };
}

/** Every declared form-step section's picked fields, grouped by section_id,
 * as `{section_id}.{field}` source options — plus a fixed "context" group
 * offering `context.school_year` (task-7-brief.md's binding rule). */
function buildSourceGroups(steps: WorkflowStepDef[], contextLabel: string): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of getSections(step)) {
      if (!section.entity_model || section.fields.length === 0) continue;
      groups.push({
        label: section.section_id,
        options: section.fields.map((f) => ({
          value: `${section.section_id}.${f.name}`,
          label: `${section.section_id}.${f.name}`,
        })),
      });
    }
  }
  groups.push({ label: contextLabel, options: [{ value: 'context.school_year', label: 'context.school_year' }] });
  return groups;
}

export default function StepEditor({
  steps,
  onChange,
  models,
  states,
  errors,
  readOnly,
  stageId,
  hideAvailableIn,
}: StepEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sourceGroups = useMemo(
    () => buildSourceGroups(steps, t('editor.showIf.contextGroup')),
    [steps, t],
  );
  // Friendly names for the "also in {stages}" note (F2) — built from the
  // same `states` prop the (now-hidden-in-stage-mode) available_in grid
  // already used, so no extra prop is needed to name a stage.
  const stateNames = useMemo(
    () => new Map(states.map((s) => [s.state_id, s.name || s.state_id])),
    [states],
  );

  function toggleCollapsed(stepId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  function updateStepAt(idx: number, next: WorkflowStepDef) {
    onChange((prev) => prev.map((s, i) => (i === idx ? next : s)));
  }

  function removeStepAt(idx: number) {
    onChange((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    onChange((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addStep(type: WorkflowStepDef['type']) {
    const created = newStep(type, states);
    onChange((prev) => [...prev, stageId ? { ...created, available_in: [stageId] } : created]);
  }

  /**
   * show_if setter for one step — routed through here (rather than an
   * inline lambda at the call site) specifically to catch the
   * unconditional -> conditional transition: task review fix #1 requires
   * that any already-picked field that becomes forbidden the moment this
   * step gains a `show_if` (model-required, no default) is dropped
   * immediately, with a toast naming what was dropped, rather than left in
   * place to fail validation silently.
   */
  function updateStepShowIf(idx: number, step: WorkflowStepDef, next: ConditionGroupDef | null) {
    const becameConditional = step.show_if == null && next != null;
    if (becameConditional && step.type === 'form') {
      const sections = getSections(step);
      const { sections: nextSections, dropped } = dropForbiddenConditionalFieldsAcross(sections, models);
      if (dropped.length > 0) {
        toast({
          message: t('editor.section.droppedForConditional').replace('{fields}', dropped.join(', ')),
          tone: 'attn',
        });
      }
      updateStepAt(idx, withSections({ ...step, show_if: next }, nextSections));
      return;
    }
    updateStepAt(idx, { ...step, show_if: next });
  }

  return (
    <div className="step-editor">
      <div className="step-editor-toolbar">
        {/* F3: StageCard already renders "What happens here" directly above
         * this component in stage mode — a second "Steps" heading here would
         * reintroduce the exact tab-vocabulary this task exists to retire. */}
        {!stageId && <span className="step-editor-heading">{t('editor.steps.heading')}</span>}
        <div className="step-editor-add-buttons">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => addStep('form')} disabled={readOnly}>
            {t('editor.step.addForm')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => addStep('documents')}
            disabled={readOnly}
          >
            {t('editor.step.addDocuments')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => addStep('message')}
            disabled={readOnly}
          >
            {t('editor.step.addMessage')}
          </button>
        </div>
      </div>

      {/* F4: in stage mode, StageCard's own `editor.stage.noSteps` already
       * covers the empty case for THIS stage — this message tests the FULL
       * array and would render a second, contradictory empty state
       * alongside it. */}
      {!stageId && steps.length === 0 && <p className="step-editor-empty">{t('editor.steps.empty')}</p>}

      <ul className="step-editor-list">
        {steps.map((step, idx) => {
          if (stageId && !step.available_in.includes(stageId)) return null;
          const isCollapsed = collapsed.has(step.step_id);
          const stepErrors = errorsForStep(errors, step.step_id);
          return (
            <li key={step.step_id} className="step-card">
              <div className="step-card-header">
                <button
                  type="button"
                  className="step-collapse-toggle"
                  onClick={() => toggleCollapsed(step.step_id)}
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? t('editor.step.expand') : t('editor.step.collapse')}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className="step-type-badge" data-type={step.type}>
                  {t(`editor.step.type.${step.type}`)}
                </span>
                <input
                  type="text"
                  className="step-title-input"
                  value={step.title}
                  placeholder={t('editor.step.titlePlaceholder')}
                  disabled={readOnly}
                  onChange={(e) => updateStepAt(idx, { ...step, title: e.target.value })}
                />
                <div className="step-card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={readOnly || Boolean(stageId) || idx === 0}
                    onClick={() => moveStep(idx, -1)}
                    aria-label={t('editor.step.moveUp')}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={readOnly || Boolean(stageId) || idx === steps.length - 1}
                    onClick={() => moveStep(idx, 1)}
                    aria-label={t('editor.step.moveDown')}
                  >
                    &darr;
                  </button>
                  {/* F1: the only way to take a step out of ONE stage without
                   * deleting it everywhere else it appears. Uses the pure
                   * `removeStepFromStage` helper, keyed by step_id — not
                   * `idx` — so it is correct regardless of the full array's
                   * ordering. */}
                  {stageId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onChange((prev) => removeStepFromStage(prev, step.step_id, stageId))}
                      disabled={readOnly}
                    >
                      {t('editor.stage.removeFromStage')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => removeStepAt(idx)}
                    disabled={readOnly}
                  >
                    {/* F2: this button is global — it deletes the step from
                     * EVERY stage it appears in, not just this card. Its
                     * label must read as that, now that "Remove from this
                     * stage" exists right next to it and the two must not be
                     * confused. */}
                    {stageId ? t('editor.stage.deleteEverywhere') : t('editor.step.remove')}
                  </button>
                </div>
              </div>

              {/* F2: moved onto the step's own row, next to the buttons that
               * act on it — was previously a separate list rendered above
               * the whole step list in StageCard, disconnected from the row
               * a reader would act on. */}
              {stageId && step.available_in.length > 1 && (
                <p className="step-card-also-in">
                  {t('editor.stage.alsoIn').replace(
                    '{stages}',
                    step.available_in
                      .filter((id) => id !== stageId)
                      .map((id) => stateNames.get(id) ?? id)
                      .join(', '),
                  )}
                </p>
              )}

              {stepErrors.length > 0 && (
                <ul className="inline-errors" role="alert">
                  {stepErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}

              {!isCollapsed && (
                <div className="step-card-body">
                  <span className="step-card-id">{step.step_id}</span>

                  <div className="step-card-row">
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={step.required}
                        disabled={readOnly}
                        onChange={(e) => updateStepAt(idx, { ...step, required: e.target.checked })}
                      />
                      {t('editor.step.required')}
                    </label>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={step.blocking}
                        disabled={readOnly}
                        onChange={(e) => updateStepAt(idx, { ...step, blocking: e.target.checked })}
                      />
                      {t('editor.step.blocking')}
                    </label>
                    <label className="section-panel-field">
                      <span>{t('editor.step.review')}</span>
                      <select
                        value={step.review ?? ''}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateStepAt(idx, {
                            ...step,
                            review: (e.target.value || null) as WorkflowStepDef['review'],
                          })
                        }
                      >
                        <option value="">{t('editor.step.reviewDefault')}</option>
                        <option value="staff">{t('editor.step.reviewStaff')}</option>
                        <option value="auto">{t('editor.step.reviewAuto')}</option>
                      </select>
                    </label>
                  </div>

                  {!hideAvailableIn && (
                    <div className="step-available-in">
                      <span className="step-panel-label">{t('editor.step.availableIn')}</span>
                      <div className="step-available-in-options">
                        {states.length === 0 && (
                          <span className="step-available-in-empty">{t('editor.step.noStates')}</span>
                        )}
                        {states.map((s) => {
                          const checked = step.available_in.includes(s.state_id);
                          return (
                            <label key={s.state_id} className="step-state-chip">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={readOnly}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...step.available_in, s.state_id]
                                    : step.available_in.filter((id) => id !== s.state_id);
                                  updateStepAt(idx, { ...step, available_in: next });
                                }}
                              />
                              {s.state_id}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {step.type === 'form' && (
                    <FormStepPanel
                      step={step}
                      models={models}
                      errors={errors}
                      readOnly={readOnly}
                      onChange={(next) => updateStepAt(idx, next)}
                    />
                  )}
                  {step.type === 'documents' && (
                    <DocumentsStepPanel step={step} readOnly={readOnly} onChange={(next) => updateStepAt(idx, next)} />
                  )}
                  {step.type === 'message' && (
                    <MessageStepPanel step={step} readOnly={readOnly} onChange={(next) => updateStepAt(idx, next)} />
                  )}

                  <div className="step-showif">
                    <span className="step-panel-label">{t('editor.step.showIf')}</span>
                    <ShowIfBuilder
                      value={step.show_if}
                      onChange={(next) => updateStepShowIf(idx, step, next)}
                      sourceGroups={sourceGroups}
                      readOnly={readOnly}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FormStepPanel({
  step,
  models,
  errors,
  readOnly,
  onChange,
}: {
  step: WorkflowStepDef;
  models: EntityModelsMap;
  errors: string[];
  readOnly: boolean;
  onChange: (next: WorkflowStepDef) => void;
}) {
  const { t } = useTranslation();
  const sections = getSections(step);
  const conditional = step.show_if != null;

  function updateSectionAt(idx: number, next: WorkflowSectionDef) {
    onChange(withSections(step, sections.map((s, i) => (i === idx ? next : s))));
  }
  function removeSectionAt(idx: number) {
    onChange(withSections(step, sections.filter((_, i) => i !== idx)));
  }
  function addSection() {
    onChange(withSections(step, [...sections, newSection()]));
  }

  return (
    <div className="form-step-sections">
      <div className="form-step-sections-header">
        <h4>{t('editor.section.heading')}</h4>
        <button type="button" className="btn btn-secondary btn-sm" onClick={addSection} disabled={readOnly}>
          {t('editor.section.add')}
        </button>
      </div>
      {sections.length === 0 && <p className="form-step-sections-empty">{t('editor.section.empty')}</p>}
      <div className="form-step-sections-list">
        {sections.map((section, idx) => (
          <SectionPanel
            key={section.section_id}
            section={section}
            models={models}
            errors={errorsForSection(errors, section.section_id)}
            conditional={conditional}
            readOnly={readOnly}
            onChange={(next) => updateSectionAt(idx, next)}
            onRemove={() => removeSectionAt(idx)}
          />
        ))}
      </div>
    </div>
  );
}

interface DocEntry {
  name: string;
  description?: string;
  sensitive: boolean;
  blocking: boolean;
  due_days_after_state?: number;
}

function getDocs(step: WorkflowStepDef): DocEntry[] {
  const raw = step.config.docs;
  return Array.isArray(raw) ? (raw as DocEntry[]) : [];
}
function withDocs(step: WorkflowStepDef, docs: DocEntry[]): WorkflowStepDef {
  return { ...step, config: { ...step.config, docs } };
}
function newDoc(): DocEntry {
  return { name: '', description: '', sensitive: false, blocking: false };
}

function DocumentsStepPanel({
  step,
  readOnly,
  onChange,
}: {
  step: WorkflowStepDef;
  readOnly: boolean;
  onChange: (next: WorkflowStepDef) => void;
}) {
  const { t } = useTranslation();
  const docs = getDocs(step);

  function updateDocAt(idx: number, next: DocEntry) {
    onChange(withDocs(step, docs.map((d, i) => (i === idx ? next : d))));
  }
  function removeDocAt(idx: number) {
    onChange(withDocs(step, docs.filter((_, i) => i !== idx)));
  }
  function addDoc() {
    onChange(withDocs(step, [...docs, newDoc()]));
  }

  return (
    <div className="documents-step-panel">
      <div className="documents-step-header">
        <h4>{t('editor.docs.heading')}</h4>
        <button type="button" className="btn btn-secondary btn-sm" onClick={addDoc} disabled={readOnly}>
          {t('editor.docs.add')}
        </button>
      </div>
      {docs.length === 0 && <p className="documents-step-empty">{t('editor.docs.empty')}</p>}
      {docs.map((doc, idx) => (
        <div className="documents-step-row" key={idx}>
          <label className="doc-field">
            <span>{t('editor.docs.name')}</span>
            <input
              type="text"
              value={doc.name}
              disabled={readOnly}
              onChange={(e) => updateDocAt(idx, { ...doc, name: e.target.value })}
            />
          </label>
          <label className="doc-field">
            <span>{t('editor.docs.description')}</span>
            <input
              type="text"
              value={doc.description ?? ''}
              disabled={readOnly}
              onChange={(e) => updateDocAt(idx, { ...doc, description: e.target.value })}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={doc.sensitive}
              disabled={readOnly}
              onChange={(e) => updateDocAt(idx, { ...doc, sensitive: e.target.checked })}
            />
            {t('editor.docs.sensitive')}
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={doc.blocking}
              disabled={readOnly}
              onChange={(e) => updateDocAt(idx, { ...doc, blocking: e.target.checked })}
            />
            {t('editor.docs.blocking')}
          </label>
          <label className="doc-field doc-field-days">
            <span>{t('editor.docs.dueDays')}</span>
            <input
              type="number"
              min={0}
              value={doc.due_days_after_state ?? ''}
              disabled={readOnly}
              onChange={(e) =>
                updateDocAt(idx, {
                  ...doc,
                  due_days_after_state: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeDocAt(idx)} disabled={readOnly}>
            {t('editor.docs.remove')}
          </button>
        </div>
      ))}
    </div>
  );
}

function getBody(step: WorkflowStepDef): string {
  const raw = step.config.body;
  return typeof raw === 'string' ? raw : '';
}
function getAck(step: WorkflowStepDef): boolean {
  return Boolean(step.config.ack);
}

function MessageStepPanel({
  step,
  readOnly,
  onChange,
}: {
  step: WorkflowStepDef;
  readOnly: boolean;
  onChange: (next: WorkflowStepDef) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="message-step-panel">
      <label className="message-body-field">
        <span>{t('editor.message.body')}</span>
        <textarea
          rows={4}
          value={getBody(step)}
          disabled={readOnly}
          onChange={(e) => onChange({ ...step, config: { ...step.config, body: e.target.value } })}
        />
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={getAck(step)}
          disabled={readOnly}
          onChange={(e) => onChange({ ...step, config: { ...step.config, ack: e.target.checked } })}
        />
        {t('editor.message.ack')}
      </label>
    </div>
  );
}
