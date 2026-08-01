import { describe, it, expect } from 'vitest';
import {
  normalizeSignature,
  signatureKey,
  matchFamily,
  clusterSiblings,
} from '../familyMatch.ts';

describe('normalizeSignature', () => {
  it('lowercases/trims email, strips non-digits from phone, collapses name/address', () => {
    const sig = normalizeSignature({
      primary_email: '  Nguyen@Example.COM ',
      primary_phone: '(415) 555-0100',
      family_name: '  Nguyen   Family ',
      primary_address: '12  Main St. ',
    });
    expect(sig.email).toBe('nguyen@example.com');
    expect(sig.phone).toBe('4155550100');
    expect(sig.name).toBe('nguyen family');
    expect(sig.address).toBe('12 main st.');
  });

  it('yields empty strings for missing fields', () => {
    expect(normalizeSignature({})).toEqual({ email: '', phone: '', name: '', address: '' });
  });
});

describe('signatureKey', () => {
  it('prefers email, then phone, then name+address', () => {
    expect(signatureKey({ email: 'a@b.com', phone: '123', name: 'x', address: 'y' })).toBe('e:a@b.com');
    expect(signatureKey({ email: '', phone: '4155550100', name: 'x', address: 'y' })).toBe('p:4155550100');
    expect(signatureKey({ email: '', phone: '', name: 'nguyen', address: '12 main' })).toBe('na:nguyen|12 main');
  });

  it('is empty when nothing identifies the family', () => {
    expect(signatureKey({ email: '', phone: '', name: 'nguyen', address: '' })).toBe('');
    expect(signatureKey({ email: '', phone: '', name: '', address: '' })).toBe('');
  });
});

describe('matchFamily', () => {
  const candidates = [
    { entity_id: 'fam-email', primary_email: 'match@x.com' },
    { entity_id: 'fam-phone', primary_phone: '415-555-0100' },
    { entity_id: 'fam-na', family_name: 'Nguyen', primary_address: '12 Main St' },
  ];

  it('matches on email first', () => {
    const sig = normalizeSignature({ primary_email: 'MATCH@x.com', primary_phone: '415-555-0100' });
    expect(matchFamily(sig, candidates)).toBe('fam-email');
  });

  it('falls back to phone', () => {
    const sig = normalizeSignature({ primary_phone: '(415) 555-0100' });
    expect(matchFamily(sig, candidates)).toBe('fam-phone');
  });

  it('falls back to name+address', () => {
    const sig = normalizeSignature({ family_name: 'nguyen', primary_address: '12 main st' });
    expect(matchFamily(sig, candidates)).toBe('fam-na');
  });

  it('returns null when nothing matches', () => {
    const sig = normalizeSignature({ primary_email: 'nobody@x.com' });
    expect(matchFamily(sig, candidates)).toBeNull();
  });

  it('returns null for an empty signature', () => {
    expect(matchFamily(normalizeSignature({}), candidates)).toBeNull();
  });
});

describe('clusterSiblings', () => {
  it('groups rows with the same key and marks family-less rows as -1', () => {
    const sigs = [
      normalizeSignature({ family_name: 'Nguyen', primary_address: '12 Main' }),
      normalizeSignature({ family_name: 'nguyen', primary_address: '12 main' }),
      normalizeSignature({ primary_email: 'lee@x.com' }),
      normalizeSignature({}),
    ];
    const clusters = clusterSiblings(sigs);
    expect(clusters[0]).toBe(clusters[1]); // siblings share a cluster
    expect(clusters[0]).not.toBe(clusters[2]);
    expect(clusters[3]).toBe(-1); // no family info
  });
});
