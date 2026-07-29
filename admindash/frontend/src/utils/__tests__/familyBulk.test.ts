import { describe, it, expect } from 'vitest';
import { FAMILY_TARGET_NAMES, extractFamilyValues } from '../familyBulk.ts';

describe('FAMILY_TARGET_NAMES', () => {
  it('lists the four family mapping targets', () => {
    expect(FAMILY_TARGET_NAMES).toEqual([
      'family_name', 'family_email', 'family_phone', 'family_address',
    ]);
  });
});

describe('extractFamilyValues', () => {
  it('maps family_* keys onto FamilyData', () => {
    const fam = extractFamilyValues({
      first_name: 'An',                 // student field — ignored
      family_name: 'Nguyen',
      family_email: 'ng@x.com',
      family_phone: '415-555-0100',
      family_address: '12 Main',
    });
    expect(fam).toEqual({
      family_name: 'Nguyen',
      primary_email: 'ng@x.com',
      primary_phone: '415-555-0100',
      primary_address: '12 Main',
    });
  });

  it('returns null when no family field is present', () => {
    expect(extractFamilyValues({ first_name: 'An' })).toBeNull();
  });

  it('keeps a family with only a name', () => {
    expect(extractFamilyValues({ family_name: 'Lee' })).toEqual({
      family_name: 'Lee',
      primary_email: undefined,
      primary_phone: undefined,
      primary_address: undefined,
    });
  });
});
