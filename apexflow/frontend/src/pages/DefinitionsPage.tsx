// Home page: definitions list — lineages grouped (published + draft rows
// per lineage), lifecycle controls, and the two workflow-creation entry
// points (blank draft / from template). Route: `/`.
//
// Binding notes (task-5-brief.md, docs/superpowers/plans/2026-08-06-apexflow
// -plan2-interface-map.md §2, §8):
// - listDefinitions returns EVERY workflow_definition row (draft/published/
//   superseded) — this page filters to draft+published only; superseded
//   rows are historical and not actionable (api/designer.py's own docstring:
//   "frontend groups by definition_id into lineages").
// - v1 badge set is status/lineage_status/health ONLY — no new-fields hint.
// - deprecate/reactivate/archive/unarchive all operate on the LINEAGE's
//   published row
//   (app/workflows/definitions.py's `_require_published_row` 409s on any
//   other status) — those actions render only on published rows.
// - "New draft from published" is a generic-write copy: fetch the bundle
//   for the published row's machine/steps, then createEntity with the same
//   definition_id lineage, version + 1, status "draft". Matches the shape
//   `templates/enrollment.py`'s seed_enrollment_template and
//   scripts/apexflow-reseed-dev.py's push both write (map §3/§8): machine/
//   steps are JSON-encoded STRINGS on the wire, not nested objects.
//   Hidden for an ARCHIVED lineage (`isArchived`, which covers both the
//   current "archived" value and the legacy "retired" one): a new draft
//   copies `def.lineage_status` verbatim onto the new row, so a "New draft"
//   off an archived lineage would carry that status forward onto a fresh
//   draft. Unarchive first, then draft.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useToast } from '../hooks/useToast.ts';
import {
  ApiError,
  getBundle,
  listDefinitions,
  lifecycleAction,
} from '../api/designer.ts';
import { createEntity } from '../api/client.ts';
import { canArchive, isArchived } from '../types/designer.ts';
import type {
  DefinitionListEntry,
  DefinitionLifecycleAction,
} from '../types/designer.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import RowMenu, { type RowMenuItem } from '../components/RowMenu.tsx';
import './DefinitionsPage.css';

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

/** `active` sorts before `deprecated` sorts before `archived`. */
const STATUS_ORDER: Record<string, number> = { published: 0, draft: 1 };

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'workflow';
}

/** Short, non-cryptographic uniqueness suffix — collisions are harmless
 * here (DataCore assigns the real entity_id; definition_id is a lineage
 * label a person picked), just distinct enough that two "New workflow"
 * clicks with the same name don't collide within one session. */
function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

interface LifecycleTarget {
  entry: DefinitionListEntry;
  action: DefinitionLifecycleAction;
}

export default function DefinitionsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const tenantId = user?.tenant_id ?? '';

  const [entries, setEntries] = useState<DefinitionListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [newDraftBusyId, setNewDraftBusyId] = useState<string | null>(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNameError, setNewNameError] = useState(false);
  const [creatingBlank, setCreatingBlank] = useState(false);

  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const [retireTarget, setRetireTarget] = useState<DefinitionListEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DefinitionListEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [retiring, setRetiring] = useState(false);

  // `load` is the reusable reload path — called from the retry button and
  // after every mutation. The mount fetch below deliberately does NOT call
  // it directly: a useEffect whose body is (transitively) just "call this
  // memoized function that sets state" trips eslint-plugin-react-hooks'
  // set-state-in-effect rule (same reasoning as AuthContext.tsx's own
  // inlined checkStoredToken — an effect-local async function, not a
  // useCallback reference, keeps the fetch-on-mount an intentional
  // subscribe-to-an-external-system effect rather than a "call setState
  // during render" pattern the rule is trying to catch).
  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await listDefinitions(tenantId);
      setEntries(res.definitions);
    } catch {
      setLoadError(true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!tenantId) return;
      setLoading(true);
      setLoadError(false);
      try {
        const res = await listDefinitions(tenantId);
        if (!cancelled) setEntries(res.definitions);
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setEntries([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Draft + published rows only — superseded rows carry no live action and
  // clutter a page whose job is "what can I do right now" (binding rule).
  // Sort by lineage (definition_id), published row before its draft.
  const visibleRows = useMemo(() => {
    return entries
      .filter((e) => e.status === 'draft' || e.status === 'published')
      .slice()
      .sort((a, b) => {
        if (a.definition_id !== b.definition_id) {
          const an = a.name || a.definition_id;
          const bn = b.name || b.definition_id;
          return an.localeCompare(bn) || a.definition_id.localeCompare(b.definition_id);
        }
        return (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
      });
  }, [entries]);

  const lineageCount = useMemo(
    () => new Set(visibleRows.map((e) => e.definition_id)).size,
    [visibleRows],
  );

  const total = visibleRows.length;
  const pageRows = useMemo(
    () => visibleRows.slice((page - 1) * pageSize, page * pageSize),
    [visibleRows, page, pageSize],
  );

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(1);
  }

  /**
   * Translated badge label for a raw backend enum value — `status`,
   * `lineage_status`, and `health` are all wire values like "deprecated",
   * never themselves user-facing copy. Falls back to the raw value (not
   * the untranslated i18n key) if a value somehow isn't in the map, so an
   * unexpected value degrades to "shows the raw word" rather than "shows
   * a literal translation key like definitions.status.foo".
   */
  function badgeLabel(prefix: 'status' | 'lineageStatus' | 'health', value: string): string {
    const key = `definitions.${prefix}.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  }

  function errorMessage(err: unknown, fallbackKey: string): string {
    if (err instanceof ApiError && typeof err.body === 'string') return err.body;
    if (err instanceof ApiError && err.body && typeof err.body === 'object' && 'detail' in err.body) {
      const detail = (err.body as { detail?: unknown }).detail;
      if (typeof detail === 'string') return detail;
    }
    return t(fallbackKey);
  }


  // --- New workflow (blank draft) -------------------------------------

  function openNewModal() {
    setNewName('');
    setNewNameError(false);
    setShowNewModal(true);
  }

  async function submitNewWorkflow() {
    const name = newName.trim();
    if (!name) {
      setNewNameError(true);
      return;
    }
    setCreatingBlank(true);
    try {
      const definitionId = `${slugify(name)}-${uniqueSuffix()}`;
      const result = await createEntity(tenantId, 'workflow_definition', {
        definition_id: definitionId,
        name,
        version: 1,
        status: 'draft',
        lineage_status: 'active',
        channel_access: 'staff_only',
        // A new workflow starts as the SMALLEST VALID machine, not an empty
        // one. An empty machine ({states: [], transitions: []}) fails
        // validate.py's `_state_errors` immediately ("no initial state", "no
        // terminal state"), so the editor greeted every new workflow with a
        // red error rail before the author had done anything — and clicking
        // "Add state" made it worse, because a new state defaults to
        // `kind: 'active'` and adds "non-terminal but has no outgoing
        // transition" on top. This skeleton validates with ZERO errors; the
        // author renames, re-kinds, and re-wires it from a working starting
        // point instead of debugging a blank canvas.
        machine: JSON.stringify({
          states: [
            { state_id: 'draft', name: 'Draft', kind: 'initial' },
            { state_id: 'done', name: 'Done', kind: 'terminal' },
          ],
          transitions: [
            {
              transition_id: 'submit',
              from: 'draft',
              to: 'done',
              action: 'submit',
              actor: 'family',
              guards: [],
              effects: [],
            },
          ],
        }),
        steps: JSON.stringify([]),
      });
      setShowNewModal(false);
      navigate(`/definitions/${result.entity_id}`);
    } catch {
      toast({ message: t('definitions.newWorkflowError'), tone: 'danger' });
    } finally {
      setCreatingBlank(false);
    }
  }

  // --- New draft from published ----------------------------------------

  async function handleNewDraft(entry: DefinitionListEntry) {
    setNewDraftBusyId(entry.entity_id);
    try {
      const bundle = await getBundle(tenantId, entry.entity_id);
      const def = bundle.definition;
      // `def.version` is already coerced to a real number by getBundle
      // (see api/designer.ts / utils/numeric.ts) — DataCore's flattened row
      // would otherwise hand back the STRING "1", and "1" + 1 === "11" in
      // JS, silently corrupting every draft's version past the first.
      const nextVersion = def.version + 1;
      const result = await createEntity(tenantId, 'workflow_definition', {
        definition_id: def.definition_id,
        name: def.name,
        version: nextVersion,
        status: 'draft',
        lineage_status: def.lineage_status,
        channel_access: def.channel_access,
        machine: JSON.stringify(def.machine),
        steps: JSON.stringify(def.steps),
      });
      toast({
        message: t('definitions.newDraftToast').replace('{v}', String(nextVersion)),
        tone: 'success',
      });
      navigate(`/definitions/${result.entity_id}`);
    } catch {
      toast({ message: t('definitions.newDraftError'), tone: 'danger' });
    } finally {
      setNewDraftBusyId(null);
    }
  }

  // --- Deprecate / reactivate -------------------------------------------

  async function confirmLifecycleAction() {
    if (!lifecycleTarget) return;
    const { entry, action } = lifecycleTarget;
    setLifecycleBusy(true);
    try {
      await lifecycleAction(tenantId, entry.entity_id, action);
      setLifecycleTarget(null);
      const toastKey = action === 'deprecate' ? 'definitions.deprecateToast' : 'definitions.reactivateToast';
      toast({ message: t(toastKey).replace('{name}', entry.name), tone: 'success' });
      void load();
    } catch (err) {
      toast({ message: errorMessage(err, 'definitions.lifecycleError'), tone: 'danger' });
    } finally {
      setLifecycleBusy(false);
    }
  }

  // --- Archive ------------------------------------------------------------

  /** Unarchive is not gated and destroys nothing, so it needs no confirm. Its
   * toast says that frozen applications resumed, because that side effect is
   * invisible on this page and an operator would otherwise not know it
   * happened. */
  async function handleUnarchive(entry: DefinitionListEntry) {
    try {
      await lifecycleAction(tenantId, entry.entity_id, 'unarchive', {});
      toast({
        message: t('definitions.unarchiveToast').replace('{name}', entry.name),
        tone: 'success',
      });
      void load();
    } catch (err) {
      toast({ message: errorMessage(err, 'definitions.unarchiveFailed'), tone: 'danger' });
    }
  }

  /** Discarding an unwanted draft is an authoring action, so it lives here as
   * well as in AdminDash. Only `draft` rows are deletable — the backend's
   * `delete_definition` 409s on published/superseded, since a superseded row
   * is the pinned definition for every instance still running on it. */
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await lifecycleAction(tenantId, deleteTarget.entity_id, 'delete');
      toast({
        message: t('definitions.deleteToast').replace('{name}', deleteTarget.name),
        tone: 'success',
      });
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast({ message: errorMessage(err, 'definitions.deleteFailed'), tone: 'danger' });
    } finally {
      setDeleting(false);
    }
  }

  function openRetireModal(entry: DefinitionListEntry) {
    setRetireTarget(entry);
  }

  async function confirmRetire() {
    if (!retireTarget) return;
    setRetiring(true);
    try {
      await lifecycleAction(tenantId, retireTarget.entity_id, 'archive');
      toast({
        message: t('definitions.retireToast').replace('{name}', retireTarget.name),
        tone: 'success',
      });
      setRetireTarget(null);
      void load();
    } catch (err) {
      // Archiving no longer refuses on open work — it freezes it — so the only
      // 409 left here is "lineage is not deprecated", which the row actions
      // already prevent. Anything reaching this point is a stale view or a
      // genuine failure, and reads the same to the operator.
      toast({ message: errorMessage(err, 'definitions.lifecycleError'), tone: 'danger' });
      setRetireTarget(null);
    } finally {
      setRetiring(false);
    }
  }

  // --- Columns --------------------------------------------------------

  const columns: Column<DefinitionListEntry>[] = [
    {
      key: 'name',
      label: 'Name',
      i18nKey: 'definitions.columns.name',
      primary: true,
      render: (row) => <span className="definitions-name">{row.name}</span>,
    },
    {
      key: 'definition_id',
      label: 'Workflow ID',
      i18nKey: 'definitions.columns.definitionId',
      render: (row) => <code className="definitions-lineage-id">{row.definition_id}</code>,
    },
    {
      key: 'version',
      label: 'Version',
      i18nKey: 'definitions.columns.version',
      numeric: true,
      render: (row) => <>v{row.version}</>,
    },
    {
      key: 'status',
      label: 'Status',
      i18nKey: 'definitions.columns.status',
      render: (row) => <StatusBadge status={row.status} label={badgeLabel('status', row.status)} />,
    },
    {
      key: 'lineage_status',
      label: 'Lineage',
      i18nKey: 'definitions.columns.lineageStatus',
      render: (row) => (
        <StatusBadge status={row.lineage_status} label={badgeLabel('lineageStatus', row.lineage_status)} />
      ),
    },
    {
      key: 'health',
      label: 'Health',
      i18nKey: 'definitions.columns.health',
      render: (row) => <StatusBadge status={row.health} label={badgeLabel('health', row.health)} />,
    },
    {
      key: 'open_instances',
      label: 'Open instances',
      i18nKey: 'definitions.columns.openInstances',
      numeric: true,
      render: (row) => <>{row.open_instances}</>,
    },
    {
      key: 'channel_access',
      label: 'Channel',
      i18nKey: 'definitions.columns.channel',
      render: (row) => (
        <span className="definitions-channel">
          {t(row.channel_access === 'family' ? 'definitions.channel.family' : 'definitions.channel.staffOnly')}
          {row.family_url ? (
            <a
              className="definitions-family-link"
              href={row.family_url}
              target="_blank"
              rel="noreferrer"
              aria-label={t('definitions.channel.familyLinkLabel')}
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          ) : null}
        </span>
      ),
    },
  ];

  /**
   * One visible action per row plus an overflow menu.
   *
   * Every lifecycle control used to render as its own button, so a published
   * row showed three similar-weight controls and the one an author actually
   * reaches for — open the editor, or start the next version — competed with
   * deprecate and archive. The common action stays a button; the rest move
   * into the menu, destructive ones last.
   */
  function rowActions(row: DefinitionListEntry) {
    if (row.status === 'draft') {
      return (
        <div className="definitions-row-actions">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/definitions/${row.entity_id}`)}>
            {t('definitions.actions.openEditor')}
          </Button>
          <RowMenu
            label={t('definitions.actions.moreFor').replace('{name}', row.name)}
            items={[{
              key: 'delete',
              label: t('definitions.actions.delete'),
              danger: true,
              onSelect: () => setDeleteTarget(row),
            }]}
          />
        </div>
      );
    }

    // Published row. Lifecycle is gated on lineage_status exactly as the
    // backend gates it (see module comment).
    const menu: RowMenuItem[] = [];
    if (row.lineage_status === 'active') {
      menu.push({
        key: 'deprecate',
        label: t('definitions.actions.deprecate'),
        onSelect: () => setLifecycleTarget({ entry: row, action: 'deprecate' }),
      });
    }
    if (row.lineage_status === 'deprecated') {
      menu.push({
        key: 'reactivate',
        label: t('definitions.actions.reactivate'),
        onSelect: () => setLifecycleTarget({ entry: row, action: 'reactivate' }),
      });
    }
    if (canArchive(row.lineage_status)) {
      menu.push({
        key: 'archive',
        label: t('definitions.actions.retire'),
        danger: true,
        onSelect: () => openRetireModal(row),
      });
    }
    if (isArchived(row.lineage_status)) {
      menu.push({
        key: 'unarchive',
        label: t('definitions.actions.unarchive'),
        onSelect: () => { void handleUnarchive(row); },
      });
    }

    return (
      <div className="definitions-row-actions">
        {!isArchived(row.lineage_status) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleNewDraft(row)}
            loading={newDraftBusyId === row.entity_id}
            loadingText={t('definitions.newDraftCreating')}
          >
            {t('definitions.actions.newDraft')}
          </Button>
        )}
        <RowMenu
          label={t('definitions.actions.moreFor').replace('{name}', row.name)}
          items={menu}
        />
      </div>
    );
  }

  const lifecycleModalOpen = lifecycleTarget !== null;
  const isDeprecate = lifecycleTarget?.action === 'deprecate';

  return (
    <div className="definitions-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('definitions.title')}
          <span className="page-subtitle">
            {t('definitions.lineageCount').replace('{n}', String(lineageCount))}
          </span>
        </h1>
        <div className="page-header-actions">
          <Button variant="secondary" onClick={() => navigate('/templates')}>
            {t('definitions.fromTemplate')}
          </Button>
          <Button variant="primary" onClick={openNewModal}>
            {t('definitions.newWorkflow')}
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="definitions-error" role="alert">
          <span>{t('definitions.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <DataTable<DefinitionListEntry>
        columns={columns}
        data={pageRows}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        onPageChange={setPage}
        rowKey={(row) => row.entity_id}
        rowLabel={(row) => `${row.name} v${row.version}`}
        caption={t('definitions.title')}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        onPageSizeChange={handlePageSizeChange}
        selectable={false}
        rowActions={rowActions}
        emptyState={{
          title: t('definitions.emptyTitle'),
          description: t('definitions.emptyBody'),
          action: (
            <Button variant="primary" onClick={openNewModal}>
              {t('definitions.newWorkflow')}
            </Button>
          ),
        }}
      />

      {/* New workflow (blank draft) */}
      <Modal
        open={showNewModal}
        onClose={() => (!creatingBlank ? setShowNewModal(false) : undefined)}
        title={t('definitions.newWorkflowModalTitle')}
        size="sm"
        dismissOnBackdrop={!creatingBlank}
        dismissOnEscape={!creatingBlank}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNewModal(false)} disabled={creatingBlank}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitNewWorkflow()}
              loading={creatingBlank}
              loadingText={t('definitions.newWorkflowCreating')}
            >
              {t('definitions.newWorkflowCreate')}
            </Button>
          </>
        }
      >
        <div className="definitions-form-field">
          <label htmlFor="new-workflow-name">{t('definitions.newWorkflowNameLabel')}</label>
          <input
            id="new-workflow-name"
            type="text"
            value={newName}
            placeholder={t('definitions.newWorkflowNamePlaceholder')}
            onChange={(e) => {
              setNewName(e.target.value);
              if (newNameError) setNewNameError(false);
            }}
            autoFocus
          />
          {newNameError && (
            <p className="definitions-field-error">{t('definitions.newWorkflowNameRequired')}</p>
          )}
        </div>
      </Modal>

      {/* Deprecate / reactivate confirm */}
      <Modal
        open={lifecycleModalOpen}
        onClose={() => (!lifecycleBusy ? setLifecycleTarget(null) : undefined)}
        title={t(isDeprecate ? 'definitions.deprecateConfirmTitle' : 'definitions.reactivateConfirmTitle')}
        size="sm"
        dismissOnBackdrop={!lifecycleBusy}
        dismissOnEscape={!lifecycleBusy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLifecycleTarget(null)} disabled={lifecycleBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={isDeprecate ? 'danger' : 'primary'}
              onClick={() => void confirmLifecycleAction()}
              loading={lifecycleBusy}
            >
              {t(isDeprecate ? 'definitions.actions.deprecate' : 'definitions.actions.reactivate')}
            </Button>
          </>
        }
      >
        <p>
          {t(isDeprecate ? 'definitions.deprecateConfirmBody' : 'definitions.reactivateConfirmBody').replace(
            '{name}',
            lifecycleTarget?.entry.name ?? '',
          )}
        </p>
      </Modal>

      {/* Retire */}
      <Modal
        open={retireTarget !== null}
        onClose={() => (!retiring ? setRetireTarget(null) : undefined)}
        title={t('definitions.retireConfirmTitle')}
        size="sm"
        dismissOnBackdrop={!retiring}
        dismissOnEscape={!retiring}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRetireTarget(null)} disabled={retiring}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmRetire()}
              loading={retiring}
              loadingText={t('definitions.retiring')}
            >
              {t('definitions.retireConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('definitions.retireConfirmBody')}</p>
        {retireTarget && retireTarget.open_instances > 0 && (
          <p className="definitions-retire-warning">
            {t('definitions.archiveFreezes').replace('{n}', String(retireTarget.open_instances))}
          </p>
        )}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => (!deleting ? setDeleteTarget(null) : undefined)}
        title={t('definitions.deleteConfirmTitle')}
        subtitle={deleteTarget?.name}
        dismissOnBackdrop={!deleting}
        dismissOnEscape={!deleting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmDelete()}
              loading={deleting}
              loadingText={t('definitions.deleting')}
            >
              {t('definitions.actions.delete')}
            </Button>
          </>
        }
      >
        <p>{t('definitions.deleteConfirmBody')}</p>
      </Modal>
    </div>
  );
}
