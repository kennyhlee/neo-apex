import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ApplicationStatus } from '@neoapex/flow-runtime';
import { formatCents } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { escapeSql, postQuery } from '../api/client.ts';
import { getDocumentUrl, postApplicationAction } from '../api/registration.ts';
import type {
  ActivityRow, ApplicationRow, DocumentRow, ItemRow, PaymentRow,
} from '../types/registration.ts';
import { fmtDateTime, toBoolish, translateOr } from '../utils/format.ts';
import { toLabel, toToneKey } from '../utils/listValue.ts';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ApplicationDetailPage.css';

const DECIDABLE: ApplicationStatus[] = ['submitted', 'in_review', 'pending_items'];

type Confirm =
  | { kind: 'approve' | 'decline' | 'request_changes' | 'promote_waitlist' }
  | { kind: 'reject_item'; itemId: string; title: string }
  | null;

/**
 * Route param convention (DISPATCH-CONTEXT identifier rule): `:applicationId`
 * is the application's DataCore **entity_id**, matching `ApplicationEntryPage`
 * and `ApplicationsPage`'s row-linking (`navigate(`/applications/${r.entity_id}`)`).
 *
 * That drives two corrections against the task brief's literal SQL/action
 * snippets, both confirmed by reading the real backend
 * (`app/registration/engine.py`, `app/registration/actions.py`):
 *
 * 1. The `registration_application` row itself must be looked up by
 *    `entity_id = '<applicationId>'`, NOT `application_id = '<applicationId>'`.
 *    `application_id` on that row is a SEPARATE business id
 *    (`engine.create_application`: `app_id = dc.next_id(...)`,
 *    `app_entity_id = created["entity_id"]` — two different values). The
 *    child-entity queries (`application_item`, `application_activity`,
 *    `document`, `payment`) correctly filter on `application_id`, because
 *    those rows store the PARENT's entity_id in that field
 *    (`engine.create_application_item`, `log_activity`,
 *    `settle_payment_item`: all write `"application_id": application_entity_id`).
 *
 * 2. Every item-scoped action (`verify_item`, `reject_item`, `waive_item`)
 *    must send the item's `entity_id`, not its business `item_id` field
 *    (`engine.create_application_item`: `item_id: uuid.uuid4().hex[:12]`,
 *    independent of DataCore's own entity_id). `_require_item`
 *    (`actions.py:42-49`) resolves via `dc.get_entity(...)`, which filters
 *    on `entity_id`. This is exactly the bug Task 8 shipped and Task 9's
 *    map calls out — checked explicitly here since this page is dense with
 *    item-scoped actions.
 *
 * Documents are the one exception: a document's business `document_id`
 * DOUBLES as its DataCore entity_id by construction
 * (`datacore/src/datacore/api/document_routes.py` module docstring, and
 * `create_document`'s `entity_id=document_id` call), so `d.document_id` is
 * safe to send to `getDocumentUrl` as-is.
 */
export default function ApplicationDetailPage() {
  const { applicationId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const navigate = useNavigate();

  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Distinguishes "not loaded yet" from "loaded, and there is no such row."
   * Without it, `app === null` meant both, so a stale bookmark or an id
   * belonging to another tenant sat on "Loading…" forever — on the page staff
   * bookmark most. `ApplicationEntryPage` already handles the identical case
   * with `entry.notFound`; this is the same branch.
   */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      // Child rows: `entity_type` (multi-writer, safe) + `application_id`
      // (multi-writer across application_item/application_activity/document/
      // payment, safe) — value is the route's entity_id, per the module note.
      const q = (type: string) => postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = '${type}' AND _status = 'active' AND application_id = '${escapeSql(applicationId)}'`);
      // The application row itself: looked up by entity_id, NOT the
      // business application_id field — see the module note above.
      const ar = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = 'registration_application' AND _status = 'active' AND entity_id = '${escapeSql(applicationId)}'`);
      setApp((ar.data[0] as unknown as ApplicationRow) ?? null);
      const [ir, acr, dr, pr] = await Promise.all([
        q('application_item'), q('application_activity'), q('document'), q('payment'),
      ]);
      setItems(ir.data as unknown as ItemRow[]);
      setActivities((acr.data as unknown as ActivityRow[])
        .sort((a, b) => String(b.at).localeCompare(String(a.at))));
      setDocuments(dr.data as unknown as DocumentRow[]);
      setPayments(pr.data as unknown as PaymentRow[]);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, [tenant, applicationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const runAction = async (action: string, params: Record<string, unknown>, doneKey: string) => {
    setBusy(true);
    try {
      await postApplicationAction(tenant, applicationId, action, params);
      toast({ message: t(doneKey), tone: 'success' });
      setConfirm(null);
      setRejectReason('');
      await load();
    } catch (e) {
      // 409 carries the allowed transitions in the response body (spec §11).
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="detail-page"><div className="programs-error" role="alert">{error}</div></div>;
  if (!loaded) return <div className="detail-page"><p className="programs-muted">{t('common.loading')}</p></div>;
  if (!app) return <div className="detail-page"><div className="programs-error" role="alert">{t('entry.notFound')}</div></div>;

  const status = app.status;
  const activityLabel = (type: unknown) =>
    translateOr(t, `detail.activity.${String(type ?? '')}`, String(type ?? ''));
  const itemActionsFor = (i: ItemRow) => {
    const acts: { key: 'verify_item' | 'reject_item' | 'waive_item'; label: string }[] = [];
    if (i.status === 'submitted') {
      acts.push({ key: 'verify_item', label: t('detail.verify') });
      acts.push({ key: 'reject_item', label: t('detail.reject') });
    }
    if (i.status !== 'waived' && i.status !== 'verified') {
      acts.push({ key: 'waive_item', label: t('detail.waive') });
    }
    return acts;
  };

  return (
    <div className="detail-page">
      <header className="page-header">
        <h1 className="page-title">
          {app.application_id}
          <span className="page-subtitle">
            {app.program_id} · {app.school_year} · {t(`apps.channel.${app.channel_started}`)}
            {app.applicant_email ? ` · ${app.applicant_email}` : ''}
          </span>
        </h1>
        <div className="page-header-actions">
          <StatusBadge status={status} label={t(`status.${status}`)} />
          <Button variant="secondary"
            onClick={() => navigate(`/applications/${applicationId}/enter`)}>
            {t('detail.continueEntry')}
          </Button>
          {app.applicant_email && (
            <Button variant="secondary" disabled={busy}
              onClick={() => void runAction('resend_link', {}, 'detail.linkSent')}>
              {t('detail.resendLink')}
            </Button>
          )}
        </div>
      </header>

      <div className="detail-actions">
        {DECIDABLE.includes(status) && (
          <>
            <Button variant="primary" disabled={busy}
              onClick={() => setConfirm({ kind: 'approve' })}>{t('detail.approve')}</Button>
            <Button variant="secondary" disabled={busy}
              onClick={() => setConfirm({ kind: 'request_changes' })}>{t('detail.requestChanges')}</Button>
            <Button variant="danger" disabled={busy}
              onClick={() => setConfirm({ kind: 'decline' })}>{t('detail.decline')}</Button>
          </>
        )}
        {status === 'waitlisted' && (
          <Button variant="primary" disabled={busy}
            onClick={() => setConfirm({ kind: 'promote_waitlist' })}>{t('detail.promote')}</Button>
        )}
      </div>

      <div className="detail-grid">
        <section className="detail-card" aria-label={t('detail.checklist')}>
          <h2>{t('detail.checklist')}</h2>
          <ul className="detail-items">
            {items.map((i) => (
              <li key={i.entity_id} className="detail-item">
                <div className="detail-item-info">
                  <strong>{i.title}</strong>
                  <small>
                    {t(`detail.kind.${i.kind}`)}
                    {toBoolish(i.blocking) ? '' : ` · ${t('detail.nonBlocking')}`}
                    {i.completed_by ? ` · ${t('detail.completedBy')} ${i.completed_by}` : ''}
                    {i.due_at ? ` · ${t('detail.due')} ${fmtDateTime(i.due_at)}` : ''}
                  </small>
                </div>
                <StatusBadge status={i.status} label={t(`itemStatus.${i.status}`)} />
                <div className="detail-item-actions">
                  {itemActionsFor(i).map((a) => (
                    <Button key={a.key} variant="ghost" size="sm" disabled={busy}
                      onClick={() => a.key === 'reject_item'
                        ? setConfirm({ kind: 'reject_item', itemId: i.entity_id, title: i.title })
                        : void runAction(a.key, { item_id: i.entity_id }, 'detail.actionDone')}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
            {items.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ul>
        </section>

        <section className="detail-card" aria-label={t('detail.documents')}>
          <h2>{t('detail.documents')}</h2>
          <ul className="detail-rows">
            {documents.map((d) => (
              <li key={d.entity_id}>
                <span className="detail-row-main">
                  {d.filename}
                  {toBoolish(d.sensitive) && (
                    <span className="detail-flag">{t('detail.sensitive')}</span>
                  )}
                </span>
                <small>{fmtDateTime(d.uploaded_at)} · {d.uploaded_by}</small>
                <Button variant="link" size="sm"
                  onClick={() => {
                    // document_id doubles as the document's entity_id by
                    // construction (DataCore document_routes.py) — safe as-is.
                    getDocumentUrl(tenant, d.document_id)
                      .then((r) => window.open(r.download_url, '_blank', 'noopener'))
                      .catch((e) => toast({ message: t('detail.downloadError'), detail: String(e), tone: 'danger' }));
                  }}>
                  {t('detail.download')}
                </Button>
              </li>
            ))}
            {documents.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ul>
        </section>

        <section className="detail-card" aria-label={t('detail.payments')}>
          <h2>{t('detail.payments')}</h2>
          <ul className="detail-rows">
            {payments.map((p) => (
              <li key={p.entity_id}>
                <span className="detail-row-main">
                  {/* DataCore returns top-level numeric fields as strings;
                      Number() coerces before formatCents does arithmetic. */}
                  {formatCents(Number(p.amount))} · {p.kind} · {p.provider}
                </span>
                <small>{p.paid_at ? fmtDateTime(p.paid_at) : '—'}{p.recorded_by ? ` · ${p.recorded_by}` : ''}</small>
                {/* Without an explicit `label`, StatusBadge falls through to
                    `toLabel`, which does no case or language transform — so
                    this rendered the raw DataCore value ("paid", "refunded"):
                    untranslated in zh-CN and not even correct English. */}
                <StatusBadge status={p.status}
                  label={translateOr(t, `paymentStatus.${toToneKey(p.status)}`,
                    toLabel(p.status, ''))} />
              </li>
            ))}
            {payments.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ul>
        </section>

        <section className="detail-card" aria-label={t('detail.timeline')}>
          <h2>{t('detail.timeline')}</h2>
          <ol className="detail-timeline">
            {activities.map((a) => (
              <li key={a.entity_id}>
                <span className="detail-row-main">
                  {/* `t` falls back to the raw KEY when a translation is
                      missing (useTranslation.ts), so an activity type this
                      page doesn't know about rendered the literal string
                      "detail.activity.whatever". Fall back to the raw type
                      instead — ugly, but it's information rather than a leaked
                      lookup key. */}
                  {activityLabel(a.type)}
                  {a.from_value || a.to_value ? `: ${a.from_value ?? '—'} → ${a.to_value ?? '—'}` : ''}
                </span>
                <small>{fmtDateTime(a.at)} · {a.actor}</small>
              </li>
            ))}
            {activities.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ol>
        </section>
      </div>

      <Modal open={confirm != null} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'reject_item'
          ? `${t('detail.rejectTitle')}: ${confirm.title}`
          : t(`detail.confirm.${confirm?.kind ?? 'approve'}`)}
        size="sm" dismissOnEscape={!busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={confirm?.kind === 'decline' || confirm?.kind === 'reject_item' ? 'danger' : 'primary'}
              loading={busy} loadingText={t('common.loading')}
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === 'reject_item') {
                  // reject_item's `reason` is email-only and never persisted
                  // (actions.py:158-177 only reads it to build the outgoing
                  // email) — no UI here reads it back afterward.
                  void runAction('reject_item',
                    { item_id: confirm.itemId, ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}) },
                    'detail.actionDone');
                } else {
                  void runAction(confirm.kind, {}, 'detail.actionDone');
                }
              }}>
              {t('detail.confirmGo')}
            </Button>
          </>
        }>
        {confirm?.kind === 'reject_item' ? (
          <div className="bcp-row bcp-row--stack">
            <label htmlFor="detail-reject-reason">{t('detail.rejectReason')}</label>
            <textarea id="detail-reject-reason" rows={3} value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)} />
          </div>
        ) : (
          <p>{t('detail.confirmBody')}</p>
        )}
      </Modal>
    </div>
  );
}
