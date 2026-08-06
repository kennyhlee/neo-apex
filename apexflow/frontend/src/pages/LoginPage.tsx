// Ported from admindash/frontend/src/pages/LoginPage.tsx (interface map §1b).
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../hooks/useAuth.ts';
import type { Locale } from '../i18n/translations.ts';
import './LoginPage.css';

export default function LoginPage() {
  const { t, locale, setLocale } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const success = await login(email, password);
    setLoading(false);
    if (success) {
      navigate('/');
    } else {
      setError(t('login.invalidCredentials'));
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card-body">
          <div className="login-logo">
            <img src="/favicon.svg" alt="ApexFlow" />
          </div>
          <h1 className="login-title">{t('login.title')}</h1>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label htmlFor="email">{t('login.email')}</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder={t('login.emailPlaceholder')}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">{t('login.password')}</label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder={t('login.passwordPlaceholder')}
                required
              />
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? t('login.signingIn') : t('login.submit')}
            </button>
          </form>
        </div>
        <div className="login-footer">{t('login.needAccount')}</div>
        <div className="login-lang">
          <label className="sr-only" htmlFor="login-lang">
            {t('nav.language')}
          </label>
          <select
            id="login-lang"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">中文</option>
          </select>
        </div>
      </div>
    </div>
  );
}
