import { useCallback, useState } from 'react';
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
  /** Open work items that will be frozen (or abandoned, under force). Drives
   * the warning copy; 0 means the workflow has already drained. */
  openInstances: number;
}

/**
 * Archive confirm.
 *
 * A plain archive is non-destructive: whatever is still in flight is FROZEN,
 * and unarchiving thaws it back to exactly where it paused. So this is a
 * confirm, not a gate — the operator is told what freezing means and proceeds.
 *
 * Force is the separate destructive path, shown only when there is in-flight
 * work to destroy: it abandons those items permanently, and after unarchiving
 * each one must be restored by hand. It is deliberately never the default,
 * never autofocused, and always carries its consequence in the same view.
 */
export default function ArchiveWorkflowModal({
  open, onClose, onArchived, tenant, entityId, workflowName, openInstances,
}: ArchiveWorkflowModalProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await postDefinitionAction(tenant, entityId, { action: 'archive', force });
      onArchived();
      onClose();
    } catch (e) {
      // The backend refuses an archive from any lineage state but `deprecated`.
      // The list page already hides the button in that case, so this is the
      // stale-view path: say the actionable thing rather than "failed".
      const reason =
        e instanceof WorkflowApiError && e.status === 409
          ? (e.body as { detail?: { reason?: string } } | undefined)?.detail?.reason
          : undefined;
      setError(
        reason === 'not_deprecated'
          ? t('workflows.archiveNeedsDeprecate')
          : t('workflows.archiveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }, [tenant, entityId, onArchived, onClose, t]);

  const hasOpenWork = openInstances > 0;

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
          <Button variant="primary" onClick={() => void run(false)} disabled={busy}>
            {t('workflows.archive')}
          </Button>
        </>
      }
    >
      <div className="archive-workflow-modal">
        <p>{t('workflows.archiveBody')}</p>

        {hasOpenWork && (
          <>
            <p className="archive-workflow-blocked">
              {t('workflows.archiveFreezes').replace('{count}', String(openInstances))}
            </p>
            <div className="archive-workflow-force">
              <p className="archive-workflow-warning">{t('workflows.archiveForceWarning')}</p>
              <Button variant="danger" size="sm" onClick={() => void run(true)} disabled={busy}>
                {t('workflows.archiveForce')}
              </Button>
            </div>
          </>
        )}

        {error && <p role="alert" className="archive-workflow-error">{error}</p>}
      </div>
    </Modal>
  );
}
