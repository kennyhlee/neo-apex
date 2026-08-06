// Machine tab (Task 8, replaces EditorPage.tsx's stub pane): states
// list + ordered transitions grouped by (from, action) + per-transition
// guard/effect composer, all driven by the backend's primitives catalog
// (task-8-brief.md's binding rule). Mirrors StepEditor.tsx's own shape
// (top-level orchestration component, no drag library, up/down reorder
// buttons) for consistency within the editor package.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import { getPrimitives } from '../api/designer.ts';
import TransitionPanel from './TransitionPanel.tsx';
import type { SourceGroup } from './ShowIfBuilder.tsx';
import { errorsForState } from './validationMatch.ts';
import type { MachineUpdater } from './draftStore.ts';
import type {
  EntityModelsMap,
  MachineDef,
  PrimitivesCatalog,
  StateDef,
  WorkflowSectionDef,
  WorkflowStepDef,
} from '../types/designer.ts';
import './editor.css';

interface MachineEditorProps {
  tenantId: string;
  machine: MachineDef;
  steps: WorkflowStepDef[];
  models: EntityModelsMap;
  errors: string[];
  /** True when the definition isn't a draft — disables every mutating
   * control (task review fix #6, Task 7 convention). */
  readOnly: boolean;
  onChange: (updater: MachineUpdater) => void;
}

/** Short, non-cryptographic uniqueness suffix — same precedent as
 * StepEditor.tsx's own `uniqueSuffix` (a person picks state_ids indirectly
 * via "add" then can rename the auto-generated one; a within-session id
 * clash is vanishingly unlikely and not safety-critical). */
function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function newState(): StateDef {
  return { state_id: `state-${uniqueSuffix()}`, name: '', kind: 'active' };
}

function getSections(step: WorkflowStepDef): WorkflowSectionDef[] {
  const raw = step.config.sections;
  return Array.isArray(raw) ? (raw as WorkflowSectionDef[]) : [];
}

/** Every declared `section_id` across form steps (Steps tab) — the
 * `commit_sections.section_ids` picker's menu. */
function declaredSectionIds(steps: WorkflowStepDef[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of getSections(step)) {
      if (section.section_id) ids.push(section.section_id);
    }
  }
  return ids;
}

/** Every declared `step_id` (Steps tab) — the `step_ids` picker's menu
 * (`start_due_clocks`, `items_in_status`). */
function declaredStepIds(steps: WorkflowStepDef[]): string[] {
  return steps.map((s) => s.step_id);
}

/** Mirrors StepEditor.tsx's own `buildSourceGroups` (module-private there,
 * not exported) — same "{section_id}.{field}" + Context group shape, so a
 * `data_condition` guard's ShowIfBuilder offers the identical source menu a
 * step's own `show_if` does. */
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

export default function MachineEditor({ tenantId, machine, steps, models, errors, readOnly, onChange }: MachineEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [primitives, setPrimitives] = useState<PrimitivesCatalog | null>(null);
  const [primitivesError, setPrimitivesError] = useState(false);

  // Loaded once per tenant (task-8-brief.md: "loaded once into the
  // editor") — the catalog is tenant-scoped auth-wise but its CONTENT is
  // static (generated from the primitives registries, not tenant data), so
  // a single fetch per mount is enough; no cache invalidation needed.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPrimitivesError(false);
      try {
        const catalog = await getPrimitives(tenantId);
        if (!cancelled) setPrimitives(catalog);
      } catch {
        if (!cancelled) setPrimitivesError(true);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const sourceGroups = useMemo(() => buildSourceGroups(steps, t('editor.showIf.contextGroup')), [steps, t]);
  const sectionIds = useMemo(() => declaredSectionIds(steps), [steps]);
  const stepIds = useMemo(() => declaredStepIds(steps), [steps]);

  /**
   * Radio-style kind selection (task-8-brief.md's binding rule): picking
   * "initial" on one state demotes whichever OTHER state currently holds it
   * back to "active", with a toast notice — enforces "exactly one initial"
   * (`validate.py`'s `_state_errors`) directly in the UI rather than only
   * catching it at validate time.
   */
  function setStateKind(idx: number, kind: StateDef['kind']) {
    const current = machine.states[idx];
    if (!current || current.kind === kind) return;
    if (kind !== 'initial') {
      onChange({ ...machine, states: machine.states.map((s, i) => (i === idx ? { ...s, kind } : s)) });
      return;
    }
    const demoted = machine.states.find((s, i) => i !== idx && s.kind === 'initial');
    const nextStates = machine.states.map((s, i) =>
      i === idx ? { ...s, kind } : s.kind === 'initial' ? { ...s, kind: 'active' as const } : s,
    );
    onChange({ ...machine, states: nextStates });
    if (demoted) {
      toast({
        message: t('editor.machine.state.demotedInitial').replace('{name}', demoted.name || demoted.state_id),
        tone: 'attn',
      });
    }
  }

  function updateState(idx: number, next: StateDef) {
    onChange({ ...machine, states: machine.states.map((s, i) => (i === idx ? next : s)) });
  }
  function removeState(idx: number) {
    onChange({ ...machine, states: machine.states.filter((_, i) => i !== idx) });
  }
  function addState() {
    onChange({ ...machine, states: [...machine.states, newState()] });
  }
  function setTransitions(next: MachineDef['transitions']) {
    onChange({ ...machine, transitions: next });
  }

  return (
    <div className="machine-editor">
      <section className="machine-states">
        <div className="machine-section-header">
          <h3>{t('editor.machine.states.heading')}</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addState} disabled={readOnly}>
            {t('editor.machine.states.add')}
          </button>
        </div>

        {machine.states.length === 0 && <p className="machine-states-empty">{t('editor.machine.states.empty')}</p>}

        <ul className="machine-states-list">
          {machine.states.map((state, idx) => {
            // Keyed by index, not `state_id` — `state_id` is a live editable
            // text field below; keying on it would remount (and drop focus
            // from) the input on every keystroke.
            const stateErrors = errorsForState(errors, state.state_id);
            return (
              <li key={idx} className="machine-state-row">
                <div className="machine-state-row-fields">
                  <input
                    type="text"
                    className="machine-state-id-input"
                    value={state.state_id}
                    placeholder={t('editor.machine.state.idPlaceholder')}
                    disabled={readOnly}
                    onChange={(e) => updateState(idx, { ...state, state_id: e.target.value })}
                  />
                  <input
                    type="text"
                    className="machine-state-name-input"
                    value={state.name}
                    placeholder={t('editor.machine.state.namePlaceholder')}
                    disabled={readOnly}
                    onChange={(e) => updateState(idx, { ...state, name: e.target.value })}
                  />
                  <div
                    className="machine-state-kind-group"
                    role="radiogroup"
                    aria-label={t('editor.machine.state.kindLabel')}
                  >
                    {(['initial', 'active', 'terminal'] as const).map((k) => (
                      <label key={k} className="machine-state-kind-option">
                        <input
                          type="radio"
                          name={`state-kind-${idx}`}
                          checked={state.kind === k}
                          disabled={readOnly}
                          onChange={() => setStateKind(idx, k)}
                        />
                        {t(`editor.machine.state.kind.${k}`)}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={readOnly}
                    onClick={() => removeState(idx)}
                  >
                    {t('editor.machine.state.remove')}
                  </button>
                </div>
                {stateErrors.length > 0 && (
                  <ul className="inline-errors" role="alert">
                    {stateErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="machine-transitions">
        <div className="machine-section-header">
          <h3>{t('editor.machine.transitions.heading')}</h3>
        </div>
        {primitivesError && <p className="machine-primitives-error">{t('editor.machine.primitives.error')}</p>}
        <TransitionPanel
          transitions={machine.transitions}
          states={machine.states}
          primitives={primitives}
          models={models}
          declaredSectionIds={sectionIds}
          declaredStepIds={stepIds}
          sourceGroups={sourceGroups}
          errors={errors}
          readOnly={readOnly}
          onChange={setTransitions}
        />
      </section>
    </div>
  );
}
