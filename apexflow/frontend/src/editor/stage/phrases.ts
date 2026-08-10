// Plain-language rendering of guard/effect primitives.
//
// Design decision this file implements: "Anything without a phrase renders
// as its raw primitive name with its params" — degraded, never hidden and
// never dropped. `phrases.test.ts` fails if a primitive is added to the
// backend registry without being accounted for here, which is the whole
// point of the allowlist.
//
// `t` is a parameter rather than a `useTranslation()` call so this module is
// pure and testable without React.
import type { EffectRef, GuardRef } from '../../types/designer.ts';

/**
 * Primitives another control owns entirely, so they must NOT render as a
 * guard at all. `actor_role` is folded into "Who can do it" by
 * `read.ts`'s `splitActorRole`; showing it again would let an author edit
 * two things that must agree.
 */
export const ABSORBED: readonly string[] = ['actor_role'];

/**
 * Primitives deliberately shown raw. `data_condition` wraps an arbitrary
 * condition expression — a fixed sentence would either lie about what it
 * tests or say nothing, so it shows its shape and offers "Edit as advanced".
 */
export const RAW_ONLY: readonly string[] = ['data_condition'];

const PHRASED: readonly string[] = [
  'all_blocking_items_complete',
  'items_in_status',
  'capacity_available',
  'date_window',
  'commit_sections',
  'set_entity_field',
  'send_email',
  'issue_link',
  'start_due_clocks',
  'set_context',
];

export function phraseKey(primitive: string): string | null {
  if (!PHRASED.includes(primitive)) return null;
  return `editor.phrase.${primitive}`;
}

function renderParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '';
  const rendered = entries
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  return `(${rendered})`;
}

export function describePrimitive(ref: GuardRef | EffectRef, t: (key: string) => string): string {
  const key = phraseKey(ref.primitive);
  if (key === null) return `${ref.primitive}${renderParams(ref.params)}`;
  return t(key);
}
