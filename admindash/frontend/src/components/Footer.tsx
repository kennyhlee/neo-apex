import { useTranslation } from '../hooks/useTranslation.ts';
import './Footer.css';

export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <span>
        &copy; {year} {t('nav.systemName')}
      </span>
      <span className="app-footer-sep" aria-hidden="true">
        ·
      </span>
      <span>{t('footer.support')}</span>
    </footer>
  );
}
