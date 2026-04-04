import { useState } from "react";
import type { User } from "../types/models";
import { checkEmail, suggestTenantIds, register } from "../api/client";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: User) => void;
  onSwitchToLogin: () => void;
}

type Step = "email" | "org" | "credentials";

export default function SignupPage({ onLogin, onSwitchToLogin }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [customId, setCustomId] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [orgExistsHint, setOrgExistsHint] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    setOrgExistsHint("");
    try {
      const result = await checkEmail(email.trim());
      if (result.status === "org_exists") {
        setOrgExistsHint(result.admin_email_hint || "your organization admin");
      } else {
        setStep("org");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await suggestTenantIds(email.trim(), orgName.trim());
      setSuggestions(result.suggestions);
      if (result.suggestions.length > 0) {
        setTenantId(result.suggestions[0]);
      }
      setStep("credentials");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate IDs");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalId = customId.trim() || tenantId;
    if (!name.trim() || !password.trim() || !finalId) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await register(name.trim(), email.trim(), password, orgName.trim(), finalId);
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
          <p className="auth-subtitle">Set up your organization</p>
        </div>

        {step === "email" && (
          <form className="auth-form" onSubmit={handleEmailCheck}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">Work Email</label>
              <input id="email" className="auth-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@yourorg.com" autoFocus />
            </div>
            {orgExistsHint && (
              <div className="auth-error">
                Your organization already has an account. Contact your admin at {orgExistsHint} to get added.
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "org" && (
          <form className="auth-form" onSubmit={handleOrgSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="orgName">Organization Name</label>
              <input id="orgName" className="auth-input" type="text" value={orgName}
                onChange={e => setOrgName(e.target.value)} placeholder="Acme Afterschool Program" autoFocus />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Generating..." : "Continue"}
            </button>
            <button type="button" className="auth-link" onClick={() => setStep("email")}>Back</button>
          </form>
        )}

        {step === "credentials" && (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-field">
              <label className="auth-label">Organization ID</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {suggestions.map(s => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="radio" name="tenantId" value={s}
                      checked={tenantId === s && !customId}
                      onChange={() => { setTenantId(s); setCustomId(""); }} />
                    <code style={{ fontSize: 14 }}>{s}</code>
                  </label>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="radio" name="tenantId" checked={!!customId}
                    onChange={() => setCustomId(customId || " ")} />
                  <input className="auth-input" type="text" placeholder="Or type your own..."
                    value={customId} onChange={e => setCustomId(e.target.value)}
                    onFocus={() => setCustomId(customId || "")}
                    style={{ flex: 1, margin: 0 }} />
                </label>
              </div>
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="name">Your Name</label>
              <input id="name" className="auth-input" type="text" value={name}
                onChange={e => setName(e.target.value)} placeholder="Kenny Lee" />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="password">Password</label>
              <input id="password" className="auth-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Create a password" />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Account"}
            </button>
            <button type="button" className="auth-link" onClick={() => setStep("org")}>Back</button>
          </form>
        )}

        <div className="auth-footer">
          <span>Already have an account? </span>
          <button className="auth-link" onClick={onSwitchToLogin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}
