import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { fetchTenants } from '../api/client.ts';
import type { Tenant } from '../types/models.ts';
import type { Locale } from '../i18n/translations.ts';
import './Navbar.css';

const DEFAULT_TENANT = 'acmechildcenter';

interface NavbarProps {
  currentTenant: string;
  onTenantChange: (tenantId: string) => void;
}

export default function Navbar({ currentTenant, onTenantChange }: NavbarProps) {
  const { t, locale, setLocale } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([
    { id: DEFAULT_TENANT, name: DEFAULT_TENANT },
  ]);

  useEffect(() => {
    fetchTenants()
      .then((res) => {
        const list = (res.tenants || [])
          .map((tn) => ({ id: tn.id, name: tn.name || tn.id }))
          .filter((tn) => tn.id);
        if (list.length) setTenants(list);
      })
      .catch(() => {});
  }, []);

  const navItems = [
    { to: '/home', label: t('nav.home') },
    { to: '/leads', label: t('nav.lead') },
    { to: '/students', label: t('nav.student') },
    { to: '/programs', label: t('nav.program') },
  ];

  const displayName = user?.name ?? 'User';
  const avatarInitial = displayName.charAt(0).toUpperCase();

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
          <span className="navbar-site-label">{t('nav.currentSite')}</span>
          <select
            className="navbar-site-select"
            value={currentTenant}
            onChange={(e) => onTenantChange(e.target.value)}
          >
            {tenants.map((tn) => (
              <option key={tn.id} value={tn.id}>
                {tn.name}
              </option>
            ))}
          </select>

          <select
            className="navbar-lang-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">中文</option>
          </select>

          <div className="navbar-user" onClick={handleLogout} title={t('nav.logout')}>
            <div className="navbar-avatar">{avatarInitial}</div>
            <span className="navbar-username">{displayName}</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
