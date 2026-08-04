import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { postQuery } from '../api/client.ts';
import type { ProgramRow } from '../types/registration.ts';
import { translateOr } from '../utils/format.ts';
import { toLabel, toToneKey } from '../utils/listValue.ts';
import Button from '../components/ui/Button.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ProgramsPage.css';

/**
 * Builder entry point: one card per active program, each linking to its
 * per-program Flow Builder route (`/programs/:programId/flow`, Task 7).
 *
 * SQL: `SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'`
 * — both predicate fields are DataCore system columns written across every
 * entity type (not single-writer), so this is safe under the binder-error
 * rule. `SELECT *` (rather than naming `capacity`/`description`/etc.) avoids
 * selecting any program-only custom field that a tenant with zero programs
 * might not have as a column yet.
 */
export default function ProgramsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const res = await postQuery(
        tenant,
        'entities',
        "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'",
      );
      setPrograms(res.data as unknown as ProgramRow[]);
      setError(null);
    } catch {
      setError(t('programs.loadError'));
    } finally {
      setLoading(false);
    }
  }, [tenant, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="programs-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('programs.title')}
          <span className="page-subtitle">{programs.length} {t('common.records')}</span>
        </h1>
      </header>

      {error && (
        <div className="programs-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {loading && <p className="programs-muted">{t('common.loading')}</p>}

      {!loading && !error && programs.length === 0 && (
        <p className="programs-muted">{t('programs.empty')}</p>
      )}

      <ul className="programs-list">
        {programs.map((p) => (
          <li key={p.entity_id} className="program-card">
            <div className="program-card-info">
              <strong>{p.name}</strong>
              {p.description && <p>{p.description}</p>}
              <div className="program-card-meta">
                {/* Same untranslated-raw-value problem as the payment badge.
                    A program's status is model-definition-driven and so
                    tenant-defined — no fixed key set can cover it — hence
                    `translateOr`, which translates the values enrollx knows
                    and leaves anything else exactly as it renders today. */}
                <StatusBadge status={p.status}
                  label={translateOr(t, `programStatus.${toToneKey(p.status)}`,
                    toLabel(p.status, ''))} />
                {p.capacity != null && String(p.capacity) !== '' && (
                  <span>{t('programs.capacity')}: {String(p.capacity)}</span>
                )}
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => navigate(`/programs/${p.program_id}/flow`)}
            >
              {t('programs.designFlow')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
