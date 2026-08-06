// Split out of contexts/AuthContext.tsx (see that file's comment) so
// AuthContext.tsx exports only the AuthProvider component.
import { useContext } from 'react';
import { AuthContext } from '../contexts/authStore.ts';

export function useAuth() {
  return useContext(AuthContext);
}

export default useAuth;
