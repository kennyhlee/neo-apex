import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { postQuery } from '../api/client.ts';
import type { Locale } from '../i18n/translations.ts';
import './Navbar.css';

export default function Navbar() {
  const { t, locale, setLocale } = useTranslation();
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
    { to: '/home', label: t('nav.home') },
    { to: '/leads', label: t('nav.lead') },
    { to: '/students', label: t('nav.student') },
    { to: '/programs', label: t('nav.program') },
  ];

  const displayName = user?.name ?? 'User';
  const avatarInitial = displayName.charAt(0).toUpperCase();
  const tenantName = (tenantDisplayName || user?.tenant_name) ?? '';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <a className="navbar-brand" href="/">
          <img
            src="https://www.acmeschool.com/uploads/2/7/1/4/27147223/1418317113.png"
            alt="Logo"
          />
          <span className="navbar-brand-text" style={{ color: '#378ADD' }}>{t('nav.systemName')}</span>
        </a>

        <ul className="navbar-nav">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="navbar-right">
          <select
            className="navbar-lang-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">中文</option>
          </select>

          <div className="navbar-user-group">
            <span className="navbar-tenant-name">{tenantName}</span>
            <div className="navbar-avatar">{avatarInitial}</div>
            <button className="navbar-logout" onClick={handleLogout} title={t('nav.logout')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
