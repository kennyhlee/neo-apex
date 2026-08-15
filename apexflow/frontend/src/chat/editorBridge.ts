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
// Nothing here is reactive: `resolveEditorTarget` is called during the card's
// render and again inside its click handler (see PatchCard.tsx). A stale read
// can therefore never write to the wrong draft — at worst it renders a
// disabled button one paint longer than necessary.
//
// The registry is only half of it. A handle is a valid handle for SOME draft;
// whether it is the right one for a given patch is `resolveEditorTarget`'s
// question, and the answer is anchored on the draft the proposal was authored
// against — never on the current route, which the card outlives.
import { applyPatch } from './applyPatch.ts';
import type { ChannelAccess, PatchOp } from './patchOps.ts';
import type { MachineDef, WorkflowStepDef } from '../types/designer.ts';

export interface EditorBridge {
  /** The `entity_id` of the draft this handle writes to — checked against the
   *  draft a proposal was AUTHORED for, not against the current route, by
   *  `resolveEditorTarget`. The ops in a proposal name ids in one specific
   *  draft and are meaningless, possibly destructive, against another. */
  entityId: string;
  /** Mirrors `DraftStore.readOnly` (`status !== "draft"`). Exposed so a caller
   *  can disable its own controls; the refusal itself does not depend on that
   *  — `createBridgeApply` returns it from `apply` too, because the store's
   *  mutators self-guard and a patch that reached them would fail SILENTLY. */
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

/** Why a patch may not be applied right now. `not_ready` is transient (the
 *  editor is on the right draft but has not published a handle yet) and is
 *  deliberately distinct from the two the operator can act on. */
export type BridgeRefusal = 'other_draft' | 'not_ready' | 'read_only';

/**
 * Decide whether a patch proposed against `originEntityId` may be applied,
 * given the draft the operator is currently looking at.
 *
 * `originEntityId` — the draft that was open when the assistant authored the
 * ops — is the anchor, and BOTH the route and the registered handle are
 * compared against it. Comparing the handle to the route instead would be a
 * tautology (the handle always carries the routed id) and would let a card
 * authored for draft A apply to draft B the moment the operator navigates:
 * ops with no cross-references (`add_stage`, `add_step`,
 * `set_channel_access`) apply cleanly to ANY workflow, so the damage would be
 * silent. The two comparisons are not redundant either — the route says what
 * the operator is looking at, the handle says whose store would receive the
 * write, and during navigation the outgoing page's handle can still be the
 * registered one.
 *
 * Returns the caller's i18n decision as a `refusal` code rather than a
 * message: this module has no locale.
 */
export function resolveEditorTarget(
  originEntityId: string | null,
  routeEntityId: string | null,
): { bridge: EditorBridge | null; refusal: BridgeRefusal | null } {
  // Covers "no origin at all" — a patch proposed off the editor page, which
  // the backend does not do but the wire type allows. There is no draft it
  // could mean, so it is refused everywhere.
  if (!originEntityId || originEntityId !== routeEntityId) {
    return { bridge: null, refusal: 'other_draft' };
  }
  const bridge = getEditorBridge();
  if (!bridge || bridge.entityId !== originEntityId) {
    return { bridge: null, refusal: 'not_ready' };
  }
  if (bridge.readOnly) return { bridge: null, refusal: 'read_only' };
  return { bridge, refusal: null };
}

/** What `createBridgeApply` needs from the editor's draft store. */
export interface BridgeSource {
  machine: MachineDef;
  steps: WorkflowStepDef[];
  readOnly: boolean;
  /** Localized refusal returned when `readOnly` — this module has no locale. */
  readOnlyMessage: string;
  setMachine: (machine: MachineDef) => void;
  setSteps: (steps: WorkflowStepDef[]) => void;
  setChannelAccess: (value: ChannelAccess) => void;
}

/**
 * Builds an `EditorBridge['apply']` over one snapshot of the draft.
 *
 * Extracted from `EditorPage`'s effect so the three rules below are testable
 * without a component harness, and so they travel with the handle rather than
 * living in whichever card happens to hold it:
 *
 * 1. READ-ONLY IS REFUSED HERE. The store's mutators silently no-op on a
 *    non-draft row, so an apply that slipped past a caller's own check would
 *    write nothing and still return null — a card would report "Applied" over
 *    a draft nothing touched.
 * 2. ALL-OR-NOTHING. `applyPatch` is pure, so a throw means none of the three
 *    setters ran and the draft is exactly as it was.
 * 3. `channelAccess` IS WRITTEN ONLY WHEN PRESENT — absent means "no
 *    `set_channel_access` op ran", not "staff_only" (`PatchApplyResult`'s own
 *    contract), so writing it unconditionally would reset the field on every
 *    unrelated patch.
 */
export function createBridgeApply(source: BridgeSource): (ops: PatchOp[]) => string | null {
  return (ops) => {
    if (source.readOnly) return source.readOnlyMessage;
    try {
      const next = applyPatch(source.machine, source.steps, ops);
      source.setMachine(next.machine);
      source.setSteps(next.steps);
      if (next.channelAccess) source.setChannelAccess(next.channelAccess);
      return null;
    } catch (e) {
      // The `PatchApplyError` message names the offending id and is shown
      // verbatim on the card, so it has to survive as prose.
      return e instanceof Error ? e.message : String(e);
    }
  };
}
