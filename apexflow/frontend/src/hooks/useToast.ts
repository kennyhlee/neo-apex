// Ported from admindash/frontend/src/hooks/useToast.ts (interface map §1f).
import { useContext } from 'react';
import { ToastContext, type ToastApi } from '../contexts/toastStore';

/**
 * Raise a toast from anywhere under <ToastProvider>.
 *
 *   const { toast } = useToast();
 *   toast({ message: 'Definition published.', tone: 'success' });
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

export default useToast;
