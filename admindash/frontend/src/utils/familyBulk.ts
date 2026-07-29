import type { FamilyData } from '../types/models.ts';

/** CSV mapping targets for family fields. Kept distinct from student field
 *  names so a mapped family column never collides with a student column. */
export const FAMILY_TARGETS = [
  { target: 'family_name', i18nKey: 'familyPicker.newFamilyName' },
  { target: 'family_email', i18nKey: 'familyPicker.newEmail' },
  { target: 'family_phone', i18nKey: 'familyPicker.newPhone' },
  { target: 'family_address', i18nKey: 'familyPicker.newAddress' },
] as const;

export const FAMILY_TARGET_NAMES = FAMILY_TARGETS.map((f) => f.target);

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Read the four family_* keys out of a row's values into FamilyData, or null
 *  if the row carries no family info at all. */
export function extractFamilyValues(values: Record<string, unknown>): FamilyData | null {
  const family_name = str(values.family_name);
  const primary_email = str(values.family_email);
  const primary_phone = str(values.family_phone);
  const primary_address = str(values.family_address);
  if (!family_name && !primary_email && !primary_phone && !primary_address) return null;
  return {
    family_name,
    primary_email: primary_email || undefined,
    primary_phone: primary_phone || undefined,
    primary_address: primary_address || undefined,
  };
}
