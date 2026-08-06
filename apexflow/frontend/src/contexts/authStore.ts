// Split out of AuthContext.tsx so that file exports only the AuthProvider
// component (react-refresh/only-export-components) — same split already
// used for toasts (contexts/toastStore.ts + components/ui/Toast.tsx +
// hooks/useToast.ts).
import { createContext } from 'react';
import type { TestUser } from '../types/models.ts';

export interface AuthState {
  user: TestUser | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  ready: boolean;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  login: async () => false,
  logout: () => {},
  ready: false,
});
