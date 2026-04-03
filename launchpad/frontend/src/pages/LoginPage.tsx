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
          <span>Don't have an account? </span>
          <button className="auth-link" onClick={onSwitchToSignup}>Sign up</button>
        </div>
      </div>
    </div>
  );
}
