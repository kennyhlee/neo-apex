// The one authoring surface. Replaces MachineEditor (the Machine tab) and
// the Steps tab: a stage is a state, the steps that happen in it are shown
// inside it, and the moves out of it are shown beneath it. Cross-cutting
// exits live in their own panel because authoring them per stage is what
// produced twelve copy-pasted withdraw transitions in the enrollment
// template.
//
// This component owns NO machine knowledge. It reads a StageModel, renders
// it, and writes edits back through `writeMachine` — so the round-trip
// property proved in stage/__tests__/roundTrip.test.ts covers every edit
// this UI can make.
import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { readStageModel, isExitGroup } from './stage/read.ts';
import type { MoveGroup } from './stage/types.ts';
import type {
  EntityModelsMap,
  MachineDef,
  WorkflowStepDef,
} from '../types/designer.ts';
import './editor.css';

interface StageEditorProps {
  tenantId: string;
  machine: MachineDef;
  steps: WorkflowStepDef[];
  models: EntityModelsMap;
  errors: string[];
  readOnly: boolean;
  onMachineChange: (next: MachineDef) => void;
  onStepsChange: (next: WorkflowStepDef[]) => void;
}

export default function StageEditor({
  machine,
  steps,
  errors,
}: StageEditorProps) {
  const { t } = useTranslation();
  const model = useMemo(() => readStageModel(machine, steps), [machine, steps]);

  const exits = model.groups.filter((g) => isExitGroup(g, model));
  const movesByStage = new Map<string, MoveGroup[]>();
  for (const group of model.groups) {
    if (isExitGroup(group, model)) continue;
    for (const member of group.members) {
      const list = movesByStage.get(member.from) ?? [];
      if (!list.includes(group)) list.push(group);
      movesByStage.set(member.from, list);
    }
  }

  return (
    <div className="stage-editor">
      <section className="stage-list">
        <h3>{t('editor.stages.heading')}</h3>
        {model.stages.length === 0 && <p className="stage-empty">{t('editor.stages.empty')}</p>}
        <ol className="stage-cards">
          {model.stages.map((stage) => (
            <li key={stage.stage_id} className="stage-card">
              <header className="stage-card-header">
                <span className="stage-card-name">{stage.name || stage.stage_id}</span>
                {stage.kind === 'initial' && (
                  <span className="stage-card-role">{t('editor.stages.startsHere')}</span>
                )}
                {stage.kind === 'terminal' && (
                  <span className="stage-card-role">{t('editor.stages.finishes')}</span>
                )}
              </header>
              <p className="stage-card-counts">
                {t('editor.stages.stepCount').replace('{n}', String(stage.step_ids.length))}
                {' · '}
                {t('editor.stages.moveCount').replace(
                  '{n}',
                  String((movesByStage.get(stage.stage_id) ?? []).length),
                )}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="stage-exits">
        <h3>{t('editor.exits.heading')}</h3>
        {exits.length === 0 && <p className="stage-empty">{t('editor.exits.empty')}</p>}
        <ul className="stage-exit-cards">
          {exits.map((exit) => {
            const stages = new Set(exit.members.map((m) => m.from)).size;
            const actors = new Set(exit.members.map((m) => m.actor)).size;
            return (
              <li key={exit.key} className="stage-exit-card">
                <span className="stage-exit-action">{exit.action}</span>
                <span className="stage-exit-expansion">
                  {t('editor.exits.expansion')
                    .replace('{t}', String(exit.members.length))
                    .replace('{s}', String(stages))
                    .replace('{a}', String(actors))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {errors.length > 0 && (
        <p className="stage-editor-error-count" role="status">
          {t('editor.stages.errorCount').replace('{n}', String(errors.length))}
        </p>
      )}
    </div>
  );
}
