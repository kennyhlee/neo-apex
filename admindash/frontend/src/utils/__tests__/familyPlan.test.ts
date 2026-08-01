import { describe, it, expect } from 'vitest';
import { planFamilies } from '../familyPlan.ts';
import { normalizeSignature, signatureKey, type FamilySignature } from '../familyMatch.ts';

// Fake matcher: an existing family exists only for email match@x.com.
const matchExisting = (sig: FamilySignature): string | null =>
  sig.email === 'match@x.com' ? 'fam-existing' : null;

describe('planFamilies', () => {
  it('groups siblings sharing a key into one new family', () => {
    const plan = planFamilies([
      { rowId: 'r1', data: { family_name: 'Nguyen', primary_address: '12 Main' } },
      { rowId: 'r2', data: { family_name: 'nguyen', primary_address: '12 main' } },
    ], matchExisting);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.rowToCluster.r1).toBe(plan.rowToCluster.r2);
    expect(Object.keys(plan.resolved)).toHaveLength(0);
  });

  it('resolves rows that match an existing family', () => {
    const plan = planFamilies([
      { rowId: 'r1', data: { family_name: 'X', primary_email: 'match@x.com' } },
    ], matchExisting);
    expect(plan.resolved.r1).toBe('fam-existing');
    expect(plan.toCreate).toHaveLength(0);
  });

  it('marks rows with no family data as unassigned', () => {
    const plan = planFamilies([{ rowId: 'r1', data: null }], matchExisting);
    expect(plan.unassigned).toEqual(['r1']);
  });

  it('creates a solo family for data that has no dedupe key (name only)', () => {
    const plan = planFamilies([
      { rowId: 'r1', data: { family_name: 'Lee' } },
      { rowId: 'r2', data: { family_name: 'Lee' } },
    ], matchExisting);
    // name-only has no signature key → each row gets its own family
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.rowToCluster.r1).not.toBe(plan.rowToCluster.r2);
  });

  it('sanity: a keyed signature is non-empty', () => {
    expect(signatureKey(normalizeSignature({ primary_email: 'a@b.com' }))).not.toBe('');
  });
});
