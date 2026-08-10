// Cross-cutting exits, authored once as a rule.
//
// Scope is a rule with exceptions, not a checkbox list, for a failure that
// is invisible with a list: adding a Payment stage six months later silently
// leaves it un-exitable and nothing on screen looks wrong. The default reads
// "any stage before the finish" with every stage listed and ticked beneath
// it, plus a live expansion count and an explicit uncovered-stage count.
import { useTranslation } from '../hooks/useTranslation.ts';
import MoveRow from './MoveRow.tsx';
import { membersForScope } from './stage/write.ts';
import type { MoveGroup, Stage } from './stage/types.ts';
import type { EntityModelsMap, PrimitivesCatalog, StateDef } from '../types/designer.ts';
import type { SourceGroup } from './ShowIfBuilder.tsx';
import './editor.css';

interface ExitsPanelProps {
  exits: MoveGroup[];
  /** Every stage, in spine order — the scope list is derived from this
   * rather than passed in, so a stage added later is offered automatically.
   * That is the whole point of "a rule, not a checkbox list". */
  stages: Stage[];
  states: StateDef[];
  primitives: PrimitivesCatalog | null;
  /** True when the primitives catalog fetch failed — see MoveRow's prop of
   * the same name. Threaded through here so the "Edit as advanced" panel on
   * an exit's MoveRow degrades the same way a stage move's does. */
  primitivesError: boolean;
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  onChange: (next: MoveGroup) => void;
  onRemove: (key: string) => void;
}

export default function ExitsPanel({
  exits,
  stages,
  states,
  primitives,
  primitivesError,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  onChange,
  onRemove,
}: ExitsPanelProps) {
  const { t } = useTranslation();
  /** The stages the default rule covers: everything that is not terminal. */
  const ruleStages = stages.filter((s) => s.kind !== 'terminal');

  return (
    <section className="stage-exits">
      <h3>{t('editor.exits.heading')}</h3>
      {exits.length === 0 && <p className="stage-empty">{t('editor.exits.empty')}</p>}
      <ul className="stage-exit-cards">
        {exits.map((exit) => {
          const scope = new Set(exit.members.map((m) => m.from));
          const actors = new Set(exit.members.map((m) => m.actor)).size;
          const uncovered = ruleStages.filter((s) => !scope.has(s.stage_id)).length;
          return (
            // `exit.key` is derived from the group's content (action, to,
            // who, guards, effects — see types.ts), so keying on it remounts
            // this card on every edit and destroys focus mid-edit — the same
            // bug StageEditor.tsx's `renderMoves` fixed for stage moves.
            // `members[0].transition_id` is stable across exactly those
            // edits and unique per group (`members` is never empty and each
            // transition belongs to exactly one group).
            <li key={exit.members[0].transition_id} className="stage-exit-card">
              <ul className="move-rows">
                <MoveRow
                  group={exit}
                  stages={stages}
                  states={states}
                  primitives={primitives}
                  primitivesError={primitivesError}
                  models={models}
                  declaredSectionIds={declaredSectionIds}
                  declaredStepIds={declaredStepIds}
                  sourceGroups={sourceGroups}
                  readOnly={readOnly}
                  onChange={onChange}
                  onRemove={() => onRemove(exit.key)}
                />
              </ul>

              <fieldset className="stage-exit-scope">
                <legend>{t('editor.exit.scopeHeading')}</legend>
                <p className="stage-exit-scope-rule">{t('editor.exit.scopeRule')}</p>
                {ruleStages.map((stage) => {
                  // Refuse the last untick: emptying a scope makes
                  // `membersForScope` return `[]`, which `writeMachine`
                  // writes as zero transitions — on the next read the group
                  // no longer exists (`readStageModel` has nothing to build
                  // it from) and the card vanishes with no undo. Deliberate
                  // deletion of the whole rule stays available through
                  // "Remove this move" (explicit, labelled), so disabling
                  // this box loses no capability — it only blocks the
                  // accidental, silent path to the same end state.
                  const ticked = scope.has(stage.stage_id);
                  const isLastTicked = ticked && scope.size === 1;
                  return (
                    <label key={stage.stage_id} className="stage-exit-scope-option">
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={readOnly || isLastTicked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...scope, stage.stage_id]
                            : [...scope].filter((id) => id !== stage.stage_id);
                          onChange({ ...exit, members: membersForScope(exit, next) });
                        }}
                      />
                      {stage.name || stage.stage_id}
                    </label>
                  );
                })}
              </fieldset>

              <p className="stage-exit-expansion">
                {t('editor.exits.expansion')
                  .replace('{t}', String(exit.members.length))
                  .replace('{s}', String(scope.size))
                  .replace('{a}', String(actors))}
                {uncovered > 0 && (
                  <>
                    {' · '}
                    <span className="stage-exit-uncovered">
                      {t('editor.exit.uncovered').replace('{n}', String(uncovered))}
                    </span>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
