// Provider half of assistantStore.ts, split out the same way AuthContext.tsx
// is split from authStore.ts so this file exports only the component.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ASSISTANT_OPEN_KEY,
  ASSISTANT_TOGGLE_ID,
  AssistantContext,
  type AssistantApi,
} from './assistantStore.ts';

export function AssistantProvider({ children }: { children: ReactNode }) {
  // Default CLOSED: the editor is dense, and reserving 380px of it before the
  // user asks for the assistant would be a worse first screen.
  const [open, setOpenState] = useState(() => {
    try {
      return sessionStorage.getItem(ASSISTANT_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  // The class on <body> is what reflows .app-main (see AssistantDrawer.css) —
  // content makes room for the drawer instead of sitting under it.
  useEffect(() => {
    document.body.classList.toggle('assistant-open', open);
    try {
      sessionStorage.setItem(ASSISTANT_OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore storage quota / disabled storage */
    }
    return () => document.body.classList.remove('assistant-open');
  }, [open]);

  const closeAndRefocus = useCallback(() => {
    setOpenState(false);
    // Queried rather than held as a ref: the button lives in AppNav, a sibling
    // this provider does not render, so there is no ref to thread down without
    // giving the context a registration step it does not otherwise need.
    document.getElementById(ASSISTANT_TOGGLE_ID)?.focus();
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
