// enrollx/frontend/src/pages/NewApplicationPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { postQuery } from '../api/client.ts';
import { createApplication } from '../api/registration.ts';
import type { ProgramRow } from '../types/registration.ts';
import Button from '../components/ui/Button.tsx';
import './ProgramsPage.css';

function defaultSchoolYear(): string {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/**
 * Staff-assisted entry, step 1: pick a program and school year, optionally
 * record the parent's email, then create the application on the "admin"
 * channel (spec §6). Creation lands on `ApplicationEntryPage` to fill in the
 * rest.
 *
 * SQL: `entity_type = 'program' AND _status = 'active'` — both are DataCore
 * system columns written across every entity type, never single-writer
 * (same query ProgramsPage already runs).
 */
export default function NewApplicationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [programId, setProgramId] = useState('');
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear());
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const loadPrograms = useCallback(async () => {
    if (!tenant) return;
    try {
      const res = await postQuery(tenant, 'entities',
        "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'");
      const rows = res.data as unknown as ProgramRow[];
      setPrograms(rows);
      setProgramId((prev) => prev || rows[0]?.program_id || '');
    } catch (e) {
      toast({ message: t('programs.loadError'), detail: String(e), tone: 'danger' });
    }
  }, [tenant, t, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPrograms();
  }, [loadPrograms]);

  const create = async () => {
    if (!programId || !schoolYear.trim()) return;
    setCreating(true);
    try {
      // channel: 'admin' — staff-assisted entry (spec §6), distinct from the
      // parent-facing 'parent' channel familyhub uses (Plan 5).
      const resp = await createApplication(tenant, {
        program_id: programId,
        school_year: schoolYear.trim(),
        channel: 'admin',
        ...(email.trim() ? { applicant_email: email.trim() } : {}),
      });
      toast({ message: t('newApp.created'), tone: 'success' });
      // createApplication's 201 envelope is {application, items}, NOT a bare
      // application row (INTERFACE-MAP §3) — and the route param this app
      // uses everywhere downstream is the application's entity_id, never the
      // RA-prefixed `application.application_id` business id
      // (DISPATCH-CONTEXT identifier convention).
      navigate(`/applications/${resp.application.entity_id}/enter`);
    } catch (e) {
      toast({ message: t('newApp.createError'), detail: String(e), tone: 'danger' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="programs-page">
      <header className="page-header">
        <h1 className="page-title">{t('newApp.title')}</h1>
      </header>
      <form className="program-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
        onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="bcp-row">
          <label htmlFor="newapp-program">{t('newApp.program')}</label>
          <select id="newapp-program" value={programId} required
            onChange={(e) => setProgramId(e.target.value)}>
            {programs.map((p) => (
              <option key={p.program_id} value={p.program_id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="bcp-row">
          <label htmlFor="newapp-year">{t('newApp.schoolYear')}</label>
          <input id="newapp-year" value={schoolYear} required
            onChange={(e) => setSchoolYear(e.target.value)} />
        </div>
        <div className="bcp-row">
          <label htmlFor="newapp-email">{t('newApp.applicantEmail')}</label>
          <input id="newapp-email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Button variant="primary" type="submit" loading={creating}
            loadingText={t('common.loading')} disabled={!programId || !schoolYear.trim()}>
            {t('newApp.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
