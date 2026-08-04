// enrollx/frontend/src/pages/NewApplicationPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defaultSchoolYear } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { createApplication } from '../api/registration.ts';
import Button from '../components/ui/Button.tsx';
import './ProgramsPage.css';

/**
 * Staff-assisted entry, step 1: confirm the school year and optionally record
 * the parent's email, then create the application on the "admin" channel
 * (spec §5). An application is admission to the school as a whole for that
 * year — there is no program to pick.
 *
 * `defaultSchoolYear()` comes from flow-runtime so this prefill, the parent
 * start page's read-only line, and enrollx's own capacity snapshot all agree
 * on the July rollover.
 */
export default function NewApplicationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const navigate = useNavigate();
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear());
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!schoolYear.trim()) return;
    setCreating(true);
    try {
      // channel: 'admin' — staff-assisted entry (spec §5), distinct from the
      // parent-facing 'parent' channel familyhub uses.
      const resp = await createApplication(tenant, {
        school_year: schoolYear.trim(),
        channel: 'admin',
        ...(email.trim() ? { applicant_email: email.trim() } : {}),
      });
      toast({ message: t('newApp.created'), tone: 'success' });
      // createApplication's 201 envelope is {application, items}, NOT a bare
      // application row — and the route param this app uses everywhere
      // downstream is the application's entity_id, never the RA-prefixed
      // `application.application_id` business id.
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
            loadingText={t('common.loading')} disabled={!schoolYear.trim()}>
            {t('newApp.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
