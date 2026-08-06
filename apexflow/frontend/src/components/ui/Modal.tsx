// Ported from admindash/frontend/src/components/ui/Modal.tsx (interface map §1f).
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Stack of open overlays, so Escape only closes the topmost one. */
const openStack: string[] = [];

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Rendered as the header title unless `header` is given. */
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Dock to the right edge as a drawer instead of centring. */
  variant?: 'modal' | 'drawer';
  /** Set false for flows that must not be dismissed by a stray click. */
  dismissOnBackdrop?: boolean;
  /** Set false while a submit is in flight. */
  dismissOnEscape?: boolean;
  /** Hide the × control (Cancel in the footer then owns dismissal). */
  hideClose?: boolean;
  className?: string;
  /** Extra class on the footer, e.g. for space-between layouts. */
  footerClassName?: string;
}

/**
 * The single overlay component for the designer.
 *
 * Focus trap, focus restoration on close, Escape handling scoped to the
 * topmost overlay, background scroll lock, `role="dialog"`, `aria-modal`,
 * and an `aria-labelledby` pointing at the panel's own heading.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  variant = 'modal',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  hideClose = false,
  className = '',
  footerClassName = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const instanceId = useId();

  // Register in the overlay stack so nested overlays close in order.
  useEffect(() => {
    if (!open) return;
    openStack.push(instanceId);
    return () => {
      const i = openStack.indexOf(instanceId);
      if (i !== -1) openStack.splice(i, 1);
    };
  }, [open, instanceId]);

  // Lock background scroll while any overlay is open.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('scroll-locked');
    return () => {
      if (openStack.length === 0) document.body.classList.remove('scroll-locked');
    };
  }, [open]);

  // Remember what had focus, move focus into the panel, restore on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }

    return () => {
      restoreFocusTo.current?.focus?.();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && dismissOnEscape) {
        // Only the topmost overlay responds.
        if (openStack[openStack.length - 1] !== instanceId) return;
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dismissOnEscape, instanceId, onClose],
  );

  if (!open) return null;

  const isDrawer = variant === 'drawer';

  return (
    <div
      className={`modal-overlay${isDrawer ? ' modal-overlay-drawer' : ''}`}
      onMouseDown={(e) => {
        if (!dismissOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal ${isDrawer ? 'modal-drawer' : `modal-${size}`} ${className}`.trim()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2 className="modal-title" id={titleId}>
            {title}
            {subtitle ? <span className="modal-subtitle">{subtitle}</span> : null}
          </h2>
          {!hideClose && (
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              &times;
            </button>
          )}
        </div>

        <div className="modal-body">{children}</div>

        {footer ? <div className={`modal-footer ${footerClassName}`.trim()}>{footer}</div> : null}
      </div>
    </div>
  );
}

export default Modal;
