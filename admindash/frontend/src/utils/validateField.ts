// admindash/frontend/src/utils/validateField.ts
import type { ModelFieldDefinition } from '../types/models.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

export function validateField(field: ModelFieldDefinition, value: unknown): string | null {
  const strValue = value != null ? String(value) : '';
  const isEmpty = strValue.trim() === '';

  if (field.type === 'bool') return null;
  if (field.type === 'selection' && field.multiple) {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) return 'Required';
    return null;
  }

  if (field.required && isEmpty) return 'Required';
  if (isEmpty) return null;

  switch (field.type) {
    case 'number':
      if (isNaN(Number(strValue))) return 'Must be a number';
      break;
    case 'email':
      if (!EMAIL_RE.test(strValue)) return 'Invalid email';
      break;
    case 'phone':
      if (!PHONE_RE.test(strValue)) return 'Invalid phone number';
      break;
  }
  return null;
}

export function validateRowAgainstModel(
  values: Record<string, unknown>,
  modelDef: { base_fields: ModelFieldDefinition[]; custom_fields: ModelFieldDefinition[] },
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of [...modelDef.base_fields, ...modelDef.custom_fields]) {
    const e = validateField(field, values[field.name]);
    if (e) errors[field.name] = e;
  }
  return errors;
}
