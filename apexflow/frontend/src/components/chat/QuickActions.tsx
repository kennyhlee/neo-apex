// Ported from admindash/frontend/src/components/QuickActions.tsx. Two changes:
// the labels go through `t('assistant.*')` instead of being hardcoded English,
// and the chip class is BEM-scoped (`quick-actions__chip`) rather than a bare
// global `.chip`.
import { useEffect, useState } from 'react';
import {
  DEFAULT_QUICK_ACTIONS,
  MAX_QUICK_ACTIONS,
  loadQuickActions,
  saveQuickActions,
} from '../../chat/quickActions.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';
import './QuickActions.css';

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<string[]>(DEFAULT_QUICK_ACTIONS);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void loadQuickActions().then(setItems);
  }, []);

  const update = (next: string[]) => {
    setItems(next);
    void saveQuickActions(next);
  };

  return (
    <div className="quick-actions">
      <div className="quick-actions__head">
        <span>{t('assistant.quickQuestions')}</span>
        <button
          type="button"
          className="quick-actions__edit"
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? t('assistant.done') : t('assistant.edit')}
        </button>
      </div>
      <div className="quick-actions__chips">
        {items.map((q, i) =>
          editing ? (
            <div className="quick-actions__row" key={i}>
              <label className="sr-only" htmlFor={`quick-action-${i}`}>
                {t('assistant.quickQuestions')}
              </label>
              <input
                id={`quick-action-${i}`}
                value={q}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  update(next);
                }}
              />
              <button
                type="button"
                aria-label={t('assistant.removeQuick')}
                onClick={() => update(items.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="quick-actions__chip"
              key={i}
              onClick={() => onPick(q)}
            >
              {q}
            </button>
          ),
        )}
        {editing && items.length < MAX_QUICK_ACTIONS && (
          <button
            type="button"
            className="quick-actions__add"
            onClick={() => update([...items, t('assistant.newQuestion')])}
          >
            {t('assistant.addQuick')}
          </button>
        )}
      </div>
    </div>
  );
}
