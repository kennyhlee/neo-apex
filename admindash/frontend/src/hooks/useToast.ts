import { useContext } from 'react';
import { ToastContext, type ToastApi } from '../contexts/toastStore';

/**
 * Raise a toast from anywhere under <ToastProvider>.
 *
 *   const { toast } = useToast();
 *   toast({ message: 'Tomás Herrera archived.', tone: 'success', onUndo: restore });
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

export default useToast;
