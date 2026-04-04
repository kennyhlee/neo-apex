import { useEffect, useState } from "react";
import type { User, OnboardingStatus } from "./types/models";
import { getCurrentUser, getStoredToken, storeToken, clearToken, getOnboardingStatus } from "./api/client";
import OnboardingPage from "./pages/OnboardingPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
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
        papermiteUrl="http://localhost:5173"
        onComplete={() => {
          getOnboardingStatus(user.tenant_id).then(setOnboarding);
        }}
        onLogout={handleLogout}
      />
    );
  }

  // Onboarding complete — main app (placeholder for Task 12)
  return (
    <div style={{ fontFamily: "var(--font-sans)", padding: 32 }}>
      <p>Welcome, {user.name}! Onboarding complete.</p>
      <button onClick={handleLogout}>Sign Out</button>
    </div>
  );
}
