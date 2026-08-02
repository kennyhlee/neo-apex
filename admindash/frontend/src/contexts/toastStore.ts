import { createContext } from 'react';

export type ToastTone = 'neutral' | 'success' | 'attn' | 'danger';

export interface ToastOptions {
  /** The sentence shown to the user. Say what happened, in past tense. */
  message: string;
  tone?: ToastTone;
  /** Optional secondary line, e.g. which records were affected. */
  detail?: string;
  /**
   * When provided, the toast shows an Undo control and stays up longer.
   * The callback may be async; the toast reports failure if it throws.
   */
  onUndo?: () => void | Promise<void>;
  /** Milliseconds before auto-dismiss. Defaults: 5000, or 10000 with undo. */
  duration?: number;
}

export interface ToastRecord extends ToastOptions {
  id: number;
  tone: ToastTone;
  undoing?: boolean;
}

export interface ToastApi {
  /** Raise a toast. Returns its id so it can be dismissed early. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);
