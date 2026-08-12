import { describe, it, expect } from 'vitest';
import { visibleWorkflows, type DefinitionListEntry } from '../workflowData.ts';

const row = (over: Partial<DefinitionListEntry>): DefinitionListEntry => ({
  entity_id: 'e1',
  definition_id: 'wd-1',
  name: 'Enrolment',
  version: 1,
  status: 'published',
  lineage_status: 'active',
  channel_access: 'family',
  health: 'current',
  open_instances: 0,
  ...over,
});

const NO_ATTENTION = new Map<string, number>();

describe('visibleWorkflows', () => {
  it('collapses a lineage to one row, preferring the published version', () => {
    const out = visibleWorkflows([
      row({ definition_id: 'wd-1', version: 1, status: 'superseded', channel_access: 'staff_only' }),
      row({ definition_id: 'wd-1', version: 2, status: 'published', channel_access: 'family' }),
      row({ definition_id: 'wd-1', version: 3, status: 'draft', channel_access: 'staff_only' }),
    ], NO_ATTENTION);

    expect(out).toHaveLength(1);
    // the live version's config, not a stale draft's
    expect(out[0].channel_access).toBe('family');
    expect(out[0].version).toBe(2);
  });

  it('hides archived workflows — their work is frozen, so nothing is processable', () => {
    const out = visibleWorkflows([
      row({ definition_id: 'wd-archived', lineage_status: 'archived', open_instances: 4 }),
      row({ definition_id: 'wd-legacy', lineage_status: 'retired', open_instances: 2 }),
    ], NO_ATTENTION);

    expect(out).toHaveLength(0);
  });

  it('keeps a deprecated workflow, which still runs its in-flight work', () => {
    const out = visibleWorkflows(
      [row({ definition_id: 'wd-dep', lineage_status: 'deprecated', open_instances: 3 })],
      NO_ATTENTION,
    );

    expect(out).toHaveLength(1);
    expect(out[0].lineage_status).toBe('deprecated');
  });

  it('hides a never-published workflow with no work items', () => {
    const out = visibleWorkflows(
      [row({ definition_id: 'wd-draft', status: 'draft', open_instances: 0 })],
      NO_ATTENTION,
    );

    expect(out).toHaveLength(0);
  });

  it('keeps an unpublished lineage that somehow still has open work items', () => {
    const out = visibleWorkflows(
      [row({ definition_id: 'wd-orphan', status: 'superseded', open_instances: 2 })],
      NO_ATTENTION,
    );

    expect(out).toHaveLength(1);
  });

  it('attaches the attention count for its own lineage only', () => {
    const out = visibleWorkflows([
      row({ definition_id: 'wd-a', name: 'A' }),
      row({ definition_id: 'wd-b', name: 'B' }),
    ], new Map([['wd-a', 5]]));

    expect(out.find((r) => r.definition_id === 'wd-a')?.needsAttention).toBe(5);
    expect(out.find((r) => r.definition_id === 'wd-b')?.needsAttention).toBe(0);
  });

  it('sorts by name', () => {
    const out = visibleWorkflows([
      row({ definition_id: 'wd-z', name: 'Zebra' }),
      row({ definition_id: 'wd-a', name: 'Apple' }),
    ], NO_ATTENTION);

    expect(out.map((r) => r.name)).toEqual(['Apple', 'Zebra']);
  });
});
