// One-group-level show_if editor (task-7-brief.md DECISION): the top-level
// `ConditionGroupDef`'s combinator (all/any/not) and its immediate leaf
// `Condition` children are edited through structured controls. An immediate
// child that is itself a nested `ConditionGroupDef` — the schema allows
// arbitrary nesting (`workflows/schema.py`'s `ConditionItem = Union[
// Condition, ConditionGroup]`, interface map §2i) — renders READ-ONLY as
// JSON with an "Edit as JSON" escape hatch (parse+validate on blur), rather
// than recursing the structured UI another level deep.
//
// Wire shape reminder (map §2i / flow-runtime's `ConditionGroupDef` doc
// comment): `all`/`any`/`not` are ALL THREE present on the wire, with `null`
// for the two that are unset — never omitted. `withCombinator` below always
// emits all three keys so a round-trip through this builder never drops one.
import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { Condition, ConditionGroupDef, ConditionItem } from '../types/designer.ts';
import './editor.css';

export interface SourceOption {
  value: string;
  label: string;
}

export interface SourceGroup {
  label: string;
  options: SourceOption[];
}

interface ShowIfBuilderProps {
  value: ConditionGroupDef | null | undefined;
  onChange: (next: ConditionGroupDef | null) => void;
  /** Grouped source options — declared sections' picked fields, plus a
   * "Context" group (`task-7-brief.md`'s binding rule: "context.school_year"
   * plus free-text entry). */
  sourceGroups: SourceGroup[];
  /** True when the definition isn't a draft — disables every mutating
   * control (task review fix #6). */
  readOnly: boolean;
}

type Combinator = 'all' | 'any' | 'not';
const COMBINATORS: Combinator[] = ['all', 'any', 'not'];
const OPS: Condition['op'][] = ['eq', 'ne', 'in', 'empty', 'not_empty', 'truthy'];
/** Sentinel select value meaning "the free-text input below is authoritative,
 * not one of the known grouped options". Not a legal `source` string itself
 * (no field/context source can equal this literal). */
const CUSTOM_SENTINEL = '__custom__';

function activeCombinator(group: ConditionGroupDef): Combinator {
  if (Array.isArray(group.all)) return 'all';
  if (Array.isArray(group.any)) return 'any';
  if (Array.isArray(group.not)) return 'not';
  return 'all';
}

function itemsOf(group: ConditionGroupDef, combinator: Combinator): ConditionItem[] {
  const raw = group[combinator];
  return Array.isArray(raw) ? raw : [];
}

/** Always emits all three keys (`all`/`any`/`not`), `null` for the unset
 * two — matches the wire shape exactly (see module doc comment). */
function withCombinator(combinator: Combinator, items: ConditionItem[]): ConditionGroupDef {
  return {
    all: combinator === 'all' ? items : null,
    any: combinator === 'any' ? items : null,
    not: combinator === 'not' ? items : null,
  };
}

/** A `Condition` always carries a `source` key; a `ConditionGroupDef` never
 * does — the schema's own discriminator, no separate tag needed. */
function isConditionGroup(item: ConditionItem): item is ConditionGroupDef {
  return !('source' in item);
}

export default function ShowIfBuilder({ value, onChange, sourceGroups, readOnly }: ShowIfBuilderProps) {
  const { t } = useTranslation();

  if (!value) {
    return (
      <div className="showif-builder showif-empty">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange(withCombinator('all', []))}
          disabled={readOnly}
        >
          {t('editor.showIf.add')}
        </button>
      </div>
    );
  }

  const combinator = activeCombinator(value);
  const items = itemsOf(value, combinator);

  function setItems(next: ConditionItem[]) {
    onChange(withCombinator(combinator, next));
  }
  function setCombinator(next: Combinator) {
    onChange(withCombinator(next, items));
  }
  function updateItem(idx: number, next: ConditionItem) {
    setItems(items.map((it, i) => (i === idx ? next : it)));
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="showif-builder">
      <div className="showif-header">
        <label className="showif-combinator-label">
          {t('editor.showIf.combinator')}
          <select
            value={combinator}
            onChange={(e) => setCombinator(e.target.value as Combinator)}
            disabled={readOnly}
          >
            {COMBINATORS.map((c) => (
              <option key={c} value={c}>
                {t(`editor.showIf.combinator.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} disabled={readOnly}>
          {t('editor.showIf.remove')}
        </button>
      </div>

      {items.length === 0 && <p className="showif-empty-hint">{t('editor.showIf.noConditions')}</p>}

      <ul className="showif-items">
        {items.map((item, idx) => (
          <li key={idx} className="showif-item">
            {isConditionGroup(item) ? (
              <NestedGroupEditor
                value={item}
                onChange={(next) => updateItem(idx, next)}
                onRemove={() => removeItem(idx)}
                readOnly={readOnly}
              />
            ) : (
              <ConditionRow
                value={item}
                sourceGroups={sourceGroups}
                onChange={(next) => updateItem(idx, next)}
                onRemove={() => removeItem(idx)}
                readOnly={readOnly}
              />
            )}
          </li>
        ))}
      </ul>

      <div className="showif-add-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setItems([...items, { source: '', op: 'truthy' }])}
          disabled={readOnly}
        >
          {t('editor.showIf.addCondition')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setItems([...items, { all: [], any: null, not: null }])}
          disabled={readOnly}
        >
          {t('editor.showIf.addNestedGroup')}
        </button>
      </div>
    </div>
  );
}

function ConditionRow({
  value,
  sourceGroups,
  onChange,
  onRemove,
  readOnly,
}: {
  value: Condition;
  sourceGroups: SourceGroup[];
  onChange: (next: Condition) => void;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const known = sourceGroups.flatMap((g) => g.options.map((o) => o.value));
  const selectValue = known.includes(value.source) ? value.source : CUSTOM_SENTINEL;

  function setSource(source: string) {
    onChange({ ...value, source });
  }

  function setOp(op: Condition['op']) {
    const next: Condition = { ...value, op };
    if (op === 'in') {
      next.value = Array.isArray(value.value) ? value.value : [];
    } else if (op === 'empty' || op === 'not_empty' || op === 'truthy') {
      next.value = undefined;
    } else if (Array.isArray(value.value)) {
      // Switching away from "in" — a list value is no longer meaningful.
      next.value = '';
    }
    onChange(next);
  }

  const scalarValue =
    typeof value.value === 'string'
      ? value.value
      : value.value == null
        ? ''
        : String(value.value);

  return (
    <div className="showif-condition">
      <select
        className="showif-source-select"
        value={selectValue}
        disabled={readOnly}
        onChange={(e) => setSource(e.target.value === CUSTOM_SENTINEL ? '' : e.target.value)}
      >
        <option value={CUSTOM_SENTINEL}>{t('editor.showIf.customSource')}</option>
        {sourceGroups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {selectValue === CUSTOM_SENTINEL && (
        <input
          type="text"
          className="showif-source-custom"
          value={value.source}
          placeholder={t('editor.showIf.customSourcePlaceholder')}
          disabled={readOnly}
          onChange={(e) => setSource(e.target.value)}
        />
      )}

      <select
        className="showif-op-select"
        value={value.op}
        disabled={readOnly}
        onChange={(e) => setOp(e.target.value as Condition['op'])}
      >
        {OPS.map((op) => (
          <option key={op} value={op}>
            {t(`editor.showIf.op.${op}`)}
          </option>
        ))}
      </select>

      {value.op === 'in' ? (
        <ListValueEditor
          value={Array.isArray(value.value) ? value.value.map(String) : []}
          onChange={(list) => onChange({ ...value, value: list })}
          readOnly={readOnly}
        />
      ) : value.op === 'eq' || value.op === 'ne' ? (
        <input
          type="text"
          className="showif-value-input"
          value={scalarValue}
          placeholder={t('editor.showIf.valuePlaceholder')}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
      ) : null}

      <button
        type="button"
        className="btn btn-ghost btn-sm showif-remove"
        onClick={onRemove}
        disabled={readOnly}
        aria-label={t('editor.showIf.removeCondition')}
      >
        &times;
      </button>
    </div>
  );
}

function ListValueEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const trimmed = draft.trim();
    if (trimmed) onChange([...value, trimmed]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="showif-list-editor">
      {value.map((v, idx) => (
        <span key={`${v}-${idx}`} className="showif-tag">
          {v}
          {!readOnly && (
            <button type="button" onClick={() => removeAt(idx)} aria-label={t('editor.showIf.removeTag')}>
              &times;
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          className="showif-list-input"
          value={draft}
          placeholder={t('editor.showIf.listPlaceholder')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
        />
      )}
    </div>
  );
}

function NestedGroupEditor({
  value,
  onChange,
  onRemove,
  readOnly,
}: {
  value: ConditionGroupDef;
  onChange: (next: ConditionGroupDef) => void;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  // No effect needed to keep `draft` in sync with `value`: the read-only
  // view below renders `value` directly (never `draft`), and `startEdit`
  // re-seeds `draft` fresh from `value` every time editing begins.
  function startEdit() {
    setDraft(JSON.stringify(value, null, 2));
    setError(null);
    setEditing(true);
  }

  /**
   * Task review fix #2 (critical): the wire shape requires EXACTLY ONE of
   * all/any/not to be a non-null array (`schema.py`'s `ConditionGroup.
   * _exactly_one_key` model validator, and `withCombinator`'s own doc
   * comment above). The previous version of this check only required "at
   * least one" — `{"all": [...], "any": [...]}` passed it, then persisted
   * via autosave, then 500'd every future `bundle`/`validate` fetch of the
   * row (an uncaught pydantic `ValidationError` inside
   * `parse_machine_steps`) — bricking the draft. This is the frontend half
   * of that fix; `app/api/designer.py`'s `_parse_or_422` is the backend
   * half (defense in depth: even if some OTHER path ever wrote a bad
   * shape, reads degrade to a 422 the editor can recover from, never a
   * 500).
   */
  function commit() {
    try {
      const parsed: unknown = JSON.parse(draft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      const obj = parsed as Record<string, unknown>;
      const keys: Combinator[] = ['all', 'any', 'not'];
      const listKeys = keys.filter((k) => Array.isArray(obj[k]));
      if (listKeys.length !== 1) {
        throw new Error('needs exactly one of all/any/not as a list');
      }
      const solo = listKeys[0];
      for (const k of keys) {
        if (k !== solo && obj[k] !== undefined && obj[k] !== null) {
          throw new Error(`'${k}' must be null when '${solo}' is set`);
        }
      }
      const normalized: ConditionGroupDef = {
        all: solo === 'all' ? (obj.all as ConditionItem[]) : null,
        any: solo === 'any' ? (obj.any as ConditionItem[]) : null,
        not: solo === 'not' ? (obj.not as ConditionItem[]) : null,
      };
      onChange(normalized);
      setError(null);
      setEditing(false);
    } catch {
      setError(t('editor.showIf.jsonInvalid'));
    }
  }

  return (
    <div className="showif-nested-group">
      <div className="showif-nested-header">
        <span className="showif-nested-label">{t('editor.showIf.nestedGroup')}</span>
        <div className="showif-nested-actions">
          {!editing && !readOnly && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
              {t('editor.showIf.editAsJson')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm showif-remove"
            onClick={onRemove}
            disabled={readOnly}
            aria-label={t('editor.showIf.removeCondition')}
          >
            &times;
          </button>
        </div>
      </div>
      {editing ? (
        <>
          <textarea
            className="showif-json-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            rows={6}
          />
          {error && <p className="showif-json-error">{error}</p>}
        </>
      ) : (
        <pre className="showif-json-readonly">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
