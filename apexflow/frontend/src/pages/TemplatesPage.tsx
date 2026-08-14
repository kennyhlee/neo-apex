// Template gallery — browse shipped workflow templates, instantiate one as a
// tenant-owned draft. Route: `/templates`.
//
// Binding notes (task-6-brief.md, docs/superpowers/plans/2026-08-06-apexflow
// -plan2-interface-map.md §3/§8):
// - listTemplates() reads GET /api/workflows/{tenant_id}/templates — a
//   platform-wide catalog (currently a single entry, "enrollment"), not
//   tenant data.
// - "Use template" mints a NEW definition_id (DefinitionsPage.tsx's
//   slugify/uniqueSuffix precedent from Task 5 — duplicated here rather than
//   shared, matching that file's own choice not to export them) and writes a
//   version-1 DRAFT workflow_definition row via createEntity. machine/steps
//   are JSON.stringify'd at write time (map §3/§8: DataCore stores them as
//   JSON-encoded strings on the wire, not nested objects — same boundary
//   DefinitionsPage.tsx's submitNewWorkflow already draws).
// - Template updates never propagate (spec §3): the copy made here is
//   complete at instantiate time — the new draft row has no live link back
//   to the template it was seeded from.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useToast } from '../hooks/useToast.ts';
import { listTemplates } from '../api/designer.ts';
import { createEntity } from '../api/client.ts';
import type { TemplateCatalogEntry } from '../types/designer.ts';
import { Button } from '../components/ui/Button.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import './TemplatesPage.css';

/** Ported from DefinitionsPage.tsx's own (unexported) helper of the same
 * name — kept local rather than shared, matching that file's precedent. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'workflow';
}

/** Short, non-cryptographic uniqueness suffix — see DefinitionsPage.tsx's
 * identical helper doc comment for why collisions here are harmless. */
function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function TemplatesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const tenantId = user?.tenant_id ?? '';

  const [templates, setTemplates] = useState<TemplateCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [activeTemplate, setActiveTemplate] = useState<TemplateCatalogEntry | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [creating, setCreating] = useState(false);

  // `load` is the reusable reload path for the retry button. The mount
  // fetch below deliberately does NOT call it directly — same
  // effect-local-async-function reasoning as DefinitionsPage.tsx's `load`
  // doc comment (avoids eslint-plugin-react-hooks' set-state-in-effect rule
  // tripping on a useCallback reference used as an effect body).
  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await listTemplates(tenantId);
      setTemplates(res.templates);
    } catch {
      setLoadError(true);
      setTemplates([]);
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
        const res = await listTemplates(tenantId);
        if (!cancelled) setTemplates(res.templates);
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setTemplates([]);
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

  function openUseModal(template: TemplateCatalogEntry) {
    setActiveTemplate(template);
    setName(template.name);
    setNameError(false);
  }

  function closeUseModal() {
    if (creating) return;
    setActiveTemplate(null);
  }

  async function submitUseTemplate() {
    if (!activeTemplate) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setCreating(true);
    try {
      const { definition } = activeTemplate;
      const definitionId = `${slugify(trimmed)}-${uniqueSuffix()}`;
      const result = await createEntity(tenantId, 'workflow_definition', {
        definition_id: definitionId,
        name: trimmed,
        version: 1,
        status: 'draft',
        lineage_status: 'active',
        channel_access: definition.channel_access,
        machine: JSON.stringify(definition.machine),
        steps: JSON.stringify(definition.steps),
      });
      toast({ message: t('templates.useToast').replace('{name}', trimmed), tone: 'success' });
      setActiveTemplate(null);
      navigate(`/definitions/${result.entity_id}`);
    } catch {
      toast({ message: t('templates.useError'), tone: 'danger' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="templates-page">
      <header className="page-header">
        <h1 className="page-title">{t('templates.title')}</h1>
      </header>

      {loadError && (
        <div className="templates-error" role="alert">
          <span>{t('templates.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {loading && <p className="page-placeholder">{t('common.loading')}</p>}

      {!loading && !loadError && templates.length === 0 && (
        <p className="page-placeholder">{t('templates.empty')}</p>
      )}

      {!loading && templates.length > 0 && (
        <div className="templates-grid">
          {templates.map((tpl) => (
            <article className="template-card" key={tpl.template_id}>
              <h2 className="template-card-name">{tpl.name}</h2>
              <p className="template-card-description">{tpl.description}</p>
              <dl className="template-card-counts">
                <div className="template-card-count">
                  <dt>{t('templates.stepCount')}</dt>
                  <dd>{tpl.definition.steps.length}</dd>
                </div>
                <div className="template-card-count">
                  <dt>{t('templates.stateCount')}</dt>
                  <dd>{tpl.definition.machine.states.length}</dd>
                </div>
              </dl>
              {tpl.missing_models.length > 0 && (
                <p className="template-card-warning" role="note">
                  <strong>{t('templates.missingModelsBadge')}</strong>{' '}
                  {t('templates.missingModelsCard').replace(
                    '{models}',
                    tpl.missing_models.join(', '),
                  )}
                </p>
              )}
              <Button variant="primary" size="sm" onClick={() => openUseModal(tpl)}>
                {t('templates.useTemplate')}
              </Button>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={activeTemplate !== null}
        onClose={closeUseModal}
        title={t('templates.useModalTitle')}
        size="sm"
        dismissOnBackdrop={!creating}
        dismissOnEscape={!creating}
        footer={
          <>
            <Button variant="secondary" onClick={closeUseModal} disabled={creating}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitUseTemplate()}
              loading={creating}
              loadingText={t('templates.useCreating')}
            >
              {t('templates.useCreate')}
            </Button>
          </>
        }
      >
        {activeTemplate && activeTemplate.missing_models.length > 0 && (
          <p className="templates-dialog-warning" role="note">
            {t('templates.missingModelsDialog').replace(
              '{models}',
              activeTemplate.missing_models.join(', '),
            )}
          </p>
        )}
        <div className="templates-form-field">
          <label htmlFor="template-workflow-name">{t('templates.useNameLabel')}</label>
          <input
            id="template-workflow-name"
            type="text"
            value={name}
            placeholder={t('templates.useNamePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(false);
            }}
            autoFocus
          />
          {nameError && <p className="templates-field-error">{t('templates.useNameRequired')}</p>}
        </div>
      </Modal>
    </div>
  );
}
