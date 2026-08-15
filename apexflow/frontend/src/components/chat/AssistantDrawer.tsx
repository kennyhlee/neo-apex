// The slide-in shell around ChatPanel. AdminDash keeps this markup inline in
// HomePage because the assistant only lives there; in ApexFlow the assistant is
// available on every authed route, so the shell is its own component mounted
// once in App.tsx and owning its own open state.
//
// Default is CLOSED: the editor is dense, and reserving 380px of it before the
// user asks for the assistant would be a worse first screen than a toggle.
import { useEffect, useState } from 'react';
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

  return (
    <>
      <button
        type="button"
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
      >
        <ChatPanel />
      </aside>
    </>
  );
}

export default AssistantDrawer;
