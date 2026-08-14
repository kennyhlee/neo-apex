import { describe, expect, it } from 'vitest';
import { lifecycleLadder, type RungKey } from '../lifecycleLadder.ts';

function rung(status: Parameters<typeof lifecycleLadder>[0], key: RungKey) {
  return lifecycleLadder(status).find((r) => r.key === key)!;
}

describe('lifecycleLadder', () => {
  it('always renders all three rungs in ladder order', () => {
    for (const status of ['active', 'deprecated', 'archived'] as const) {
      expect(lifecycleLadder(status).map((r) => r.key))
        .toEqual(['active', 'deprecated', 'archived']);
    }
  });

  it('marks exactly one rung current', () => {
    for (const status of ['active', 'deprecated', 'archived'] as const) {
      expect(lifecycleLadder(status).filter((r) => r.current)).toHaveLength(1);
    }
  });

  it('marks the rung matching the lineage status', () => {
    expect(rung('active', 'active').current).toBe(true);
    expect(rung('deprecated', 'deprecated').current).toBe(true);
    expect(rung('archived', 'archived').current).toBe(true);
  });

  it('treats the legacy `retired` alias as archived', () => {
    expect(rung('retired', 'archived').current).toBe(true);
    expect(rung('retired', 'deprecated').action).toBe('unarchive');
  });

  it('offers no action on the current rung', () => {
    expect(rung('active', 'active').action).toBeNull();
    expect(rung('deprecated', 'deprecated').action).toBeNull();
    expect(rung('archived', 'archived').action).toBeNull();
  });

  it('offers deprecate from active', () => {
    const r = rung('active', 'deprecated');
    expect(r.action).toBe('deprecate');
    expect(r.blockedReasonKey).toBeNull();
  });

  it('blocks archive from active, with a reason', () => {
    // The backend 409s `not_deprecated`: deprecating is the window in which
    // mid-flight work drains, so archive is reachable only from deprecated.
    const r = rung('active', 'archived');
    expect(r.action).toBe('archive');
    expect(r.blockedReasonKey).toBe('definitions.ladder.archiveNeedsDeprecated');
  });

  it('offers both reactivate and archive from deprecated, neither blocked', () => {
    expect(rung('deprecated', 'active')).toMatchObject({
      action: 'reactivate', blockedReasonKey: null,
    });
    expect(rung('deprecated', 'archived')).toMatchObject({
      action: 'archive', blockedReasonKey: null,
    });
  });

  it('offers unarchive from archived, landing on deprecated not active', () => {
    // unarchive returns the lineage to `deprecated`, never straight to active.
    expect(rung('archived', 'deprecated')).toMatchObject({
      action: 'unarchive', blockedReasonKey: null,
    });
  });

  it('blocks reactivate from archived, with a reason', () => {
    const r = rung('archived', 'active');
    expect(r.action).toBe('reactivate');
    expect(r.blockedReasonKey).toBe('definitions.ladder.reactivateNeedsUnarchive');
  });
});
