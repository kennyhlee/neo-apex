import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { TestUser } from '../types/models.ts';

interface AuthState {
  user: TestUser | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
  ready: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  login: () => false,
  logout: () => {},
  ready: false,
});

let cachedTestUser: TestUser | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TestUser | null>(() => {
    const saved = sessionStorage.getItem('admindash_user');
    return saved ? (JSON.parse(saved) as TestUser) : null;
  });
  const [ready, setReady] = useState(!!cachedTestUser);

  useEffect(() => {
    if (cachedTestUser) { setReady(true); return; }
    fetch('/test_user.json')
      .then((r) => r.json())
      .then((data: TestUser) => { cachedTestUser = data; })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const login = useCallback((username: string, password: string) => {
    if (!cachedTestUser) return false;
    if (username === cachedTestUser.username && password === cachedTestUser.password) {
      setUser(cachedTestUser);
      sessionStorage.setItem('admindash_user', JSON.stringify(cachedTestUser));
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('admindash_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
