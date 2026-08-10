// One stage: its name, what happens in it, and the moves out of it.
//
// "Steps move inside stages" (design spec): a step is created within the
// stage it happens in, and `available_in` is written from that placement. A
// step appearing in several stages shows in each, with an "also in" note so
// the author knows an edit here is an edit everywhere.
import type { ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import StepEditor from './StepEditor.tsx';
import { addStepToStage } from './stagePlacement.ts';
import type { StepsUpdater } from './draftStore.ts';
import type { MoveGroup, Stage } from './stage/types.ts';
import type { EntityModelsMap, StateDef, WorkflowStepDef } from '../types/designer.ts';
import './editor.css';

/** Every role a stage can hold, in the order they read as a lifecycle.
 * Matches `StateDef['kind']` exactly — the machine has no fourth value. */
const STAGE_KINDS: Stage['kind'][] = ['initial', 'active', 'terminal'];

interface StageCardProps {
  stage: Stage;
  moves: MoveGroup[];
  steps: WorkflowStepDef[];
  states: StateDef[];
  models: EntityModelsMap;
  errors: string[];
  readOnly: boolean;
  /** False when this is the last remaining stage — deleting it would leave
   * the machine with nothing to add a stage back onto sensibly, so the
   * control is disabled rather than allowed to empty the workflow. */
  canRemove: boolean;
  /** How many moves (stage moves and exits alike) removing this stage would
   * genuinely delete — a group that keeps members from other stages
   * survives with a shorter list and does not count here. Surfaced via
   * `editor.stage.removeStageWarn` so deletion is not a surprise. */
  removeImpact: number;
  onStepsChange: (next: StepsUpdater) => void;
  onRename: (name: string) => void;
  /** Writes the stage's role. StageEditor routes this through
   * `stageOps.setStageKind` and `commit`, and raises the demotion toast when
   * picking "Starts here" takes that role off another stage. */
  onKindChange: (kind: Stage['kind']) => void;
  onRemoveStage: () => void;
  onAddMove: () => void;
  /** Rendered beneath the steps — supplied by StageEditor so MoveRow (Task 8)
   * can be dropped in without StageCard learning about moves. */
  renderMoves: (moves: MoveGroup[]) => ReactNode;
}

export default function StageCard({
  stage,
  moves,
  steps,
  states,
  models,
  errors,
  readOnly,
  canRemove,
  removeImpact,
  onStepsChange,
  onRename,
  onKindChange,
  onRemoveStage,
  onAddMove,
  renderMoves,
}: StageCardProps) {
  const { t } = useTranslation();
  // F1: candidates for "Add an existing step here" — every step NOT already
  // placed in this stage. Selecting one calls `addStepToStage`, which mints
  // no new `step_id`; the step just gains this stage alongside whatever it
  // already had.
  const candidates = steps.filter((s) => !s.available_in.includes(stage.stage_id));

  return (
    <li className="stage-card">
      <header className="stage-card-header">
        <label className="stage-card-name-label">
          <span className="sr-only">{t('editor.stage.rename')}</span>
          <input
            type="text"
            className="stage-card-name-input"
            value={stage.name}
            placeholder={stage.stage_id}
            disabled={readOnly}
            onChange={(e) => onRename(e.target.value)}
          />
        </label>
        {/* The stage's role. Previously a pair of read-only badges, which
         * left `kind` writable only by `newStage`'s fill-the-missing-role
         * rule — and therefore left a self-built workflow unable to ever
         * grow the second terminal stage the Exits panel asks for. */}
        <label className="stage-card-kind-label">
          <span className="sr-only">{t('editor.stage.kindLabel')}</span>
          <select
            className="stage-card-kind"
            value={stage.kind}
            disabled={readOnly}
            onChange={(e) => onKindChange(e.target.value as Stage['kind'])}
          >
            {STAGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`editor.stage.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={readOnly || !canRemove}
          onClick={onRemoveStage}
        >
          {t('editor.stage.removeStage')}
        </button>
      </header>
      {removeImpact > 0 && (
        <p className="stage-card-remove-warn">
          {t('editor.stage.removeStageWarn').replace('{n}', String(removeImpact))}
        </p>
      )}

      <section className="stage-card-steps">
        <h4>{t('editor.stage.stepsHeading')}</h4>
        {/* F2: the "also in" note now renders on each step's own row, inside
         * StepEditor (stage mode) — see StepEditor.tsx. Its own empty state
         * (`editor.stage.noSteps`) is the only empty-state message this card
         * shows; StepEditor suppresses its own for stageId (F4). */}
        {steps.filter((s) => s.available_in.includes(stage.stage_id)).length === 0 && (
          <p className="stage-empty">{t('editor.stage.noSteps')}</p>
        )}
        <StepEditor
          steps={steps}
          onChange={onStepsChange}
          models={models}
          states={states}
          errors={errors}
          readOnly={readOnly}
          stageId={stage.stage_id}
          hideAvailableIn
        />
        {/* F1: the only way, now that the available_in checkbox grid is
         * hidden in stage mode, to put an already-authored step into a
         * SECOND stage — "a step appearing in several stages is expressed
         * by adding it to each" (design spec). Controlled with a fixed
         * `value=""` so it resets to the placeholder after every pick,
         * rather than trying to keep showing a step that (once added) no
         * longer belongs in its own candidate list. */}
        <label className="stage-card-add-existing">
          <span className="sr-only">{t('editor.stage.addExisting')}</span>
          <select
            className="stage-card-add-existing-select"
            value=""
            disabled={readOnly || candidates.length === 0}
            onChange={(e) => {
              const stepId = e.target.value;
              if (!stepId) return;
              onStepsChange((prev) => addStepToStage(prev, stepId, stage.stage_id));
            }}
          >
            <option value="" disabled>
              {t('editor.stage.addExisting')}
            </option>
            {candidates.map((s) => (
              <option key={s.step_id} value={s.step_id}>
                {s.title || s.step_id}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="stage-card-moves">
        {renderMoves(moves)}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={readOnly}
          onClick={onAddMove}
        >
          {t('editor.stage.addMove')}
        </button>
      </section>
    </li>
  );
}
