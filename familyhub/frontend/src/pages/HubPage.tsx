import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DONE_ITEM_STATUSES,
  formatCents,
  paymentAmountFor,
  type ApplicationItem,
} from '@neoapex/flow-runtime';
import {
  decodeToken,
  FacadeError,
  fetchApplication,
  getDocumentUrl,
  startCheckout,
  submitApplication,
  uploadDocumentFile,
} from '../api/facade.ts';
import {
  entityData,
  entityId,
  type ApplicationStatus,
  type EntityRecord,
  type HubBundle,
  type ItemStatus,
} from '../types/registration.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './HubPage.css';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  draft: 'info',
  submitted: 'info',
  in_review: 'info',
  pending_items: 'warning',
  approved: 'success',
  enrolled: 'success',
  waitlisted: 'warning',
  declined: 'danger',
  withdrawn: 'danger',
};

const ITEM_TONE: Record<ItemStatus, Tone> = {
  not_started: 'warning',
  in_progress: 'warning',
  submitted: 'info',
  verified: 'success',
  rejected: 'danger',
  waived: 'info',
};

const ALL_STATUSES: ApplicationStatus[] = [
  'draft', 'submitted', 'in_review', 'pending_items', 'approved',
  'enrolled', 'waitlisted', 'declined', 'withdrawn',
];
const ALL_ITEM_STATUSES: ItemStatus[] = [
  'not_started', 'in_progress', 'submitted', 'verified', 'rejected', 'waived',
];

// Statuses where the PARENT still has to do something. `submitted` is
// deliberately excluded -- the parent already acted (uploaded/paid/filled
// the form) and it is now with the school for review.
const OUTSTANDING: ItemStatus[] = ['not_started', 'in_progress', 'rejected'];
const TERMINAL: ApplicationStatus[] = ['declined', 'withdrawn'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.docx';

function asStatus(value: unknown): ApplicationStatus {
  return ALL_STATUSES.includes(value as ApplicationStatus) ? (value as ApplicationStatus) : 'draft';
}

function asItemStatus(value: unknown): ItemStatus {
  return ALL_ITEM_STATUSES.includes(value as ItemStatus) ? (value as ItemStatus) : 'not_started';
}

/**
 * DataCore stringifies every top-level field of a flattened row -- `"false"`
 * is truthy in JS. Coerce exactly those fields (never a value already inside
 * a parsed JSON blob, which arrives as a real JS type).
 */
function asBool(v: unknown): boolean {
  return String(v) === 'true';
}

interface ApplicationView {
  application_id: string;
  status: ApplicationStatus;
}

/**
 * `application_id` here is the ONE genuine display exception to the
 * identifier trap (bindings §1 discrepancy 3): the business id, shown to
 * the parent, never dispatched on.
 */
function toApplicationView(row: EntityRecord): ApplicationView {
  const d = entityData(row);
  return {
    application_id: String(d.application_id ?? ''),
    status: asStatus(d.status),
  };
}

/**
 * IDENTIFIER TRAP: `item_id` below MUST be the row's DataCore `entity_id`,
 * never the business `item_id` field the row also carries -- every action
 * this page dispatches (`uploadDocumentFile` -> `completeItem`,
 * `startCheckout`) sends this value straight through, and the backend
 * resolves it against `entity_id` (bindings §5). `blocking` is coerced with
 * `asBool` for the same stringly-typed-top-level-field reason.
 */
function toApplicationItems(rows: EntityRecord[]): ApplicationItem[] {
  return rows.map((row) => {
    const d = entityData(row);
    return {
      // MUST go through entityId(): `d` is base_data for the envelope
      // shape, which has no entity_id in it (see entityId's note).
      item_id: entityId(row),
      application_id: String(d.application_id ?? ''),
      block_id: String(d.block_id ?? ''),
      kind: (d.kind as ApplicationItem['kind']) ?? 'form',
      title: String(d.title ?? ''),
      status: asItemStatus(d.status),
      blocking: asBool(d.blocking),
      payload_ref: typeof d.payload_ref === 'string' ? d.payload_ref : undefined,
    };
  });
}

/**
 * `draft_data` is a JSON-serialized string column (same shape as
 * `config.blocks` before `facade.ts` normalizes it, but this one is never
 * pre-parsed for us). Values inside the parsed object are real JS types
 * already and must not be re-coerced.
 */
function parseDraft(applicationRow: EntityRecord): Record<string, unknown> {
  const raw = entityData(applicationRow).draft_data;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isDone(status: ItemStatus): boolean {
  return (DONE_ITEM_STATUSES as readonly string[]).includes(status);
}

/**
 * 401 (bad/tampered token) and 404 (unknown/revoked token) are the only
 * responses that mean "this link is genuinely bad". Everything else --
 * a masked 502 (enrollx or DataCore down), a 429, a network failure that
 * never reached the facade at all (plain non-`FacadeError` rejection) --
 * is transient and must not send the parent to the invalid-link screen.
 */
function isInvalidLinkError(err: unknown): boolean {
  return err instanceof FacadeError && (err.status === 401 || err.status === 404);
}

export default function HubPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const [hub, setHub] = useState<HubBundle | null>(null);
  const [invalid, setInvalid] = useState(false);
  // Transient load/refresh failure -- a masked 5xx, a 429, an offline
  // phone. Distinct from `invalid`: it gets a retry affordance, never the
  // "this link is invalid or has expired" screen.
  const [loadError, setLoadError] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Used both for the retry banner/button and for post-action refreshes
  // (`onUpload`/`onPay`-adjacent `onSubmit`). `load()`'s failure must NEVER
  // flip `invalid` -- a refresh blipping after a successful action, or a
  // parent tapping retry, is not evidence the link itself is bad. Only the
  // very first fetch (the effect below) can ever set `invalid`, since only
  // there is there no existing working hub to protect.
  const load = useCallback(async () => {
    try {
      const h = await fetchApplication(token);
      setHub(h);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  // Inlined (rather than calling `load` from here) so the initial fetch
  // can be cancellation-guarded the same way RegisterPage's effects are,
  // AND so it alone -- never `load()` -- is allowed to set `invalid`.
  useEffect(() => {
    let cancelled = false;
    fetchApplication(token)
      .then((h) => {
        if (cancelled) return;
        setHub(h);
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

  // These are declared with `useCallback`, ahead of the early returns below,
  // so React's rules-of-hooks are satisfied -- none of them depend on `hub`
  // (only on `token`/`t`/`load`), so hoisting them costs nothing.
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

  const onPay = useCallback(async (itemId: string) => {
    setBusyItem(itemId);
    setActionError(null);
    try {
      // Full-page redirect, not a new tab: Stripe redirects back to this
      // same `/application/{token}` on success or cancel, and a
      // background-tab `window.open` after an `await` is exactly the
      // pattern mobile popup blockers kill.
      const checkoutUrl = await startCheckout(token, itemId);
      window.location.href = checkoutUrl;
    } catch {
      setActionError(t('hub.payError'));
      setBusyItem(null);
    }
  }, [token, t]);

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

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      await submitApplication(token);
      await load();
    } catch {
      setActionError(t('hub.submitError'));
    } finally {
      setSubmitting(false);
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

  if (!hub) {
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

  const app = toApplicationView(hub.application);
  const status = app.status;
  const terminal = TERMINAL.includes(status);
  const decoded = decodeToken(token);
  const items = toApplicationItems(hub.items);
  const draft = parseDraft(hub.application);
  const planChoice =
    typeof draft.payment_plan_selection === 'string' ? draft.payment_plan_selection : '';
  // items.py stamps the original payment item with the `payment` block's OWN
  // block_id; stripe_webhook.py stamps the later "Balance payment" item with
  // the `payment_plan` block's id instead. paymentAmountFor uses this id to
  // tell the two apart structurally (never by title) -- see its doc comment.
  const paymentBlockId = hub.config.blocks.find((b) => b.type === 'payment')?.block_id ?? null;

  const amountDueFor = (item: ApplicationItem): string | null => {
    const cents = paymentAmountFor(hub.config, planChoice, item, paymentBlockId);
    return cents != null ? t('hub.amountDue').replace('{amount}', formatCents(cents)) : null;
  };

  const outstanding = items.filter((i) => OUTSTANDING.includes(i.status));
  const blockingOutstanding = items.filter((i) => i.blocking && !isDone(i.status));
  // Mirrors FlowRenderer's own canSubmit gate (submit is legal from draft or
  // pending_items, once every blocking item is done) so this page never
  // offers an action the runtime itself would refuse.
  const canSubmit =
    !terminal && (status === 'draft' || status === 'pending_items') &&
    blockingOutstanding.length === 0;

  function affordance(item: ApplicationItem) {
    const documentId = item.payload_ref;
    if (item.kind === 'document' && documentId && !OUTSTANDING.includes(item.status)) {
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
    if (terminal || !OUTSTANDING.includes(item.status)) return null;

    if (item.kind === 'document') {
      return (
        <>
          <button
            type="button"
            className="hub-action"
            disabled={busyItem === item.item_id}
            aria-label={`${t('hub.upload')}: ${item.title}`}
            onClick={() => fileInputs.current[item.item_id]?.click()}
          >
            {busyItem === item.item_id ? t('hub.uploading') : t('hub.upload')}
          </button>
          <input
            ref={(el) => { fileInputs.current[item.item_id] = el; }}
            type="file"
            accept={ACCEPT}
            className="hub-file-input"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void onUpload(item.item_id, e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </>
      );
    }
    if (item.kind === 'form' && decoded) {
      return (
        <Link
          className="hub-action link"
          to={`/register/${decoded.tenantId}?token=${encodeURIComponent(token)}`}
        >
          {t('hub.continueForm')}
        </Link>
      );
    }
    if (item.kind === 'payment') {
      return (
        <button
          type="button"
          className="hub-action"
          disabled={busyItem === item.item_id}
          onClick={() => onPay(item.item_id)}
        >
          {t('hub.payNow')}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="hub-page">
      <h1 className="hub-title">{t('hub.title')}</h1>

      <section
        className={`hub-banner tone-${STATUS_TONE[status]}`}
        role="status"
        aria-live="polite"
      >
        <span className={`hub-status-chip tone-${STATUS_TONE[status]}`}>
          {t(`status.${status}`)}
        </span>
        <p>{t(`statusBanner.${status}`)}</p>
        {status === 'declined' && <p className="hub-contact">{t('hub.contactSchool')}</p>}
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
                <li key={item.item_id}>
                  <span>{item.title}</span>
                  <span className="hub-outstanding-meta">
                    {item.kind === 'payment' && amountDueFor(item) && (
                      <span className="hub-amount-inline">{amountDueFor(item)}</span>
                    )}
                    {item.blocking && <span className="hub-blocking">{t('hub.blocking')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canSubmit && (
            <button
              type="button"
              className="hub-submit"
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {t('hub.submit')}
            </button>
          )}
        </section>
      )}

      <section className="hub-checklist">
        <h2>{t('hub.checklist')}</h2>
        <ul>
          {items.map((item) => (
            <li key={item.item_id} className="hub-item">
              <div className="hub-item-main">
                <span className="hub-item-title">{item.title}</span>
                <span className={`hub-item-chip tone-${ITEM_TONE[item.status]}`}>
                  {t(`itemStatus.${item.status}`)}
                </span>
              </div>
              {item.kind === 'payment' && OUTSTANDING.includes(item.status) && amountDueFor(item) && (
                <p className="hub-amount">{amountDueFor(item)}</p>
              )}
              <div className="hub-item-actions">{affordance(item)}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
