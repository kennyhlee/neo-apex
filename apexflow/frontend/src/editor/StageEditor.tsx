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
import { useToast } from '../hooks/useToast.ts';
import { getPrimitives } from '../api/designer.ts';
import { readStageModel, isExitGroup } from './stage/read.ts';
import { writeMachine } from './stage/write.ts';
import { buildSourceGroups, declaredSectionIds, declaredStepIds } from './stage/sources.ts';
import {
  addExit,
  addMove,
  addStage,
  canAddExit,
  removeMoveFromStage,
  removeStage,
  setStageKind,
} from './stageOps.ts';
import StageCard from './StageCard.tsx';
import MoveRow from './MoveRow.tsx';
import ExitsPanel from './ExitsPanel.tsx';
import type { MoveGroup, Stage, StageModel } from './stage/types.ts';
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
  const { toast } = useToast();
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

  // `removeStage` changes both the model and the steps (a step's
  // `available_in` loses the removed stage), so both must commit together —
  // `commit` alone only ever touches the model.
  function commitRemoveStage(stageId: string) {
    const removed = removeStage(model, stageId, steps);
    onMachineChange(writeMachine(removed.model));
    onStepsChange(removed.steps);
  }

  // `setStageKind` demotes the previous initial stage because the machine may
  // hold exactly one — the deleted MachineEditor.tsx did the same and said so
  // rather than letting a badge quietly move. The demoted stage is read here,
  // before the write, so `setStageKind` itself stays pure.
  function commitStageKind(stageId: string, kind: Stage['kind']) {
    if (kind === 'initial') {
      const demoted = model.stages.find((s) => s.kind === 'initial' && s.stage_id !== stageId);
      if (demoted) {
        toast({
          message: t('editor.stage.demotedInitial').replace(
            '{name}',
            demoted.name || demoted.stage_id,
          ),
          tone: 'attn',
        });
      }
    }
    commit(setStageKind(model, stageId, kind));
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

  // How many moves `removeStage` would genuinely delete — NOT how many
  // merely touch the stage. A group survives with a shorter member list if
  // it has members from other stages too (see `removeStage`'s doc comment),
  // so counting every group that merely touches the stage overstates the
  // impact — e.g. signup's six-member `drop` group survives removing
  // `offered` with 4 members left, so it must not count toward the total.
  // This mirrors `removeStage`'s own deletion rule exactly: a group is
  // deleted if it targets the stage (`to`, which would otherwise dangle) or
  // every one of its members leaves from the stage (so none would remain).
  const stageName = new Map(model.stages.map((s) => [s.stage_id, s.name || s.stage_id]));

  /** The OTHER stages this move also leaves from, named. Empty for the
   * ordinary one-stage move, which keeps its single "Remove this move"
   * button; non-empty is exactly the case where that button would have
   * deleted another stage's transition without saying so. */
  function otherSourceNames(group: MoveGroup, stageId: string): string[] {
    const others = [...new Set(group.members.map((m) => m.from))].filter((id) => id !== stageId);
    return others.map((id) => stageName.get(id) ?? id);
  }

  const removalImpact = new Map<string, number>();
  for (const stage of model.stages) {
    removalImpact.set(
      stage.stage_id,
      model.groups.filter(
        (g) => g.to === stage.stage_id || g.members.every((m) => m.from === stage.stage_id),
      ).length,
    );
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
              canRemove={model.stages.length > 1}
              removeImpact={removalImpact.get(stage.stage_id) ?? 0}
              onStepsChange={onStepsChange}
              onRename={(name) =>
                commit({
                  ...model,
                  stages: model.stages.map((s) =>
                    s.stage_id === stage.stage_id ? { ...s, name } : s,
                  ),
                })
              }
              onKindChange={(kind) => commitStageKind(stage.stage_id, kind)}
              onRemoveStage={() => commitRemoveStage(stage.stage_id)}
              onAddMove={() => commit(addMove(model, stage.stage_id))}
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
                      // F3: a group is keyed on everything except `from`, so
                      // one card can be the rendering of transitions leaving
                      // several stages — and it renders identically under each
                      // of them. Naming the others turns a silent multi-stage
                      // delete into a labelled one.
                      alsoFrom={otherSourceNames(move, stage.stage_id)}
                      onChange={(next) =>
                        commit({
                          ...model,
                          groups: model.groups.map((g) => (g.key === move.key ? next : g)),
                        })
                      }
                      onRemove={() =>
                        commit({ ...model, groups: model.groups.filter((g) => g.key !== move.key) })
                      }
                      onRemoveFromStage={() =>
                        commit(removeMoveFromStage(model, move.key, stage.stage_id))
                      }
                    />
                  ))}
                </ul>
              )}
            />
          ))}
        </ol>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={readOnly}
          onClick={() => commit(addStage(model))}
        >
          {t('editor.stages.addStage')}
        </button>
      </section>

      <ExitsPanel
        exits={exits}
        canAddExit={canAddExit(model)}
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
        onAddExit={() => commit(addExit(model))}
      />

      {errors.length > 0 && (
        <p className="stage-editor-error-count" role="status">
          {t('editor.stages.errorCount').replace('{n}', String(errors.length))}
        </p>
      )}
    </div>
  );
}
