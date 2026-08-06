// Live preview tab (Task 9, replaces EditorPage.tsx's stub pane) — mounts
// flow-runtime's real `StepRenderer` against the CURRENT in-memory draft
// (draftStore's `steps`/`machine`/`models`, passed straight through as
// props — not a re-fetch of the persisted row), so edits made in the
// Steps/Machine tabs re-render here live: same store, same objects, no
// extra fetch (task-9-brief.md's binding rule).
//
// Preview answers (`answers` below) are local-only state, never written
// back to draftStore — this tab can never mark the draft dirty or trigger
// an autosave (binding rule: "Preview is inert with respect to
// persistence"). "Reset answers" just clears this local state.
import { useMemo, useState } from 'react';
import { StepRenderer, type ModelFieldSource, type WorkflowDraft } from '@neoapex/flow-runtime';
import '@neoapex/flow-runtime/src/flow-runtime.css';
import { useTranslation } from '../hooks/useTranslation.ts';
import { Button } from '../components/ui/Button.tsx';
import type { EntityModelsMap, MachineDef, WorkflowStepDef } from '../types/designer.ts';
import './editor.css';

interface PreviewPaneProps {
  steps: WorkflowStepDef[];
  machine: MachineDef;
  models: EntityModelsMap;
}

/**
 * The state a fresh preview (or one whose previously-selected state just
 * disappeared) should default to: the declared `kind: "initial"` state, or
 * the first declared state if none is marked initial yet (a draft mid-edit
 * in the Machine tab may not have one — `validate.py`'s "exactly one
 * initial state" rule is publish-time only, `_state_errors`), or `''` if
 * there are no states at all.
 */
function defaultStateId(states: MachineDef['states']): string {
  return states.find((s) => s.kind === 'initial')?.state_id ?? states[0]?.state_id ?? '';
}

export default function PreviewPane({ steps, machine, models }: PreviewPaneProps) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<WorkflowDraft>({});
  // `null` until the user explicitly picks a state — an override, not the
  // source of truth, so a state that gets renamed/removed in the Machine
  // tab (or a machine that had zero states when the user last picked one
  // and has since gained its first) can't leave this pane pinned to a
  // stale/nonexistent state_id. Derived below (`selectedState`) rather than
  // synced via an effect — react-hooks/set-state-in-effect flags a
  // setState call inside a `useEffect` body, and there is nothing here an
  // effect is actually needed for: "fall back to the default when the
  // override is no longer valid" is a pure function of this render's props
  // and state, computed the same way every render.
  const [stateOverride, setStateOverride] = useState<string | null>(null);
  const selectedState = useMemo(() => {
    if (stateOverride && machine.states.some((s) => s.state_id === stateOverride)) {
      return stateOverride;
    }
    return defaultStateId(machine.states);
  }, [stateOverride, machine.states]);

  /**
   * `available_in` pre-filter — `StepRenderer` itself does NOT consult
   * `available_in` (`flow-runtime/src/StepRenderer.tsx`'s
   * `StepRendererProps` doc comment: "Callers that DO have a state to
   * preview against ... must pre-filter `steps` to those whose
   * `available_in` includes the selected state before passing them in
   * here").
   *
   * DECISION — empty `available_in` means the step is available in NO
   * state (excluded here), not every state. Read from the backend rather
   * than guessed, per task-9-brief.md's binding rule:
   *
   * - `apexflow/backend/app/workflows/schema.py:220` declares
   *   `available_in: list[str]` with no default and not `Optional` —
   *   contrast `show_if: ConditionGroup | None = None` on the very next
   *   line (`schema.py:221`), whose `None` the engine explicitly treats as
   *   "no restriction, always applicable" (`applicable_items`, next
   *   bullet). `available_in` gets no such permissive
   *   empty/null-means-everything carve-out in its own schema — it must be
   *   explicitly authored to mean anything.
   * - `apexflow/backend/app/workflows/shared.py:107-124`'s
   *   `applicable_items` — the one runtime function that filters
   *   steps/items by "is this currently applicable" — only ever reads
   *   `step.show_if`; it never references `available_in`.
   *   `apexflow/backend/app/workflows/engine.py`'s `_derive_item_specs`
   *   (`engine.py:104-140`, instance-creation item derivation) likewise
   *   derives an item for every step unconditionally, never consulting
   *   `available_in` either. So there is no existing runtime "empty means
   *   all states" behavior this preview would otherwise be contradicting.
   * - The designer's own authoring UI (`StepEditor.tsx`'s `newStep`)
   *   starts every freshly-added step at `available_in: []` and builds the
   *   set purely by checking per-state boxes (that same file's
   *   `step.available_in.includes(s.state_id)` / `.filter(...)` toggle) —
   *   an allowlist a person builds UP from nothing, not a restriction they
   *   opt into from an otherwise-permissive default. Reading a brand-new,
   *   not-yet-configured step as "available in every state" until its
   *   author visits the checkboxes would be a footgun the checkbox UI's
   *   own shape argues against.
   *
   * `.includes()` against an empty array is always `false`, so this needs
   * no special-casing beyond the filter predicate itself.
   */
  const visibleSteps = useMemo(
    () => steps.filter((step) => step.available_in.includes(selectedState)),
    [steps, selectedState],
  );

  const countLabel = t('editor.preview.stepCount')
    .replace('{n}', String(visibleSteps.length))
    .replace('{m}', String(steps.length));

  return (
    <div className="preview-pane">
      <div className="preview-pane-toolbar">
        <label className="preview-pane-state-select">
          <span className="step-panel-label">{t('editor.preview.stateLabel')}</span>
          <select
            value={selectedState}
            disabled={machine.states.length === 0}
            onChange={(e) => setStateOverride(e.target.value)}
          >
            {machine.states.map((s) => (
              <option key={s.state_id} value={s.state_id}>
                {s.name || s.state_id}
              </option>
            ))}
          </select>
        </label>
        <span className="preview-pane-count">{countLabel}</span>
        <Button variant="secondary" size="sm" onClick={() => setAnswers({})}>
          {t('editor.preview.resetAnswers')}
        </Button>
      </div>

      {machine.states.length === 0 ? (
        <p className="preview-pane-empty">{t('editor.step.noStates')}</p>
      ) : visibleSteps.length === 0 ? (
        <p className="preview-pane-empty">{t('editor.preview.noStepsForState')}</p>
      ) : (
        <StepRenderer
          steps={visibleSteps}
          models={models as Record<string, ModelFieldSource>}
          mode="preview"
          draft={answers}
          onDraftChange={setAnswers}
        />
      )}
    </div>
  );
}
