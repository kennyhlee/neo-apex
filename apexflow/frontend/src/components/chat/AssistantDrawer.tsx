// The slide-in shell around ChatPanel. AdminDash keeps this markup inline in
// HomePage because the assistant only lives there; in ApexFlow the assistant is
// available on every authed route, so the shell is its own component mounted
// once in App.tsx and owning its own open state.
//
// Default is CLOSED: the editor is dense, and reserving 380px of it before the
// user asks for the assistant would be a worse first screen than a toggle.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation.ts';
import { ChatPanel } from './ChatPanel.tsx';
import './AssistantDrawer.css';

// Session-scoped, like the transcript: a new tab starts closed.
const OPEN_KEY = 'apexflow_assistant_open';

export function AssistantDrawer() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  // The class on <body> is what reflows .app-main (see AssistantDrawer.css) —
  // content makes room for the drawer instead of sitting under it.
  useEffect(() => {
    document.body.classList.toggle('assistant-open', open);
    try {
      sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore storage quota / disabled storage */
    }
    return () => document.body.classList.remove('assistant-open');
  }, [open]);

  const toggleRef = useRef<HTMLButtonElement>(null);

  /**
   * Escape closes the drawer when focus is inside it.
   *
   * Bound to the `<aside>` rather than to `document`: a window-level listener
   * would also fire while the user is typing in some unrelated page control,
   * and closing the assistant out from under an edit elsewhere is worse than
   * not offering the shortcut. React's synthetic events bubble, so focus in
   * any descendant — composer, chips, a proposal card's buttons — is covered.
   *
   * Focus is returned to the toggle, because the element that had it is inside
   * the drawer this is about to hide (`visibility: hidden` when
   * `aria-hidden`), and dropping focus to <body> would strand a keyboard user
   * at the top of the document.
   */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  return (
    <>
      <button
        type="button"
        ref={toggleRef}
        className="assistant-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="assistant-drawer"
      >
        {open ? t('assistant.hide') : t('assistant.show')}
      </button>
      <aside
        id="assistant-drawer"
        className={`assistant-drawer ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
        onKeyDown={onKeyDown}
      >
        <ChatPanel />
      </aside>
    </>
  );
}

export default AssistantDrawer;
