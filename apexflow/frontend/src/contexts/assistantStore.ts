// Open/closed state for the assistant drawer, shared between the nav button
// that opens it (AppNav) and the drawer itself (AssistantDrawer).
//
// Context rather than a module bus, following authStore/toastStore: the two
// consumers are siblings under one provider in App.tsx, so there is nothing to
// coordinate across unmounts, and React state re-renders both automatically —
// `editorBridge`'s hand-rolled registry exists because a card has to reach an
// editor that may not be mounted, which is not the case here.
import { createContext } from 'react';

/**
 * The nav button's DOM id. Escape and the drawer's × return focus here, so it
 * has to be stable and known to both sides — hence one exported constant
 * rather than a string repeated in three files.
 */
export const ASSISTANT_TOGGLE_ID = 'assistant-nav-toggle';

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
