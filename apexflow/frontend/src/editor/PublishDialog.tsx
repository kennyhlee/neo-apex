// Publish confirm flow (Task 10). Opened from EditorPage's header Publish
// button — the caller (EditorPage) is responsible for flushing any pending
// autosave BEFORE setting `open` true (see draftStore.ts's `flush`), so
// this dialog's own on-open `validateDefinition` call always reads the
// just-persisted row rather than a stale one still sitting in the 800ms
// autosave debounce.
//
// Binding notes (task-10-brief.md):
// - Re-runs `validateDefinition` on open (not just trusting the rail's
//   last-known state) — same error-string shapes, same rail-style rendering
//   (reuses `.inline-errors`, editor.css). Zero errors -> confirm state.
// - Version/lineage info ("publishing version N; will supersede version M")
//   comes from `listDefinitions` — the bundle/row shapes this dialog
//   otherwise uses carry no sibling-row info, so finding the lineage's
//   current published row (if any) means a second read alongside validate.
// - `publishDefinition` 409s with `{"errors": [...]}` under FastAPI's
//   `{"detail": ...}` wrapper (api/definitions.py's `publish_definition`;
//   verified against apexflow-backend's test_definitions_api.py:
//   `resp.json()["detail"]["errors"]`) when another editor's concurrent
//   change made the draft invalid between this dialog's own pre-check and
//   the actual publish call — rendered the same way as the pre-check
//   errors, dialog stays open, no navigation.
// - `family_url` is never on `DefinitionRow` (`publishDefinition`'s return
//   shape — machine/steps are still JSON strings there, and no family_url
//   field exists on it at all, api/definitions.py). The only place it's
//   ever computed is `listDefinitions`'s per-row `_family_url` (api/
//   designer.py) — so channel "family" success refetches the list and reads
//   it off the row matching this entity_id, same precedent
//   DefinitionsPage.tsx's channel column binds to.
// - Success -> close always navigates away (binding rule: simplest is
//   correct here, since a stayed-on published row's readOnly state would
//   otherwise need a live update this task doesn't otherwise need to solve).
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import { ApiError, listDefinitions, publishDefinition, validateDefinition } from '../api/designer.ts';
import type { ChannelAccess } from '../types/designer.ts';
import { Modal } from '../components/ui/Modal.tsx';
import { Button } from '../components/ui/Button.tsx';
import './editor.css';

type Stage = 'loading' | 'loadError' | 'blocked' | 'confirm' | 'publishError' | 'success';

interface PublishDialogProps {
  open: boolean;
  tenantId: string;
  entityId: string;
  definitionId: string;
  name: string;
  version: number;
  channelAccess: ChannelAccess;
  /** Dialog is closing WITHOUT a successful publish (cancel, backdrop, X,
   * Escape while not in the success stage). */
  onClose: () => void;
  /** Dialog is closing AFTER a successful publish — caller navigates away
   * (binding rule: always navigate on close once published). */
  onPublished: () => void;
}

/** `publish_definition`'s `HTTPException(409, {"errors": [...]})` — FastAPI
 * wraps any non-string `detail` under a top-level `"detail"` key, so the
 * parsed body is `{"detail": {"errors": [...]}}`. Returns null for any
 * other 409 shape or non-409 error (network failure, 404, ...), which the
 * caller falls back to a generic toast for. */
function extractPublishErrors(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body;
  if (!body || typeof body !== 'object' || !('detail' in body)) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object' || !('errors' in detail)) return null;
  const errors = (detail as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  return errors.filter((e): e is string => typeof e === 'string');
}

export default function PublishDialog({
  open,
  tenantId,
  entityId,
  definitionId,
  name,
  version,
  channelAccess,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [stage, setStage] = useState<Stage>('loading');
  const [errors, setErrors] = useState<string[]>([]);
  const [priorVersion, setPriorVersion] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [familyUrl, setFamilyUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-fetch validate + lineage info every time the dialog opens — never
  // trust whatever was true the last time it was open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // Reset + fetch inside the effect-local async function (not directly in
    // the effect body) — same shape as draftStore.ts's/DefinitionsPage.tsx's
    // own load effects, for the same reason (eslint-plugin-react-hooks'
    // set-state-in-effect rule).
    async function run() {
      setStage('loading');
      setErrors([]);
      setPriorVersion(null);
      setFamilyUrl(null);
      setCopied(false);
      try {
        const [validateResult, listResult] = await Promise.all([
          validateDefinition(tenantId, entityId),
          listDefinitions(tenantId),
        ]);
        if (cancelled) return;
        const priorPublished = listResult.definitions.find(
          (e) => e.definition_id === definitionId && e.status === 'published',
        );
        setPriorVersion(priorPublished ? priorPublished.version : null);
        if (validateResult.errors.length > 0) {
          setErrors(validateResult.errors);
          setStage('blocked');
        } else {
          setStage('confirm');
        }
      } catch {
        if (!cancelled) setStage('loadError');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, entityId, definitionId]);

  async function handleConfirm() {
    setPublishing(true);
    try {
      await publishDefinition(tenantId, entityId);
      if (channelAccess === 'family') {
        try {
          const listResult = await listDefinitions(tenantId);
          const publishedRow = listResult.definitions.find((e) => e.entity_id === entityId);
          setFamilyUrl(publishedRow?.family_url ?? null);
        } catch {
          setFamilyUrl(null);
        }
      }
      setStage('success');
    } catch (err) {
      const publishErrors = extractPublishErrors(err);
      if (publishErrors) {
        setErrors(publishErrors);
        setStage('publishError');
      } else {
        toast({ message: t('editor.publish.errorGeneric'), tone: 'danger' });
      }
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopy() {
    if (!familyUrl) return;
    try {
      await navigator.clipboard.writeText(familyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ message: t('editor.publish.copyError'), tone: 'danger' });
    }
  }

  function handleDialogClose() {
    if (stage === 'success') onPublished();
    else onClose();
  }

  const busy = stage === 'loading' || publishing;

  let body: ReactNode;
  let footer: ReactNode;

  if (stage === 'loading') {
    body = <p className="publish-dialog-status">{t('editor.publish.loading')}</p>;
    footer = (
      <Button variant="secondary" onClick={onClose}>
        {t('common.close')}
      </Button>
    );
  } else if (stage === 'loadError') {
    body = (
      <p className="publish-dialog-status publish-dialog-status-danger">{t('editor.publish.loadError')}</p>
    );
    footer = (
      <Button variant="secondary" onClick={onClose}>
        {t('common.close')}
      </Button>
    );
  } else if (stage === 'success') {
    body = (
      <div className="publish-dialog-success">
        <p>{t('editor.publish.successBody').replace('{name}', name).replace('{v}', String(version))}</p>
        {priorVersion !== null && (
          <p className="publish-dialog-status">
            {t('editor.publish.supersedeNote').replace('{v}', String(priorVersion))}
          </p>
        )}
        {channelAccess === 'family' && (
          <div className="publish-dialog-family">
            <label htmlFor="publish-dialog-family-url">{t('editor.publish.familyUrlLabel')}</label>
            {familyUrl ? (
              <div className="publish-dialog-family-row">
                <input
                  id="publish-dialog-family-url"
                  type="text"
                  readOnly
                  value={familyUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
                  {copied ? t('editor.publish.copied') : t('editor.publish.copyLink')}
                </Button>
              </div>
            ) : (
              <p className="publish-dialog-status">{t('editor.publish.familyUrlUnavailable')}</p>
            )}
          </div>
        )}
      </div>
    );
    footer = (
      <Button variant="primary" onClick={onPublished}>
        {t('editor.publish.done')}
      </Button>
    );
  } else {
    // blocked / confirm / publishError all share the version+lineage info.
    body = (
      <div className="publish-dialog-body">
        <p className="publish-dialog-version">
          {t('editor.publish.versionLabel').replace('{v}', String(version))}
        </p>
        {priorVersion !== null && (
          <p className="publish-dialog-status">
            {t('editor.publish.supersedeNote').replace('{v}', String(priorVersion))}
          </p>
        )}
        {(stage === 'blocked' || stage === 'publishError') && (
          <>
            <p className="publish-dialog-status publish-dialog-status-danger">
              {t('editor.publish.errorsHeading')}
            </p>
            <ul className="inline-errors">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={onClose} disabled={publishing}>
          {stage === 'confirm' ? t('common.cancel') : t('common.close')}
        </Button>
        {/* "blocked"/"publishError" (errors present) don't get a confirm
         * control — the dialog's job there is to show WHY publish can't
         * happen, not to offer a button that would just 409 again. */}
        {stage === 'confirm' && (
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            loading={publishing}
            loadingText={t('editor.publish.publishing')}
          >
            {t('editor.publish.confirmButton')}
          </Button>
        )}
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleDialogClose}
      title={t('editor.publish.dialogTitle')}
      size="sm"
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footer={footer}
    >
      {body}
    </Modal>
  );
}
