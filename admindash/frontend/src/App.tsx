import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import Navbar from './components/Navbar.tsx';
import Footer from './components/Footer.tsx';
import LoginPage from './pages/LoginPage.tsx';
import HomePage from './pages/HomePage.tsx';
import StudentsPage from './pages/StudentsPage.tsx';
import LeadPage from './pages/LeadPage.tsx';
import ProgramPage from './pages/ProgramPage.tsx';
import './App.css';

function AppRoutes() {
  const { user, ready } = useAuth();
  const [tenant, setTenant] = useState(user?.tenant_id ?? 'acmechildcenter');

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
            <div className="app-shell">
              <Navbar currentTenant={tenant} onTenantChange={setTenant} />
              <main className="app-main">
                <Routes>
                  <Route path="/home" element={<HomePage />} />
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
