import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastOptions, type ToastRecord } from '../../contexts/toastStore.ts';
import './Toast.css';

const DEFAULT_MS = 5000;
const UNDO_MS = 10000;

/**
 * Toast host for the whole app.
 *
 * Before this, every successful mutation in AdminDash was silent and every
 * destructive one was irreversible. Archive, convert and bulk actions now
 * report themselves and, where the caller supplies `onUndo`, offer a ten-second
 * reversal instead of a blocking confirm dialog.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const record: ToastRecord = { ...options, id, tone: options.tone ?? 'neutral' };

      setToasts((prev) => [...prev.slice(-2), record]);

      const ms = options.duration ?? (options.onUndo ? UNDO_MS : DEFAULT_MS);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      );

      return id;
    },
    [dismiss],
  );

  const handleUndo = useCallback(
    async (record: ToastRecord) => {
      if (!record.onUndo) return;

      const timer = timers.current.get(record.id);
      if (timer) clearTimeout(timer);
      setToasts((prev) => prev.map((t) => (t.id === record.id ? { ...t, undoing: true } : t)));

      try {
        await record.onUndo();
        dismiss(record.id);
      } catch {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === record.id
              ? {
                  ...t,
                  undoing: false,
                  tone: 'danger',
                  message: "That couldn't be undone.",
                  detail: 'The change is still in place. Try again from the record.',
                  onUndo: undefined,
                }
              : t,
          ),
        );
        timers.current.set(
          record.id,
          setTimeout(() => dismiss(record.id), DEFAULT_MS),
        );
      }
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role="status" aria-live="polite">
            <div className="toast-text">
              <span className="toast-message">{t.message}</span>
              {t.detail ? <span className="toast-detail">{t.detail}</span> : null}
            </div>

            {t.onUndo ? (
              <button
                type="button"
                className="toast-undo"
                onClick={() => void handleUndo(t)}
                disabled={t.undoing}
              >
                {t.undoing ? 'Undoing…' : 'Undo'}
              </button>
            ) : null}

            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
