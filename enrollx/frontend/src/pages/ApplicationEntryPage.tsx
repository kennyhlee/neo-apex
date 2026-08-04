// enrollx/frontend/src/pages/ApplicationEntryPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FlowRenderer } from '@neoapex/flow-runtime';
import type {
  ApplicationSummary, FlowBlock, RegistrationConfigDef, RequiredDoc,
} from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { escapeSql, postQuery } from '../api/client.ts';
import { postApplicationAction, startCheckout, uploadDocumentForItem } from '../api/registration.ts';
import type { ApplicationRow, ConfigRow, ItemRow } from '../types/registration.ts';
import { toBoolish } from '../utils/format.ts';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ApplicationEntryPage.css';

/**
 * Staff-assisted entry, step 2: renders the published flow for this
 * application via `FlowRenderer mode="staff"` so a staff member can key in
 * data on the family's behalf, upload scanned paper forms, and record
 * offline payments (spec §6). Also the "Continue entry" target for
 * applications already in progress (Task 10's tracking views link here).
 *
 * Route param convention (DISPATCH-CONTEXT): `:applicationId` is the
 * application's DataCore **entity_id** everywhere in this file — never the
 * RA-prefixed business id stored at `base_data.application_id` on the
 * `registration_application` row itself. Those two are genuinely different
 * strings (`engine.create_application` mints the business id from
 * `dc.next_id`, then lets DataCore assign a separate `entity_id` to the row),
 * so the two SQL queries below deliberately filter on different columns.
 */
export default function ApplicationEntryPage() {
  const { applicationId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const { getModel } = useModel();
  const navigate = useNavigate();

  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [config, setConfig] = useState<RegistrationConfigDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineItemId, setOfflineItemId] = useState<string | null>(null);
  const [offlineAmount, setOfflineAmount] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);

  /**
   * SQL #1: `entity_type` + `_status` (DataCore system columns, always safe)
   * plus `entity_id = '{applicationId}'`. `entity_id` is DataCore's own row
   * identifier, assigned to every entity of every type — never a
   * single-writer field, and the only column that actually matches our route
   * param (see file header). Filtering on `application_id` here instead — as
   * the plan text originally suggested — would search the business id field
   * and never match the entity_id we were navigated with.
   *
   * SQL #2: `entity_type` + `_status` plus `application_id = '{applicationId}'`.
   * On `application_item` rows `application_id` holds the PARENT's entity_id
   * (`engine.create_application_item`: `"application_id": application_entity_id`),
   * so this is the correct join key here even though the same field name means
   * something else on the `registration_application` row itself. The field is
   * written by `application_item`, `application_activity`, `payment`, and
   * `document` rows in addition to `registration_application`'s own business
   * id — several entity types, so it is never a single-writer binder hazard.
   */
  const loadAppAndItems = useCallback(async () => {
    const ar = await postQuery(tenant, 'entities',
      `SELECT * FROM data WHERE entity_type = 'registration_application' AND _status = 'active' AND entity_id = '${escapeSql(applicationId)}'`);
    const a = (ar.data[0] as unknown as ApplicationRow) ?? null;
    setApp(a);
    const ir = await postQuery(tenant, 'entities',
      `SELECT * FROM data WHERE entity_type = 'application_item' AND _status = 'active' AND application_id = '${escapeSql(applicationId)}'`);
    setItems(ir.data as unknown as ItemRow[]);
    return a;
  }, [tenant, applicationId]);

  useEffect(() => {
    (async () => {
      try {
        const a = await loadAppAndItems();
        if (!a) { setError(t('entry.notFound')); return; }
        // SQL #3: `entity_type` + `_status` plus `program_id`, the same
        // predicate ConfigBuilderPage already runs — `program_id` is written
        // by both `program` and `registration_config` (and by this
        // application row too), so it is never single-writer.
        const cr = await postQuery(tenant, 'entities',
          `SELECT * FROM data WHERE entity_type = 'registration_config' AND _status = 'active' AND program_id = '${escapeSql(String(a.program_id))}'`);
        const rows = cr.data as unknown as ConfigRow[];
        // config_version/version arrive from DataCore as strings on every
        // row (every top-level field is stringly typed) — coerce with
        // Number() before comparing. The application pins config_version at
        // creation time (spec §4); fall back to the latest version if the
        // pinned one can't be found (e.g. archived and since pruned).
        const cfg = rows.find((c) => Number(c.version) === Number(a.config_version))
          ?? [...rows].sort((x, y) => Number(y.version) - Number(x.version))[0];
        if (!cfg) { setError(t('entry.noConfig')); return; }
        // `blocks` is a JSON-serialized column: JSON.parse gives real JS
        // types straight through, no further coercion needed on its contents.
        const blocks = JSON.parse(String(cfg.blocks)) as FlowBlock[];
        // Host responsibility: flow-runtime never fetches anything itself —
        // hydrate entity-model-sourced form fields before the config reaches
        // FlowRenderer (same pattern as ConfigBuilderPage's preview).
        const hydrated = await Promise.all(blocks.map(async (b) => {
          const et = b.type === 'form' && typeof b.config.entity_type === 'string'
            ? b.config.entity_type : null;
          if (!et) return b;
          try {
            const m = await getModel(tenant, et);
            const fields = [...m.base_fields, ...m.custom_fields]
              .filter((f) => f.name !== `${et}_id`);
            return { ...b, config: { ...b.config, fields } };
          } catch {
            return { ...b, config: { ...b.config, fields: [] } };
          }
        }));
        setConfig({
          config_id: String(cfg.config_id), program_id: String(cfg.program_id),
          version: Number(cfg.version), status: 'published', blocks: hydrated,
        });
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [tenant, applicationId, loadAppAndItems, getModel, t]);

  const draftDataRaw = app?.draft_data;
  const values = useMemo(() => {
    // draft_data is a JSON-serialized column: JSON.parse gives real JS types
    // through directly, no further coercion of its contents.
    try {
      return draftDataRaw ? JSON.parse(String(draftDataRaw)) as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }, [draftDataRaw]);

  const rendererItems = useMemo(() => items.map((i) => ({
    // `item_id` here is flow-runtime's `ApplicationItem.item_id`, which every
    // block component (PaymentBlock's onCheckout/onRecordOfflinePayment,
    // FlowRenderer's own onCompleteItem call) sends straight back to us as
    // the id to act on. It must be DataCore's `entity_id`, NOT the business
    // `item_id` field application_item rows also carry — the backend's
    // `_require_item` (`actions.py:41-47`) calls `get_entity(...)`, which
    // resolves by entity_id, and the two are independently-generated
    // strings that never match (`engine.py:265` mints the business
    // `item_id` field separately from whatever entity_id DataCore assigns
    // the row). Sending the business id here 404s every item-scoped action
    // ("Item not found on this application") while page load and free-text
    // autosave, which never touch this field, keep working — the same
    // identifier trap as the route param, one level down.
    item_id: i.entity_id, application_id: i.application_id, block_id: i.block_id,
    kind: i.kind, title: i.title, status: i.status,
    // `blocking` is a top-level DataCore field, so it arrives as the string
    // "true"/"false" as often as a real boolean — coerce with toBoolish
    // before it reaches flow-runtime's ApplicationItem.blocking: boolean.
    blocking: toBoolish(i.blocking),
    due_at: i.due_at, completed_by: i.completed_by, payload_ref: i.payload_ref,
  })), [items]);

  const summary: ApplicationSummary | null = app ? {
    application_id: app.application_id, program_id: app.program_id,
    school_year: app.school_year, status: app.status,
    channel_started: app.channel_started,
    // config_version: another stringly-typed top-level field — coerce.
    config_version: Number(app.config_version),
    applicant_email: app.applicant_email,
  } : null;

  // ---- FlowRenderer callbacks — every mutation reports via useToast -------

  const handleSaveDraft = async (v: Record<string, unknown>) => {
    try {
      await postApplicationAction(tenant, applicationId, 'save_draft', { draft_data: v });
    } catch (e) {
      toast({ message: t('entry.saveError'), detail: String(e), tone: 'danger' });
      throw e;
    }
  };

  /**
   * FlowRenderer's `advance()` calls this only for 'form' blocks, passing the
   * block's own field values as `payload` — but `complete_item`'s only
   * optional param is `payload_ref` (a document reference STRING; verified
   * `actions.py:102-106`), not an arbitrary values object. That form data is
   * already persisted moments earlier by the `await onSaveDraft(...)` this
   * same `advance()` call makes, so there is nothing useful to forward here
   * — sending the values object as `payload_ref` would just get
   * `str()`-coerced into a meaningless string server-side. Accepting one
   * fewer parameter than the declared callback type is fine in TS (same
   * pattern ConfigBuilderPage's preview no-ops use).
   */
  const handleCompleteItem = async (itemId: string) => {
    try {
      await postApplicationAction(tenant, applicationId, 'complete_item', { item_id: itemId });
      await loadAppAndItems();
      toast({ message: t('entry.itemCompleted'), tone: 'success' });
    } catch (e) {
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
      throw e;
    }
  };

  const handleUploadDocument = async (blockId: string, doc: RequiredDoc, file: File) => {
    const item = items.find((i) => i.block_id === blockId && i.title === doc.name);
    if (!item) { toast({ message: t('entry.uploadError'), tone: 'danger' }); return; }
    try {
      // entity_id, not the business item_id field — see rendererItems' comment.
      await uploadDocumentForItem(tenant, applicationId, item.entity_id, doc, file);
      await loadAppAndItems();
      toast({ message: t('entry.uploaded'), tone: 'success' });
    } catch (e) {
      toast({ message: t('entry.uploadError'), detail: String(e), tone: 'danger' });
    }
  };

  const handleCheckout = async (itemId: string) => {
    try {
      const { checkout_url } = await startCheckout(tenant, applicationId, itemId);
      window.open(checkout_url, '_blank', 'noopener');
    } catch (e) {
      toast({ message: t('entry.checkoutError'), detail: String(e), tone: 'danger' });
    }
  };

  const handleSubmit = async () => {
    try {
      await postApplicationAction(tenant, applicationId, 'submit', {});
      toast({ message: t('entry.submitted'), tone: 'success' });
      navigate(`/applications/${applicationId}`);
    } catch (e) {
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
      throw e;
    }
  };

  /**
   * `record_offline_payment` takes `item_id` + a REQUIRED integer-cents
   * `amount`, plus optional `kind`/`currency` we don't surface here — and,
   * per INTERFACE-MAP Discrepancy #2, there is no `note`/memo field on this
   * action at all (`_record_offline_payment` reads only `item_id`, `amount`,
   * `kind`, `currency`; nothing is persisted for a memo). The modal
   * deliberately has no note input: adding one would silently drop whatever
   * staff typed with no server error to explain why.
   */
  const recordOffline = async () => {
    if (!offlineItemId) return;
    const cents = Math.round(Number(offlineAmount || 0) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    setOfflineBusy(true);
    try {
      await postApplicationAction(tenant, applicationId, 'record_offline_payment', {
        item_id: offlineItemId,
        amount: cents,
      });
      setOfflineItemId(null);
      setOfflineAmount('');
      await loadAppAndItems();
      toast({ message: t('entry.offlineRecorded'), tone: 'success' });
    } catch (e) {
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
    } finally {
      setOfflineBusy(false);
    }
  };

  if (error) return <div className="entry-page"><div className="programs-error" role="alert">{error}</div></div>;
  if (!app || !config || !summary) return <div className="entry-page"><p className="programs-muted">{t('common.loading')}</p></div>;

  return (
    <div className="entry-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('entry.title')}
          <span className="page-subtitle">{app.application_id} · {app.school_year}</span>
        </h1>
        <div className="page-header-actions">
          <StatusBadge status={app.status} label={t(`status.${app.status}`)} />
          <Button variant="secondary" onClick={() => navigate(`/applications/${applicationId}`)}>
            {t('entry.viewDetail')}
          </Button>
        </div>
      </header>

      <FlowRenderer
        config={config}
        mode="staff"
        application={summary}
        items={rendererItems}
        values={values}
        onSaveDraft={handleSaveDraft}
        onCompleteItem={handleCompleteItem}
        onUploadDocument={handleUploadDocument}
        onCheckout={handleCheckout}
        onSubmit={handleSubmit}
        onRecordOfflinePayment={(itemId) => setOfflineItemId(itemId)}
      />

      <Modal open={offlineItemId != null} onClose={() => setOfflineItemId(null)}
        title={t('entry.offlineTitle')} size="sm" dismissOnEscape={!offlineBusy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOfflineItemId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={offlineBusy} loadingText={t('common.loading')}
              disabled={!offlineAmount || Number(offlineAmount) <= 0}
              onClick={() => void recordOffline()}>
              {t('entry.offlineTitle')}
            </Button>
          </>
        }>
        <div className="bcp-row">
          <label htmlFor="offline-amount">{t('entry.offlineAmount')}</label>
          <input id="offline-amount" type="number" min={0} step="0.01" value={offlineAmount}
            onChange={(e) => setOfflineAmount(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
