// Home page: definitions list — one row per workflow LINEAGE (not per
// version), an `Open` button that lands on whichever version is being
// worked on, and a click-through drawer that holds everything else. Route:
// `/`.
//
// Binding notes (task-6-brief.md, docs/superpowers/plans/2026-08-06-apexflow
// -plan2-interface-map.md §2, §8):
// - listDefinitions returns EVERY workflow_definition row (draft/published/
//   superseded) — `collapseLineages` (utils/lineage.ts) is what filters to
//   draft+published and folds each lineage's rows into one `LineageRow`;
//   superseded rows are historical and not actionable (api/designer.py's own
//   docstring: "frontend groups by definition_id into lineages").
// - A lineage that is both published AND drafted used to occupy two table
//   rows with different action sets. `collapseLineages` makes that
//   impossible: `LineageRow.published`/`.draft` hold at most one of each,
//   and the table's `Live` column renders both — the published version plus
//   a `vN draft` chip — in the one row. `primaryEntityId` (same module)
//   picks which version the row's single `Open` button lands on: the draft
//   wins, since on an authoring surface that's the version being worked on.
// - Everything the old `⋯` overflow menu held (deprecate/reactivate/archive/
//   unarchive, delete draft, new draft) now lives in `LineageDrawer`,
//   reached by clicking the row body. The drawer renders the lifecycle as a
//   ladder (utils/lifecycleLadder.ts) instead of a menu, so an illegal move
//   (e.g. Archive on an `active` lineage) shows greyed WITH ITS REASON
//   rather than being silently omitted. The drawer raises intent only —
//   every confirm modal, API call, toast, and reload stays here, keyed off
//   `drawerLineageId` (a definition_id, not a captured row) so the drawer
//   re-reads the freshly-collapsed row after every mutation instead of
//   showing a stale snapshot.
// - deprecate/reactivate/archive/unarchive all operate on the LINEAGE's
//   published row (app/workflows/definitions.py's `_require_published_row`
//   409s on any other status) — `handleLadderAction` resolves the ladder's
//   `entityId` back to that row's `LineageRow.published` entry.
// - "New draft from published" is now a single server-side action
//   (`api/designer.ts`'s `newDraft`, POST `.../actions {action: "new_draft"}`)
//   rather than a client-side bundle-fetch-and-copy: the one-draft-per-
//   lineage rule can only be enforced server-side, where two tabs open on
//   this list can't both see "no draft" and both create one. Hidden in the
//   drawer for an ARCHIVED lineage (`isArchived`, which covers both the
//   current "archived" value and the legacy "retired" one) — see
//   `LineageDrawer`'s own comment.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useToast } from '../hooks/useToast.ts';
import {
  ApiError,
  listDefinitions,
  lifecycleAction,
  newDraft,
} from '../api/designer.ts';
import { createEntity } from '../api/client.ts';
import type {
  DefinitionListEntry,
  DefinitionLifecycleAction,
} from '../types/designer.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { collapseLineages, primaryEntityId, type LineageRow } from '../utils/lineage.ts';
import type { RungAction } from '../utils/lifecycleLadder.ts';
import LineageDrawer from '../components/LineageDrawer.tsx';
import './DefinitionsPage.css';

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

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

  // At most one lineage can have a `new_draft` in flight at a time — the
  // drawer for a different row can't even be open while this one's open, so
  // this only ever needs to be a plain boolean, not a per-entity id.
  const [newDraftBusy, setNewDraftBusy] = useState(false);

  // Holds a `definition_id` rather than a `LineageRow` object, so the drawer
  // re-reads the freshly-collapsed row out of `lineageRows` after every
  // reload instead of rendering a snapshot captured before the action ran.
  const [drawerLineageId, setDrawerLineageId] = useState<string | null>(null);

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

  // One row per lineage — draft + published rows folded together, superseded
  // rows dropped (see module comment / utils/lineage.ts).
  const lineageRows = useMemo(() => collapseLineages(entries), [entries]);

  const lineageCount = lineageRows.length;
  const total = lineageRows.length;
  const pageRows = useMemo(
    () => lineageRows.slice((page - 1) * pageSize, page * pageSize),
    [lineageRows, page, pageSize],
  );

  const drawerRow = useMemo(
    () => lineageRows.find((r) => r.definition_id === drawerLineageId) ?? null,
    [lineageRows, drawerLineageId],
  );

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(1);
  }

  /**
   * Translated badge label for a raw backend enum value — `lineage_status`
   * and `health` are both wire values like "deprecated", never themselves
   * user-facing copy. Falls back to the raw value (not the untranslated
   * i18n key) if a value somehow isn't in the map, so an unexpected value
   * degrades to "shows the raw word" rather than "shows a literal
   * translation key like definitions.lineageStatus.foo".
   */
  function badgeLabel(prefix: 'lineageStatus' | 'health', value: string): string {
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

  async function handleNewDraft(entityId: string) {
    setNewDraftBusy(true);
    try {
      const created = await newDraft(tenantId, entityId);
      toast({
        message: t('definitions.newDraftToast').replace('{v}', String(created.version)),
        tone: 'success',
      });
      navigate(`/definitions/${created.entity_id}`);
    } catch (err) {
      // The two 409s the drawer's own gating should already prevent still
      // reach here from a stale view — a second tab that opened a draft since
      // this list loaded. Say which one it was rather than "try again".
      const reason =
        err instanceof ApiError
        && err.body
        && typeof err.body === 'object'
        && 'detail' in err.body
        && typeof (err.body as { detail?: unknown }).detail === 'object'
          ? ((err.body as { detail: { reason?: string } }).detail.reason)
          : undefined;
      const key =
        reason === 'draft_exists' ? 'definitions.newDraftDraftExists'
        : reason === 'lineage_archived' ? 'definitions.newDraftArchived'
        : 'definitions.newDraftError';
      toast({ message: t(key), tone: 'danger' });
      void load();
    } finally {
      setNewDraftBusy(false);
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

  /**
   * The drawer's ladder raises one of four actions against an `entityId` —
   * always the lineage's PUBLISHED row, per `LineageDrawer`'s own comment
   * (`_require_published_row` 409s on anything else). This resolves that id
   * back to the `LineageRow` holding it and routes to the same confirm-modal
   * state / unconfirmed-mutation paths the old per-row buttons used —
   * `archive` and `unarchive` keep their existing handling, `deprecate` and
   * `reactivate` share the confirm modal below via `lifecycleTarget`.
   */
  function handleLadderAction(entityId: string, action: RungAction) {
    const entry = lineageRows.find((r) => r.published?.entity_id === entityId)?.published;
    if (!entry) {
      // Only reachable from a stale drawer — the lineage's published row
      // moved or vanished (superseded, deleted) since this list loaded. A
      // silent no-op here would look like the button is simply broken;
      // reload and say so instead.
      toast({ message: t('definitions.lifecycleError'), tone: 'danger' });
      void load();
      return;
    }
    if (action === 'archive') { setRetireTarget(entry); return; }
    if (action === 'unarchive') { void handleUnarchive(entry); return; }
    setLifecycleTarget({ entry, action });
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
      // A never-published lineage's only row was this draft — after this
      // delete, `load()` will make its lineage disappear entirely. Close the
      // drawer now rather than leave it open on a row that's about to vanish.
      if (!lineageRows.find((r) => r.definition_id === deleteTarget.definition_id)?.published) {
        setDrawerLineageId(null);
      }
      void load();
    } catch (err) {
      toast({ message: errorMessage(err, 'definitions.deleteFailed'), tone: 'danger' });
    } finally {
      setDeleting(false);
    }
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
      // 409 left here is "lineage is not deprecated", which the drawer's
      // ladder already prevents (Archive renders greyed with a reason
      // outside `deprecated` — see `lifecycleLadder`'s `blockedReasonKey`).
      // Anything reaching this point is a stale view or a genuine failure,
      // and reads the same to the operator.
      toast({ message: errorMessage(err, 'definitions.lifecycleError'), tone: 'danger' });
      setRetireTarget(null);
    } finally {
      setRetiring(false);
    }
  }

  // --- Columns --------------------------------------------------------

  const columns: Column<LineageRow>[] = [
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
      // `status` (draft/published) is no longer a row property — a lineage can
      // be both at once — so it folds in here as a chip beside the live version.
      key: 'live',
      label: 'Live',
      i18nKey: 'definitions.columns.live',
      render: (row) => (
        <span className="definitions-live">
          {row.published ? `v${row.published.version}` : t('definitions.noPublished')}
          {row.draft ? (
            <StatusBadge
              status="draft"
              label={t('definitions.draftChip').replace('{v}', String(row.draft.version))}
            />
          ) : null}
        </span>
      ),
    },
    {
      key: 'lineage_status',
      label: 'Lineage',
      i18nKey: 'definitions.columns.lineageStatus',
      render: (row) => (
        <StatusBadge
          status={row.lineage_status}
          label={badgeLabel('lineageStatus', row.lineage_status)}
        />
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
          {t(row.channel_access === 'family'
            ? 'definitions.channel.family'
            : 'definitions.channel.staffOnly')}
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
   * Exactly one control per row, matching AdminDash's Students and Families
   * tables (row click opens a detail drawer; the row carries a single button).
   * Everything the old `⋯` menu held now lives in the drawer, where a blocked
   * lifecycle move can be shown WITH ITS REASON instead of silently omitted.
   */
  function rowActions(row: LineageRow) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => navigate(`/definitions/${primaryEntityId(row)}`)}
      >
        {t('definitions.actions.open')}
      </Button>
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

      <DataTable<LineageRow>
        columns={columns}
        data={pageRows}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        onPageChange={setPage}
        rowKey={(row) => row.definition_id}
        rowLabel={(row) => row.name}
        caption={t('definitions.title')}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        onPageSizeChange={handlePageSizeChange}
        selectable={false}
        rowActions={rowActions}
        onRowClick={(row) => setDrawerLineageId(row.definition_id)}
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

      {/*
       * Mounted here — BEFORE the four confirm Modals below, not after them —
       * on purpose. `Modal` renders its overlay inline at its own JSX
       * position rather than through a portal (ui/Modal.tsx), and every
       * overlay (drawer and dialog alike) shares one `--z-modal` value
       * (styles/theme.css), so with equal z-index it is DOM TREE ORDER that
       * decides which overlay's `inset: 0` catches a click. Every confirm
       * below is reachable only from a button inside this drawer, so if the
       * drawer were the LATER sibling, opening a confirm from it would still
       * leave the drawer painted on top: the confirm's own buttons would be
       * visually behind the drawer's overlay, and a click meant for
       * "Deprecate" would land on the drawer's backdrop instead and close
       * the drawer without ever calling the mutation. Mounting the drawer
       * first makes it the EARLIEST of the five overlays, so any confirm it
       * opens paints on top of it instead of under it.
       */}
      <LineageDrawer
        row={drawerRow}
        onClose={() => setDrawerLineageId(null)}
        onOpenEditor={(entityId) => navigate(`/definitions/${entityId}`)}
        onAction={handleLadderAction}
        onDeleteDraft={(entry) => setDeleteTarget(entry)}
        onNewDraft={(entityId) => void handleNewDraft(entityId)}
        busy={newDraftBusy || lifecycleBusy || retiring || deleting}
        newDraftBusy={newDraftBusy}
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
