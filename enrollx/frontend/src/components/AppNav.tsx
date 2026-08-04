import { NavLink } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import './AppNav.css';

/**
 * The primary authenticated nav. Renders above the inner `<Routes>` in
 * App.tsx. The `/settings/payments` link is Plan 3's route — added here,
 * never removed or renamed; Plan 3's own link on HomePage stays untouched too.
 */
export default function AppNav() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <nav className="app-nav" aria-label={t('nav.primary')}>
      <span className="app-nav-brand">EnrollX</span>
      <NavLink to="/flow" className="app-nav-link">{t('nav.flow')}</NavLink>
      <NavLink to="/applications" className="app-nav-link">{t('nav.applications')}</NavLink>
      <NavLink to="/settings/payments" className="app-nav-link">{t('nav.settings')}</NavLink>
      <span className="app-nav-spacer" />
      {user && <span className="app-nav-user">{user.name}</span>}
      <button type="button" className="app-nav-logout" onClick={logout}>
        {t('nav.logout')}
      </button>
    </nav>
  );
}
