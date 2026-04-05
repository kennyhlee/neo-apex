import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import './LoginPage.css';

export default function LoginPage() {
  const { t } = useTranslation();
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
      navigate('/home');
    } else {
      setError('Invalid credentials');
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card-body">
          <div className="login-logo">
            <img
              src="https://www.acmeschool.com/uploads/2/7/1/4/27147223/1418317113.png"
              alt="Logo"
            />
          </div>
          <h1 className="login-title">{t('login.title')}</h1>
          {error && (
            <div style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: '1rem', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label htmlFor="email">{t('login.email')}</label>
              <input
                id="email"
                type="email"
                placeholder={t('login.emailPlaceholder')}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">{t('login.password')}</label>
              <input
                id="password"
                type="password"
                placeholder={t('login.passwordPlaceholder')}
                required
              />
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? '...' : t('login.submit')}
            </button>
          </form>
        </div>
        <div className="login-footer">
          {t('login.noAccount')}{' '}
          <a href="#">{t('login.register')}</a>
        </div>
      </div>
    </div>
  );
}
