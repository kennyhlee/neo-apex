import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  StepRenderer,
  defaultSchoolYear,
  draftToSectionAnswers,
  sectionAnswersToDraft,
  type InstanceDocumentView,
  type WorkflowDraft,
  type WorkflowItemView,
} from '@neoapex/flow-runtime';
import '@neoapex/flow-runtime/src/flow-runtime.css';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import { postQuery } from '../api/client.ts';
import {
  createDocument,
  createWorkflowInstance,
  getAllowedActions,
  getDefinitionBundle,
  listWorkflowDefinitions,
  postInstanceAction,
  WorkflowApiError,
  type DefinitionBundle,
} from '../api/workflows.ts';
import {
  actionButtonsFor,
  documentsSql,
  itemsSql,
  toDocumentView,
  toItemView,
  usableModels,
} from '../utils/workflowData.ts';
import Button from '../components/ui/Button.tsx';
import './WorkflowPipelinePage.css';
import './StaffEntryPage.css';

interface StaffEntryPageProps {
  tenant: string;
}

/**
 * `/workflows/:definitionId/new` — staff-assisted entry: creates a
 * `channel: 'staff'` instance for the lineage's published definition, then
 * mounts `StepRenderer` in `mode="staff"` against it. Replaces Task 10's
 * placeholder route.
 *
 * Reuses Task 11's `workflowData.ts` SQL builders/`actionButtonsFor` and the
 * same `postQuery`-based refetch pattern `WorkflowInstanceDrawer` already
 * established, rather than trusting `createWorkflowInstance`'s own response
 * shape for the items list: `POST .../instances`'s `"items"` array is
 * `dc.dc_create`-ENVELOPE shaped (`{entity_id, entity_type, base_data}`,
 * per `apexflow/backend/app/api/instances.py`'s own doc comment — only
 * `"instance"` gets re-flattened before the response is built), so fetching
 * a fresh FLATTENED `itemsSql`/`documentsSql` row set immediately after
 * create avoids needing to handle two different item wire shapes on this
 * page.
 */
export default function StaffEntryPage({ tenant }: StaffEntryPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { definitionId = '' } = useParams<{ definitionId: string }>();

  const [phase, setPhase] = useState<'loading' | 'form' | 'running' | 'notFound'>('loading');
  const [bundle, setBundle] = useState<DefinitionBundle | null>(null);

  // Context form.
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear());
  const [applicantEmail, setApplicantEmail] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Running instance.
  const [instanceEntityId, setInstanceEntityId] = useState<string | null>(null);
  const [instanceDisplayId, setInstanceDisplayId] = useState('');
  const [machineState, setMachineState] = useState('');
  const [items, setItems] = useState<WorkflowItemView[]>([]);
  const [documents, setDocuments] = useState<InstanceDocumentView[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft>({});
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the definitions list, find the published row for this lineage, and
  // fetch its bundle (models + machine + steps). Any failure — no published
  // row, a 404, a network error — degrades to the same 'notFound' phase; the
  // brief has no separate "stale"/"broken" messaging requirement for this
  // page (unlike familyhub's RegisterPage, which distinguishes those for an
  // applicant — here it's staff, who can check the definition in the editor).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const defsRes = await listWorkflowDefinitions(tenant);
        const published = defsRes.definitions.find(
          (d) => d.definition_id === definitionId && d.status === 'published',
        );
        if (!published) {
          if (!cancelled) setPhase('notFound');
          return;
        }
        const b = await getDefinitionBundle(tenant, published.entity_id);
        if (cancelled) return;
        setBundle(b);
        setPhase('form');
      } catch {
        if (!cancelled) setPhase('notFound');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, definitionId]);

  useEffect(() => () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
  }, []);

  /** Items + documents + allowed-actions (which also carries the current
   * `state`, sparing a separate instance re-fetch) — every mutation on this
   * page refetches all three, same convention `WorkflowInstanceDrawer`
   * established. */
  const refetchRuntime = useCallback(async (entityId: string) => {
    const [itemsRes, docsRes, allowedRes] = await Promise.all([
      postQuery(tenant, 'entities', itemsSql(entityId)),
      postQuery(tenant, 'entities', documentsSql(entityId)),
      getAllowedActions(tenant, entityId),
    ]);
    setItems(itemsRes.data.map(toItemView));
    setDocuments(docsRes.data.map(toDocumentView));
    setAllowed(allowedRes.allowed);
    setMachineState(allowedRes.state);
  }, [tenant]);

  async function onStart(e: FormEvent) {
    e.preventDefault();
    if (!bundle || starting) return;
    setStartError(null);
    setStarting(true);
    try {
      const trimmedEmail = applicantEmail.trim();
      const created = await createWorkflowInstance(tenant, definitionId, {
        context: { school_year: schoolYear },
        channel: 'staff',
        ...(trimmedEmail ? { applicant_email: trimmedEmail } : {}),
      });
      const instanceRow = created.instance;
      const entityId = String(instanceRow.entity_id ?? '');
      setInstanceEntityId(entityId);
      setInstanceDisplayId(String(instanceRow.instance_id || entityId));
      let draftData: Record<string, unknown> = {};
      if (typeof instanceRow.draft_data === 'string') {
        try {
          const parsed: unknown = JSON.parse(instanceRow.draft_data);
          if (parsed && typeof parsed === 'object') draftData = parsed as Record<string, unknown>;
        } catch {
          draftData = {};
        }
      }
      setDraft(sectionAnswersToDraft(bundle.definition.steps, draftData));
      await refetchRuntime(entityId);
      setPhase('running');
    } catch (err) {
      if (err instanceof WorkflowApiError && err.status === 409) {
        const reason = (err.body as { detail?: { reason?: string } } | undefined)?.detail?.reason;
        if (reason === 'lineage_not_active') {
          setStartError(t('workflows.entry.lineageNotActive'));
        } else if (reason === 'definition_stale' || reason === 'definition_broken') {
          setStartError(t('workflows.entry.definitionUnavailable'));
        } else {
          setStartError(t('workflows.entry.startError'));
        }
      } else {
        setStartError(t('workflows.entry.startError'));
      }
    } finally {
      setStarting(false);
    }
  }

  function handleDraftChange(next: WorkflowDraft) {
    setDraft(next);
    if (!bundle || !instanceEntityId) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const eid = instanceEntityId;
    draftTimerRef.current = setTimeout(() => {
      postInstanceAction(tenant, eid, {
        action: 'save_draft',
        section_answers: draftToSectionAnswers(bundle.definition.steps, next),
      })
        .then(() => setRuntimeError(null))
        .catch(() => setRuntimeError(t('workflows.entry.saveError')));
    }, 800);
  }

  // Every mutation (item ops AND advertised transitions) goes through here,
  // same 409-handling contract as Task 11's drawer: a blocked-action 409
  // (`detail.allowed`) toasts that actions were refreshed, a CAS conflict
  // (`detail.error === "conflict"`) toasts a retry prompt, anything else
  // toasts a generic failure -- all three refetch so the page never shows a
  // stale allowed-actions/state view after an error.
  async function runAction(action: string, extra?: Record<string, unknown>) {
    if (!instanceEntityId) return;
    setActionBusy(action);
    try {
      await postInstanceAction(tenant, instanceEntityId, { action, ...extra });
      await refetchRuntime(instanceEntityId);
      setRuntimeError(null);
    } catch (err) {
      if (err instanceof WorkflowApiError) {
        const detail = (err.body as { detail?: { allowed?: string[]; error?: string } } | undefined)?.detail;
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
      await refetchRuntime(instanceEntityId);
    } finally {
      setActionBusy(null);
    }
  }

  // Staff document upload: presign (Task 9's proxy → apexflow's document
  // create) -> PUT bytes to the presigned URL -> complete_item with
  // payload_ref = the created document_id (Task 3's write path; engine.py's
  // complete_item validates it against this instance's documents).
  async function uploadViaDocumentsProxy(itemEntityId: string, file: File) {
    if (!instanceEntityId) return;
    const contentType = file.type || 'application/pdf';
    try {
      const slot = await createDocument(tenant, {
        instance_id: instanceEntityId,
        item_id: itemEntityId,
        filename: file.name,
        content_type: contentType,
        size: file.size,
      });
      const put = await fetch(slot.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed: HTTP ${put.status}`);
      await postInstanceAction(tenant, instanceEntityId, {
        action: 'complete_item',
        item_id: itemEntityId,
        payload_ref: slot.document_id,
      });
      await refetchRuntime(instanceEntityId);
      setRuntimeError(null);
    } catch {
      toast({ message: t('workflows.entry.uploadFailed'), tone: 'danger' });
    }
  }

  if (phase === 'loading') {
    return (
      <div className="staff-entry-page">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (phase === 'notFound' || !bundle) {
    return (
      <div className="not-found">
        <h1>{t('workflows.entry.notFoundTitle')}</h1>
        <p>{t('workflows.entry.notFound')}</p>
        <Link className="btn btn-primary" to={`/workflows/${definitionId}`}>
          {t('workflows.entry.viewInPipeline')}
        </Link>
      </div>
    );
  }

  if (phase === 'form') {
    return (
      <div className="staff-entry-page">
        <header className="page-header">
          <h1 className="page-title">{bundle.definition.name}</h1>
        </header>
        <form className="staff-entry-form" onSubmit={(e) => void onStart(e)} noValidate>
          {startError && (
            <p className="staff-entry-error" role="alert">
              {startError}
            </p>
          )}
          <div className="staff-entry-form-fields">
            <div className="staff-entry-field">
              <label htmlFor="staff-entry-school-year">{t('workflows.entry.schoolYear')}</label>
              <input
                id="staff-entry-school-year"
                type="text"
                className="fr-input"
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
              />
            </div>
            <div className="staff-entry-field">
              <label htmlFor="staff-entry-applicant-email">{t('workflows.entry.applicantEmail')}</label>
              <input
                id="staff-entry-applicant-email"
                type="email"
                inputMode="email"
                className="fr-input"
                value={applicantEmail}
                onChange={(e) => setApplicantEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="staff-entry-form-actions">
            <Button type="submit" variant="primary" disabled={starting}>
              {starting ? t('workflows.entry.starting') : t('workflows.entry.start')}
            </Button>
            <Link className="btn btn-secondary" to={`/workflows/${definitionId}`}>
              {t('workflows.entry.viewInPipeline')}
            </Link>
          </div>
        </form>
      </div>
    );
  }

  // phase === 'running'
  const visibleSteps = bundle.definition.steps.filter((s) => s.available_in.includes(machineState));
  const models = usableModels(bundle.models);
  const transitionActions = actionButtonsFor(allowed);

  return (
    <div className="staff-entry-page">
      <header className="page-header">
        <h1 className="page-title">
          {bundle.definition.name}
          <span className="page-subtitle">{instanceDisplayId}</span>
        </h1>
        <div className="page-header-actions">
          <Link className="btn btn-secondary" to={`/workflows/${definitionId}`}>
            {t('workflows.entry.viewInPipeline')}
          </Link>
        </div>
      </header>

      {runtimeError && (
        <p className="staff-entry-error" role="alert">
          {runtimeError}
        </p>
      )}

      <StepRenderer
        steps={visibleSteps}
        models={models}
        mode="staff"
        draft={draft}
        onDraftChange={handleDraftChange}
        items={items}
        onCompleteItem={(itemEid) => runAction('complete_item', { item_id: itemEid })}
        onUploadDocument={uploadViaDocumentsProxy}
        documents={documents}
      />

      <h3 className="staff-entry-actions-title">{t('workflows.drawer.actions')}</h3>
      <div className="workflow-actions-bar">
        {transitionActions.length === 0 && (
          <p className="workflow-drawer-empty">{t('workflows.drawer.noActions')}</p>
        )}
        {transitionActions.map((action) => (
          <Button
            key={action}
            variant="secondary"
            disabled={actionBusy !== null}
            onClick={() => void runAction(action)}
          >
            {action}
          </Button>
        ))}
      </div>
    </div>
  );
}
