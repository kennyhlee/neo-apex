// workflow-forms/src/validateField.ts
import type { FlowField } from './types';
import { flowTWith, type Locale } from './i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

/**
 * Validate one field, returning a localized message or null.
 *
 * The trailing `locale` is optional and settled deliberately NOW (final
 * review A13). This function is barrel-exported and about to gain its second
 * consumer in Plan 5's familyhub host: changing its signature is a one-host
 * change today and a two-host breaking change afterwards.
 *
 * Why a `locale` and not a `t`: the function is pure, so it cannot call
 * `useFlowT()`, and every message it can produce is a workflow-forms key — a
 * caller-supplied `t` would force both hosts to know those key names. A
 * `Locale` keeps the function pure and self-contained.
 *
 * Why optional: omitting it preserves the previous behaviour exactly (a
 * per-call `flowLocale()` read), so no existing call site changes meaning and
 * nothing regresses. Callers that HAVE a locale should pass it, because
 * `flowLocale()` reads localStorage and so does not re-translate on a
 * language toggle the way a component under `FlowLocaleContext` does.
 */
export function validateFlowField(
  field: FlowField, value: unknown, locale?: Locale,
): string | null {
  const tr = (key: string) => flowTWith(locale, key);
  const strValue = value != null ? String(value) : '';
  const isEmpty = strValue.trim() === '';

  if (field.type === 'bool') return null;
  if (field.type === 'selection' && field.multiple) {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) return tr('errRequired');
    return null;
  }

  if (field.required && isEmpty) return tr('errRequired');
  if (isEmpty) return null;

  switch (field.type) {
    case 'number':
      if (isNaN(Number(strValue))) return tr('errNumber');
      break;
    case 'email':
      if (!EMAIL_RE.test(strValue)) return tr('errEmail');
      break;
    case 'phone':
      if (!PHONE_RE.test(strValue)) return tr('errPhone');
      break;
  }
  return null;
}
