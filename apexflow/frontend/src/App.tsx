import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { ToastProvider } from './components/ui/Toast.tsx';
import AppNav from './components/AppNav.tsx';
import { RoutedErrorBoundary } from './components/ErrorBoundary.tsx';
import { AssistantDrawer } from './components/chat/AssistantDrawer.tsx';
import { AssistantProvider } from './contexts/AssistantContext.tsx';
import LoginPage from './pages/LoginPage.tsx';
import DefinitionsPage from './pages/DefinitionsPage.tsx';
import EditorPage from './pages/EditorPage.tsx';
import TemplatesPage from './pages/TemplatesPage.tsx';
import { useTranslation } from './hooks/useTranslation.ts';
import './App.css';

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="not-found">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link className="btn btn-primary" to="/">
        {t('notFound.action')}
      </Link>
    </div>
  );
}

function AppRoutes() {
  const { user, ready } = useAuth();

  if (!ready) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route
        path="*"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : (
            // Wraps the shell, not the app: AppNav's Assistant button and the
            // drawer are siblings here, and both need the same open state.
            <AssistantProvider>
              <div className="app-shell">
                <AppNav />
                <AssistantDrawer />
                <main className="app-main" id="main-content" tabIndex={-1}>
                  <RoutedErrorBoundary>
                    <Routes>
                      <Route path="/" element={<DefinitionsPage />} />
                      <Route path="/definitions/:entityId" element={<EditorPage />} />
                      <Route path="/templates" element={<TemplatesPage />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </RoutedErrorBoundary>
                </main>
              </div>
            </AssistantProvider>
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
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
