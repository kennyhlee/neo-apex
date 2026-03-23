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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    if (login(username, password)) {
      navigate('/home');
    } else {
      setError('Invalid credentials');
    }
  }

  function handleGoogleLogin() {
    if (login('google-user', '')) {
      navigate('/home');
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
          <div className="login-columns">
            <form onSubmit={handleSubmit}>
              <div className="login-field">
                <label htmlFor="username">{t('login.username')}</label>
                <input
                  id="username"
                  type="text"
                  placeholder={t('login.usernamePlaceholder')}
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
              <button type="submit" className="login-submit">
                {t('login.submit')}
              </button>
            </form>
            <div className="login-alt login-divider">
              <div className="login-alt-label">{t('login.otherMethods')}</div>
              <button
                type="button"
                className="login-google-btn"
                onClick={handleGoogleLogin}
              >
                {t('login.googleLogin')}
              </button>
            </div>
          </div>
        </div>
        <div className="login-footer">
          {t('login.noAccount')}{' '}
          <a href="#">{t('login.register')}</a>
        </div>
      </div>
    </div>
  );
}
