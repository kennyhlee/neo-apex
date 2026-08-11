import { describe, it, expect } from 'vitest';
import { ITEM_DONE_STATUSES } from '@neoapex/flow-runtime';
import {
  publishedDefinitionsSql,
  publishedMachineSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
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
});
