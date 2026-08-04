import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.tsx';
import './App.css';

/**
 * Public, no-auth shell. This app never sees a staff JWT — there is no
 * AuthContext, no route guard, and no login route. The single "/" route is
 * a placeholder; Plan 5 adds the token-scoped `/register/:tenantId/:programId`
 * and `/application/:token` routes here, still with no auth surface.
 */
export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <main className="app-main" id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
