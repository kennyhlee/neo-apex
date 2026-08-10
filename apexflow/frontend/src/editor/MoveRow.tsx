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
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  onChange: (next: MoveGroup) => void;
  onRemove: () => void;
}

const WHO_OPTIONS: Who[] = ['family', 'staff', 'both', 'automatic'];

export default function MoveRow({
  group,
  stages,
  states,
  primitives,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  onChange,
  onRemove,
}: MoveRowProps) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const targetName = stages.find((s) => s.stage_id === group.to)?.name || group.to;

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

      <div className="move-row-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? t('editor.move.advancedDone') : t('editor.move.advanced')}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={readOnly}
          onClick={onRemove}
        >
          {t('editor.move.remove')}
        </button>
      </div>

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
