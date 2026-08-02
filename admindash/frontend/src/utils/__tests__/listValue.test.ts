import { describe, it, expect } from 'vitest';
import { toValues, toLabel, toToneKey } from '../listValue.ts';

describe('toValues', () => {
  it('passes plain strings through', () => {
    expect(toValues('Active')).toEqual(['Active']);
  });

  it('unwraps JSON arrays', () => {
    expect(toValues('["Active"]')).toEqual(['Active']);
    expect(toValues('["Active","On Leave"]')).toEqual(['Active', 'On Leave']);
  });

  it('unwraps Python-style reprs from the extraction pipeline', () => {
    // The case that was reaching the UI verbatim.
    expect(toValues("['Active']")).toEqual(['Active']);
    expect(toValues("['Suspended']")).toEqual(['Suspended']);
    expect(toValues("['Active', 'On Leave']")).toEqual(['Active', 'On Leave']);
  });

  it('unwraps bare bracketed lists', () => {
    expect(toValues('[2nd]')).toEqual(['2nd']);
    expect(toValues('[Kinder, 2nd]')).toEqual(['Kinder', '2nd']);
  });

  it('handles real arrays', () => {
    expect(toValues(['Active', 'Enrolled'])).toEqual(['Active', 'Enrolled']);
  });

  it('does not split on commas inside quotes', () => {
    expect(toValues("['Smith, John']")).toEqual(['Smith, John']);
  });

  it('returns nothing for empties', () => {
    expect(toValues(null)).toEqual([]);
    expect(toValues(undefined)).toEqual([]);
    expect(toValues('')).toEqual([]);
    expect(toValues('[]')).toEqual([]);
  });
});

describe('toLabel', () => {
  it('joins multi-selects', () => {
    expect(toLabel('["A","B"]')).toBe('A, B');
  });

  it('falls back when empty', () => {
    expect(toLabel(null)).toBe('—');
    expect(toLabel('', '-')).toBe('-');
  });

  it('never leaks brackets or quotes to the UI', () => {
    for (const raw of ["['Active']", '["Active"]', '[Active]', 'Active']) {
      expect(toLabel(raw)).toBe('Active');
    }
  });
});

describe('toToneKey', () => {
  it('produces the same key regardless of the wrapping', () => {
    // These four all rendered as different keys before, so only one of them
    // matched the tone map and the rest fell through to the neutral colour.
    const keys = ["['Active']", '["Active"]', '[Active]', 'Active'].map(toToneKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('active');
  });

  it('normalises spacing', () => {
    expect(toToneKey('On Leave')).toBe('on_leave');
    expect(toToneKey("['On Leave']")).toBe('on_leave');
  });
});
