import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import LoginPage from './pages/LoginPage.tsx';
import HomePage from './pages/HomePage.tsx';
import PaymentsSettingsPage from './pages/PaymentsSettingsPage.tsx';
import './App.css';

/**
 * Minimal route guard: unauthenticated visitors only ever see /login,
 * authenticated visitors get the app shell. Plan 4 adds the Flow Builder
 * and tracking routes inside the authenticated branch.
 */
function AppRoutes() {
  const { user, ready } = useAuth();

  if (!ready) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/home" replace /> : <LoginPage />} />

      <Route
        path="*"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : (
            <div className="app-shell">
              <main className="app-main" id="main-content" tabIndex={-1}>
                <Routes>
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/settings/payments" element={<PaymentsSettingsPage />} />
                  <Route path="/" element={<Navigate to="/home" replace />} />
                  <Route path="*" element={<Navigate to="/home" replace />} />
                </Routes>
              </main>
            </div>
          )
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
