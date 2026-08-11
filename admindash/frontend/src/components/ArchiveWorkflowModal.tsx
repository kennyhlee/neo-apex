import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { postDefinitionAction, WorkflowApiError } from '../api/workflows.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import './ArchiveWorkflowModal.css';

interface ArchiveWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful archive so the caller can reload its list. */
  onArchived: () => void;
  tenant: string;
  /** The PUBLISHED row's entity_id — lifecycle actions act on that row, not
   * on the lineage's `definition_id`. */
  entityId: string;
  workflowName: string;
}

/**
 * Two-stage archive confirm.
 *
 * Stage 1 attempts a plain archive. The backend gates it on every work item
 * being in an end state, so a workflow with open work comes back 409 with
 * `detail.open_instances`; that flips this modal into stage 2, which names the
 * count and offers force-archive as an explicit, clearly-warned second choice.
 *
 * Force is deliberately never the default and never autofocused: it abandons
 * live work families are mid-way through, and after unarchiving each item has
 * to be restored by hand.
 */
export default function ArchiveWorkflowModal({
  open, onClose, onArchived, tenant, entityId, workflowName,
}: ArchiveWorkflowModalProps) {
  const { t } = useTranslation();
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Stage 1 fires once per open. A ref (not state) so it cannot re-trigger on
   * the re-render its own setState causes. */
  const attempted = useRef(false);

  const run = useCallback(async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await postDefinitionAction(tenant, entityId, { action: 'archive', force });
      onArchived();
      onClose();
    } catch (e) {
      const openInstances =
        e instanceof WorkflowApiError && e.status === 409
          ? (e.body as { detail?: { open_instances?: number } } | undefined)?.detail?.open_instances
          : undefined;
      if (typeof openInstances === 'number') {
        setBlockedCount(openInstances);
      } else {
        setError(t('workflows.archiveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }, [tenant, entityId, onArchived, onClose, t]);

  useEffect(() => {
    if (!open) {
      attempted.current = false;
      setBlockedCount(null);
      setError(null);
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    void run(false);
  }, [open, run]);

  const blocked = blockedCount !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workflows.archiveTitle')}
      subtitle={workflowName}
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {blocked && (
            <Button variant="danger" onClick={() => void run(true)} disabled={busy}>
              {t('workflows.archiveForce')}
            </Button>
          )}
        </>
      }
    >
      <div className="archive-workflow-modal">
        {!blocked && !error && <p>{t('workflows.archiveBody')}</p>}
        {blocked && (
          <>
            <p className="archive-workflow-blocked">
              {t('workflows.archiveBlocked').replace('{count}', String(blockedCount))}
            </p>
            <p className="archive-workflow-warning">{t('workflows.archiveForceWarning')}</p>
          </>
        )}
        {error && <p role="alert" className="archive-workflow-error">{error}</p>}
      </div>
    </Modal>
  );
}
