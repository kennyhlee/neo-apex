// The one seam between the assistant drawer and the open editor draft.
//
// The drawer is mounted once in `App.tsx`, OUTSIDE the routed tree, so a patch
// card has no React path to `EditorPage`'s `useDraftStore` instance — no shared
// provider, no lifted state, no props. Rather than hoist the whole draft store
// into a context that every route would then re-render on, `EditorPage`
// publishes a tiny, single-purpose handle here and the card looks it up.
// (Same shape as admindash's `paletteBus`: module-level state, no React.)
//
// Two rules make this safe, and both matter more than the registry itself:
//
// 1. THE HANDLE IS REPLACED, NOT MUTATED. `EditorPage` re-registers from an
//    effect whose deps include `machine` and `steps`, so `apply` always closes
//    over the CURRENT draft. A handle registered once at mount would apply ops
//    against whatever the draft looked like when the editor opened and silently
//    discard every edit made since.
// 2. `unregisterEditorBridge` IS ID-SCOPED. Effect cleanup and effect setup
//    interleave differently depending on whether React is re-running one
//    component's effect, unmounting one route while mounting another, or
//    double-invoking in StrictMode. A bare `current = null` in cleanup can
//    therefore land AFTER the next page already registered and leave the
//    assistant with no bridge at all on a live editor. Clearing only when the
//    id still matches makes the ordering irrelevant.
//
// Nothing here is reactive: `getEditorBridge()` is read during the card's
// render and re-read inside its click handler, and the card re-validates the
// handle it gets both times (see PatchCard.tsx). A stale read can therefore
// never write to the wrong draft — at worst it renders a disabled button one
// paint longer than necessary.
import type { PatchOp } from './patchOps.ts';

export interface EditorBridge {
  /** The `entity_id` of the draft this handle writes to. The card compares it
   *  against the entity_id in the CURRENT route before applying — the ops in a
   *  proposal were authored against one specific draft and are meaningless,
   *  possibly destructive, against another. */
  entityId: string;
  /** Mirrors `DraftStore.readOnly` (`status !== "draft"`). The store's own
   *  mutators self-guard, so a patch applied through a read-only handle would
   *  fail SILENTLY — hence the card checks this before calling `apply`. */
  readOnly: boolean;
  /** Applies ops to the live draft. Returns null on success, or a
   *  human-readable error (PatchApplyError message) — all-or-nothing. */
  apply: (ops: PatchOp[]) => string | null;
}

let current: EditorBridge | null = null;

/** Publishes (or replaces) the handle for the open draft. */
export function registerEditorBridge(bridge: EditorBridge): void {
  current = bridge;
}

/**
 * Retracts the handle for `id` — a no-op if some other draft has since
 * registered. See rule 2 in the module header: cleanup for the page being left
 * can run after setup for the page being entered.
 */
export function unregisterEditorBridge(id: string): void {
  if (current?.entityId === id) current = null;
}

/** The handle for whatever draft is open, or null when no editor is mounted. */
export function getEditorBridge(): EditorBridge | null {
  return current;
}
