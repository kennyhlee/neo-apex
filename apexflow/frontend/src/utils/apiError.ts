// Unwraps the human-readable sentence out of an `ApiError`'s parsed body.
//
// Extracted from `pages/DefinitionsPage.tsx`'s local `errorMessage` helper so
// the chat cards get the same unwrapping without importing from a page module.
// `ApiError.message` is only ever `HTTP ${status}` — everything worth showing a
// person is on `.body`, and dropping it is what makes a 422 read as a bare
// "Create failed: HTTP 422".
//
// The hard part is that this API's error bodies are of two KINDS, and only one
// of them is prose. Every shape below was read off the live routes:
//
//   prose, show it:
//     422 {"detail": {"parse_error": "2 validation errors for MachineDef\n…"}}
//     422 {"detail": [{"type": "missing", "loc": [...], "msg": "Field required", …}]}
//     404 {"detail": "workflow_definition not found"}
//
//   machine codes, NEVER show them:
//     409 {"detail": {"reason": "not_draft",      "status": "published"}}
//     409 {"detail": {"reason": "not_deprecated", "lineage_status": "active"}}
//     409 {"detail": {"reason": "draft_exists",   "entity_id": "…"}}
//     409 {"detail": {"errors": ["transition 'submit' effect …"]}}
//
// So the object branch reads only the keys known to carry a sentence, and
// returns null for anything else. Joining a dict's values instead would put
// "not_draft; published" in front of a user, in both locales, where the caller
// had translated copy ready — which is exactly the regression this shape once
// shipped. `errors` is excluded deliberately even though its strings are
// prose: it is the publish 409, whose call site renders the list itself.
//
// Returning null is not a failure mode — it is the contract. Callers pair it
// with their own translated fallback, so "no sentence from the server" lands on
// real copy rather than on a leaked wire value.
import { ApiError } from '../api/designer.ts';

/**
 * Body keys whose value is a human sentence rather than a code.
 * `parse_error`: the create/save 422 (app/workflows/definitions.py:282,480).
 * `msg`: one FastAPI request-validation entry.
 */
const PROSE_KEYS = ['parse_error', 'msg'] as const;

/** The sentence inside a JSON value, or null when it holds only codes. */
function flatten(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map(flatten).filter((p): p is string => p !== null);
    return parts.length ? parts.join('; ') : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of PROSE_KEYS) {
      if (key in record) {
        const text = flatten(record[key]);
        if (text !== null) return text;
      }
    }
    return null;
  }
  return null;
}

/**
 * The server's own words for this failure, or null when it did not send any
 * (a network error, a non-JSON body, a body of machine codes). Callers pair it
 * with their own translated fallback: `errorDetail(err) ?? t('someKey')`.
 */
export function errorDetail(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (typeof err.body === 'string') return err.body.trim() || null;
  if (!err.body || typeof err.body !== 'object') return null;
  return flatten((err.body as { detail?: unknown }).detail);
}
