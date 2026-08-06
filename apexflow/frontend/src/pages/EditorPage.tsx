// Step editor page (Task 7) — loads the draft via `useDraftStore`, renders
// the ordered step list (`StepEditor`), a tab strip for Task 8's machine
// editor and Task 9's live preview pane, plus a right rail of validation
// errors. Route: `/definitions/:entityId`.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useDraftStore } from '../editor/draftStore.ts';
import StepEditor from '../editor/StepEditor.tsx';
import MachineEditor from '../editor/MachineEditor.tsx';
import PreviewPane from '../editor/PreviewPane.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import './EditorPage.css';

type EditorTab = 'steps' | 'machine' | 'preview';

export default function EditorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { entityId } = useParams<{ entityId: string }>();
  const tenantId = user?.tenant_id ?? '';
  const store = useDraftStore(tenantId, entityId);
  const [tab, setTab] = useState<EditorTab>('steps');

  if (store.loading) {
    return <p className="page-placeholder">{t('common.loading')}</p>;
  }

  // Task review fix #2: a row whose stored machine/steps JSON no longer
  // parses (`app/api/designer.py`'s `_parse_or_422`) is a DISTINCT,
  // recoverable state from a generic load failure — checked before
  // `loadError` since both leave `store.definition` null.
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

  return (
    <div className="editor-page">
      <header className="page-header">
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
        </div>
      </header>

      {def.status !== 'draft' && (
        <div className="editor-readonly-banner" role="status">
          {t('editor.readonlyBanner')}
        </div>
      )}

      <div className="editor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'steps'}
          className={`editor-tab${tab === 'steps' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('steps')}
        >
          {t('editor.tabs.steps')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'machine'}
          className={`editor-tab${tab === 'machine' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('machine')}
        >
          {t('editor.tabs.machine')}
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
          {tab === 'steps' && (
            <StepEditor
              steps={store.steps}
              onChange={store.setSteps}
              models={store.models}
              states={store.machine.states}
              errors={store.validation.errors}
              readOnly={store.readOnly}
            />
          )}
          {tab === 'machine' && (
            <MachineEditor
              tenantId={tenantId}
              machine={store.machine}
              onChange={store.setMachine}
              steps={store.steps}
              models={store.models}
              errors={store.validation.errors}
              readOnly={store.readOnly}
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
