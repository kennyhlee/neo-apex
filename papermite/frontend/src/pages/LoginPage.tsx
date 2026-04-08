import { useState } from "react";
import type { TestUser } from "../types/models";
import { PAPERMITE_API_URL } from "../config";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: TestUser) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });

  const emailError = touched.email && !email.trim() ? "Email is required" : "";
  const passwordError = touched.password && !password.trim() ? "Password is required" : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });

    if (!email.trim() || !password.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${PAPERMITE_API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Login failed");
        setPassword("");
        return;
      }

      const data = await res.json();
      onLogin(data.token, data.user);
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login__glow login__glow--1" />
      <div className="login__glow login__glow--2" />

      <div className="login__card">
        <div className="login__header">
          <h1 className="login__brand">Papermite</h1>
          <p className="login__subtitle">Data Ingestion Gateway</p>
        </div>

        <form className="login__form" onSubmit={handleSubmit} noValidate>
          <div className="login__field">
            <label className="login__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={`login__input ${emailError ? "login__input--error" : ""}`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
            />
            {emailError && <span className="login__field-error">{emailError}</span>}
          </div>

          <div className="login__field">
            <label className="login__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className={`login__input ${passwordError ? "login__input--error" : ""}`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              placeholder="Enter password"
              autoComplete="current-password"
            />
            {passwordError && (
              <span className="login__field-error">{passwordError}</span>
            )}
          </div>

          {error && (
            <div className="login__error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <button
            className="login__submit"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <span className="login__spinner" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="login__footer">
          <svg width="140" height="24" viewBox="0 0 140 24" fill="none">
            <defs>
              <linearGradient id="trail-pm" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#378ADD"><animate attributeName="stop-color" values="#378ADD;#D4537E;#378ADD" dur="6s" repeatCount="indefinite"/></stop>
                <stop offset="50%" stopColor="#D4537E"><animate attributeName="stop-color" values="#D4537E;#378ADD;#D4537E" dur="6s" repeatCount="indefinite"/></stop>
                <stop offset="100%" stopColor="#378ADD"><animate attributeName="stop-color" values="#378ADD;#D4537E;#378ADD" dur="6s" repeatCount="indefinite"/></stop>
              </linearGradient>
            </defs>
            <circle cx="6" cy="16" r="1.4" fill="url(#trail-pm)" opacity="0.3"/>
            <circle cx="16" cy="12" r="1.4" fill="url(#trail-pm)" opacity="0.4"/>
            <circle cx="26" cy="9" r="1.4" fill="url(#trail-pm)" opacity="0.45"/>
            <circle cx="36" cy="8" r="1.5" fill="url(#trail-pm)" opacity="0.5"/>
            <circle cx="46" cy="8.5" r="1.5" fill="url(#trail-pm)" opacity="0.55"/>
            <circle cx="56" cy="10" r="1.5" fill="url(#trail-pm)" opacity="0.6"/>
            <circle cx="66" cy="12" r="1.5" fill="url(#trail-pm)" opacity="0.65"/>
            <circle cx="76" cy="13" r="1.4" fill="url(#trail-pm)" opacity="0.7"/>
            <circle cx="86" cy="12.5" r="1.4" fill="url(#trail-pm)" opacity="0.75"/>
            <circle cx="96" cy="11" r="1.4" fill="url(#trail-pm)" opacity="0.8"/>
            <path d="M108 8L122 3L116 15L112 10L108 8Z" fill="url(#trail-pm)" stroke="url(#trail-pm)" strokeWidth="0.5" strokeLinejoin="round"/>
            <path d="M122 3L112 10" stroke="url(#trail-pm)" strokeWidth="0.5" opacity="0.25"/>
          </svg>
          <span>by <a href="https://www.floatify.com/" target="_blank" rel="noopener noreferrer">floatify</a></span>
        </div>
      </div>
    </div>
  );
}
