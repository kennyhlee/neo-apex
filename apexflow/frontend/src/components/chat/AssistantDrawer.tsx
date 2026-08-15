// The slide-in shell around ChatPanel. AdminDash keeps this markup inline in
// HomePage because the assistant only lives there; in ApexFlow the assistant is
// available on every authed route, so the shell is its own component mounted
// once in App.tsx.
//
// This component owns no open/closed state: it is opened from AppNav's
// Assistant button and closed from either that button, the × in the panel
// header, or Escape. The state lives in `AssistantProvider` because the two
// controls are in different subtrees.
//
// There is deliberately NO floating toggle pill. One used to live here, fixed
// to the top-right of the content column; it read as a stray widget rather than
// part of the app (AdminDash never visibly shows its equivalent — its drawer
// defaults open and the pill sits underneath it), and being `position: fixed`
// it kept colliding with whatever the page put in that band. The controls are
// now where the user already looks for chrome: the nav, and the panel's own
// header.
import { useCallback } from 'react';
import { useAssistant } from '../../hooks/useAssistant.ts';
import { ChatPanel } from './ChatPanel.tsx';
import './AssistantDrawer.css';

export function AssistantDrawer() {
  const { open, closeAndRefocus } = useAssistant();

  /**
   * Escape closes the drawer when focus is inside it.
   *
   * Bound to the `<aside>` rather than to `document`: a window-level listener
   * would also fire while the user is typing in some unrelated page control,
   * and closing the assistant out from under an edit elsewhere is worse than
   * not offering the shortcut. React's synthetic events bubble, so focus in
   * any descendant — composer, chips, a proposal card's buttons — is covered.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeAndRefocus();
    },
    [closeAndRefocus],
  );

  return (
    <aside
      id="assistant-drawer"
      className={`assistant-drawer ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
      onKeyDown={onKeyDown}
    >
      <ChatPanel onClose={closeAndRefocus} />
    </aside>
  );
}

export default AssistantDrawer;
