// Contract tests for the assistant <-> editor handle.
//
// The registry is four lines of code, so these tests are not about the lines —
// they pin the two ORDERING rules the module exists to enforce, both of which
// are invisible in normal use and both of which fail in the direction of "the
// patch card silently writes nowhere" (or, worse, to the wrong draft):
//
//   * re-registering replaces, so `apply` is never a stale closure;
//   * unregistering is id-scoped, so a late cleanup from the page being left
//     cannot wipe the handle the page being entered just published.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBridgeApply,
  getEditorBridge,
  registerEditorBridge,
  resolveEditorTarget,
  unregisterEditorBridge,
  type BridgeSource,
  type EditorBridge,
} from '../editorBridge.ts';
import type { ChannelAccess } from '../patchOps.ts';
import type { MachineDef, WorkflowStepDef } from '../../types/designer.ts';

const bridge = (entityId: string, overrides: Partial<EditorBridge> = {}): EditorBridge => ({
  entityId,
  readOnly: false,
  apply: () => null,
  ...overrides,
});

// Module state survives between tests in a file — leave it clean either way.
afterEach(() => {
  const open = getEditorBridge();
  if (open) unregisterEditorBridge(open.entityId);
});

describe('editorBridge', () => {
  it('starts empty — no editor mounted, no handle', () => {
    expect(getEditorBridge()).toBeNull();
  });

  it('returns the registered handle', () => {
    const b = bridge('def-1');
    registerEditorBridge(b);
    expect(getEditorBridge()).toBe(b);
  });

  it('replaces on re-register, so apply is never a stale closure', () => {
    const stale = vi.fn(() => null);
    const fresh = vi.fn(() => null);
    registerEditorBridge(bridge('def-1', { apply: stale }));
    // What EditorPage's effect does on every machine/steps change.
    registerEditorBridge(bridge('def-1', { apply: fresh }));

    getEditorBridge()?.apply([]);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });

  it('unregister clears the handle for the matching id', () => {
    registerEditorBridge(bridge('def-1'));
    unregisterEditorBridge('def-1');
    expect(getEditorBridge()).toBeNull();
  });

  it('unregister for a DIFFERENT id leaves the current handle alone', () => {
    // The interleaving this rule exists for: route /definitions/def-2 mounts
    // and registers before /definitions/def-1's effect cleanup runs.
    registerEditorBridge(bridge('def-1'));
    registerEditorBridge(bridge('def-2'));
    unregisterEditorBridge('def-1');

    expect(getEditorBridge()?.entityId).toBe('def-2');
  });

  it('unregister is idempotent and safe with nothing registered', () => {
    expect(() => unregisterEditorBridge('def-1')).not.toThrow();
    registerEditorBridge(bridge('def-1'));
    unregisterEditorBridge('def-1');
    unregisterEditorBridge('def-1');
    expect(getEditorBridge()).toBeNull();
  });

  it('carries readOnly through so the card can refuse before calling apply', () => {
    registerEditorBridge(bridge('def-1', { readOnly: true }));
    expect(getEditorBridge()?.readOnly).toBe(true);
  });
});

// --- resolveEditorTarget ----------------------------------------------------
//
// The card outlives the route it was born on (the assistant drawer is mounted
// outside <Routes> and never unmounts), so "may these ops be applied to what
// is open right now?" is a real question with a wrong answer that is SILENT:
// add_stage / add_step / set_channel_access carry no cross-references and
// apply cleanly to any workflow at all.

describe('resolveEditorTarget', () => {
  it('allows the patch when origin, route and handle are the same draft', () => {
    const b = bridge('def-1');
    registerEditorBridge(b);

    expect(resolveEditorTarget('def-1', 'def-1')).toEqual({ bridge: b, refusal: null });
  });

  it('refuses a card from draft A while the operator is on draft B', () => {
    // The regression this function exists for: a valid, non-read-only handle
    // for the WRONG draft must not be enough.
    registerEditorBridge(bridge('def-2'));

    expect(resolveEditorTarget('def-1', 'def-2')).toEqual({
      bridge: null,
      refusal: 'other_draft',
    });
  });

  it('refuses when the operator has left the editor entirely', () => {
    expect(resolveEditorTarget('def-1', null)).toEqual({
      bridge: null,
      refusal: 'other_draft',
    });
  });

  it('refuses a patch that has no origin draft at all', () => {
    registerEditorBridge(bridge('def-1'));

    expect(resolveEditorTarget(null, 'def-1').refusal).toBe('other_draft');
    // ...and does not become applicable just because origin and route are both
    // absent.
    expect(resolveEditorTarget(null, null).refusal).toBe('other_draft');
  });

  it('reports not_ready — not other_draft — on the right route with no handle yet', () => {
    expect(resolveEditorTarget('def-1', 'def-1')).toEqual({ bridge: null, refusal: 'not_ready' });
  });

  it('reports not_ready when the registered handle is still the previous draft', () => {
    // Mid-navigation: the route is already def-1, the outgoing page's handle
    // has not been replaced. Applying here would write into a store that is
    // about to be discarded.
    registerEditorBridge(bridge('def-0'));

    expect(resolveEditorTarget('def-1', 'def-1').refusal).toBe('not_ready');
  });

  it('reports read_only for a published row', () => {
    registerEditorBridge(bridge('def-1', { readOnly: true }));

    expect(resolveEditorTarget('def-1', 'def-1')).toEqual({ bridge: null, refusal: 'read_only' });
  });
});

// --- createBridgeApply ------------------------------------------------------

const MACHINE: MachineDef = {
  states: [{ state_id: 'start', name: 'Start', kind: 'initial' }],
  transitions: [],
};

/** The setters stay OUTSIDE the `over` spread so they keep their `Mock` type
 *  (a `Partial<BridgeSource>` spread widens them back to plain functions and
 *  `.mock` stops type-checking). No test needs to override them. */
function source(over: Partial<BridgeSource> = {}) {
  return {
    machine: MACHINE,
    steps: [] as WorkflowStepDef[],
    readOnly: false,
    readOnlyMessage: 'read-only!',
    ...over,
    setMachine: vi.fn<(machine: MachineDef) => void>(),
    setSteps: vi.fn<(steps: WorkflowStepDef[]) => void>(),
    setChannelAccess: vi.fn<(value: ChannelAccess) => void>(),
  };
}

describe('createBridgeApply', () => {
  it('applies ops through the store setters and reports success', () => {
    const s = source();

    expect(createBridgeApply(s)([{ op: 'add_stage', stage_id: 'review', name: 'Review', kind: 'active' }])).toBeNull();
    expect(s.setMachine).toHaveBeenCalledTimes(1);
    expect(s.setSteps).toHaveBeenCalledTimes(1);
    const next = s.setMachine.mock.calls[0][0] as MachineDef;
    expect(next.states.map((st) => st.state_id)).toEqual(['start', 'review']);
  });

  it('REFUSES on a read-only row instead of writing nothing and claiming success', () => {
    // draftStore's setters silently no-op off-draft, so without this the
    // caller gets `null` — "applied" — over a draft nothing touched.
    const s = source({ readOnly: true });

    expect(createBridgeApply(s)([{ op: 'add_stage', stage_id: 'review', name: 'Review', kind: 'active' }])).toBe(
      'read-only!',
    );
    expect(s.setMachine).not.toHaveBeenCalled();
    expect(s.setSteps).not.toHaveBeenCalled();
    expect(s.setChannelAccess).not.toHaveBeenCalled();
  });

  it('writes channel access only when a set_channel_access op ran', () => {
    const without = source();
    createBridgeApply(without)([{ op: 'add_stage', stage_id: 'x', name: 'X', kind: 'active' }]);
    expect(without.setChannelAccess).not.toHaveBeenCalled();

    const withIt = source();
    createBridgeApply(withIt)([{ op: 'set_channel_access', value: 'family' }]);
    expect(withIt.setChannelAccess).toHaveBeenCalledWith('family');
  });

  it('returns the PatchApplyError message and writes NOTHING when an op fails', () => {
    const s = source();

    const err = createBridgeApply(s)([
      { op: 'add_stage', stage_id: 'review', name: 'Review', kind: 'active' },
      { op: 'rename_stage', stage_id: 'ghost', name: 'Ghost' },
    ]);

    expect(err).toContain('ghost');
    // All-or-nothing: the first op succeeded inside applyPatch, but applyPatch
    // is pure, so nothing reached the store.
    expect(s.setMachine).not.toHaveBeenCalled();
    expect(s.setSteps).not.toHaveBeenCalled();
  });
});
