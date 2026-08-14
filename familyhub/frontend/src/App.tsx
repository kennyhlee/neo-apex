import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.tsx';
import RegisterPage from './pages/RegisterPage.tsx';
import HubPage from './pages/HubPage.tsx';
import RequestLinkPage from './pages/RequestLinkPage.tsx';
import { RoutedErrorBoundary } from './components/ErrorBoundary.tsx';
import './App.css';

/**
 * Public, no-auth shell. This app never sees a staff JWT — there is no
 * AuthContext, no route guard, and no login route.
 */
export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <main className="app-main" id="main-content" tabIndex={-1}>
          <RoutedErrorBoundary>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              {/* Task 10: renamed from /register/:tenantId -- spec §6's route
                  shape is /w/{tenant_id}/{definition_id}, matching apexflow's
                  magic-link "link" field
                  (apexflow/backend/app/api/internal.py's _link_for). */}
              <Route path="/w/:tenantId/:definitionId" element={<RegisterPage />} />
              <Route path="/application/:token" element={<HubPage />} />
              <Route path="/request-link" element={<RequestLinkPage />} />
              <Route path="*" element={<LandingPage />} />
            </Routes>
          </RoutedErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
