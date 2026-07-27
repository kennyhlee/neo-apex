import { useEffect, useState } from 'react';
import {
  DEFAULT_QUICK_ACTIONS, MAX_QUICK_ACTIONS, loadQuickActions, saveQuickActions,
} from '../chat/quickActions';
import './QuickActions.css';

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  const [items, setItems] = useState<string[]>(DEFAULT_QUICK_ACTIONS);
  const [editing, setEditing] = useState(false);

  useEffect(() => { loadQuickActions().then(setItems); }, []);

  const update = (next: string[]) => { setItems(next); void saveQuickActions(next); };

  return (
    <div className="quick-actions">
      <div className="quick-actions__head">
        <span>Quick questions</span>
        <button className="quick-actions__edit" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="quick-actions__chips">
        {items.map((q, i) =>
          editing ? (
            <div className="quick-actions__row" key={i}>
              <input value={q} onChange={(e) => {
                const next = [...items]; next[i] = e.target.value; update(next);
              }} />
              <button onClick={() => update(items.filter((_, j) => j !== i))}>✕</button>
            </div>
          ) : (
            <button className="chip" key={i} onClick={() => onPick(q)}>{q}</button>
          ),
        )}
        {editing && items.length < MAX_QUICK_ACTIONS && (
          <button className="quick-actions__add" onClick={() => update([...items, 'New question'])}>
            + Add
          </button>
        )}
      </div>
    </div>
  );
}
