import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import type { User, OnboardingStatus } from "./types/models";
import { getCurrentUser, getStoredToken, storeToken, clearToken, getOnboardingStatus } from "./api/client";
import { PAPERMITE_FRONTEND_URL } from "./config";
import OnboardingPage from "./pages/OnboardingPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import TenantSettingsPage from "./pages/TenantSettingsPage";
import UserManagementPage from "./pages/UserManagementPage";
import "./index.css";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authPage, setAuthPage] = useState<"login" | "signup">("login");

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setAuthChecked(true); return; }
    getCurrentUser()
      .then(async (u) => {
        setUser(u);
        const status = await getOnboardingStatus(u.tenant_id);
        setOnboarding(status);
      })
      .catch(() => clearToken())
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = async (token: string, loggedInUser: User) => {
    storeToken(token);
    setUser(loggedInUser);
    const status = await getOnboardingStatus(loggedInUser.tenant_id);
    setOnboarding(status);
  };

  const handleLogout = () => { clearToken(); setUser(null); setOnboarding(null); };

  if (!authChecked) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Loading...</div>;
  }

  if (!user) {
    return authPage === "login"
      ? <LoginPage onLogin={handleLogin} onSwitchToSignup={() => setAuthPage("signup")} />
      : <SignupPage onLogin={handleLogin} onSwitchToLogin={() => setAuthPage("login")} />;
  }

  // Onboarding gate — non-admin sees "setup pending"
  if (onboarding && !onboarding.is_complete && user.role !== "admin") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "var(--font-sans)" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h2 style={{ fontSize: 20, fontWeight: 400, color: "var(--text-primary)", marginBottom: 8 }}>Setup in Progress</h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>Your admin is setting things up. Please check back later.</p>
          <button onClick={handleLogout} style={{ padding: "10px 20px", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>Sign Out</button>
        </div>
      </div>
    );
  }

  // Onboarding gate — admin redirected to onboarding wizard
  if (onboarding && !onboarding.is_complete && user.role === "admin") {
    return (
      <OnboardingPage
        user={user}
        onboarding={onboarding}
        papermiteUrl={PAPERMITE_FRONTEND_URL}
        onComplete={() => {
          getOnboardingStatus(user.tenant_id).then(setOnboarding);
        }}
        onLogout={handleLogout}
      />
    );
  }

  // Onboarding complete — main app
  return <BrowserRouter><AppShell user={user} onLogout={handleLogout} /></BrowserRouter>;
}

function AppShell({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 32px", height: 60, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-primary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)", textDecoration: "none" }}>Launchpad</Link>
          {(user.role === "admin" || user.role === "staff") && (
            <Link to="/settings/tenant" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Tenant Info</Link>
          )}
          {user.role === "admin" && (
            <Link to="/settings/users" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Users</Link>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)" }}>
          <span>{user.tenant_name}</span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--tint-blue-bg)", border: "1px solid var(--border-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--tint-blue-text)" }}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "none", borderRadius: "50%", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.background = "var(--danger-muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>
      <main style={{ flex: 1, padding: 32, maxWidth: 1000, width: "100%", margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<TenantSettingsPage user={user} />} />
          <Route path="/settings/tenant" element={
            user.role === "admin" || user.role === "staff" ? <TenantSettingsPage user={user} /> : <Navigate to="/" />
          } />
          <Route path="/settings/users" element={
            user.role === "admin" ? <UserManagementPage user={user} /> : <Navigate to="/" />
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
