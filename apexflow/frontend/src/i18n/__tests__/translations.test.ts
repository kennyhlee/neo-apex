import { describe, expect, it } from 'vitest';
import { translations, type Locale } from '../translations.ts';

const LOCALES = Object.keys(translations) as Locale[];

describe('translations', () => {
  it('ships more than one locale', () => {
    expect(LOCALES.length).toBeGreaterThan(1);
  });

  it('has the same key set in every locale', () => {
    const reference = LOCALES[0];
    const referenceKeys = Object.keys(translations[reference]).sort();
    for (const locale of LOCALES.slice(1)) {
      const keys = Object.keys(translations[locale]).sort();
      const missing = referenceKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !referenceKeys.includes(k));
      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] });
    }
  });

  it('has no blank values', () => {
    const blank: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(translations[locale])) {
        if (value.trim() === '') blank.push(`${locale}:${key}`);
      }
    }
    expect(blank).toEqual([]);
  });
});
