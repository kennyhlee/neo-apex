// Provider half of assistantStore.ts, split out the same way AuthContext.tsx
// is split from authStore.ts so this file exports only the component.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ASSISTANT_OPEN_KEY,
  ASSISTANT_TOGGLE_ID,
  AssistantContext,
  type AssistantApi,
} from './assistantStore.ts';

export function AssistantProvider({ children }: { children: ReactNode }) {
  // Default CLOSED: the editor is dense, and opening a panel over it before the
  // user asks for one would be a worse first screen.
  const [open, setOpenState] = useState(() => {
    try {
      return sessionStorage.getItem(ASSISTANT_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(ASSISTANT_OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore storage quota / disabled storage */
    }
  }, [open]);

  // Focus is handed back AFTER the close has rendered, not inside the click
  // handler: below 992px the handle is `display: none` while open, and
  // `.focus()` on a still-hidden element is a silent no-op.
  const wantHandleFocus = useRef(false);
  useEffect(() => {
    if (!open && wantHandleFocus.current) {
      wantHandleFocus.current = false;
      document.getElementById(ASSISTANT_TOGGLE_ID)?.focus();
    }
  }, [open]);

  const closeAndRefocus = useCallback(() => {
    // The element that had focus is inside the panel about to be hidden
    // (`visibility: hidden` when `aria-hidden`), so parking focus on the handle
    // keeps a keyboard user where the assistant now is.
    wantHandleFocus.current = true;
    setOpenState(false);
  }, []);

  const api = useMemo<AssistantApi>(
    () => ({
      open,
      setOpen: setOpenState,
      toggle: () => setOpenState((o) => !o),
      closeAndRefocus,
    }),
    [open, closeAndRefocus],
  );

  return <AssistantContext.Provider value={api}>{children}</AssistantContext.Provider>;
}

export default AssistantProvider;
