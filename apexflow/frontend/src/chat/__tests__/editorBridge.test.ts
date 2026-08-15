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
  getEditorBridge,
  registerEditorBridge,
  unregisterEditorBridge,
  type EditorBridge,
} from '../editorBridge.ts';

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
