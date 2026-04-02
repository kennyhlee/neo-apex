import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ModelProvider } from './contexts/ModelContext.tsx';
import { DashboardProvider } from './contexts/DashboardContext.tsx';
import Navbar from './components/Navbar.tsx';
import Footer from './components/Footer.tsx';
import LoginPage from './pages/LoginPage.tsx';
import HomePage from './pages/HomePage.tsx';
import StudentsPage from './pages/StudentsPage.tsx';
import LeadPage from './pages/LeadPage.tsx';
import ProgramPage from './pages/ProgramPage.tsx';
import AddStudentPage from './pages/AddStudentPage.tsx';
import './App.css';

function AppRoutes() {
  const { user, ready } = useAuth();
  const [tenant, setTenant] = useState(user?.tenant_id ?? '');

  // Sync tenant with logged-in user's tenant_id
  useEffect(() => {
    if (user?.tenant_id) setTenant(user.tenant_id);
  }, [user?.tenant_id]);

  if (!ready) return null;

  return (
    <Routes>
      {/* Login has its own layout (no navbar/footer) */}
      <Route
        path="/login"
        element={user ? <Navigate to="/home" replace /> : <LoginPage />}
      />

      {/* Protected routes — redirect to login if not authenticated */}
      <Route
        path="*"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : (
            <ModelProvider>
            <DashboardProvider>
              <div className="app-shell">
                <Navbar currentTenant={tenant} onTenantChange={setTenant} />
                <main className="app-main">
                  <Routes>
                    <Route path="/home" element={<HomePage tenant={tenant} />} />
                    <Route
                      path="/students/add"
                      element={<AddStudentPage tenant={tenant} />}
                    />
                    <Route
                      path="/students"
                      element={<StudentsPage tenant={tenant} />}
                    />
                    <Route path="/leads" element={<LeadPage />} />
                    <Route path="/programs" element={<ProgramPage />} />
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
