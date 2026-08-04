// flow-runtime/src/validateField.ts
import type { FlowField } from './types';
import { flowT } from './i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

export function validateFlowField(field: FlowField, value: unknown): string | null {
  const strValue = value != null ? String(value) : '';
  const isEmpty = strValue.trim() === '';

  if (field.type === 'bool') return null;
  if (field.type === 'selection' && field.multiple) {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) return flowT('errRequired');
    return null;
  }

  if (field.required && isEmpty) return flowT('errRequired');
  if (isEmpty) return null;

  switch (field.type) {
    case 'number':
      if (isNaN(Number(strValue))) return flowT('errNumber');
      break;
    case 'email':
      if (!EMAIL_RE.test(strValue)) return flowT('errEmail');
      break;
    case 'phone':
      if (!PHONE_RE.test(strValue)) return flowT('errPhone');
      break;
  }
  return null;
}
