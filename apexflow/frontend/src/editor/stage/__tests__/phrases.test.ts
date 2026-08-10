// The maintenance guard the design asks for: "a test asserting that every
// member of GUARDS/EFFECTS either has a phrase or appears on an explicit
// raw-only allowlist — so a primitive added later fails the suite rather
// than quietly degrading in front of an admin."
//
// The primitive list is NOT hand-typed here — that would only catch drift
// against its own copy, not against the backend registry. It's imported
// from `primitiveNames.generated.ts`, generated from
// apexflow/backend/app/workflows/primitives.py's GUARDS/EFFECTS registry by
// `apexflow/backend/scripts/generate_primitive_names_ts.py` and guarded by
// `apexflow/backend/tests/test_primitive_names_generated.py`. A primitive
// added to the backend registry fails that Python drift test first; once
// regenerated, it fails this file if it's not accounted for here.
import { describe, expect, it } from 'vitest';
import { ABSORBED, describePrimitive, phraseKey, RAW_ONLY } from '../phrases.ts';
import { EFFECT_NAMES, GUARD_NAMES } from '../primitiveNames.generated.ts';
import { translations } from '../../../i18n/translations.ts';

const ALL = [...GUARD_NAMES, ...EFFECT_NAMES];

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

// ---------------------------------------------------------------------------
// Param-derived phrases.
//
// The finding these cover: a fixed sentence per primitive stated the INVERSE
// of the truth on shipped data. `items_in_status` is the one that inverts, so
// it gets the real definitions' own params, not invented ones.
// ---------------------------------------------------------------------------
describe('describePrimitive — items_in_status', () => {
  const t = (k: string) => translations['en-US'][k] ?? k;

  // enrollment.py's `t_flag_pending_items`, verbatim. This is the guard that
  // rendered as "only if the required items are complete".
  it('reads a rejected/any guard as a rejection, not a completion', () => {
    const out = describePrimitive(
      {
        primitive: 'items_in_status',
        params: { step_ids: ['application_form'], status: 'rejected', quantifier: 'any' },
      },
      t,
    );
    expect(out).toBe('only if any application_form item is sent back');
    expect(out).not.toContain('complete');
  });

  // signup.py's confirm guard, verbatim.
  it('reads a submitted-or-verified/all guard as a completion', () => {
    expect(
      describePrimitive(
        {
          primitive: 'items_in_status',
          params: { step_ids: ['signup_form'], status: ['submitted', 'verified'], quantifier: 'all' },
        },
        t,
      ),
    ).toBe('only if every signup_form item is complete');
  });

  // enrollment.py's `t_finalize_enrollment` guard, verbatim.
  it('reads a verified-or-waived/all guard as a completion too', () => {
    expect(
      describePrimitive(
        {
          primitive: 'items_in_status',
          params: { step_ids: ['documents'], status: ['verified', 'waived'], quantifier: 'all' },
        },
        t,
      ),
    ).toBe('only if every documents item is complete');
  });

  it('defaults the quantifier to "all", as _guard_items_in_status does', () => {
    expect(
      describePrimitive({ primitive: 'items_in_status', params: { status: 'verified' } }, t),
    ).toBe('only if every required item is complete');
  });

  it('drops the step clause when the guard is not scoped to steps', () => {
    const out = describePrimitive(
      { primitive: 'items_in_status', params: { status: 'rejected', quantifier: 'any' } },
      t,
    );
    expect(out).toBe('only if any item is sent back');
    expect(out).not.toContain('{steps}');
  });

  it('names every scoped step, not just the first', () => {
    expect(
      describePrimitive(
        {
          primitive: 'items_in_status',
          params: { step_ids: ['application_form', 'documents'], status: 'verified' },
        },
        t,
      ),
    ).toBe('only if every application_form, documents item is complete');
  });

  it('lists the raw statuses rather than guessing a bucket it cannot justify', () => {
    const out = describePrimitive(
      { primitive: 'items_in_status', params: { status: ['not_started', 'rejected'] } },
      t,
    );
    expect(out).toContain('not_started');
    expect(out).toContain('rejected');
  });

  it('falls back to the bare phrase when a draft carries no usable status', () => {
    expect(describePrimitive({ primitive: 'items_in_status', params: {} }, t)).toBe(
      translations['en-US']['editor.phrase.items_in_status'],
    );
  });

  it('leaves no placeholder unsubstituted in either locale', () => {
    for (const locale of Object.keys(translations) as (keyof typeof translations)[]) {
      const tl = (k: string) => translations[locale][k] ?? k;
      for (const params of [
        { step_ids: ['application_form'], status: 'rejected', quantifier: 'any' },
        { status: ['submitted', 'verified'], quantifier: 'all' },
      ]) {
        const out = describePrimitive({ primitive: 'items_in_status', params }, tl);
        expect({ locale, out, clean: !out.includes('{') }).toEqual({ locale, out, clean: true });
      }
    }
  });
});

describe('describePrimitive — the other param-derived phrases', () => {
  const t = (k: string) => translations['en-US'][k] ?? k;

  // signup.py's confirmed drop pair and enrollment.py's approve effects.
  it('set_entity_field names the record, the field and the value', () => {
    expect(
      describePrimitive(
        {
          primitive: 'set_entity_field',
          params: { ref: 'enrollment', field: 'status', value: 'Withdrawn' },
        },
        t,
      ),
    ).toBe('sets the enrollment’s status to “Withdrawn”');
    expect(
      describePrimitive(
        { primitive: 'set_entity_field', params: { ref: 'student', field: 'status', value: 'Enrolled' } },
        t,
      ),
    ).toBe('sets the student’s status to “Enrolled”');
  });

  it('set_entity_field falls back when ref or field is missing', () => {
    expect(describePrimitive({ primitive: 'set_entity_field', params: { value: 'x' } }, t)).toBe(
      translations['en-US']['editor.phrase.set_entity_field'],
    );
  });

  it('date_window names whichever bounds it actually has', () => {
    expect(
      describePrimitive(
        { primitive: 'date_window', params: { start: '2026-01-01', end: '2026-03-31' } },
        t,
      ),
    ).toBe('only between 2026-01-01 and 2026-03-31');
    expect(
      describePrimitive({ primitive: 'date_window', params: { start: '2026-01-01' } }, t),
    ).toBe('only from 2026-01-01 onwards');
    expect(describePrimitive({ primitive: 'date_window', params: { end: '2026-03-31' } }, t)).toBe(
      'only until 2026-03-31',
    );
  });

  it('set_context names the key it writes, on the workflow rather than an application', () => {
    const out = describePrimitive(
      { primitive: 'set_context', params: { key: 'school_year', value: '2026-2027' } },
      t,
    );
    expect(out).toContain('school_year');
    expect(out).toContain('2026-2027');
    expect(out).not.toContain('application');
  });
});
