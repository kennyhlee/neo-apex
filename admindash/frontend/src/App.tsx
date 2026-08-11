import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ModelProvider } from './contexts/ModelContext.tsx';
import { DashboardProvider } from './contexts/DashboardContext.tsx';
import { ToastProvider } from './components/ui/Toast.tsx';
import CommandPalette from './components/ui/CommandPalette.tsx';
import Navbar from './components/Navbar.tsx';
import Footer from './components/Footer.tsx';
import LoginPage from './pages/LoginPage.tsx';
import PublicInquiryPage from './pages/PublicInquiryPage.tsx';
import HomePage from './pages/HomePage.tsx';
import AttentionPage from './pages/AttentionPage.tsx';
import StudentsPage from './pages/StudentsPage.tsx';
import BulkAddStudentsPage from './pages/BulkAddStudentsPage.tsx';
import LeadPage from './pages/LeadPage.tsx';
import ProgramPage from './pages/ProgramPage.tsx';
import FamiliesPage from './pages/FamiliesPage.tsx';
import WorkflowsPage from './pages/WorkflowsPage.tsx';
import WorkflowPipelinePage from './pages/WorkflowPipelinePage.tsx';
import StaffEntryPage from './pages/StaffEntryPage.tsx';
import { useTranslation } from './hooks/useTranslation.ts';
import './App.css';

/**
 * Unknown URLs previously redirected to /home, so a typo looked like a
 * successful navigation. They now say what happened.
 */
function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="not-found">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link className="btn btn-primary" to="/home">
        {t('notFound.action')}
      </Link>
    </div>
  );
}

function AppRoutes() {
  const { user, ready } = useAuth();
  const tenant = user?.tenant_id ?? '';

  if (!ready) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/home" replace /> : <LoginPage />} />

      <Route path="/inquire/:tenantId" element={<PublicInquiryPage />} />

      <Route
        path="*"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : (
            <ModelProvider>
              <DashboardProvider>
                <div className="app-shell">
                  <Navbar />
                  <CommandPalette tenant={tenant} />
                  <main className="app-main" id="main-content" tabIndex={-1}>
                    <Routes>
                      <Route path="/home" element={<HomePage tenant={tenant} />} />
                      <Route path="/attention" element={<AttentionPage tenant={tenant} />} />
                      <Route path="/students" element={<StudentsPage tenant={tenant} />} />
                      <Route
                        path="/students/bulk-add"
                        element={<BulkAddStudentsPage tenant={tenant} />}
                      />
                      <Route path="/leads" element={<LeadPage tenant={tenant} />} />
                      <Route path="/programs" element={<ProgramPage tenant={tenant} />} />
                      <Route path="/families" element={<FamiliesPage tenant={tenant} />} />
                      <Route path="/workflows" element={<WorkflowsPage tenant={tenant} />} />
                      <Route
                        path="/workflows/:definitionId"
                        element={<WorkflowPipelinePage tenant={tenant} />}
                      />
                      <Route
                        path="/workflows/:definitionId/new"
                        element={<StaffEntryPage tenant={tenant} />}
                      />
                      <Route path="/" element={<Navigate to="/home" replace />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </main>
                  <Footer />
                </div>
              </DashboardProvider>
            </ModelProvider>
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
