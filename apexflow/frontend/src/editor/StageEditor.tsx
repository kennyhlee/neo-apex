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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { getPrimitives } from '../api/designer.ts';
import { readStageModel, isExitGroup } from './stage/read.ts';
import { writeMachine } from './stage/write.ts';
import { buildSourceGroups, declaredSectionIds, declaredStepIds } from './stage/sources.ts';
import StageCard from './StageCard.tsx';
import MoveRow from './MoveRow.tsx';
import ExitsPanel from './ExitsPanel.tsx';
import type { MoveGroup, StageModel } from './stage/types.ts';
import type { StepsUpdater } from './draftStore.ts';
import type {
  EntityModelsMap,
  MachineDef,
  PrimitivesCatalog,
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
  onStepsChange: (next: StepsUpdater) => void;
}

export default function StageEditor({
  tenantId,
  machine,
  steps,
  models,
  errors,
  readOnly,
  onMachineChange,
  onStepsChange,
}: StageEditorProps) {
  const { t } = useTranslation();
  const model = useMemo(() => readStageModel(machine, steps), [machine, steps]);
  const [primitives, setPrimitives] = useState<PrimitivesCatalog | null>(null);
  const [primitivesError, setPrimitivesError] = useState(false);

  // Loaded once per tenant, same rationale as MachineEditor.tsx: the
  // catalog is auth-scoped per tenant but its content is static (generated
  // from the primitives registries, not tenant data), so a single fetch per
  // mount is enough.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPrimitivesError(false);
      try {
        const catalog = await getPrimitives(tenantId);
        if (!cancelled) setPrimitives(catalog);
      } catch {
        // MoveRow's "Edit as advanced" no longer goes silent on a failed
        // fetch — it renders `editor.machine.primitives.error` (same key
        // MachineEditor.tsx already uses for this) instead of nothing.
        if (!cancelled) setPrimitivesError(true);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const sourceGroups = useMemo(
    () => buildSourceGroups(steps, t('editor.showIf.contextGroup')),
    [steps, t],
  );
  const sectionIds = useMemo(() => declaredSectionIds(steps), [steps]);
  const stepIds = useMemo(() => declaredStepIds(steps), [steps]);

  function commit(next: StageModel) {
    onMachineChange(writeMachine(next));
  }

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
            <StageCard
              key={stage.stage_id}
              stage={stage}
              moves={movesByStage.get(stage.stage_id) ?? []}
              steps={steps}
              states={machine.states}
              models={models}
              errors={errors}
              readOnly={readOnly}
              onStepsChange={onStepsChange}
              onRename={(name) =>
                commit({
                  ...model,
                  stages: model.stages.map((s) =>
                    s.stage_id === stage.stage_id ? { ...s, name } : s,
                  ),
                })
              }
              renderMoves={(moves) => (
                <ul className="move-rows">
                  {moves.map((move) => (
                    <MoveRow
                      // `move.key` is derived from (action, to, who, guards,
                      // effects) — see types.ts — so editing ANY of those
                      // fields changes it, remounting this row and
                      // destroying focus/collapsing the advanced panel
                      // mid-edit. `members[0].transition_id` is stable
                      // across exactly those edits (renaming the action,
                      // changing a guard/effect doesn't touch `members`) and
                      // is unique per group (every transition belongs to
                      // exactly one group) — see MoveGroup's `members`
                      // comment ("Never empty").
                      key={move.members[0].transition_id}
                      group={move}
                      stages={model.stages}
                      states={machine.states}
                      primitives={primitives}
                      primitivesError={primitivesError}
                      models={models}
                      declaredSectionIds={sectionIds}
                      declaredStepIds={stepIds}
                      sourceGroups={sourceGroups}
                      readOnly={readOnly}
                      onChange={(next) =>
                        commit({
                          ...model,
                          groups: model.groups.map((g) => (g.key === move.key ? next : g)),
                        })
                      }
                      onRemove={() =>
                        commit({ ...model, groups: model.groups.filter((g) => g.key !== move.key) })
                      }
                    />
                  ))}
                </ul>
              )}
            />
          ))}
        </ol>
      </section>

      <ExitsPanel
        exits={exits}
        stages={model.stages}
        states={machine.states}
        primitives={primitives}
        primitivesError={primitivesError}
        models={models}
        declaredSectionIds={sectionIds}
        declaredStepIds={stepIds}
        sourceGroups={sourceGroups}
        readOnly={readOnly}
        onChange={(next) =>
          commit({ ...model, groups: model.groups.map((g) => (g.key === next.key ? next : g)) })
        }
        onRemove={(key) => commit({ ...model, groups: model.groups.filter((g) => g.key !== key) })}
      />

      {errors.length > 0 && (
        <p className="stage-editor-error-count" role="status">
          {t('editor.stages.errorCount').replace('{n}', String(errors.length))}
        </p>
      )}
    </div>
  );
}
