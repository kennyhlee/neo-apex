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
          <svg width="140" height="24" viewBox="0 0 140 24" fill="none">
            <circle cx="6" cy="16" r="1.4" fill="#7C3AED" opacity="0.3"/>
            <circle cx="16" cy="12" r="1.4" fill="#7C3AED" opacity="0.4"/>
            <circle cx="26" cy="9" r="1.4" fill="#7C3AED" opacity="0.45"/>
            <circle cx="36" cy="8" r="1.5" fill="#7C3AED" opacity="0.5"/>
            <circle cx="46" cy="8.5" r="1.5" fill="#6B4ED8" opacity="0.55"/>
            <circle cx="56" cy="10" r="1.5" fill="#5A5FBB" opacity="0.6"/>
            <circle cx="66" cy="12" r="1.5" fill="#4A6BA5" opacity="0.65"/>
            <circle cx="76" cy="13" r="1.4" fill="#3B6FA0" opacity="0.7"/>
            <circle cx="86" cy="12.5" r="1.4" fill="#2B6DB5" opacity="0.75"/>
            <circle cx="96" cy="11" r="1.4" fill="#2B6DB5" opacity="0.8"/>
            <path d="M108 8L122 3L116 15L112 10L108 8Z" fill="url(#pg-lp)" stroke="#2B6DB5" strokeWidth="0.5" strokeLinejoin="round"/>
            <path d="M122 3L112 10" stroke="#2B6DB5" strokeWidth="0.5" opacity="0.25"/>
            <defs><linearGradient id="pg-lp" x1="108" y1="3" x2="118" y2="15"><stop stopColor="#7C3AED"/><stop offset="1" stopColor="#2B6DB5"/></linearGradient></defs>
          </svg>
          <span>by floatify</span>
        </div>
      </div>
    </div>
  );
}
