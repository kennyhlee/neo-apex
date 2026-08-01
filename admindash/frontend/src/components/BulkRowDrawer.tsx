// admindash/frontend/src/components/BulkRowDrawer.tsx
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import DynamicForm from './DynamicForm.tsx';
import FamilyPicker from './FamilyPicker.tsx';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { ModelDefinition, FamilySelection } from '../types/models.ts';
import { extractFamilyValues } from '../utils/familyBulk.ts';
import './BulkRowDrawer.css';

interface Props {
  rows: BulkRow[];
  activeRowIndex: number;
  modelDef: ModelDefinition;
  tenant: string;
  onSaveRow: (rowId: string, baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onSetRowFamily: (rowId: string, selection: FamilySelection | null) => void;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export default function BulkRowDrawer({
  rows, activeRowIndex, modelDef, tenant, onSaveRow, onSetRowFamily, onClose, onNavigate,
}: Props) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<{ kind: 'close' } | { kind: 'navigate'; targetIndex: number } | null>(null);

  const row = rows[activeRowIndex];
  if (!row) return null;

  const currentSelection: FamilySelection | null = row.familyLink
    ? { mode: 'existing', familyId: row.familyLink.familyId, label: row.familyLink.label }
    : (() => {
        const fam = extractFamilyValues(row.values);
        return fam ? { mode: 'new', data: fam } : null;
      })();

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
      <Modal
        open
        onClose={requestClose}
        variant="drawer"
        title={t('bulkAdd.drawer.title').replace('{n}', String(activeRowIndex + 1))}
        className="modal-drawer-wide"
        footerClassName="modal-footer-spread"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={activeRowIndex === 0}
              onClick={() => requestNavigate(activeRowIndex - 1)}
            >
              {t('bulkAdd.drawer.prev')}
            </Button>
            <span className="bulk-drawer__nav-pos">
              {activeRowIndex + 1} / {rows.length}
            </span>
            <Button
              variant="secondary"
              disabled={activeRowIndex >= rows.length - 1}
              onClick={() => requestNavigate(activeRowIndex + 1)}
            >
              {t('bulkAdd.drawer.next')}
            </Button>
          </>
        }
      >
        <div onChangeCapture={() => setDirty(true)}>
          <FamilyPicker
            key={row.id}
            tenant={tenant}
            value={currentSelection}
            onChange={(sel) => onSetRowFamily(row.id, sel)}
          />

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
      </Modal>

      <Modal
        open={confirmDiscard != null}
        onClose={() => setConfirmDiscard(null)}
        title={t('bulkAdd.drawer.discard')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDiscard(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmDiscardAndProceed}>
              {t('bulkAdd.drawer.discard')}
            </Button>
          </>
        }
      >
        <p className="bulk-drawer-confirm__prompt">{t('bulkAdd.drawer.discardPrompt')}</p>
      </Modal>
    </>
  );
}
