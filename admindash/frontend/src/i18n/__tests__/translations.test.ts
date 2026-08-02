import { describe, it, expect } from 'vitest';
import { translations } from '../translations.ts';

/**
 * A missing key renders the raw key string in the UI with no warning — so
 * "students.emptySearchTitle" appears verbatim on screen for a zh-CN user.
 * Thirteen keys had already drifted out of zh-CN before this test existed.
 */
describe('translation locales stay in step', () => {
  const en = Object.keys(translations['en-US']);
  const zh = Object.keys(translations['zh-CN']);

  it('has the same keys in every locale', () => {
    const missingInZh = en.filter((k) => !(k in translations['zh-CN']));
    const missingInEn = zh.filter((k) => !(k in translations['en-US']));
    expect({ missingInZh, missingInEn }).toEqual({ missingInZh: [], missingInEn: [] });
  });

  it('has no empty values', () => {
    for (const [locale, table] of Object.entries(translations)) {
      const blank = Object.entries(table)
        .filter(([, v]) => !String(v).trim())
        .map(([k]) => k);
      expect(blank, `blank values in ${locale}`).toEqual([]);
    }
  });

  it('keeps interpolation placeholders consistent across locales', () => {
    const placeholders = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const key of en) {
      const a = placeholders(translations['en-US'][key]);
      const b = placeholders(translations['zh-CN'][key] ?? '');
      expect(b, `placeholders differ for "${key}"`).toEqual(a);
    }
  });
});
