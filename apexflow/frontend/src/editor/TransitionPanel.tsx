// Transitions grouped by (from, action) — declaration order visible,
// reorder up/down WITHIN a group (task-8-brief.md's binding rule: "the
// guarded-alternatives semantics visible: first match wins; unguarded
// last"). Groups are a purely DERIVED view over the flat `transitions`
// array (grouped by each transition's CURRENT from/action, recomputed every
// render) — from/action are ordinary per-transition editable fields
// (task-8-brief.md: "per transition: from/to (state selects), action
// (text)"), not a separate group-owned value, so editing either can move a
// transition into a different visual group.
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import GuardEffectComposer from './GuardEffectComposer.tsx';
import type { SourceGroup } from './ShowIfBuilder.tsx';
import { errorsForTransition } from './validationMatch.ts';
import type {
  EntityModelsMap,
  GuardRef,
  EffectRef,
  PrimitivesCatalog,
  StateDef,
  TransitionDef,
} from '../types/designer.ts';
import './editor.css';

interface TransitionPanelProps {
  transitions: TransitionDef[];
  states: StateDef[];
  /** `null` while the catalog is still loading (MachineEditor's first
   * fetch) — guard/effect composers render a loading note instead until
   * it's available. */
  primitives: PrimitivesCatalog | null;
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  errors: string[];
  readOnly: boolean;
  onChange: (next: TransitionDef[]) => void;
}

/** Short, non-cryptographic uniqueness suffix — same precedent as
 * StepEditor.tsx's own `uniqueSuffix`. */
function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

interface GroupItem {
  transition: TransitionDef;
  flatIdx: number;
}

interface GroupEntry {
  from: string;
  action: string;
  items: GroupItem[];
}

/** Groups preserve BOTH the first-appearance order of each (from, action)
 * pair AND each group's own members' flat-array order — a `Map` iterates in
 * insertion order, and pushing each transition onto its group in flat-array
 * order does the rest; no separate sort needed for either axis. */
function buildGroups(transitions: TransitionDef[]): GroupEntry[] {
  const map = new Map<string, GroupEntry>();
  transitions.forEach((t, flatIdx) => {
    const key = `${t.from}\u0000${t.action}`;
    let group = map.get(key);
    if (!group) {
      group = { from: t.from, action: t.action, items: [] };
      map.set(key, group);
    }
    group.items.push({ transition: t, flatIdx });
  });
  return Array.from(map.values());
}

export default function TransitionPanel({
  transitions,
  states,
  primitives,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  errors,
  readOnly,
  onChange,
}: TransitionPanelProps) {
  const { t } = useTranslation();
  const groups = buildGroups(transitions);

  function addTransition(from: string, action: string) {
    onChange([
      ...transitions,
      {
        transition_id: `t-${uniqueSuffix()}`,
        from: from || (states[0]?.state_id ?? ''),
        to: '',
        action,
        actor: 'staff',
        guards: [],
        effects: [],
      },
    ]);
  }

  function updateTransition(flatIdx: number, next: TransitionDef) {
    onChange(transitions.map((t, i) => (i === flatIdx ? next : t)));
  }

  function removeTransition(flatIdx: number) {
    onChange(transitions.filter((_, i) => i !== flatIdx));
  }

  /** Swap the transition at `flatIdx` with its group-relative neighbor in
   * `dir` — swaps the two FLAT-ARRAY slots' contents directly rather than
   * making the group contiguous, so transitions belonging to OTHER groups
   * keep their own flat position untouched. */
  function moveTransition(flatIdx: number, groupIndices: number[], dir: -1 | 1) {
    const pos = groupIndices.indexOf(flatIdx);
    const targetPos = pos + dir;
    if (targetPos < 0 || targetPos >= groupIndices.length) return;
    const otherFlatIdx = groupIndices[targetPos];
    const next = [...transitions];
    [next[flatIdx], next[otherFlatIdx]] = [next[otherFlatIdx], next[flatIdx]];
    onChange(next);
  }

  return (
    <div className="transition-panel">
      <div className="transition-panel-toolbar">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => addTransition(states[0]?.state_id ?? '', '')}
          disabled={readOnly}
        >
          {t('editor.machine.transitions.add')}
        </button>
      </div>

      {transitions.length === 0 && <p className="transition-panel-empty">{t('editor.machine.transitions.empty')}</p>}

      {groups.map((group, gi) => {
        const groupIndices = group.items.map((it) => it.flatIdx);
        const unguardedPositions = group.items
          .map((it, i) => (it.transition.guards.length === 0 ? i : -1))
          .filter((i) => i >= 0);
        const multipleUnguarded = unguardedPositions.length > 1;
        const unguardedNotLast = unguardedPositions.length === 1 && unguardedPositions[0] !== group.items.length - 1;

        return (
          <div className="transition-group" key={`${group.from}\u0000${group.action}\u0000${gi}`}>
            <div className="transition-group-header">
              <span className="transition-group-label">
                <span className="transition-group-endpoint">
                  {group.from || t('editor.machine.transition.unset')}
                </span>
                <span className="transition-group-arrow" aria-hidden="true">
                  &rarr;
                </span>
                <span className="transition-group-endpoint transition-group-action">
                  {group.action || t('editor.machine.transition.unset')}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addTransition(group.from, group.action)}
                disabled={readOnly}
              >
                {t('editor.machine.transition.addToGroup')}
              </button>
            </div>

            {(multipleUnguarded || unguardedNotLast) && (
              <ul className="inline-hints" role="alert">
                <li>
                  {multipleUnguarded
                    ? t('editor.machine.transition.multipleUnguarded')
                    : t('editor.machine.transition.unguardedNotLast')}
                </li>
              </ul>
            )}

            <ul className="transition-list">
              {group.items.map((item, pos) => (
                <TransitionCard
                  key={item.transition.transition_id}
                  transition={item.transition}
                  errors={errorsForTransition(errors, item.transition.transition_id)}
                  states={states}
                  primitives={primitives}
                  models={models}
                  declaredSectionIds={declaredSectionIds}
                  declaredStepIds={declaredStepIds}
                  sourceGroups={sourceGroups}
                  readOnly={readOnly}
                  canMoveUp={pos > 0}
                  canMoveDown={pos < group.items.length - 1}
                  onMoveUp={() => moveTransition(item.flatIdx, groupIndices, -1)}
                  onMoveDown={() => moveTransition(item.flatIdx, groupIndices, 1)}
                  onRemove={() => removeTransition(item.flatIdx)}
                  onChange={(next) => updateTransition(item.flatIdx, next)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TransitionCard({
  transition,
  errors,
  states,
  primitives,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onChange,
}: {
  transition: TransitionDef;
  errors: string[];
  states: StateDef[];
  primitives: PrimitivesCatalog | null;
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onChange: (next: TransitionDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  function setField<K extends keyof TransitionDef>(key: K, value: TransitionDef[K]) {
    onChange({ ...transition, [key]: value });
  }

  return (
    <li className="transition-card">
      <div className="transition-card-header">
        <button
          type="button"
          className="step-collapse-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('editor.step.expand') : t('editor.step.collapse')}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="transition-card-id">{transition.transition_id}</span>
        <div className="transition-card-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={readOnly || !canMoveUp}
            onClick={onMoveUp}
            aria-label={t('editor.machine.transition.moveUp')}
          >
            &uarr;
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={readOnly || !canMoveDown}
            onClick={onMoveDown}
            aria-label={t('editor.machine.transition.moveDown')}
          >
            &darr;
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={readOnly} onClick={onRemove}>
            {t('editor.machine.transition.remove')}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="inline-errors" role="alert">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      {!collapsed && (
        <div className="transition-card-body">
          <div className="transition-card-row">
            <label className="section-panel-field">
              <span>{t('editor.machine.transition.from')}</span>
              <select value={transition.from} disabled={readOnly} onChange={(e) => setField('from', e.target.value)}>
                <option value="" disabled>
                  {t('editor.machine.transition.selectStatePlaceholder')}
                </option>
                {states.map((s) => (
                  <option key={s.state_id} value={s.state_id}>
                    {s.state_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="section-panel-field">
              <span>{t('editor.machine.transition.to')}</span>
              <select value={transition.to} disabled={readOnly} onChange={(e) => setField('to', e.target.value)}>
                <option value="" disabled>
                  {t('editor.machine.transition.selectStatePlaceholder')}
                </option>
                {states.map((s) => (
                  <option key={s.state_id} value={s.state_id}>
                    {s.state_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="section-panel-field">
              <span>{t('editor.machine.transition.action')}</span>
              <input
                type="text"
                value={transition.action}
                placeholder={t('editor.machine.transition.actionPlaceholder')}
                disabled={readOnly}
                onChange={(e) => setField('action', e.target.value)}
              />
            </label>
            <label className="section-panel-field">
              <span>{t('editor.machine.transition.actor')}</span>
              <select
                value={transition.actor}
                disabled={readOnly}
                onChange={(e) => setField('actor', e.target.value as TransitionDef['actor'])}
              >
                <option value="family">{t('editor.machine.transition.actor.family')}</option>
                <option value="staff">{t('editor.machine.transition.actor.staff')}</option>
                <option value="system">{t('editor.machine.transition.actor.system')}</option>
              </select>
            </label>
          </div>

          {primitives ? (
            <>
              <GuardEffectComposer
                kindLabel="guard"
                refs={transition.guards}
                primitives={primitives.guards}
                models={models}
                states={states}
                declaredSectionIds={declaredSectionIds}
                declaredStepIds={declaredStepIds}
                sourceGroups={sourceGroups}
                readOnly={readOnly}
                onChange={(next) => setField('guards', next as GuardRef[])}
              />
              <GuardEffectComposer
                kindLabel="effect"
                refs={transition.effects}
                primitives={primitives.effects}
                models={models}
                states={states}
                declaredSectionIds={declaredSectionIds}
                declaredStepIds={declaredStepIds}
                sourceGroups={sourceGroups}
                readOnly={readOnly}
                onChange={(next) => setField('effects', next as EffectRef[])}
              />
            </>
          ) : (
            <p className="transition-primitives-loading">{t('editor.machine.primitives.loading')}</p>
          )}
        </div>
      )}
    </li>
  );
}
