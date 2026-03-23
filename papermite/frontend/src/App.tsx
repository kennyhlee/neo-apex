import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import type { TestUser } from "./types/models";
import { getCurrentUser, getStoredToken, storeToken, clearToken } from "./api/client";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import UploadPage from "./pages/UploadPage";
import ReviewPage from "./pages/ReviewPage";
import FinalizedPage from "./pages/FinalizedPage";
import "./App.css";

function AccessDenied({ user, onLogout }: { user: TestUser; onLogout: () => void }) {
  return (
    <div className="app-shell">
      <div
        className="app-main"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "var(--danger-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <h2
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "20px",
              fontWeight: 400,
              color: "var(--text-primary)",
              marginBottom: "8px",
            }}
          >
            Access Denied
          </h2>
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginBottom: "4px",
            }}
          >
            Signed in as <strong>{user.name}</strong> ({user.email})
          </p>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text-tertiary)",
              marginBottom: "24px",
            }}
          >
            Role <code style={{ color: "var(--danger)" }}>{user.role}</code> does
            not have access. Requires{" "}
            <code style={{ color: "var(--success)" }}>tenant_admin</code>.
          </p>
          <button className="btn" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell({ user, onLogout }: { user: TestUser; onLogout: () => void }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <Link to="/" className="app-header__logo">
            Papermite
          </Link>
          <div className="app-header__divider" />
          <span className="app-header__subtitle">Model Setup</span>
        </div>
        <div className="app-header__user">
          <span>{user.tenant_name}</span>
          <div className="app-header__avatar">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <button
            className="app-header__logout"
            onClick={onLogout}
            title="Sign out"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LandingPage user={user} />} />
          <Route path="/upload" element={<UploadPage user={user} />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/finalize/:id" element={<FinalizedPage user={user} />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<TestUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [backendError, setBackendError] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    getCurrentUser()
      .then(setUser)
      .catch(() => {
        clearToken();
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = (token: string, loggedInUser: TestUser) => {
    storeToken(token);
    setUser(loggedInUser);
    setBackendError(false);
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  if (!authChecked) {
    return (
      <div className="app-shell">
        <div
          className="app-main"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="spinner spinner--lg" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (user.role !== "tenant_admin") {
    return (
      <BrowserRouter>
        <AccessDenied user={user} onLogout={handleLogout} />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppShell user={user} onLogout={handleLogout} />
    </BrowserRouter>
  );
}
