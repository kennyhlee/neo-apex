import { describe, it, expect } from 'vitest';
import { toneFor, tileTintFor, hashIndex, TILE_TINTS } from '../tone.ts';

describe('toneFor', () => {
  it('is unaffected by how the value was wrapped', () => {
    for (const raw of ["['Active']", '["Active"]', '[Active]', 'Active']) {
      expect(toneFor(raw)).toBe('ok');
    }
  });

  it('resolves the student statuses in the local tenant', () => {
    // acme-afterschool: these are the real values on disk.
    expect(toneFor("['Active']")).toBe('ok');
    expect(toneFor('Enrolled')).toBe('ok');
    expect(toneFor("['Suspended']")).toBe('info');
    expect(toneFor('Waitlisted')).toBe('attn');
  });

  it('resolves the program statuses in the local tenant', () => {
    expect(toneFor("['Upcoming']")).toBe('info');
    expect(toneFor('Upcoming')).toBe('info');
  });

  it('separates present, needs-action, informational and gone', () => {
    expect(toneFor('Enrolled')).toBe('ok');
    expect(toneFor('Pending')).toBe('attn');
    expect(toneFor('Graduated')).toBe('info');
    expect(toneFor('Withdrawn')).toBe('risk');
  });

  it('normalises spacing and case', () => {
    expect(toneFor('ON LEAVE')).toBe('attn');
    expect(toneFor('on_leave')).toBe('attn');
    expect(toneFor('On Leave')).toBe('attn');
  });

  it('gives unknown values a stable tone, never ok or risk', () => {
    // Guessing "good" or "bad" for a status we do not recognise would be
    // worse than saying nothing.
    for (const unknown of ['Frobnicated', 'Tier 3', 'Zzz']) {
      const tone = toneFor(unknown);
      expect(['info', 'neutral', 'away']).toContain(tone);
      expect(toneFor(unknown)).toBe(tone); // stable across calls
    }
  });

  it('falls back to neutral for empties', () => {
    expect(toneFor(null)).toBe('neutral');
    expect(toneFor('')).toBe('neutral');
  });
});

describe('tileTintFor', () => {
  it('is stable for the same name', () => {
    expect(tileTintFor('Amara Osei')).toBe(tileTintFor('Amara Osei'));
  });

  it('only ever returns a defined tint', () => {
    for (const n of ['Amara Osei', 'Wei Lin', 'fun activity', '']) {
      expect(TILE_TINTS).toContain(tileTintFor(n) as (typeof TILE_TINTS)[number]);
    }
  });

  it('spreads names across the available tints', () => {
    const names = ['Amara Osei', 'Bennett Cho', 'Priya Raghunathan', 'Tomás Herrera',
                   'Wei Lin', 'Dorothy Nkemelu', 'Nadia Farouk', 'Owen Whitfield'];
    expect(new Set(names.map(tileTintFor)).size).toBeGreaterThan(1);
  });
});

describe('hashIndex', () => {
  it('stays within bounds', () => {
    for (const s of ['', 'a', 'a much longer string than the others']) {
      const i = hashIndex(s, 6);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });
});
