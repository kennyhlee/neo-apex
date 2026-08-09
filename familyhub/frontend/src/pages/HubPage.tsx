import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ItemStatus, WorkflowItemView } from '@neoapex/flow-runtime';
import {
  decodeToken,
  FacadeError,
  fetchInstance,
  getDocumentUrl,
  runAction,
  uploadDocumentFile,
} from '../api/facade.ts';
import {
  asItemStatus,
  entityData,
  entityId,
  type EntityRecord,
  type InstanceBundle,
} from '../types/workflow.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './HubPage.css';

type Tone = 'info' | 'success' | 'warning' | 'danger';

// Exhaustive by construction: `ItemStatus` is generated from apexflow's
// StrEnum, so adding a status there fails this `Record` at compile time
// rather than rendering a silently untoned badge.
const ITEM_TONE: Record<ItemStatus, Tone> = {
  not_started: 'warning',
  submitted: 'info',
  verified: 'success',
  rejected: 'danger',
  waived: 'info',
};

// Statuses where the PARENT still has to do something. `submitted` is
// deliberately excluded -- the parent already acted (uploaded/filled the
// form/acknowledged) and it is now with the school for review.
const OUTSTANDING: ItemStatus[] = ['not_started', 'rejected'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.docx';

/**
 * DataCore stringifies every top-level field of a flattened row -- `"false"`
 * is truthy in JS. Coerce exactly those fields (never a value already inside
 * a parsed JSON blob, which arrives as a real JS type).
 */
function asBool(v: unknown): boolean {
  return String(v) === 'true';
}

/** `WorkflowItemView` plus the raw `payload_ref` field a `documents`-kind
 *  item row also carries. `uploadDocumentFile` -> `completeItem` now writes
 *  this (Task 3's write path, threaded through by the fix for final-review
 *  finding C1) -- kept as its own field so the "view document" affordance
 *  can read it straight off the item row without another frontend change. */
interface ItemView extends WorkflowItemView {
  payload_ref?: string;
}

/**
 * IDENTIFIER TRAP: `entity_id` below MUST go through `entityId()`, never a
 * row's business `item_id` field -- every action this page dispatches
 * (`uploadDocumentFile` -> `completeItem`) sends this value straight
 * through, and the backend resolves it against `entity_id`. `blocking` is
 * coerced with `asBool` for the same stringly-typed-top-level-field reason.
 */
function toItemViews(rows: EntityRecord[]): ItemView[] {
  return rows.map((row) => {
    const d = entityData(row);
    return {
      entity_id: entityId(row),
      step_id: String(d.step_id ?? ''),
      kind: (d.kind as ItemView['kind']) ?? 'form',
      title: String(d.title ?? ''),
      status: asItemStatus(d.status),
      blocking: asBool(d.blocking),
      payload_ref: typeof d.payload_ref === 'string' && d.payload_ref ? d.payload_ref : undefined,
    };
  });
}

/** Turn a machine action name into a readable button label without a
 *  per-action i18n key -- see RegisterPage's identical helper for why
 *  action names have no fixed translatable set. */
function actionLabel(action: string): string {
  return action
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * 401 (bad/tampered token) and 404 (unknown/revoked token) are the only
 * responses that mean "this link is genuinely bad". Everything else --
 * a masked 502 (apexflow or DataCore down), a 429, a network failure that
 * never reached the facade at all (plain non-`FacadeError` rejection) --
 * is transient and must not send the parent to the invalid-link screen.
 */
function isInvalidLinkError(err: unknown): boolean {
  return err instanceof FacadeError && (err.status === 401 || err.status === 404);
}

export default function HubPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const [instance, setInstance] = useState<InstanceBundle | null>(null);
  const [invalid, setInvalid] = useState(false);
  // Transient load/refresh failure -- a masked 5xx, a 429, an offline
  // phone. Distinct from `invalid`: it gets a retry affordance, never the
  // "this link is invalid or has expired" screen.
  const [loadError, setLoadError] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Used both for the retry banner/button and for post-action refreshes.
  // `load()`'s failure must NEVER flip `invalid` -- a refresh blipping
  // after a successful action, or a parent tapping retry, is not evidence
  // the link itself is bad. Only the very first fetch (the effect below)
  // can ever set `invalid`, since only there is there no existing working
  // instance to protect.
  const load = useCallback(async () => {
    try {
      const i = await fetchInstance(token);
      setInstance(i);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  // Inlined (rather than calling `load` from here) so the initial fetch
  // can be cancellation-guarded, AND so it alone -- never `load()` -- is
  // allowed to set `invalid`.
  useEffect(() => {
    let cancelled = false;
    fetchInstance(token)
      .then((i) => {
        if (cancelled) return;
        setInstance(i);
        setInvalid(false);
        setLoadError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isInvalidLinkError(err)) {
          setInvalid(true);
        } else {
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onUpload = useCallback(async (itemId: string, file: File | null) => {
    if (!file) return;
    setBusyItem(itemId);
    setActionError(null);
    try {
      await uploadDocumentFile(token, itemId, file);
      await load();
    } catch {
      setActionError(t('hub.uploadFailed'));
    } finally {
      setBusyItem(null);
    }
  }, [token, load, t]);

  const onViewDocument = useCallback(async (documentId: string) => {
    setActionError(null);
    try {
      const url = await getDocumentUrl(token, documentId);
      window.open(url, '_blank', 'noopener');
    } catch {
      // Deliberately the SAME generic message for every failure (403, 404,
      // masked 5xx) -- distinguishing them would tell whoever is holding
      // this link whether some other family's document exists at all.
      setActionError(t('hub.documentUnavailable'));
    }
  }, [token, t]);

  const onAction = useCallback(async (action: string) => {
    setActionBusy(action);
    setActionError(null);
    try {
      await runAction(token, action);
      await load();
    } catch {
      setActionError(t('hub.submitError'));
    } finally {
      setActionBusy(null);
    }
  }, [token, load, t]);

  if (invalid) {
    return (
      <div className="hub-page">
        <p className="hub-banner tone-danger" role="alert">{t('hub.invalidLink')}</p>
        <Link className="hub-link" to="/request-link">{t('hub.requestNewLink')}</Link>
      </div>
    );
  }

  if (!instance) {
    if (loadError) {
      return (
        <div className="hub-page">
          <p className="hub-banner tone-danger" role="alert">{t('hub.loadError')}</p>
          <button type="button" className="hub-action secondary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      );
    }
    return <div className="hub-page"><p className="hub-loading">{t('hub.loading')}</p></div>;
  }

  const state = String(entityData(instance.instance).state ?? '');
  const stateInfo = instance.definition.machine.states.find((s) => s.state_id === state);
  const stateLabel = stateInfo?.name ?? state;
  const terminal = stateInfo?.kind === 'terminal';
  const decoded = decodeToken(token);
  const items = toItemViews(instance.items);
  const actionableAllowed = instance.allowed.filter(
    (a) => a !== 'save_draft' && a !== 'complete_item',
  );
  // Captured as a plain local (not read through `instance` again) so the
  // nested `affordance` closure below doesn't need TS to prove `instance`
  // is still non-null by the time it runs -- `instance` is a `useState`
  // value, and TS's control-flow narrowing does not persist into a nested
  // function declaration's body.
  const definitionId = instance.definition.definition_id;

  const outstanding = items.filter((i) => OUTSTANDING.includes(i.status as ItemStatus));

  function affordance(item: ItemView) {
    const documentId = item.payload_ref;
    if (item.kind === 'documents' && documentId && !OUTSTANDING.includes(item.status as ItemStatus)) {
      return (
        <button
          type="button"
          className="hub-action secondary"
          onClick={() => onViewDocument(documentId)}
        >
          {t('hub.viewDocument')}
        </button>
      );
    }
    if (terminal || !OUTSTANDING.includes(item.status as ItemStatus)) return null;

    if (item.kind === 'documents') {
      return (
        <>
          <button
            type="button"
            className="hub-action"
            disabled={busyItem === item.entity_id}
            aria-label={`${t('hub.upload')}: ${item.title}`}
            onClick={() => fileInputs.current[item.entity_id]?.click()}
          >
            {busyItem === item.entity_id ? t('hub.uploading') : t('hub.upload')}
          </button>
          <input
            ref={(el) => { fileInputs.current[item.entity_id] = el; }}
            type="file"
            accept={ACCEPT}
            className="hub-file-input"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void onUpload(item.entity_id, e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </>
      );
    }
    // 'form' and 'message-ack' items are completed on the running workflow
    // page itself (the form fields / acknowledgement checkbox live there,
    // not here) -- send the parent back to it.
    if ((item.kind === 'form' || item.kind === 'message-ack') && decoded) {
      return (
        <Link
          className="hub-action link"
          to={`/w/${decoded.tenantId}/${definitionId}?token=${encodeURIComponent(token)}`}
        >
          {t('hub.continueForm')}
        </Link>
      );
    }
    return null;
  }

  return (
    <div className="hub-page">
      <h1 className="hub-title">{t('hub.title')}</h1>

      <section className="hub-banner tone-info" role="status" aria-live="polite">
        <span className="hub-status-chip tone-info">
          {t('hub.state')}: {stateLabel}
        </span>
        {terminal && <p className="hub-contact">{t('hub.contactSchool')}</p>}
      </section>

      {loadError && (
        <p className="hub-error hub-retry-row" role="alert">
          <span>{t('hub.loadError')}</span>
          <button type="button" className="hub-action secondary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {actionError && <p className="hub-error" role="alert">{actionError}</p>}

      {!terminal && (
        <section className="hub-outstanding">
          <h2>{t('hub.outstanding')}</h2>
          {outstanding.length === 0 ? (
            <p className="hub-muted">{t('hub.nothingOutstanding')}</p>
          ) : (
            <ul>
              {outstanding.map((item) => (
                <li key={item.entity_id}>
                  <span>{item.title}</span>
                  {item.blocking && <span className="hub-blocking">{t('hub.blocking')}</span>}
                </li>
              ))}
            </ul>
          )}
          {actionableAllowed.map((action) => (
            <button
              key={action}
              type="button"
              className="hub-submit"
              disabled={actionBusy === action}
              onClick={() => void onAction(action)}
            >
              {actionLabel(action)}
            </button>
          ))}
        </section>
      )}

      <section className="hub-checklist">
        <h2>{t('hub.checklist')}</h2>
        <ul>
          {items.map((item) => (
            <li key={item.entity_id} className="hub-item">
              <div className="hub-item-main">
                <span className="hub-item-title">{item.title}</span>
                <span className={`hub-item-chip tone-${ITEM_TONE[item.status as ItemStatus]}`}>
                  {t(`itemStatus.${item.status}`)}
                </span>
              </div>
              <div className="hub-item-actions">{affordance(item)}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
