import { useTranslation } from '../hooks/useTranslation.ts';
import './ProgramPage.css';

export default function ProgramPage() {
  const { t } = useTranslation();

  return (
    <div className="placeholder-page">
      <h1 className="gradient-text">{t('program.title')}</h1>
      <p>Coming soon.</p>
    </div>
  );
}
