import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { StepRenderer, defaultSchoolYear, type ModelFieldSource, type WorkflowDraft } from '@neoapex/flow-runtime';
import {
  completeItem,
  draftToSectionAnswers,
  FacadeError,
  fetchInstance,
  fetchWorkflowBundle,
  runAction,
  saveDraft,
  sectionAnswersToDraft,
  startWorkflow,
  uploadDocumentFile,
} from '../api/facade.ts';
import {
  entityData,
  entityId,
  type EntityRecord,
  type InstanceBundle,
  type WorkflowBundle,
  type WorkflowItemView,
} from '../types/workflow.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './RegisterPage.css';

/**
 * `loading`   -- fetching the public workflow bundle, or (resume path) the
 *                instance behind a `?token=`.
 * `email`     -- workflow bundle loaded, no token yet: capture the
 *                applicant's email and start a new instance.
 * `running`   -- an instance + token are in hand: mount `StepRenderer`.
 * `notFound`  -- the tenant's workflow bundle 404s (bad URL, or no
 *                published `channel_access: "family"` row -- the backend
 *                does not distinguish the two).
 * `invalidLink` -- a `?token=` was supplied but is unknown/expired/revoked.
 *                  Distinct from `notFound` because the *school* is fine
 *                  here -- only the parent's link is bad.
 * `closed`    -- the lineage's `lineage_status !== 'active'` (deprecated or
 *                retired): still published, but no longer accepting NEW
 *                instances. A friendly page, not an error -- an existing
 *                parent's own link still resumes fine (see the resume
 *                effect below, which never routes through this phase).
 */
type Phase = 'loading' | 'email' | 'running' | 'notFound' | 'invalidLink' | 'closed';

/**
 * DataCore stringifies every top-level field of a flattened row -- `"false"`
 * is truthy in JS. This coerces exactly those fields (never values already
 * inside a parsed JSON blob, which arrive as real JS types).
 */
function asBool(v: unknown): boolean {
  return String(v) === 'true';
}

/**
 * `draft_data` is a JSON-serialized string column on `workflow_instance`.
 * Values inside the parsed object are real JS types already and must not
 * be re-coerced.
 */
function parseDraftData(instanceRow: EntityRecord): Record<string, unknown> {
  const raw = entityData(instanceRow).draft_data;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * IDENTIFIER TRAP: `entity_id` below MUST go through `entityId()`, never a
 * row's business `item_id` field -- every action this page dispatches
 * (`onCompleteItem`, `onUploadDocument`) sends this value straight back to
 * `completeItem`/`uploadDocumentFile`, which resolve it against `entity_id`
 * server-side. `blocking` is coerced with `asBool` for the same
 * stringly-typed-top-level-field reason `application.config_version` used
 * to be, pre-Task-12.
 */
function toItemViews(rows: EntityRecord[]): WorkflowItemView[] {
  return rows.map((row) => {
    const d = entityData(row);
    return {
      entity_id: entityId(row),
      step_id: String(d.step_id ?? ''),
      kind: (d.kind as WorkflowItemView['kind']) ?? 'form',
      title: String(d.title ?? ''),
      status: String(d.status ?? 'not_started'),
      blocking: asBool(d.blocking),
    };
  });
}

/**
 * `WorkflowBundle.models` values may be `null` (Plan 3 Task 4 finding: a
 * referenced entity model that was never set up at this tenant) --
 * `StepRenderer` types `models` as `Record<string, ModelFieldSource>` with
 * no null. Filtering here means a section bound to a dropped key resolves
 * to `undefined` in `StepRenderer`'s own lookup, and `sectionFields`
 * already treats that as "render no fields" rather than crashing.
 */
function usableModels(models: Record<string, ModelFieldSource | null>): Record<string, ModelFieldSource> {
  const out: Record<string, ModelFieldSource> = {};
  for (const [key, value] of Object.entries(models)) {
    if (value) out[key] = value;
  }
  return out;
}

/** A 409's relayed body shape for `startWorkflow` (bindings §1f/§5a: FastAPI
 *  wraps an `HTTPException(409, {"reason": ...})` as `{"detail": {...}}`
 *  on the wire). */
interface Start409Body {
  detail?: { reason?: string };
}

/** Turn a machine action name into a readable button label without a
 *  per-action i18n key -- action names are tenant-authored and open-ended
 *  (a workflow definition can declare any transition name), so there is no
 *  fixed set to translate ahead of time. */
function actionLabel(action: string): string {
  return action
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

const AUTOSAVE_DEBOUNCE_MS = 800;

export default function RegisterPage() {
  const { tenantId = '', definitionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('loading');
  const [bundle, setBundle] = useState<WorkflowBundle | null>(null);
  const [instance, setInstance] = useState<InstanceBundle | null>(null);
  const [token, setToken] = useState<string>(searchParams.get('token') ?? '');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Set the instant `onStart` has a token in hand -- before the resume
  // effect below can ever see the new `token` on a re-render. Guards that
  // effect from re-firing a second, wholly redundant `fetchInstance` right
  // after a successful start.
  const startedLocallyRef = useRef(false);
  // Hydrate `draft` from the server's `draft_data` exactly once per
  // instance load -- never again on a post-action refresh, so a refresh
  // triggered by e.g. `onCompleteItem` can't clobber an in-flight edit the
  // autosave debounce hasn't flushed yet. `draft` is the client's source of
  // truth for the lifetime of the page after that first hydration.
  const draftHydratedRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the public workflow bundle (school name, capacity state, steps,
  // models, lineage_status). Unauthenticated and pre-start -- never needs a
  // token.
  useEffect(() => {
    let cancelled = false;
    fetchWorkflowBundle(tenantId, definitionId)
      .then((b) => {
        if (cancelled) return;
        setBundle(b);
        setPhase((prev) => {
          if (prev === 'running') return prev;
          return b.lineage_status !== 'active' ? 'closed' : 'email';
        });
      })
      .catch(() => {
        if (!cancelled) setPhase('notFound');
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, definitionId]);

  // Resume path: `?token=` present -> load the instance directly and skip
  // the email-capture phase entirely, once the workflow bundle is also in
  // hand. This intentionally never checks `bundle.lineage_status` -- a
  // deprecated/retired lineage still lets an EXISTING instance's own link
  // resume (only NEW starts are blocked); the 'closed' phase set by the
  // bundle-load effect above is guarded against overwriting 'running' for
  // exactly this reason.
  useEffect(() => {
    if (!token || !bundle || startedLocallyRef.current) return;
    let cancelled = false;
    fetchInstance(token)
      .then((i) => {
        if (cancelled) return;
        setInstance(i);
        setPhase('running');
      })
      .catch(() => {
        if (!cancelled) setPhase((prev) => (prev === 'running' ? prev : 'invalidLink'));
      });
    return () => {
      cancelled = true;
    };
  }, [token, bundle]);

  // Hydrate `draft` from the instance's persisted `draft_data` exactly
  // once, the first time an instance is in hand (fresh start or resume).
  useEffect(() => {
    if (!instance || !bundle || draftHydratedRef.current) return;
    draftHydratedRef.current = true;
    setDraft(sectionAnswersToDraft(bundle.definition.steps, parseDraftData(instance.instance)));
  }, [instance, bundle]);

  const refreshInstance = useCallback(async () => {
    if (!token) return;
    try {
      setInstance(await fetchInstance(token));
    } catch {
      // A post-action refresh failing is not evidence the action itself
      // failed -- swallow it here so the action's own try/catch (which
      // reports "the action failed") never fires for a refresh that merely
      // blipped after the real action already succeeded.
    }
  }, [token]);

  async function onStart(e: FormEvent) {
    e.preventDefault();
    if (!bundle || starting) return;
    const value = email.trim();
    if (value.length < 6 || !value.includes('@')) {
      setFormError(t('register.invalidEmail'));
      return;
    }
    setFormError(null);
    setStarting(true);
    try {
      const started = await startWorkflow(tenantId, definitionId, value);
      // Must be set before `setToken` -- otherwise the resume effect's
      // guard is not yet in place on the very next render.
      startedLocallyRef.current = true;
      setToken(started.token);
      setLinkSent(true);
      // `StartResponse` carries no `allowed`/pinned `definition` (unlike
      // the old registration-era shape) -- fetch the real InstanceBundle
      // rather than hand-assembling a partial one.
      const fresh = await fetchInstance(started.token);
      setInstance(fresh);
      setPhase('running');
    } catch (err) {
      if (err instanceof FacadeError && err.status === 409) {
        const reason = (err.body as Start409Body | undefined)?.detail?.reason;
        if (reason === 'lineage_not_active') {
          setPhase('closed');
          setStarting(false);
          return;
        }
        if (reason === 'definition_stale' || reason === 'definition_broken') {
          setFormError(t('register.startUnavailable'));
          setStarting(false);
          return;
        }
      }
      // Any other failure (a capacity-style 409 from the machine, a
      // network blip, a masked 502) falls through to the generic message.
      setFormError(t('register.startError'));
    } finally {
      setStarting(false);
    }
  }

  function handleDraftChange(next: WorkflowDraft) {
    setDraft(next);
    if (!token || !bundle) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      // Converted against the FULL step set (not just the currently
      // visible/state-filtered steps) so an answer from a step the
      // instance has already moved past is never dropped from this
      // snapshot's payload.
      saveDraft(token, draftToSectionAnswers(bundle.definition.steps, next))
        .then(() => setRuntimeError(null))
        .catch(() => setRuntimeError(t('register.saveError')));
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function handleAction(action: string) {
    if (!token) return;
    setActionBusy(action);
    setRuntimeError(null);
    try {
      await runAction(token, action);
      await refreshInstance();
    } catch {
      setRuntimeError(t('hub.submitError'));
    } finally {
      setActionBusy(null);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="register-page">
        <p className="register-status">{t('register.loading')}</p>
      </div>
    );
  }

  if (phase === 'notFound' || !bundle) {
    return (
      <div className="register-page">
        <p className="register-status" role="alert">
          {t('register.notFound')}
        </p>
      </div>
    );
  }

  if (phase === 'closed') {
    return (
      <div className="register-page">
        <header className="register-header">
          <h1>{t('register.closedTitle')}</h1>
        </header>
        <p className="register-status" role="alert">
          {t('register.closedBody')}
        </p>
        <Link className="register-link" to="/request-link">
          {t('hub.requestNewLink')}
        </Link>
      </div>
    );
  }

  if (phase === 'invalidLink') {
    return (
      <div className="register-page">
        <p className="register-status" role="alert">
          {t('hub.invalidLink')}
        </p>
        <Link className="register-link" to="/request-link">
          {t('hub.requestNewLink')}
        </Link>
      </div>
    );
  }

  if (phase === 'email') {
    return (
      <div className="register-page">
        <header className="register-header">
          <h1>{bundle.tenant.name}</h1>
          {/* Read-only: the school year is derived server-side from the same
              July-rollover rule familyhub-backend's `_school_year_for_date`
              uses for the capacity snapshot below, so showing an editable
              field here could only disagree with it. */}
          <p className="register-school-year">
            {t('register.schoolYear')}: {defaultSchoolYear()}
          </p>
          {bundle.capacity.full && (
            <p className="register-full-notice" role="status">
              {t('register.schoolFull')}
            </p>
          )}
        </header>
        <form className="register-email-form" onSubmit={(e) => void onStart(e)} noValidate>
          {formError && (
            <p className="register-error" role="alert">
              {formError}
            </p>
          )}
          <label htmlFor="applicant-email">{t('register.emailLabel')}</label>
          <input
            id="applicant-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            disabled={starting}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="register-help">{t('register.emailHelp')}</p>
          <button type="submit" className="register-primary" disabled={starting}>
            {starting ? t('register.starting') : t('register.start')}
          </button>
        </form>
      </div>
    );
  }

  // phase === 'running'
  const state = String(entityData(instance?.instance).state ?? '');
  const visibleSteps = bundle.definition.steps.filter((s) => s.available_in.includes(state));
  const models = usableModels(bundle.models);
  const itemViews = instance ? toItemViews(instance.items) : [];
  const actionableAllowed = (instance?.allowed ?? []).filter(
    (a) => a !== 'save_draft' && a !== 'complete_item',
  );

  return (
    <div className="register-page">
      <header className="register-header">
        <h1>{bundle.tenant.name}</h1>
        <p className="register-school-year">
          {t('register.schoolYear')}: {defaultSchoolYear()}
        </p>
        {linkSent && (
          <p className="register-link-sent" role="status">
            {t('register.linkSent')}
          </p>
        )}
      </header>
      {runtimeError && (
        <p className="register-error" role="alert">
          {runtimeError}
        </p>
      )}
      {instance && (
        <>
          <StepRenderer
            steps={visibleSteps}
            models={models}
            mode="family"
            draft={draft}
            onDraftChange={handleDraftChange}
            items={itemViews}
            onCompleteItem={(itemEid) =>
              completeItem(token, itemEid)
                .then(async () => {
                  setRuntimeError(null);
                  await refreshInstance();
                })
                .catch((err) => {
                  setRuntimeError(t('hub.completeItemError'));
                  throw err;
                })
            }
            onUploadDocument={(itemEid, file) =>
              uploadDocumentFile(token, itemEid, file)
                .then(async () => {
                  setRuntimeError(null);
                  await refreshInstance();
                })
                .catch((err) => {
                  setRuntimeError(t('hub.uploadFailed'));
                  throw err;
                })
            }
            // No token-scoped documents-LISTING route exists on
            // familyhub-backend yet (only presign-upload and
            // download-by-id) -- StepRenderer's "already uploaded" sublist
            // is therefore always empty here; uploading itself still
            // works. Known gap, not this task's to close.
            documents={[]}
          />
          {actionableAllowed.length > 0 && (
            <div className="register-actions">
              {actionableAllowed.map((action) => (
                <button
                  key={action}
                  type="button"
                  className="hub-action"
                  disabled={actionBusy === action}
                  onClick={() => void handleAction(action)}
                >
                  {actionLabel(action)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <p className="register-hub-link">
        <Link className="register-link" to={`/application/${token}`}>
          {t('register.openHub')}
        </Link>
      </p>
    </div>
  );
}
