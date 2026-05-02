// admindash/frontend/src/components/BulkRowDrawer.tsx
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import DynamicForm from './DynamicForm.tsx';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import './BulkRowDrawer.css';

interface Props {
  rows: BulkRow[];
  activeRowIndex: number;
  modelDef: ModelDefinition;
  onSaveRow: (rowId: string, baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export default function BulkRowDrawer({
  rows, activeRowIndex, modelDef, onSaveRow, onClose, onNavigate,
}: Props) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<{ kind: 'close' } | { kind: 'navigate'; targetIndex: number } | null>(null);

  const row = rows[activeRowIndex];
  if (!row) return null;

  const handleSubmit = (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => {
    onSaveRow(row.id, baseData, customFields);
    setDirty(false);
  };

  const requestNavigate = (target: number) => {
    if (dirty) {
      setConfirmDiscard({ kind: 'navigate', targetIndex: target });
    } else {
      onNavigate(target);
    }
  };

  const requestClose = () => {
    if (dirty) {
      setConfirmDiscard({ kind: 'close' });
    } else {
      onClose();
    }
  };

  const confirmDiscardAndProceed = () => {
    setDirty(false);
    if (confirmDiscard?.kind === 'navigate') {
      const target = confirmDiscard.targetIndex;
      setConfirmDiscard(null);
      onNavigate(target);
    } else {
      setConfirmDiscard(null);
      onClose();
    }
  };

  return (
    <>
      <div className="bulk-drawer-backdrop" onClick={requestClose} />
      <aside className="bulk-drawer" role="dialog" aria-modal="true">
        <header className="bulk-drawer__header">
          <h2>{t('bulkAdd.drawer.title').replace('{n}', String(activeRowIndex + 1))}</h2>
          <button className="bulk-drawer__close" onClick={requestClose} aria-label={t('common.close')}>
            &times;
          </button>
        </header>

        <div
          className="bulk-drawer__body"
          onChangeCapture={() => setDirty(true)}
        >
          {/* CRITICAL: key={row.id} forces unmount/remount across Prev/Next so
              DynamicForm's initialValues-merge-not-replace effect cannot leak
              values between rows (DynamicForm.tsx:235-245). DO NOT remove. */}
          <DynamicForm
            key={row.id}
            modelDefinition={modelDef}
            initialValues={row.values}
            onSubmit={handleSubmit}
            onCancel={requestClose}
          />
        </div>

        <nav className="bulk-drawer__nav">
          <button
            disabled={activeRowIndex === 0}
            onClick={() => requestNavigate(activeRowIndex - 1)}
          >
            {t('bulkAdd.drawer.prev')}
          </button>
          <span className="bulk-drawer__nav-pos">
            {activeRowIndex + 1} / {rows.length}
          </span>
          <button
            disabled={activeRowIndex >= rows.length - 1}
            onClick={() => requestNavigate(activeRowIndex + 1)}
          >
            {t('bulkAdd.drawer.next')}
          </button>
        </nav>
      </aside>

      {confirmDiscard && (
        <div className="bulk-drawer-confirm-overlay">
          <div className="bulk-drawer-confirm">
            <p>{t('bulkAdd.drawer.discardPrompt')}</p>
            <div className="bulk-drawer-confirm__actions">
              <button onClick={() => setConfirmDiscard(null)}>{t('common.cancel')}</button>
              <button
                className="bulk-drawer-confirm__danger"
                onClick={confirmDiscardAndProceed}
              >
                {t('bulkAdd.drawer.discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
