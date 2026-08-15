// Trimmed port of admindash/frontend/src/components/Navbar.tsx (interface
// map §1) — same skip-link/brand/nav/user-menu structure, cut down to the
// links this app actually has (Workflows, Templates) and no
// density/command-palette/tenant-name-fetch (admindash-specific).
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useAssistant } from '../hooks/useAssistant.ts';
import { ASSISTANT_TOGGLE_ID } from '../contexts/assistantStore.ts';
import type { Locale } from '../i18n/translations.ts';
import './AppNav.css';

export default function AppNav() {
  const { t, locale, setLocale } = useTranslation();
  const { user, logout } = useAuth();
  const { open: assistantOpen, toggle: toggleAssistant } = useAssistant();
  const navigate = useNavigate();

  const navItems = [
    { to: '/', label: t('nav.workflows') },
    { to: '/templates', label: t('nav.templates') },
  ];

  const displayName = user?.name ?? 'User';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        {t('nav.skipToContent')}
      </a>

      <nav className="app-nav" aria-label={t('nav.primary')}>
        <div className="app-nav-inner">
          <NavLink className="app-nav-brand" to="/">
            <img src="/favicon.svg" alt="" aria-hidden="true" />
            <span className="app-nav-brand-text">{t('nav.systemName')}</span>
          </NavLink>

          <ul className="app-nav-links">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="app-nav-right">
            {/* The assistant's only open control. `aria-expanded` +
                `aria-controls` tie it to the drawer, and the `active` class is
                the same one the nav links use for "you are here" — an open
                drawer is a state of the app, so it is marked the same way. */}
            <button
              type="button"
              id={ASSISTANT_TOGGLE_ID}
              className={`app-nav-assistant ${assistantOpen ? 'active' : ''}`}
              onClick={toggleAssistant}
              aria-expanded={assistantOpen}
              aria-controls="assistant-drawer"
            >
              {t('assistant.title')}
            </button>

            <label className="sr-only" htmlFor="app-nav-lang">
              {t('nav.language')}
            </label>
            <select
              id="app-nav-lang"
              className="app-nav-lang-select"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="en-US">English</option>
              <option value="zh-CN">中文</option>
            </select>

            <div className="app-nav-user" ref={menuRef}>
              <button
                type="button"
                className="app-nav-user-trigger"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="app-nav-avatar" aria-hidden="true">
                  {avatarInitial}
                </span>
                <span className="sr-only">{t('nav.accountMenu')}</span>
              </button>

              {menuOpen && (
                <div className="app-nav-menu" role="menu">
                  <div className="app-nav-menu-head">
                    <strong>{displayName}</strong>
                    {user?.tenant_name ? <span>{user.tenant_name}</span> : null}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="app-nav-menu-item app-nav-menu-danger"
                    onClick={handleLogout}
                  >
                    {t('nav.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
