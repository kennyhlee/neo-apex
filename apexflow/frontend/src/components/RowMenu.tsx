import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './RowMenu.css';

export interface RowMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  /** Renders in the danger colour and sits below a separator. */
  danger?: boolean;
  disabled?: boolean;
}

interface RowMenuProps {
  items: RowMenuItem[];
  /** Accessible name for the trigger, e.g. "More actions for Enrolment". */
  label: string;
}

/**
 * Overflow menu for secondary row actions.
 *
 * Exists because a table row that renders every lifecycle action as its own
 * button turns into a wall of similar-weight controls — and the ones that
 * matter least (deprecate, archive) were shouting as loudly as the one an
 * author actually reaches for. One primary button stays visible; the rest live
 * here.
 *
 * Deliberately small rather than a generic menu library: closes on outside
 * click and on Escape, restores focus to the trigger, and marks itself up with
 * the button/menu ARIA roles. It does NOT implement arrow-key roving focus —
 * Tab moves through the items, which is sufficient for a list of two or three
 * and avoids hand-rolling a focus manager that would need its own tests.
 */
export default function RowMenu({ items, label }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Scoped to this menu, and stopped so a surrounding Modal's own Escape
      // handler does not also close the dialog behind it.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="row-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="row-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Three dots as text, not an icon font — nothing else here needs one. */}
        <span aria-hidden="true">⋯</span>
      </button>

      {open && (
        <div className="row-menu-list" id={menuId} role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`row-menu-item${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
