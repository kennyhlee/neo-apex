// The slide-in shell around ChatPanel, mounted once in App.tsx and available on
// every authed route.
//
// The drawer OVERLAYS the page — it does not inset `.app-main`. That was a
// deliberate change: pushing the content column narrowed it by the panel width
// and yanked the page-header actions 376px to the left every time the
// assistant opened, so opening a chat panel rearranged the page you were
// trying to work on. Overlaying costs the right ~380px of the view while open,
// which is cheaper than moving every control the operator was aiming at.
//
// Opening and closing both live on the panel itself, not in the nav: the edge
// handle below (which rides the drawer's left edge as it slides, so it is
// always the same object) and the "Hide ›" control in ChatPanel's header.
// There is no nav button — a persistent chrome item competing with Workflows
// and Templates read as out of place, and AppNav is navigation.
import { useCallback } from 'react';
import { useAssistant } from '../../hooks/useAssistant.ts';
import { ASSISTANT_TOGGLE_ID } from '../../contexts/assistantStore.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { AssistantResizeGrip } from './AssistantResizeGrip.tsx';
import './AssistantDrawer.css';

export function AssistantDrawer() {
  const { open, toggle, closeAndRefocus } = useAssistant();
  const { t } = useTranslation();

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
    <>
      <button
        type="button"
        id={ASSISTANT_TOGGLE_ID}
        className={`assistant-handle ${open ? 'is-open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls="assistant-drawer"
      >
        {/* The chevron points the way the panel will travel and flips with
            the state; the label is vertical so the tab stays a thin edge
            rather than a floating pill sitting over the page. */}
        <span className="assistant-handle__chevron" aria-hidden="true">
          &#8249;
        </span>
        <span className="assistant-handle__label">{t('assistant.title')}</span>
      </button>
      <aside
        id="assistant-drawer"
        className={`assistant-drawer ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
        onKeyDown={onKeyDown}
      >
        <AssistantResizeGrip />
        <ChatPanel onClose={closeAndRefocus} />
      </aside>
    </>
  );
}

export default AssistantDrawer;
