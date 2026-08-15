// Unwraps the human-readable sentence out of an `ApiError`'s parsed body.
//
// Extracted from `pages/DefinitionsPage.tsx`'s local `errorMessage` helper so
// the chat cards get the same unwrapping without importing from a page module.
// `ApiError.message` is only ever `HTTP ${status}` — everything worth showing a
// person is on `.body`, and dropping it is what makes a 422 read as a bare
// "Create failed: HTTP 422".
//
// One behaviour is deliberately WIDER than the original: a `detail` that is not
// a string is flattened rather than discarded. FastAPI puts a dict there for
// the create/save routes (`{"parse_error": "..."}` — api/designer.py:105) and a
// list there for request-validation failures, and those are precisely the
// bodies whose text the operator needs. A body with NO `detail` still yields
// null, so the publish 409 (`{errors: [...]}`, rendered in its own dialog) and
// the archive 409 (`{open_instances: N}`, rendered as its own sentence) keep
// falling through to their callers' fallback copy exactly as before.
import { ApiError } from '../api/designer.ts';

/**
 * Depth-first join of every string in a JSON value; null when it holds none.
 *
 * The one special case is a FastAPI request-validation entry — `{type, loc,
 * msg, input}` — where a blind join reads "dict_type; body; machine; Input
 * should be a valid dictionary; {not json" and only the `msg` is the sentence.
 * Both shapes below were read off the live route, not assumed:
 *   422 `{"detail": [{"type": "missing", "loc": ["body","name"],
 *                     "msg": "Field required", "input": {...}}]}`
 *   422 `{"detail": {"parse_error": "2 validation errors for MachineDef\n…"}}`
 */
function flatten(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map(flatten).filter((p): p is string => p !== null);
    return parts.length ? parts.join('; ') : null;
  }
  if (value && typeof value === 'object') {
    const msg = (value as { msg?: unknown }).msg;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    const parts = Object.values(value)
      .map(flatten)
      .filter((p): p is string => p !== null);
    return parts.length ? parts.join('; ') : null;
  }
  return null;
}

/**
 * The server's own words for this failure, or null when it did not send any
 * (a network error, a non-JSON body, a body of pure numbers). Callers pair it
 * with their own translated fallback: `errorDetail(err) ?? t('someKey')`.
 */
export function errorDetail(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (typeof err.body === 'string') return err.body.trim() || null;
  if (!err.body || typeof err.body !== 'object') return null;
  return flatten((err.body as { detail?: unknown }).detail);
}
