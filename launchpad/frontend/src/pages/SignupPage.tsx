import { useState } from "react";
import type { User } from "../types/models";
import { register } from "../api/client";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: User) => void;
  onSwitchToLogin: () => void;
}

export default function SignupPage({ onLogin, onSwitchToLogin }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim() || !tenantName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await register(name.trim(), email.trim(), password, tenantName.trim());
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-brand">Launchpad</h1>
          <p className="auth-subtitle">Create your account</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="name">Your Name</label>
            <input id="name" className="auth-input" type="text" value={name}
              onChange={e => setName(e.target.value)} placeholder="Jane Smith" autoFocus />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input id="email" className="auth-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Password</label>
            <input id="password" className="auth-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Choose a password" />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="tenant">Organization Name</label>
            <input id="tenant" className="auth-input" type="text" value={tenantName}
              onChange={e => setTenantName(e.target.value)} placeholder="Acme Afterschool" />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>
        <div className="auth-footer">
          <span>Already have an account? </span>
          <button className="auth-link" onClick={onSwitchToLogin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}
