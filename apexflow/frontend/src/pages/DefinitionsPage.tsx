// Placeholder — the real definitions list (DataTable bound to
// listDefinitions) arrives in Task 5. Route: `/`.
import { useTranslation } from '../hooks/useTranslation.ts';

export default function DefinitionsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('definitions.title')}</h1>
      </div>
      <p className="page-placeholder">{t('definitions.comingSoon')}</p>
    </div>
  );
}
