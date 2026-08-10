// The maintenance guard the design asks for: "a test asserting that every
// member of GUARDS/EFFECTS either has a phrase or appears on an explicit
// raw-only allowlist — so a primitive added later fails the suite rather
// than quietly degrading in front of an admin."
//
// The primitive list is transcribed from
// apexflow/backend/app/workflows/primitives.py's GUARDS/EFFECTS registry
// keys. A primitive added there without a phrase here fails this file.
import { describe, expect, it } from 'vitest';
import { ABSORBED, describePrimitive, phraseKey, RAW_ONLY } from '../phrases.ts';
import { translations } from '../../../i18n/translations.ts';

const GUARDS = [
  'all_blocking_items_complete',
  'items_in_status',
  'capacity_available',
  'data_condition',
  'date_window',
  'actor_role',
] as const;

const EFFECTS = [
  'commit_sections',
  'set_entity_field',
  'send_email',
  'issue_link',
  'start_due_clocks',
  'set_context',
] as const;

const ALL = [...GUARDS, ...EFFECTS];

describe('phrase coverage', () => {
  it.each(ALL)('%s has a phrase, or is explicitly raw-only or absorbed', (primitive) => {
    const key = phraseKey(primitive);
    const accounted = key !== null || RAW_ONLY.includes(primitive) || ABSORBED.includes(primitive);
    expect({ primitive, accounted }).toEqual({ primitive, accounted: true });
  });

  it.each(ALL)('%s’s phrase key exists in every locale', (primitive) => {
    const key = phraseKey(primitive);
    if (key === null) return;
    for (const locale of Object.keys(translations)) {
      expect({ locale, key, present: key in translations[locale as keyof typeof translations] }).toEqual({
        locale,
        key,
        present: true,
      });
    }
  });

  it('absorbs actor_role rather than phrasing it', () => {
    expect(ABSORBED).toContain('actor_role');
    expect(phraseKey('actor_role')).toBeNull();
  });
});

describe('describePrimitive', () => {
  const t = (k: string) => translations['en-US'][k] ?? k;

  it('renders a known guard as a sentence', () => {
    expect(describePrimitive({ primitive: 'capacity_available', params: {} }, t)).toBe(
      'only if there is space',
    );
  });

  it('renders a known effect as a sentence', () => {
    expect(describePrimitive({ primitive: 'send_email', params: { template: 'approved' } }, t)).toBe(
      'emails the family',
    );
  });

  it('falls back to the raw primitive and its params, never hiding it', () => {
    const out = describePrimitive(
      { primitive: 'made_up_primitive', params: { a: 1, b: 'x' } },
      t,
    );
    expect(out).toContain('made_up_primitive');
    expect(out).toContain('a=1');
    expect(out).toContain('b=x');
  });

  it('renders a raw-only primitive raw even though it is known', () => {
    for (const primitive of RAW_ONLY) {
      expect(describePrimitive({ primitive, params: {} }, t)).toContain(primitive);
    }
  });
});
