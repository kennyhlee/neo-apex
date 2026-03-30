import { useTranslation } from '../hooks/useTranslation.ts';
import './LeadPage.css';

export default function LeadPage() {
  const { t } = useTranslation();

  return (
    <div className="placeholder-page">
      <h1>{t('lead.title')}</h1>
      <p>Coming soon.</p>
    </div>
  );
}
