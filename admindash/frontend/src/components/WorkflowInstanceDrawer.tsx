import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import { postQuery } from '../api/client.ts';
import {
  getAllowedActions,
  postInstanceAction,
  getDocumentUrl,
  WorkflowApiError,
} from '../api/workflows.ts';
import {
  itemsSql,
  documentsSql,
  activitySql,
  actionButtonsFor,
  itemActionVisibility,
  parseMachineStates,
  settledSection,
  type InstanceRow,
} from '../utils/workflowData.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import StatusBadge from './StatusBadge.tsx';
import './LeadDetailDrawer.css';
import '../pages/WorkflowPipelinePage.css';

interface WorkflowItemRow {
  entity_id: string;
  title?: string;
  kind?: string;
  status?: string;
  [key: string]: unknown;
}

interface WorkflowDocumentRow {
  entity_id: string;
  filename?: string;
  uploaded_by?: string;
  [key: string]: unknown;
}

interface WorkflowActivityRow {
  entity_id: string;
  type?: string;
  from_value?: string;
  to_value?: string;
  actor?: string;
  at?: string;
  [key: string]: unknown;
}

const CANCEL_ACTION = 'cancel_instance';

/** Per-section fetch-failure flags, keyed the same as the four parallel
 * `refetch` calls. Fix round 1, live-browser-gate finding #2: one section's
 * query rejecting (originally `activitySql`'s DuckDB reserved-keyword 400,
 * but the same gap would let any future per-column Binder Error do the
 * same) must not blank the sections whose OWN fetch succeeded. */
interface SectionErrors {
  items: boolean;
  documents: boolean;
  activity: boolean;
  allowed: boolean;
}

const NO_SECTION_ERRORS: SectionErrors = {
  items: false, documents: false, activity: false, allowed: false,
};

/** Same "raw string if unparseable" fallback as `WorkflowPipelinePage`'s own
 * `formatOpenedAt` — kept as a local copy since that one isn't exported. */
function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** 409 body shape from the actions route, relayed verbatim through
 * admindash-backend's proxy: `{"detail": {"allowed": [...]}}` (a blocked
 * transition — `machine.py::_run_transition_action`) or
 * `{"detail": {"error": "conflict", ...}}` (a CAS write conflict —
 * `datacore.py::dc_update`'s `expected_version` mismatch). */
interface ActionErrorBody {
  detail?: { allowed?: string[]; error?: string };
}

/**
 * Instance detail drawer — items checklist (staff verify/reject/waive),
 * documents, activity feed, and the advertised-actions bar. Structure and
 * styling follow `LeadDetailDrawer.tsx` as the template (drawer variant,
 * confirm-modal pattern for a destructive change, activity list markup).
 *
 * `definition` is the same raw `machine` JSON `WorkflowPipelinePage` already
 * holds as `machineJson` (parsed object OR the DataCore JSON-encoded string
 * — `parseMachineStates` tolerates both), passed through unchanged so this
 * component has no opinion on where it came from.
 */
export default function WorkflowInstanceDrawer(
  { tenant, instance, definition, onClose, onChanged }:
  {
    tenant: string;
    instance: InstanceRow;
    definition: unknown;
    onClose: () => void;
    onChanged: () => void;
  },
) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [items, setItems] = useState<WorkflowItemRow[]>([]);
  const [documents, setDocuments] = useState<WorkflowDocumentRow[]>([]);
  const [activity, setActivity] = useState<WorkflowActivityRow[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [sectionErrors, setSectionErrors] = useState<SectionErrors>(NO_SECTION_ERRORS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const instanceEntityId = instance.entity_id;

  // `Promise.allSettled` (not `Promise.all`): each of the four sections is
  // set from its OWN result via `settledSection`, so one query rejecting
  // (e.g. a Binder/Parser Error DataCore 400s) never prevents the other
  // three `setState` calls from running with their real data. A failed
  // section renders its own inline retry note instead of the whole drawer
  // going blank.
  const refetch = useCallback(async () => {
    const [itemsRes, docsRes, actRes, allowedRes] = await Promise.allSettled([
      postQuery(tenant, 'entities', itemsSql(instanceEntityId))
        .then((r) => r.data as unknown as WorkflowItemRow[]),
      postQuery(tenant, 'entities', documentsSql(instanceEntityId))
        .then((r) => r.data as unknown as WorkflowDocumentRow[]),
      postQuery(tenant, 'entities', activitySql(instanceEntityId))
        .then((r) => r.data as unknown as WorkflowActivityRow[]),
      getAllowedActions(tenant, instanceEntityId).then((r) => r.allowed),
    ]);

    const itemsSec = settledSection(itemsRes, [] as WorkflowItemRow[]);
    const docsSec = settledSection(docsRes, [] as WorkflowDocumentRow[]);
    const actSec = settledSection(actRes, [] as WorkflowActivityRow[]);
    const allowedSec = settledSection(allowedRes, [] as string[]);

    setItems(itemsSec.data);
    setDocuments(docsSec.data);
    setActivity(actSec.data);
    setAllowed(allowedSec.data);
    setSectionErrors({
      items: itemsSec.failed,
      documents: docsSec.failed,
      activity: actSec.failed,
      allowed: allowedSec.failed,
    });
  }, [tenant, instanceEntityId]);

  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);

  // Every mutation (item ops AND advertised transitions) goes through here:
  // success refetches every section + notifies the board; a blocked-action
  // 409 (`detail.allowed`) toasts that actions were refreshed and refetches
  // so the bar reflects reality; a CAS conflict (`detail.error ===
  // "conflict"`) toasts a retry prompt and refetches for the same reason —
  // either way the drawer never shows a stale allowed-actions list after an
  // error.
  async function runAction(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      await postInstanceAction(tenant, instanceEntityId, { action, ...extra });
      await refetch();
      onChanged();
    } catch (e) {
      if (e instanceof WorkflowApiError) {
        const detail = (e.body as ActionErrorBody | undefined)?.detail;
        if (detail?.error === 'conflict') {
          toast({ message: t('workflows.conflictRetry'), tone: 'attn' });
        } else if (detail?.allowed) {
          toast({ message: t('workflows.actionsRefreshed'), tone: 'attn' });
        } else {
          toast({ message: t('workflows.actionFailed'), tone: 'danger' });
        }
      } else {
        toast({ message: t('workflows.actionFailed'), tone: 'danger' });
      }
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(doc: WorkflowDocumentRow) {
    try {
      const { download_url } = await getDocumentUrl(tenant, doc.entity_id);
      window.open(download_url, '_blank', 'noopener,noreferrer');
    } catch {
      toast({ message: t('workflows.documentUrlFailed'), tone: 'danger' });
    }
  }

  async function confirmCancelInstance() {
    setConfirmCancel(false);
    await runAction(CANCEL_ACTION);
  }

  const states = parseMachineStates(definition);
  const stateLabel =
    states.find((s) => s.state_id === instance.state)?.name ?? String(instance.state ?? '');
  const displayId = String(instance.instance_id || instance.entity_id);
  // `cancel_instance` is never itself a member of `allowed`
  // (`machine.py::allowed_actions` only ever returns guard-passing
  // transition names plus the item built-ins) — it's an engine built-in
  // offered unconditionally on any non-terminal instance (brief: "always
  // offered on non-terminal instances"). `allowed_actions` returns `[]`
  // exactly when `_is_terminal_state` is true and otherwise always appends
  // a non-empty item-builtins list, so a non-empty `allowed` IS "not
  // terminal" — no separate terminal check needed on this side.
  const transitionActions = actionButtonsFor(allowed);
  const canCancel = allowed.length > 0;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        variant="drawer"
        title={displayId}
        subtitle={String(instance.applicant_email ?? '')}
      >
        <div className="lead-drawer-content workflow-drawer-content">
          <dl className="lead-detail-fields">
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.state')}</dt>
              <dd>{stateLabel}</dd>
            </div>
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.instanceId')}</dt>
              <dd>{displayId}</dd>
            </div>
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.channelStarted')}</dt>
              <dd>{String(instance.channel_started ?? '—')}</dd>
            </div>
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.applicantEmail')}</dt>
              <dd>{String(instance.applicant_email ?? '—')}</dd>
            </div>
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.openedAt')}</dt>
              <dd>{formatTimestamp(instance.opened_at)}</dd>
            </div>
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.closedAt')}</dt>
              <dd>{formatTimestamp(instance.closed_at)}</dd>
            </div>
            <div className="lead-detail-field">
              <dt>{t('workflows.drawer.definitionVersion')}</dt>
              <dd>{String(instance.definition_version ?? '—')}</dd>
            </div>
          </dl>

          <h3>{t('workflows.drawer.items')}</h3>
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : sectionErrors.items ? (
            <p className="workflow-section-error" role="alert">
              {t('workflows.drawer.sectionLoadError')}{' '}
              <Button size="sm" variant="link" onClick={() => void refetch()}>
                {t('common.retry')}
              </Button>
            </p>
          ) : items.length === 0 ? (
            <p className="workflow-drawer-empty">{t('workflows.drawer.noItems')}</p>
          ) : (
            <ul className="workflow-item-list">
              {items.map((item) => {
                const vis = itemActionVisibility(String(item.status ?? 'not_started'));
                return (
                  <li key={item.entity_id} className="workflow-item-row">
                    <div className="workflow-item-main">
                      <strong>{String(item.title ?? item.entity_id)}</strong>
                      <small>{String(item.kind ?? '')}</small>
                    </div>
                    <StatusBadge status={item.status} />
                    <div className="workflow-item-actions">
                      {vis.verify && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void runAction('verify_item', { item_id: item.entity_id })}
                        >
                          {t('workflows.drawer.verify')}
                        </Button>
                      )}
                      {vis.reject && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void runAction('reject_item', { item_id: item.entity_id })}
                        >
                          {t('workflows.drawer.reject')}
                        </Button>
                      )}
                      {vis.waive && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void runAction('waive_item', { item_id: item.entity_id })}
                        >
                          {t('workflows.drawer.waive')}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <h3>{t('workflows.drawer.documents')}</h3>
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : sectionErrors.documents ? (
            <p className="workflow-section-error" role="alert">
              {t('workflows.drawer.sectionLoadError')}{' '}
              <Button size="sm" variant="link" onClick={() => void refetch()}>
                {t('common.retry')}
              </Button>
            </p>
          ) : documents.length === 0 ? (
            <p className="workflow-drawer-empty">{t('workflows.drawer.noDocuments')}</p>
          ) : (
            <ul className="workflow-document-list">
              {documents.map((doc) => (
                <li key={doc.entity_id}>
                  <span>{String(doc.filename ?? doc.entity_id)}</span>
                  <small>{String(doc.uploaded_by ?? '')}</small>
                  <Button size="sm" variant="link" onClick={() => void handleDownload(doc)}>
                    {t('workflows.drawer.download')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <h3>{t('leads.activityTimeline')}</h3>
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : sectionErrors.activity ? (
            <p className="workflow-section-error" role="alert">
              {t('workflows.drawer.sectionLoadError')}{' '}
              <Button size="sm" variant="link" onClick={() => void refetch()}>
                {t('common.retry')}
              </Button>
            </p>
          ) : activity.length === 0 ? (
            <p className="workflow-drawer-empty">{t('workflows.drawer.noActivity')}</p>
          ) : (
            <ul className="activity-list">
              {activity.map((a) => (
                <li key={a.entity_id}>
                  <span className={`badge badge-${a.type ?? 'note'}`}>{a.type}</span>
                  <span>
                    {a.type === 'email_sent' || a.type === 'note'
                      ? a.to_value
                      : `${a.from_value || '—'} → ${a.to_value || '—'}`}
                  </span>
                  <small>{formatTimestamp(a.at)}</small>
                </li>
              ))}
            </ul>
          )}

          <h3>{t('workflows.drawer.actions')}</h3>
          <div className="workflow-actions-bar">
            {loading ? (
              <p>{t('common.loading')}</p>
            ) : sectionErrors.allowed ? (
              <p className="workflow-section-error" role="alert">
                {t('workflows.drawer.sectionLoadError')}{' '}
                <Button size="sm" variant="link" onClick={() => void refetch()}>
                  {t('common.retry')}
                </Button>
              </p>
            ) : (
              transitionActions.length === 0 &&
              !canCancel && (
                <p className="workflow-drawer-empty">{t('workflows.drawer.noActions')}</p>
              )
            )}
            {transitionActions.map((action) => (
              <Button
                key={action}
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction(action)}
              >
                {action}
              </Button>
            ))}
            {canCancel && (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmCancel(true)}>
                {t('workflows.drawer.cancelInstance')}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('workflows.drawer.confirmCancelTitle')}
        size="sm"
        dismissOnBackdrop={!busy}
        dismissOnEscape={!busy}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(false)}>
              {t('workflows.drawer.confirmCancelDismiss')}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmCancelInstance()}>
              {t('workflows.drawer.confirmCancelAction')}
            </Button>
          </>
        }
      >
        <p>{t('workflows.drawer.confirmCancelPrompt')}</p>
      </Modal>
    </>
  );
}
