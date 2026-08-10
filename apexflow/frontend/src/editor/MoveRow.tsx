// One move, rendered as a sentence with the existing composer one click
// away. The escape hatch is not a fallback for bad UI — it is the design's
// stated contract: "every move carries an 'Edit as advanced' control that
// opens today's GuardEffectComposer unchanged", and an unrecognised
// primitive "degrades to the raw view rather than being hidden or dropped".
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import GuardEffectComposer from './GuardEffectComposer.tsx';
import type { SourceGroup } from './ShowIfBuilder.tsx';
import { describePrimitive } from './stage/phrases.ts';
import { membersForWho } from './stage/write.ts';
import type { MoveGroup, Stage, Who } from './stage/types.ts';
import type {
  EntityModelsMap,
  PrimitivesCatalog,
  StateDef,
} from '../types/designer.ts';
import './editor.css';

interface MoveRowProps {
  group: MoveGroup;
  stages: Stage[];
  states: StateDef[];
  primitives: PrimitivesCatalog | null;
  /** True when the primitives catalog fetch failed — distinguishes "still
   * loading" (primitives null, no error: advanced panel is briefly empty)
   * from "never coming" (primitives null, errored: advanced panel explains
   * why instead of silently rendering nothing). */
  primitivesError: boolean;
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  /**
   * Names of the OTHER stages this same move also leaves from, when it is
   * rendered under one stage's card.
   *
   * A `MoveGroup` is keyed on everything except `from` (design ruling,
   * Amendment B), so two moves that agree on action/target/who/guards/effects
   * fold into ONE group rendered under every stage it leaves — pointing two
   * hand-added `move…` rows at the same target is enough to produce that.
   * Left unsaid, "Remove this move" then deletes the other stages'
   * transitions too. Non-empty here switches this row to the same pair of
   * scoped controls the step rows carry ("Remove from this stage" /
   * "Delete everywhere"). Empty (the ordinary case, and always for the Exits
   * panel, which scopes through its own checkbox rule instead) keeps the
   * single unambiguous "Remove this move".
   */
  alsoFrom?: string[];
  onChange: (next: MoveGroup) => void;
  onRemove: () => void;
  /** Drops only this stage's members. Required whenever `alsoFrom` is
   * non-empty; unused otherwise. */
  onRemoveFromStage?: () => void;
}

const WHO_OPTIONS: Who[] = ['family', 'staff', 'both', 'automatic'];

export default function MoveRow({
  group,
  stages,
  states,
  primitives,
  primitivesError,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  alsoFrom,
  onChange,
  onRemove,
  onRemoveFromStage,
}: MoveRowProps) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const targetName = stages.find((s) => s.stage_id === group.to)?.name || group.to;
  const shared = (alsoFrom?.length ?? 0) > 0 && onRemoveFromStage !== undefined;

  function setWho(who: Who) {
    onChange({ ...group, who, members: membersForWho(group, who) });
  }

  return (
    <li className="move-row">
      <div className="move-row-sentence">
        <select
          className="move-row-who"
          aria-label={t('editor.move.whoLabel')}
          value={group.who}
          disabled={readOnly}
          onChange={(e) => setWho(e.target.value as Who)}
        >
          {WHO_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {t(`editor.move.who.${w}`)}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="move-row-action"
          aria-label={t('editor.move.actionLabel')}
          value={group.action}
          disabled={readOnly}
          onChange={(e) => onChange({ ...group, action: e.target.value })}
        />
        <select
          className="move-row-target"
          aria-label={t('editor.move.goesTo').replace('{stage}', '')}
          value={group.to}
          disabled={readOnly}
          onChange={(e) => onChange({ ...group, to: e.target.value })}
        >
          {stages.map((s) => (
            <option key={s.stage_id} value={s.stage_id}>
              {s.name || s.stage_id}
            </option>
          ))}
        </select>
        <span className="move-row-target-label">
          {t('editor.move.goesTo').replace('{stage}', targetName)}
        </span>
      </div>

      {group.guards.length > 0 && (
        <p className="move-row-clause">
          <span className="move-row-clause-label">{t('editor.move.onlyWhen')}</span>{' '}
          {group.guards.map((g) => describePrimitive(g, t)).join('; ')}
        </p>
      )}
      {group.effects.length > 0 && (
        <p className="move-row-clause">
          <span className="move-row-clause-label">{t('editor.move.thenWhat')}</span>{' '}
          {group.effects.map((e) => describePrimitive(e, t)).join('; ')}
        </p>
      )}

      {/* Mirrors the step rows' "also in {stages}" note — same idiom, same
       * job: say that an edit here is an edit somewhere else too. */}
      {shared && (
        <p className="move-row-also-from">
          {t('editor.move.alsoFrom').replace('{stages}', alsoFrom!.join(', '))}
        </p>
      )}

      <div className="move-row-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? t('editor.move.advancedDone') : t('editor.move.advanced')}
        </button>
        {shared && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={readOnly}
            onClick={onRemoveFromStage}
          >
            {t('editor.move.removeFromStage')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={readOnly}
          onClick={onRemove}
        >
          {/* Same rule the step rows follow: the global control only claims
           * to be global once a scoped alternative sits next to it. */}
          {shared ? t('editor.move.deleteEverywhere') : t('editor.move.remove')}
        </button>
      </div>

      {advanced && primitivesError && (
        <p className="move-row-primitives-error">{t('editor.machine.primitives.error')}</p>
      )}

      {advanced && primitives && (
        <div className="move-row-advanced">
          <GuardEffectComposer
            kindLabel="guard"
            refs={group.guards}
            primitives={primitives.guards}
            models={models}
            states={states}
            declaredSectionIds={declaredSectionIds}
            declaredStepIds={declaredStepIds}
            sourceGroups={sourceGroups}
            readOnly={readOnly}
            onChange={(next) => onChange({ ...group, guards: next })}
          />
          <GuardEffectComposer
            kindLabel="effect"
            refs={group.effects}
            primitives={primitives.effects}
            models={models}
            states={states}
            declaredSectionIds={declaredSectionIds}
            declaredStepIds={declaredStepIds}
            sourceGroups={sourceGroups}
            readOnly={readOnly}
            onChange={(next) => onChange({ ...group, effects: next })}
          />
        </div>
      )}
    </li>
  );
}
