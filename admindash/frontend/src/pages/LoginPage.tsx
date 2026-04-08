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
        <div className="login-platform">
          <svg width="140" height="24" viewBox="0 0 140 24" fill="none">
            <defs>
              <linearGradient id="trail-ad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#378ADD"><animate attributeName="stop-color" values="#378ADD;#D4537E;#378ADD" dur="6s" repeatCount="indefinite"/></stop>
                <stop offset="50%" stopColor="#D4537E"><animate attributeName="stop-color" values="#D4537E;#378ADD;#D4537E" dur="6s" repeatCount="indefinite"/></stop>
                <stop offset="100%" stopColor="#378ADD"><animate attributeName="stop-color" values="#378ADD;#D4537E;#378ADD" dur="6s" repeatCount="indefinite"/></stop>
              </linearGradient>
            </defs>
            <circle cx="6" cy="16" r="1.4" fill="url(#trail-ad)" opacity="0.3"/>
            <circle cx="16" cy="12" r="1.4" fill="url(#trail-ad)" opacity="0.4"/>
            <circle cx="26" cy="9" r="1.4" fill="url(#trail-ad)" opacity="0.45"/>
            <circle cx="36" cy="8" r="1.5" fill="url(#trail-ad)" opacity="0.5"/>
            <circle cx="46" cy="8.5" r="1.5" fill="url(#trail-ad)" opacity="0.55"/>
            <circle cx="56" cy="10" r="1.5" fill="url(#trail-ad)" opacity="0.6"/>
            <circle cx="66" cy="12" r="1.5" fill="url(#trail-ad)" opacity="0.65"/>
            <circle cx="76" cy="13" r="1.4" fill="url(#trail-ad)" opacity="0.7"/>
            <circle cx="86" cy="12.5" r="1.4" fill="url(#trail-ad)" opacity="0.75"/>
            <circle cx="96" cy="11" r="1.4" fill="url(#trail-ad)" opacity="0.8"/>
            <path d="M108 8L122 3L116 15L112 10L108 8Z" fill="url(#trail-ad)" stroke="url(#trail-ad)" strokeWidth="0.5" strokeLinejoin="round"/>
            <path d="M122 3L112 10" stroke="url(#trail-ad)" strokeWidth="0.5" opacity="0.25"/>
          </svg>
          <span>by <a href="https://www.floatify.com/" target="_blank" rel="noopener noreferrer">floatify</a></span>
        </div>
      </div>
    </div>
  );
}
