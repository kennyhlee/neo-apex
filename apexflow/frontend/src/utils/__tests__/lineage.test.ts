import { describe, expect, it } from 'vitest';
import { collapseLineages, primaryEntityId } from '../lineage.ts';
import type { DefinitionListEntry } from '../../types/designer.ts';

function entry(over: Partial<DefinitionListEntry> = {}): DefinitionListEntry {
  return {
    entity_id: 'e1',
    definition_id: 'enroll',
    name: 'Enrollment',
    version: 1,
    status: 'draft',
    lineage_status: 'active',
    channel_access: 'staff_only',
    health: 'current',
    open_instances: 0,
    ...over,
  };
}

describe('collapseLineages', () => {
  it('collapses a published row and its draft into one lineage row', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
      entry({ entity_id: 'drf', version: 4, status: 'draft' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].published?.entity_id).toBe('pub');
    expect(rows[0].draft?.entity_id).toBe('drf');
  });

  it('reads lineage-level fields from the published row, not the draft', () => {
    // The draft's copy of lineage_status is written once at creation and never
    // updated, so it can be stale. The published row is authoritative.
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published',
              lineage_status: 'deprecated', channel_access: 'family' }),
      entry({ entity_id: 'drf', version: 4, status: 'draft',
              lineage_status: 'active', channel_access: 'staff_only' }),
    ]);

    expect(rows[0].lineage_status).toBe('deprecated');
    expect(rows[0].channel_access).toBe('family');
  });

  it('keeps a draft-only lineage, with no published row', () => {
    const rows = collapseLineages([entry({ entity_id: 'drf', version: 1, status: 'draft' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].published).toBeNull();
    expect(rows[0].draft?.entity_id).toBe('drf');
    expect(rows[0].lineage_status).toBe('active');
  });

  it('keeps an archived lineage', () => {
    // AdminDash's visibleWorkflows drops these; ApexFlow must not — the
    // archived lineage is the only place Unarchive is reachable.
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 5, status: 'published', lineage_status: 'archived' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].lineage_status).toBe('archived');
  });

  it('keeps a retired lineage under the legacy alias', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 5, status: 'published', lineage_status: 'retired' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].lineage_status).toBe('retired');
  });

  it('excludes superseded rows', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'old', version: 2, status: 'superseded' }),
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].published?.entity_id).toBe('pub');
  });

  it('drops a lineage that has only superseded rows', () => {
    expect(collapseLineages([entry({ status: 'superseded' })])).toEqual([]);
  });

  it('takes open_instances as the max across versions', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published', open_instances: 14 }),
      entry({ entity_id: 'drf', version: 4, status: 'draft', open_instances: 0 }),
    ]);

    expect(rows[0].open_instances).toBe(14);
  });

  it('separates distinct lineages and sorts them by name', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'z', definition_id: 'zeta', name: 'Zeta', status: 'published' }),
      entry({ entity_id: 'a', definition_id: 'alpha', name: 'Alpha', status: 'published' }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('keeps the highest-versioned draft when a lineage somehow has two', () => {
    // The backend now forbids this, but rows predating that rule still exist.
    const rows = collapseLineages([
      entry({ entity_id: 'd4', version: 4, status: 'draft' }),
      entry({ entity_id: 'd5', version: 5, status: 'draft' }),
    ]);

    expect(rows[0].draft?.entity_id).toBe('d5');
  });
});

describe('primaryEntityId', () => {
  it('prefers the draft — it is what the author is working on', () => {
    const [row] = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
      entry({ entity_id: 'drf', version: 4, status: 'draft' }),
    ]);

    expect(primaryEntityId(row)).toBe('drf');
  });

  it('falls back to the published row when there is no draft', () => {
    const [row] = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
    ]);

    expect(primaryEntityId(row)).toBe('pub');
  });
});
