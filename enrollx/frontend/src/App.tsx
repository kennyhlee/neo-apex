import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ModelProvider } from './contexts/ModelContext.tsx';
import { ToastProvider } from './components/ui/Toast.tsx';
import AppNav from './components/AppNav.tsx';
import LoginPage from './pages/LoginPage.tsx';
import HomePage from './pages/HomePage.tsx';
import PaymentsSettingsPage from './pages/PaymentsSettingsPage.tsx';
import ProgramsPage from './pages/ProgramsPage.tsx';
import ConfigBuilderPage from './pages/ConfigBuilderPage.tsx';
import ApplicationsPage from './pages/ApplicationsPage.tsx';
import NewApplicationPage from './pages/NewApplicationPage.tsx';
import ApplicationDetailPage from './pages/ApplicationDetailPage.tsx';
import ApplicationEntryPage from './pages/ApplicationEntryPage.tsx';
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
            <ToastProvider>
              <ModelProvider>
                <div className="app-shell">
                  <AppNav />
                  <main className="app-main" id="main-content" tabIndex={-1}>
                    <Routes>
                      <Route path="/home" element={<HomePage />} />
                      <Route path="/settings/payments" element={<PaymentsSettingsPage />} />
                      <Route path="/programs" element={<ProgramsPage />} />
                      <Route path="/programs/:programId/flow" element={<ConfigBuilderPage />} />
                      <Route path="/applications" element={<ApplicationsPage />} />
                      <Route path="/applications/new" element={<NewApplicationPage />} />
                      <Route path="/applications/:applicationId" element={<ApplicationDetailPage />} />
                      <Route path="/applications/:applicationId/enter" element={<ApplicationEntryPage />} />
                      <Route path="/" element={<Navigate to="/home" replace />} />
                      <Route path="*" element={<Navigate to="/home" replace />} />
                    </Routes>
                  </main>
                </div>
              </ModelProvider>
            </ToastProvider>
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
