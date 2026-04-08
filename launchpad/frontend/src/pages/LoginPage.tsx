import { useState } from "react";
import type { User } from "../types/models";
import { login } from "../api/client";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: User) => void;
  onSwitchToSignup: () => void;
}

export default function LoginPage({ onLogin, onSwitchToSignup }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await login(email.trim(), password);
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-brand">Launchpad</h1>
          <p className="auth-subtitle">Sign in to your account</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input id="email" className="auth-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Password</label>
            <input id="password" className="auth-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Enter password" />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <div className="auth-footer">
          <span>Setting up a new organization? </span>
          <button className="auth-link" onClick={onSwitchToSignup}>Create your first admin account</button>
        </div>
        <div className="auth-platform">
          <svg className="auth-platform__trail" width="140" height="24" viewBox="0 0 140 24" fill="none">
            <defs>
              <linearGradient id="trail-lp" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#378ADD"><animate attributeName="stop-color" values="#378ADD;#D4537E;#378ADD" dur="6s" repeatCount="indefinite"/></stop>
                <stop offset="50%" stopColor="#D4537E"><animate attributeName="stop-color" values="#D4537E;#378ADD;#D4537E" dur="6s" repeatCount="indefinite"/></stop>
                <stop offset="100%" stopColor="#378ADD"><animate attributeName="stop-color" values="#378ADD;#D4537E;#378ADD" dur="6s" repeatCount="indefinite"/></stop>
              </linearGradient>
            </defs>
            <circle cx="6" cy="16" r="1.4" fill="url(#trail-lp)" opacity="0.3"/>
            <circle cx="16" cy="12" r="1.4" fill="url(#trail-lp)" opacity="0.4"/>
            <circle cx="26" cy="9" r="1.4" fill="url(#trail-lp)" opacity="0.45"/>
            <circle cx="36" cy="8" r="1.5" fill="url(#trail-lp)" opacity="0.5"/>
            <circle cx="46" cy="8.5" r="1.5" fill="url(#trail-lp)" opacity="0.55"/>
            <circle cx="56" cy="10" r="1.5" fill="url(#trail-lp)" opacity="0.6"/>
            <circle cx="66" cy="12" r="1.5" fill="url(#trail-lp)" opacity="0.65"/>
            <circle cx="76" cy="13" r="1.4" fill="url(#trail-lp)" opacity="0.7"/>
            <circle cx="86" cy="12.5" r="1.4" fill="url(#trail-lp)" opacity="0.75"/>
            <circle cx="96" cy="11" r="1.4" fill="url(#trail-lp)" opacity="0.8"/>
            <path d="M108 8L122 3L116 15L112 10L108 8Z" fill="url(#trail-lp)" stroke="url(#trail-lp)" strokeWidth="0.5" strokeLinejoin="round"/>
            <path d="M122 3L112 10" stroke="url(#trail-lp)" strokeWidth="0.5" opacity="0.25"/>
          </svg>
          <span>by <a href="https://www.floatify.com/" target="_blank" rel="noopener noreferrer">floatify</a></span>
        </div>
      </div>
    </div>
  );
}
