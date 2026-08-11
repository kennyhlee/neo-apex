import { describe, it, expect, vi } from 'vitest';
import { ITEM_DONE_STATUSES } from '@neoapex/flow-runtime';
import {
  publishedDefinitionsSql,
  publishedMachineSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
  dueAtProbeSql,
  definitionIndex,
  buildAttention,
  bucketRows,
  type AttentionInput,
} from '../attentionData.ts';

describe('SQL builders', () => {
  const all = [
    publishedDefinitionsSql(),
    publishedMachineSql('enrollment'),
    submittedItemsSql(),
    overdueItemsSql('2026-08-11T00:00:00.000Z'),
    instanceSilenceSql(),
  ];

  it('never selects star, which would return the 1024-float vector column', () => {
    for (const sql of all) expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('quotes the reserved keyword `at`', () => {
    // Non-vacuous: the three builders that touch the activity timestamp must
    // all quote it, and the two that don't touch it must not mention it.
    for (const sql of [submittedItemsSql(), overdueItemsSql('x'), instanceSilenceSql()]) {
      expect(sql).toContain('MAX(a."at")');
    }
    expect(publishedDefinitionsSql()).not.toContain('"at"');
    expect(publishedMachineSql('enrollment')).not.toContain('"at"');
  });

  it('scopes the published-machine lookup to one lineage and escapes it', () => {
    expect(publishedMachineSql("en'rol")).toContain("definition_id = 'en''rol'");
    expect(publishedMachineSql('enrollment')).toContain("status = 'published'");
  });

  it('scopes every table reference to active rows', () => {
    // Each builder must scope ALL its table aliases to _status = 'active',
    // not just pass if the substring appears once. submittedItemsSql and
    // overdueItemsSql have three aliases (i, inst, a); instanceSilenceSql has
    // two (inst, a); publishedDefinitionsSql has one (data); publishedMachineSql
    // has one (data). The LEFT JOIN alias (a) is the most likely to be missed.
    expect(submittedItemsSql()).toContain("i._status = 'active'");
    expect(submittedItemsSql()).toContain("inst._status = 'active'");
    expect(submittedItemsSql()).toContain("a._status = 'active'");

    expect(overdueItemsSql('2026-08-11T00:00:00.000Z')).toContain("i._status = 'active'");
    expect(overdueItemsSql('2026-08-11T00:00:00.000Z')).toContain("inst._status = 'active'");
    expect(overdueItemsSql('2026-08-11T00:00:00.000Z')).toContain("a._status = 'active'");

    expect(instanceSilenceSql()).toContain("inst._status = 'active'");
    expect(instanceSilenceSql()).toContain("a._status = 'active'");

    expect(publishedDefinitionsSql()).toContain("_status = 'active'");
    expect(publishedMachineSql('enrollment')).toContain("_status = 'active'");
  });

  it('published definitions reads exactly the three columns needed', () => {
    const sql = publishedDefinitionsSql();
    // Must have all three required columns in the SELECT
    expect(sql).toContain('SELECT definition_id, name, machine');
    // Verify no extra columns are selected (spot-check for common accidental adds
    // that would appear before FROM)
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toContain('vector');
    // Verify status filtering is applied
    expect(sql).toContain("status = 'published'");
  });

  it('submitted items join activity on the item, not just the instance', () => {
    const sql = submittedItemsSql();
    expect(sql).toContain("i.status = 'submitted'");
    expect(sql).toContain('a.item_id = i.entity_id');
  });

  it('overdue excludes every done status so a submitted item is not double counted', () => {
    const sql = overdueItemsSql('2026-08-11T00:00:00.000Z');
    // Each status from ITEM_DONE_STATUSES must be present, so an implementation
    // using inline literals instead of deriving from the vocabulary would fail
    // if the statuses ever diverge.
    for (const status of ITEM_DONE_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
    // Verify the exclusion pattern is present
    expect(sql).toContain('NOT IN');
    expect(sql).toContain("i.due_at < '2026-08-11T00:00:00.000Z'");
    // Verify the count matches exactly (no accidental extras or omissions)
    const statusPattern = ITEM_DONE_STATUSES.map((s) => `'${s}'`).join(', ');
    expect(sql).toContain(statusPattern);
  });

  it('escapes a quote in the injected timestamp', () => {
    expect(overdueItemsSql("2026'; DROP")).toContain("2026''; DROP");
  });

  it('the review query never references due_at, which some tenants lack', () => {
    // DataCore's per-tenant table is the union of the fields that tenant's rows
    // carry. A tenant whose workflow items never got a due date has no `due_at`
    // column at all, and referencing it is a Binder Error — which took out the
    // review bucket too, purely because it shared a projection with overdue.
    expect(submittedItemsSql()).not.toContain('due_at');
  });

  it('probes for due_at against workflow_item rows only', () => {
    const sql = dueAtProbeSql();
    expect(sql).toContain('i.due_at');
    expect(sql).toContain("i.entity_type = 'workflow_item'");
    expect(sql).toContain("i._status = 'active'");
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });
});

describe('SQL builders with mocked vocabulary', () => {
  // Test that overdueItemsSql derives from ITEM_DONE_STATUSES at runtime, not hardcoded.
  // If the vocabulary changes, the SQL must follow. We prove this by mocking
  // ITEM_DONE_STATUSES to return something different (e.g. ['alpha', 'beta'])
  // and confirming the SQL reflects those new values, not the hardcoded ones.
  //
  // This lives in its own describe block so the mock does not leak into other tests.
  it('overdueItemsSql derives ITEM_DONE_STATUSES, not hardcoded literals', async () => {
    // Mock @neoapex/flow-runtime before any module loads it
    vi.doMock('@neoapex/flow-runtime', () => ({
      ITEM_DONE_STATUSES: ['alpha', 'beta'],
    }));

    // Reset modules and reimport after the mock is in place
    vi.resetModules();
    const { overdueItemsSql: mockedOverdueItemsSql } = await import('../attentionData.ts');

    // The SQL should contain the mocked statuses
    const sql = mockedOverdueItemsSql('2026-08-11T00:00:00.000Z');
    expect(sql).toContain("'alpha'");
    expect(sql).toContain("'beta'");
    // And should NOT contain the hardcoded real statuses
    expect(sql).not.toContain("'submitted'");
    expect(sql).not.toContain("'verified'");
    expect(sql).not.toContain("'waived'");
  });
});

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-11T12:00:00.000Z');

/** `machine` arrives JSON-encoded from DataCore — encoded here too, so the
 * test exercises the real wire shape rather than a convenient object. */
const DEFS = [
  {
    definition_id: 'enrollment',
    name: 'Registration 2026',
    machine: JSON.stringify({
      states: [
        { state_id: 'draft', name: 'Draft', kind: 'initial' },
        { state_id: 'review', name: 'In review', kind: 'active' },
        { state_id: 'done', name: 'Enrolled', kind: 'terminal' },
      ],
      transitions: [],
    }),
  },
  {
    definition_id: 'signup',
    name: 'Afterschool Signup',
    machine: JSON.stringify({
      // `done` is ACTIVE here — the same state id means different things in
      // different definitions, so terminality must be resolved per definition.
      states: [
        { state_id: 'open', name: 'Open', kind: 'initial' },
        { state_id: 'done', name: 'Still going', kind: 'active' },
      ],
      transitions: [],
    }),
  },
];

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    definitions: DEFS,
    submitted: [],
    overdue: [],
    silence: [],
    nowMs: NOW,
    stalledDays: 7,
    ...over,
  };
}

describe('definitionIndex', () => {
  it('resolves terminality per definition, not globally', () => {
    const idx = definitionIndex(DEFS);
    expect(idx.get('enrollment')!.terminal.has('done')).toBe(true);
    expect(idx.get('signup')!.terminal.has('done')).toBe(false);
  });

  it('falls back to the id when a definition has no name', () => {
    const idx = definitionIndex([{ definition_id: 'x', machine: '{}' }]);
    expect(idx.get('x')!.name).toBe('x');
  });

  it('treats an unparseable machine as having no terminal states', () => {
    const idx = definitionIndex([{ definition_id: 'x', name: 'X', machine: 'not json' }]);
    expect(idx.get('x')!.terminal.size).toBe(0);
  });
});

describe('buildAttention', () => {
  const submittedRow = {
    item_entity_id: 'it1',
    title: 'Immunization Record',
    instance_entity_id: 'in1',
    definition_id: 'enrollment',
    state: 'review',
    applicant_email: 'chen@example.com',
    last_item_change: new Date(NOW - 4 * DAY).toISOString(),
  };

  it('flags a submitted item and dates it from the item_change activity', () => {
    const rows = bucketRows(buildAttention(input({ submitted: [submittedRow] })), 'review');
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowName).toBe('Registration 2026');
    expect(rows[0].itemTitle).toBe('Immunization Record');
    expect(rows[0].ageMs).toBe(4 * DAY);
  });

  it('omits the age when the item_change predates item attribution', () => {
    const rows = bucketRows(
      buildAttention(input({ submitted: [{ ...submittedRow, last_item_change: null }] })),
      'review',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ageMs).toBeNull();
  });

  it('drops a row whose instance sits in a terminal state', () => {
    const rows = bucketRows(
      buildAttention(input({ submitted: [{ ...submittedRow, state: 'done' }] })),
      'review',
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps a row in a state that is terminal only in ANOTHER definition', () => {
    const rows = bucketRows(
      buildAttention(input({
        submitted: [{ ...submittedRow, definition_id: 'signup', state: 'done' }],
      })),
      'review',
    );
    expect(rows).toHaveLength(1);
  });

  it('dates an overdue item from due_at, needing no activity row', () => {
    const rows = bucketRows(
      buildAttention(input({
        overdue: [{
          item_entity_id: 'it2', title: 'Proof of address',
          instance_entity_id: 'in2', definition_id: 'enrollment', state: 'review',
          due_at: new Date(NOW - 9 * DAY).toISOString(), last_item_change: null,
        }],
      })),
      'overdue',
    );
    expect(rows[0].ageMs).toBe(9 * DAY);
  });

  it('flags an instance silent past the threshold and ignores a fresh one', () => {
    const result = buildAttention(input({
      silence: [
        { instance_entity_id: 'a', definition_id: 'enrollment', state: 'review',
          last_activity: new Date(NOW - 8 * DAY).toISOString() },
        { instance_entity_id: 'b', definition_id: 'enrollment', state: 'review',
          last_activity: new Date(NOW - 2 * DAY).toISOString() },
      ],
    }));
    const rows = bucketRows(result, 'stalled');
    expect(rows).toHaveLength(1);
    expect(rows[0].instanceEntityId).toBe('a');
  });

  it('sorts most urgent first, with unknown ages last', () => {
    const mk = (id: string, days: number | null) => ({
      item_entity_id: id, title: 't', instance_entity_id: id,
      definition_id: 'enrollment', state: 'review',
      last_item_change: days === null ? null : new Date(NOW - days * DAY).toISOString(),
    });
    const rows = bucketRows(
      buildAttention(input({ submitted: [mk('a', 2), mk('b', null), mk('c', 9)] })),
      'review',
    );
    expect(rows.map((r) => r.instanceEntityId)).toEqual(['c', 'a', 'b']);
  });

  it('partitions every row into exactly one bucket, so counts sum to the total', () => {
    // The property Home depends on: a card's number IS the length of the list
    // /attention renders for that bucket, because both call bucketRows on the
    // same result. If a row ever landed in two buckets or none, this breaks.
    const result = buildAttention(input({
      submitted: [{ item_entity_id: 's1', title: 'a', instance_entity_id: 'i1',
        definition_id: 'enrollment', state: 'review',
        last_item_change: new Date(NOW - DAY).toISOString() }],
      overdue: [{ item_entity_id: 'o1', title: 'b', instance_entity_id: 'i2',
        definition_id: 'enrollment', state: 'review',
        due_at: new Date(NOW - 3 * DAY).toISOString() }],
      silence: [{ instance_entity_id: 'i3', definition_id: 'enrollment', state: 'review',
        last_activity: new Date(NOW - 30 * DAY).toISOString() }],
    }));
    const summed = (['overdue', 'review', 'stalled'] as const)
      .reduce((n, b) => n + bucketRows(result, b).length, 0);
    expect(summed).toBe(result.rows.length);
    expect(summed).toBe(3);
  });
});
