// How wide the assistant drawer is, and remembering it between visits.
//
// Pure apart from the two storage calls, so the clamping rules can be argued
// with in a test rather than by dragging a panel around.
//
// The width lives in the `--assistant-w` CUSTOM PROPERTY on the document
// root, not in a React state passed down as an inline style. Two separate
// fixed-position elements need it — the drawer, and the edge handle that
// rides its left edge (`right: var(--assistant-w)`) — and they are siblings,
// not parent and child. A custom property on `:root` is the one place both
// can read.
//
// `localStorage`, not IndexedDB (which `quickActions.ts` uses): this has to
// be readable SYNCHRONOUSLY, before first paint, or the drawer renders at
// the default width and then jumps to the remembered one.

const STORAGE_KEY = 'assistantWidth';
export const CSS_VAR = '--assistant-w';

/** Narrower than this and the chat panel's own controls start wrapping. */
export const MIN_ASSISTANT_W = 320;
/** Wider than this stops being a side panel. */
export const MAX_ASSISTANT_W = 880;
/** Page content the drawer must never swallow, however wide it is dragged. */
const MIN_CONTENT_W = 240;

/** Below this the drawer is full-width (see the drawer's media query), so
 * there is no left edge to drag and the grip is hidden. */
export const RESIZE_MIN_VIEWPORT = 992;

/**
 * The width actually allowed, given the window.
 *
 * The upper bound is whichever is smaller: the absolute cap, or what leaves
 * `MIN_CONTENT_W` of page visible. On a window narrow enough that those two
 * conflict, the minimum wins — a drawer below `MIN_ASSISTANT_W` is unusable,
 * and a viewport that small is already handled by the full-width media query.
 */
export function clampAssistantWidth(px: number, viewportWidth: number): number {
  const upper = Math.max(MIN_ASSISTANT_W, Math.min(MAX_ASSISTANT_W, viewportWidth - MIN_CONTENT_W));
  if (!Number.isFinite(px)) return MIN_ASSISTANT_W;
  return Math.round(Math.min(upper, Math.max(MIN_ASSISTANT_W, px)));
}

/** Width from a pointer at `clientX`: the drawer is pinned to the right
 * edge, so its width is simply the distance from the pointer to that edge. */
export function widthFromPointer(clientX: number, viewportWidth: number): number {
  return clampAssistantWidth(viewportWidth - clientX, viewportWidth);
}

/** The remembered width, or null when there is nothing usable stored.
 * Anything unparseable is treated as absent rather than repaired — a bad
 * value should fall back to the stylesheet's default, not to a guess. */
export function loadAssistantWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const px = Number.parseInt(raw, 10);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    // Storage can be disabled or full; a forgotten width is not worth an
    // exception through a render.
    return null;
  }
}

export function saveAssistantWidth(px: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(px)));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Publish the width for the drawer and its handle to read. */
export function applyAssistantWidth(px: number, root: HTMLElement): void {
  root.style.setProperty(CSS_VAR, `${Math.round(px)}px`);
}

/**
 * Restore the remembered width, clamped to the CURRENT window.
 *
 * Clamping on restore matters: a width saved on a wide display would
 * otherwise cover a narrower one entirely. Returns the width applied, or
 * null when nothing was stored — in which case the stylesheet's own default
 * stands and no custom property is set at all.
 */
export function restoreAssistantWidth(root: HTMLElement, viewportWidth: number): number | null {
  const stored = loadAssistantWidth();
  if (stored === null) return null;
  const width = clampAssistantWidth(stored, viewportWidth);
  applyAssistantWidth(width, root);
  return width;
}
