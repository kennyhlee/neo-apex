// One stage: its name, what happens in it, and the moves out of it.
//
// "Steps move inside stages" (design spec): a step is created within the
// stage it happens in, and `available_in` is written from that placement. A
// step appearing in several stages shows in each, with an "also in" note so
// the author knows an edit here is an edit everywhere.
import type { ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import StepEditor from './StepEditor.tsx';
import type { StepsUpdater } from './draftStore.ts';
import type { MoveGroup, Stage } from './stage/types.ts';
import type { EntityModelsMap, StateDef, WorkflowStepDef } from '../types/designer.ts';
import './editor.css';

interface StageCardProps {
  stage: Stage;
  stages: Stage[];
  moves: MoveGroup[];
  steps: WorkflowStepDef[];
  states: StateDef[];
  models: EntityModelsMap;
  errors: string[];
  readOnly: boolean;
  onStepsChange: (next: StepsUpdater) => void;
  onRename: (name: string) => void;
  /** Rendered beneath the steps — supplied by StageEditor so MoveRow (Task 8)
   * can be dropped in without StageCard learning about moves. */
  renderMoves: (moves: MoveGroup[]) => ReactNode;
}

export default function StageCard({
  stage,
  stages,
  moves,
  steps,
  states,
  models,
  errors,
  readOnly,
  onStepsChange,
  onRename,
  renderMoves,
}: StageCardProps) {
  const { t } = useTranslation();
  const stageNames = new Map(stages.map((s) => [s.stage_id, s.name || s.stage_id]));
  const inThisStage = steps.filter((s) => s.available_in.includes(stage.stage_id));

  return (
    <li className="stage-card">
      <header className="stage-card-header">
        <label className="stage-card-name-label">
          <span className="visually-hidden">{t('editor.stage.rename')}</span>
          <input
            type="text"
            className="stage-card-name-input"
            value={stage.name}
            disabled={readOnly}
            onChange={(e) => onRename(e.target.value)}
          />
        </label>
        {stage.kind === 'initial' && (
          <span className="stage-card-role">{t('editor.stages.startsHere')}</span>
        )}
        {stage.kind === 'terminal' && (
          <span className="stage-card-role">{t('editor.stages.finishes')}</span>
        )}
      </header>

      <section className="stage-card-steps">
        <h4>{t('editor.stage.stepsHeading')}</h4>
        {inThisStage.length === 0 && <p className="stage-empty">{t('editor.stage.noSteps')}</p>}
        <ul className="stage-card-step-notes">
          {inThisStage
            .filter((step) => step.available_in.length > 1)
            .map((step) => (
              <li key={step.step_id} className="stage-card-step-note">
                {step.title || step.step_id}:{' '}
                {t('editor.stage.alsoIn').replace(
                  '{stages}',
                  step.available_in
                    .filter((id) => id !== stage.stage_id)
                    .map((id) => stageNames.get(id) ?? id)
                    .join(', '),
                )}
              </li>
            ))}
        </ul>
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
      </section>

      <section className="stage-card-moves">{renderMoves(moves)}</section>
    </li>
  );
}
