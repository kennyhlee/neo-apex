// Ported from admindash/frontend/src/contexts/AuthContext.tsx (interface
// map §1a) — DataCore JWT via the apexflow backend's own /auth/login (which
// proxies DataCore unchanged, same as admindash's). TOKEN_KEY matches every
// other NeoApex frontend (interface map §7). The AuthState type + context
// object live in ./authStore.ts and useAuth in ../hooks/useAuth.ts so this
// file exports only the AuthProvider component.
import { useState, useCallback, useEffect, type ReactNode } from 'react';
import type { TestUser } from '../types/models.ts';
import { APEXFLOW_API_URL } from '../config.ts';
import { AuthContext } from './authStore.ts';

const TOKEN_KEY = 'neoapex_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TestUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkStoredToken() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const r = await fetch(`${APEXFLOW_API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error('Invalid token');
        const data: TestUser = await r.json();
        if (!cancelled) setUser(data);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void checkStoredToken();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const resp = await fetch(`${APEXFLOW_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    // Chat transcript and drawer state are scoped to the login session
    // (see components/chat/ChatPanel.tsx and AssistantDrawer.tsx).
    sessionStorage.removeItem('apexflow_chat_history');
    sessionStorage.removeItem('apexflow_assistant_open');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}
