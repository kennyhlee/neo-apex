// Step editor page (Task 7) — loads the draft via `useDraftStore`, renders
// the ordered step list (`StepEditor`), a tab strip for Task 8's machine
// editor and Task 9's live preview pane, plus a right rail of validation
// errors. Route: `/definitions/:entityId`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useToast } from '../hooks/useToast.ts';
import { useDraftStore } from '../editor/draftStore.ts';
import StageEditor from '../editor/StageEditor.tsx';
import FlowView from '../editor/flow/FlowView.tsx';
import { revealStage } from '../editor/flow/revealStage.ts';
import { readStageModel } from '../editor/stage/read.ts';
import PreviewPane from '../editor/PreviewPane.tsx';
import PublishDialog from '../editor/PublishDialog.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { lifecycleAction } from '../api/designer.ts';
import {
  createBridgeApply,
  registerEditorBridge,
  unregisterEditorBridge,
} from '../chat/editorBridge.ts';
import type { ChannelAccess } from '../types/designer.ts';
import './EditorPage.css';

type EditorTab = 'stages' | 'flow' | 'preview';

const EDITOR_TABS: EditorTab[] = ['stages', 'flow', 'preview'];
const DEFAULT_TAB: EditorTab = 'stages';

/** The open tab lives in `?view=`, not in component state.
 *
 * That is what lets the assistant's flow card — rendered in a drawer mounted
 * OUTSIDE the router — open the Flow tab: it just navigates. Deriving the tab
 * from the URL rather than syncing state to it also means there is no effect
 * to write, no param to strip afterwards, and no window in which the two
 * disagree. Reloading or sharing the link keeps the tab, which is a plain
 * improvement over the state version.
 *
 * An unknown or absent value is the default tab, so a hand-edited URL cannot
 * render a blank pane.
 */
function tabFromParam(value: string | null): EditorTab {
  return EDITOR_TABS.includes(value as EditorTab) ? (value as EditorTab) : DEFAULT_TAB;
}

export default function EditorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { entityId } = useParams<{ entityId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = user?.tenant_id ?? '';
  const store = useDraftStore(tenantId, entityId);
  const tab = tabFromParam(searchParams.get('view'));
  // `replace` so flipping between tabs does not fill the back button with
  // steps inside one page.
  const setTab = useCallback(
    (next: EditorTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === DEFAULT_TAB) params.delete('view');
          else params.set('view', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // A stage the reader picked in the Flow tab. It cannot be revealed at click
  // time: the Stages tab is unmounted at that moment, so the card does not
  // exist yet. Parked here until the tab switch renders it.
  //
  // A ref, not state: this is a one-shot instruction to the DOM, and nothing
  // renders differently because of it. Holding it in state would mean
  // clearing it from inside an effect, which is the cascading-render pattern
  // `react-hooks/set-state-in-effect` exists to stop.
  const pendingStageRef = useRef<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);

  async function handleOpenPublish() {
    // Task 10 binding rule: flush any pending autosave before opening the
    // dialog, so its own on-open validate/lineage fetch reads the
    // just-persisted draft rather than one still sitting in the debounce
    // window. `flush()` rejects (review fix, minor) if an in-flight save
    // doesn't finish within its bounded wait — surface that instead of
    // leaving the button stuck mid-click.
    setPublishBusy(true);
    try {
      await store.flush();
      setShowPublishDialog(true);
    } catch {
      toast({ message: t('editor.publish.flushTimeout'), tone: 'danger' });
    } finally {
      setPublishBusy(false);
    }
  }

  /* Second half of the Flow -> Stages jump. Keyed on `tab` because the click
     that parks a stage id ALSO switches the tab, so this runs exactly once
     per jump, after the Stages tab has mounted and the card exists.

     The request is cleared whether or not the card was found: a stage that
     is missing at this point has been deleted, and retrying on some later
     render would scroll the page out from under whatever the author had
     started doing instead. */
  useEffect(() => {
    const stageId = pendingStageRef.current;
    if (!stageId || tab !== 'stages') return;
    pendingStageRef.current = null;
    revealStage(stageId);
  }, [tab]);

  /* Unsaved edits now live only in this browser, so closing the tab is a real
     way to lose them. The localStorage mirror means they are recoverable, but
     a warning is still owed — recovery is a safety net, not a plan. */
  useEffect(() => {
    if (!store.dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store.dirty]);

  /* The assistant drawer is mounted outside the routed tree (App.tsx), so a
     patch proposal has no React path to this page's draft store. Publish a
     handle to it instead — `src/chat/editorBridge.ts` explains the registry.

     RE-REGISTERING ON EVERY CHANGE is the point of the dep list, not a
     nicety: `apply` closes over `store.machine`/`store.steps`, so a handle
     registered once at mount would patch the draft as it looked when the
     editor opened and throw away every edit made since. `readOnly` is in
     there for the same reason — a row published in another tab must stop
     accepting patches without a reload.

     Registration is gated on the loaded definition BEING THE ONE `entityId`
     names, not merely on there being a definition. Navigating from draft A to
     draft B re-runs this effect with B's id while the store still holds A's
     definition, machine, steps and readOnly (it clears none of them until the
     load resolves) — so a `definition`-only gate publishes a handle labelled B
     that writes A's machine. Apply in that window edits the old draft, gets
     overwritten by the incoming load, and reports success; draft -> published
     also leaves `readOnly: false` registered for a row that cannot be saved.
     `!loading` covers the same window from the other side (`reload()` keeps
     the old definition object while it refetches). */
  const {
    definition: bridgeDefinition,
    readOnly: bridgeReadOnly,
    machine: bridgeMachine,
    steps: bridgeSteps,
    loading: bridgeLoading,
    setMachine,
    setSteps,
    setChannelAccess,
  } = store;
  useEffect(() => {
    if (!entityId || bridgeLoading) return;
    if (!bridgeDefinition || bridgeDefinition.entity_id !== entityId) return;
    registerEditorBridge({
      entityId,
      readOnly: bridgeReadOnly,
      // The apply semantics (read-only refused rather than silently no-oped,
      // all-or-nothing, channel access only when the patch set it) live in
      // `createBridgeApply` so they are testable without a component harness.
      // Closes over this effect's machine/steps, and the effect re-runs on
      // every change to either — so the flow card always draws the draft as
      // it stands, unsaved edits included.
      read: () => ({ machine: bridgeMachine, steps: bridgeSteps }),
      apply: createBridgeApply({
        machine: bridgeMachine,
        steps: bridgeSteps,
        readOnly: bridgeReadOnly,
        readOnlyMessage: t('assistant.readOnly'),
        setMachine,
        setSteps,
        setChannelAccess,
      }),
    });
    return () => unregisterEditorBridge(entityId);
  }, [
    entityId,
    bridgeDefinition,
    bridgeReadOnly,
    bridgeMachine,
    bridgeSteps,
    bridgeLoading,
    t,
    // Stable `useCallback`s from the store — destructured (rather than read as
    // `store.setMachine` inside the effect) so exhaustive-deps can see each
    // value individually instead of demanding the whole `store` object, which
    // is a new identity on every render and would re-register on every one.
    setMachine,
    setSteps,
    setChannelAccess,
  ]);

  if (store.loading) {
    return <p className="page-placeholder">{t('common.loading')}</p>;
  }

  // Task review fix #2: a row whose stored machine/steps JSON no longer
  // parses (`app/api/designer.py`'s `_parse_or_422`) is a DISTINCT,
  // recoverable state from a generic load failure — checked before
  // `loadError` since both leave `store.definition` null.
  //
  // Task 13 (Plan 2 follow-up item 8): this full-page hijack only fires for
  // a DIRECT load failure (genuinely corrupt row, or `store.reload()`) or a
  // background validate whose local in-memory state is ALSO unparseable —
  // `draftStore`'s `runValidate` routes a background 422 with valid local
  // state to `staleParseWarning` instead (rendered as a dismissable inline
  // banner further below), since the user's in-progress edits are fine and
  // will overwrite the stale/bad row on the next autosave.
  if (store.parseError) {
    return (
      <div className="editor-parse-error" role="alert">
        <h1 className="page-title">{t('editor.draftInvalid.heading')}</h1>
        <p>{t('editor.draftInvalid.body')}</p>
        <pre className="editor-parse-error-detail">{store.parseError}</pre>
        <Button variant="secondary" size="sm" onClick={() => void store.reload()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (store.loadError || !store.definition) {
    return (
      <div className="editor-load-error" role="alert">
        <span>{t('editor.loadError')}</span>
        <Button variant="secondary" size="sm" onClick={() => void store.reload()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const def = store.definition;
  const saveLabel = store.saveError
    ? t('editor.save.error')
    : store.saving
      ? t('editor.save.saving')
      : store.dirty
        ? t('editor.save.dirty')
        : store.savedAt
          ? t('editor.save.saved')
          : null;

  /**
   * Leave the editor. Always available — "cancel" means "I am done here
   * without saving", which is just as meaningful when nothing has changed.
   * Being dirty only decides whether the exit is guarded.
   *
   * Goes to the workflow list rather than `navigate(-1)`: history could lead
   * anywhere (a deep link, another tab's referrer, or straight out of the app),
   * and an exit that lands somewhere unpredictable is worse than one that is
   * always the same place.
   */
  function leaveEditor() {
    if (store.dirty) { setShowCancel(true); return; }
    navigate('/');
  }

  /** Confirmed exit: drop the unsaved edits (and the local mirror with them),
   * then leave. Costs nothing — those edits only ever lived in this browser. */
  function discardAndLeave() {
    store.cancel();
    setShowCancel(false);
    navigate('/');
  }


  async function handleSave() {
    try {
      await store.save();
      toast({ message: t('editor.save.toast'), tone: 'success' });
    } catch {
      toast({ message: t('editor.save.error'), tone: 'danger' });
    }
  }

  /**
   * Cancel out of workflow creation.
   *
   * Both creation paths (blank and from-template) persist the draft BEFORE
   * navigating here, so "cancel" cannot just navigate away — that leaves an
   * orphan draft the author never wanted. Discard deletes the row and returns
   * to the list. Draft-only, matching `delete_definition`'s own gate: a
   * published or superseded row 409s, and a superseded one is the pinned
   * definition for every instance still running on it.
   */
  async function handleDiscard() {
    if (!entityId) return;
    setDiscarding(true);
    try {
      await lifecycleAction(tenantId, entityId, 'delete');
      toast({ message: t('editor.deleteToast'), tone: 'success' });
      navigate('/');
    } catch {
      toast({ message: t('editor.deleteFailed'), tone: 'danger' });
      setDiscarding(false);
    }
  }

  return (
    <div className="editor-page">
      {store.recovered && (
        <div className="editor-recovered" role="status">
          <span>
            {t('editor.recovered.body').replace(
              '{when}',
              new Date(store.recovered.at).toLocaleString(),
            )}
          </span>
          <Button variant="secondary" size="sm" onClick={store.applyRecovered}>
            {t('editor.recovered.restore')}
          </Button>
          <Button variant="ghost" size="sm" onClick={store.discardRecovered}>
            {t('editor.recovered.discard')}
          </Button>
        </div>
      )}

      <header className="page-header">
        {/* The editor had no exit at all: creation persists the draft then
            drops you here, so without this the only way out was the global
            nav or the browser back button. */}
        {/* Shares leaveEditor so this cannot become an unguarded way past the
            unsaved-changes warning. Left a <Link> rather than a <button> so
            middle-click and open-in-new-tab still work — those open a second
            tab and leave this one's unsaved state untouched, so they need no
            guard. */}
        <Link
          className="editor-back-link"
          to="/"
          onClick={(e) => { e.preventDefault(); leaveEditor(); }}
        >
          {t('editor.backToWorkflows')}
        </Link>
        <h1 className="page-title">
          {def.name}
          <span className="page-subtitle">{t('editor.versionLabel').replace('{v}', String(def.version))}</span>
        </h1>
        <div className="editor-header-badges">
          <StatusBadge status={def.status} label={t(`definitions.status.${def.status}`)} />
          {store.validation.health && (
            <StatusBadge
              status={store.validation.health}
              label={t(`definitions.health.${store.validation.health}`)}
            />
          )}
          {saveLabel && (
            <span
              className={`editor-save-indicator${store.saveError ? ' editor-save-indicator-error' : ''}`}
              role="status"
            >
              {saveLabel}
            </span>
          )}
          {def.status === 'draft' && (
            <>
              <label className="editor-channel-select">
                {t('editor.channelAccess.label')}
                <select
                  value={def.channel_access}
                  disabled={store.readOnly}
                  onChange={(e) => store.setChannelAccess(e.target.value as ChannelAccess)}
                >
                  <option value="staff_only">{t('definitions.channel.staffOnly')}</option>
                  <option value="family">{t('definitions.channel.family')}</option>
                </select>
              </label>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSave()}
                disabled={!store.dirty || store.saving || publishBusy}
                loading={store.saving}
                loadingText={t('editor.save.saving')}
              >
                {t('editor.save.button')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={leaveEditor}
                disabled={store.saving || publishBusy}
              >
                {t('editor.cancel.button')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDiscard(true)}
                disabled={store.saving || publishBusy}
              >
                {t('editor.delete.button')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleOpenPublish()}
                disabled={store.saving || publishBusy}
                loading={publishBusy}
                loadingText={t('editor.publish.preparing')}
              >
                {t('editor.publish.button')}
              </Button>
            </>
          )}
        </div>
      </header>

      <Modal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        title={t('editor.cancel.title')}
        subtitle={def.name}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCancel(false)}>
              {t('editor.cancel.keep')}
            </Button>
            <Button variant="danger" onClick={discardAndLeave}>
              {t('editor.cancel.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('editor.cancel.body')}</p>
      </Modal>

      <Modal
        open={showDiscard}
        onClose={() => (!discarding ? setShowDiscard(false) : undefined)}
        title={t('editor.delete.title')}
        subtitle={def.name}
        size="sm"
        dismissOnBackdrop={!discarding}
        dismissOnEscape={!discarding}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDiscard(false)} disabled={discarding}>
              {t('editor.delete.keep')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleDiscard()}
              loading={discarding}
              loadingText={t('editor.delete.deleting')}
            >
              {t('editor.delete.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('editor.delete.body')}</p>
      </Modal>

      {def.status === 'draft' && (
        <PublishDialog
          open={showPublishDialog}
          tenantId={tenantId}
          entityId={def.entity_id}
          definitionId={def.definition_id}
          name={def.name}
          version={def.version}
          channelAccess={def.channel_access}
          onClose={() => setShowPublishDialog(false)}
          onPublished={() => navigate('/')}
        />
      )}

      {def.status !== 'draft' && (
        <div className="editor-readonly-banner" role="status">
          {t('editor.readonlyBanner')}
        </div>
      )}

      {store.staleParseWarning && (
        <div className="editor-stale-parse-banner" role="alert">
          <span>{t('editor.staleParseWarning.body')}</span>
          <button
            type="button"
            className="editor-stale-parse-banner-dismiss"
            onClick={store.dismissStaleParseWarning}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
      )}

      <div className="editor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'stages'}
          className={`editor-tab${tab === 'stages' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('stages')}
        >
          {t('editor.tabs.stages')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'flow'}
          className={`editor-tab${tab === 'flow' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('flow')}
        >
          {t('editor.tabs.flow')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={`editor-tab${tab === 'preview' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('preview')}
        >
          {t('editor.tabs.preview')}
        </button>
      </div>

      <div className="editor-layout">
        <div className="editor-main" role="tabpanel">
          {tab === 'stages' && (
            <StageEditor
              tenantId={tenantId}
              machine={store.machine}
              steps={store.steps}
              models={store.models}
              errors={store.validation.errors}
              readOnly={store.readOnly}
              onMachineChange={store.setMachine}
              onStepsChange={store.setSteps}
            />
          )}
          {tab === 'flow' && (
            <FlowView
              // Read from the SAME in-memory machine the Stages tab edits, so
              // the drawing reflects unsaved work rather than the last saved
              // row. Recomputed per render like StageEditor's own read —
              // `readStageModel` is pure and cheap next to a re-render.
              model={readStageModel(store.machine, store.steps)}
              onSelectStage={(stageId) => {
                pendingStageRef.current = stageId;
                setTab('stages');
              }}
            />
          )}
          {tab === 'preview' && (
            <PreviewPane steps={store.steps} machine={store.machine} models={store.models} />
          )}
        </div>

        <aside className="editor-rail">
          <h2 className="editor-rail-heading">{t('editor.rail.heading')}</h2>
          {store.validation.validating && <p className="editor-rail-validating">{t('editor.rail.validating')}</p>}
          {store.validation.errors.length === 0 ? (
            <p className="editor-rail-empty">{t('editor.rail.noIssues')}</p>
          ) : (
            <ul className="editor-rail-errors">
              {store.validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
