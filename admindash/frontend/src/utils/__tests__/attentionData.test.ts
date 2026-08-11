import { describe, it, expect } from 'vitest';
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
    // all quote it, and the one that doesn't touch it must not mention it.
    for (const sql of [submittedItemsSql(), overdueItemsSql('x'), instanceSilenceSql()]) {
      expect(sql).toContain('MAX(a."at")');
    }
    expect(publishedDefinitionsSql()).not.toContain('"at"');
  });

  it('scopes the published-machine lookup to one lineage and escapes it', () => {
    expect(publishedMachineSql("en'rol")).toContain("definition_id = 'en''rol'");
    expect(publishedMachineSql('enrollment')).toContain("status = 'published'");
  });

  it('scopes every table reference to active rows', () => {
    for (const sql of all) expect(sql).toContain("_status = 'active'");
  });

  it('published definitions reads only the three columns needed', () => {
    const sql = publishedDefinitionsSql();
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain('definition_id');
    expect(sql).toContain('machine');
    expect(sql).not.toContain('vector');
  });

  it('submitted items join activity on the item, not just the instance', () => {
    const sql = submittedItemsSql();
    expect(sql).toContain("i.status = 'submitted'");
    expect(sql).toContain('a.item_id = i.entity_id');
  });

  it('overdue excludes every done status so a submitted item is not double counted', () => {
    const sql = overdueItemsSql('2026-08-11T00:00:00.000Z');
    expect(sql).toContain("'submitted'");
    expect(sql).toContain("'verified'");
    expect(sql).toContain("'waived'");
    expect(sql).toContain('NOT IN');
    expect(sql).toContain("i.due_at < '2026-08-11T00:00:00.000Z'");
  });

  it('escapes a quote in the injected timestamp', () => {
    expect(overdueItemsSql("2026'; DROP")).toContain("2026''; DROP");
  });
});
