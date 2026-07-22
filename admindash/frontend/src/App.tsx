import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ModelProvider } from './contexts/ModelContext.tsx';
import { DashboardProvider } from './contexts/DashboardContext.tsx';
import Navbar from './components/Navbar.tsx';
import Footer from './components/Footer.tsx';
import LoginPage from './pages/LoginPage.tsx';
import PublicInquiryPage from './pages/PublicInquiryPage.tsx';
import HomePage from './pages/HomePage.tsx';
import StudentsPage from './pages/StudentsPage.tsx';
import BulkAddStudentsPage from './pages/BulkAddStudentsPage.tsx';
import LeadPage from './pages/LeadPage.tsx';
import ProgramPage from './pages/ProgramPage.tsx';
import './App.css';

function AppRoutes() {
  const { user, ready } = useAuth();
  const tenant = user?.tenant_id ?? '';

  if (!ready) return null;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/home" replace /> : <LoginPage />}
      />

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
                <main className="app-main">
                  <Routes>
                    <Route path="/home" element={<HomePage tenant={tenant} />} />
                    <Route
                      path="/students"
                      element={<StudentsPage tenant={tenant} />}
                    />
                    <Route
                      path="/students/bulk-add"
                      element={<BulkAddStudentsPage tenant={tenant} />}
                    />
                    <Route path="/leads" element={<LeadPage tenant={tenant} />} />
                    <Route path="/programs" element={<ProgramPage tenant={tenant} />} />
                    <Route path="*" element={<Navigate to="/home" replace />} />
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
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
