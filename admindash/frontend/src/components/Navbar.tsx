import { useEffect, useRef, useState, type ReactElement } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useDensity } from '../hooks/useDensity.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { postQuery } from '../api/client.ts';
import { openCommandPalette } from './ui/paletteBus.ts';
import type { Locale } from '../i18n/translations.ts';
import './Navbar.css';

/** Mac shows ⌘K, everything else Ctrl K. */
const shortcutHint =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
    ? '⌘K'
    : 'Ctrl K';

/** Simple line icons for the small-screen tab bar. */
const icons: Record<string, ReactElement> = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 6h18" /><path d="M3 12h12" /><path d="M3 18h6" />
    </svg>
  ),
  students: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  ),
  families: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="8" cy="9" r="2.6" /><circle cx="16" cy="9" r="2.6" />
      <path d="M2.8 19a5.2 5.2 0 0 1 10.4 0" /><path d="M13.6 15.2A5.2 5.2 0 0 1 21.2 19" />
    </svg>
  ),
  programs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" />
      <path d="M8 3v4" /><path d="M16 3v4" />
    </svg>
  ),
};

export default function Navbar() {
  const { t, locale, setLocale } = useTranslation();
  const { density, toggleDensity } = useDensity();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // The upper-right label shows the tenant's display name (issue #76), fetched
  // from the tenant row. Falls back to the legal tenant_name from the user
  // profile until (or unless) a display name is available.
  const [tenantDisplayName, setTenantDisplayName] = useState<string>('');
  useEffect(() => {
    const tid = user?.tenant_id;
    if (!tid) return;
    let cancelled = false;
    postQuery(
      tid,
      'tenants',
      "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
    )
      .then((res) => {
        if (cancelled) return;
        const row = res.data?.[0];
        const dn = row && typeof row.display_name === 'string' ? row.display_name.trim() : '';
        if (dn) setTenantDisplayName(dn);
      })
      .catch(() => {
        /* fall back to tenant_name */
      });
    return () => {
      cancelled = true;
    };
  }, [user?.tenant_id]);

  const navItems = [
    { to: '/home', label: t('nav.home'), icon: 'home' },
    { to: '/leads', label: t('nav.lead'), icon: 'leads' },
    { to: '/students', label: t('nav.student'), icon: 'students' },
    { to: '/families', label: t('nav.family'), icon: 'families' },
    { to: '/programs', label: t('nav.program'), icon: 'programs' },
  ];

  const displayName = user?.name ?? 'User';
  const avatarInitial = displayName.charAt(0).toUpperCase();
  const tenantName = (tenantDisplayName || user?.tenant_name) ?? '';

  // --- User menu -----------------------------------------------------------
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

      <nav className="navbar" aria-label={t('nav.primary')}>
        <div className="navbar-inner">
          <NavLink className="navbar-brand" to="/home">
            <img src="/favicon.svg" alt="" aria-hidden="true" />
            <span className="navbar-brand-text">{t('nav.systemName')}</span>
          </NavLink>

          <ul className="navbar-nav">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="navbar-right">
            {/* Discoverability for ⌘K — the shortcut is the fast path, but it
                has to be visible before anyone learns it. */}
            <button type="button" className="navbar-search" onClick={openCommandPalette}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <span className="navbar-search-text">{t('palette.openHint')}</span>
              <kbd className="navbar-kbd">{shortcutHint}</kbd>
            </button>

            <button
              type="button"
              className="navbar-density"
              onClick={toggleDensity}
              aria-pressed={density === 'compact'}
              title={density === 'compact' ? t('nav.densityComfortable') : t('nav.densityCompact')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                {density === 'compact' ? (
                  <>
                    <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
                  </>
                ) : (
                  <>
                    <path d="M4 5h16" /><path d="M4 10h16" /><path d="M4 15h16" /><path d="M4 20h16" />
                  </>
                )}
              </svg>
              <span className="sr-only">
                {density === 'compact' ? t('nav.densityComfortable') : t('nav.densityCompact')}
              </span>
            </button>

            <label className="sr-only" htmlFor="navbar-lang">
              {t('nav.language')}
            </label>
            <select
              id="navbar-lang"
              className="navbar-lang-select"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="en-US">English</option>
              <option value="zh-CN">中文</option>
            </select>

            <div className="navbar-user" ref={menuRef}>
              <button
                type="button"
                className="navbar-user-trigger"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="navbar-tenant-name">{tenantName}</span>
                <span className="navbar-avatar" aria-hidden="true">
                  {avatarInitial}
                </span>
                <span className="sr-only">{t('nav.accountMenu')}</span>
              </button>

              {menuOpen && (
                <div className="navbar-menu" role="menu">
                  <div className="navbar-menu-head">
                    <strong>{displayName}</strong>
                    <span>{tenantName}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="navbar-menu-item"
                    onClick={() => {
                      toggleDensity();
                      setMenuOpen(false);
                    }}
                  >
                    {density === 'compact' ? t('nav.densityComfortable') : t('nav.densityCompact')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="navbar-menu-item navbar-menu-danger"
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

      {/*
        Small-screen navigation.

        Previously the nav list was simply hidden below 768px with nothing
        replacing it, which left every page reachable only by typing a URL.
      */}
      <nav className="navbar-tabs" aria-label={t('nav.primary')}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `navbar-tab${isActive ? ' active' : ''}`}
          >
            <span className="navbar-tab-icon">{icons[item.icon]}</span>
            <span className="navbar-tab-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
