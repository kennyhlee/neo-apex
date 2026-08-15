// Open/closed state for the assistant drawer, shared between the nav button
// that opens it (AppNav) and the drawer itself (AssistantDrawer).
//
// Context rather than a module bus, following authStore/toastStore.
//
// The drawer and its edge handle both live in `AssistantDrawer`, so this could
// now be local state — it stays in context because `ChatPanel`'s "Hide ›" needs
// it too, and because a future caller ("explain these errors" from the
// validation rail) should be able to open the assistant without threading a
// prop through the page tree.
import { createContext } from 'react';

/**
 * The edge handle's DOM id. Escape and the header's "Hide ›" return focus here,
 * so it has to be stable and known to both sides — hence one exported constant
 * rather than a string repeated across files.
 */
export const ASSISTANT_TOGGLE_ID = 'assistant-handle';

/** Session-scoped, like the transcript: a new tab starts closed. */
export const ASSISTANT_OPEN_KEY = 'apexflow_assistant_open';

export interface AssistantApi {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /**
   * Close and move focus back to the nav button. The element that had focus is
   * usually inside the drawer this is about to hide (`visibility: hidden` when
   * `aria-hidden`), and dropping focus to <body> would strand a keyboard user
   * at the top of the document.
   */
  closeAndRefocus: () => void;
}

export const AssistantContext = createContext<AssistantApi | null>(null);
