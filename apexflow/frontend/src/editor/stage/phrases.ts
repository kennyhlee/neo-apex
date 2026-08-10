// Plain-language rendering of guard/effect primitives.
//
// Design decision this file implements: "Anything without a phrase renders
// as its raw primitive name with its params" — degraded, never hidden and
// never dropped. Enforcing that against the real backend registry (not a
// hand-typed copy of it) takes two parts: `apexflow/backend/scripts/
// generate_primitive_names_ts.py` generates `primitiveNames.generated.ts`
// from `app.workflows.primitives`' GUARDS/EFFECTS, and
// `apexflow/backend/tests/test_primitive_names_generated.py` fails if that
// file drifts from the registries. `phrases.test.ts` then imports the
// generated names and fails if any of them isn't accounted for here —
// together, a primitive added to the backend registry fails the suite
// instead of quietly degrading to raw in front of an admin, which is the
// whole point of the allowlist.
//
// A phrase is not always a fixed sentence. Where a primitive's PARAMS decide
// what it actually tests or writes, the sentence is derived from them (see
// `PARAM_DERIVED` below) — `items_in_status` read as "only if the required
// items are complete" for a `{status:'rejected', quantifier:'any'}` guard,
// which is the inverse of what it does. A fixed phrase is only correct for a
// primitive whose params cannot change its meaning.
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

type Translate = (key: string) => string;

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' ? [value] : [];
}

/**
 * `workflow_item.status` values that mean the item has been handed in — the
 * "complete" side of the vocabulary (`shared.py`'s `ItemStatus`:
 * not_started, submitted, verified, waived, rejected). Both shipped
 * templates' completion guards use a subset of these (`['submitted',
 * 'verified']`, `['verified', 'waived']`).
 */
const DONE_STATUSES: readonly string[] = ['submitted', 'verified', 'waived'];

/** Adjectival phrase for a set of item statuses. Falls back to listing the
 * raw values rather than picking a bucket it cannot justify — vague beats
 * wrong, which is this whole finding. */
function statusPhrase(statuses: string[], t: Translate): string {
  if (statuses.every((s) => s === 'rejected')) return t('editor.phrase.itemStatus.rejected');
  if (statuses.every((s) => DONE_STATUSES.includes(s))) return t('editor.phrase.itemStatus.complete');
  if (statuses.every((s) => s === 'not_started')) return t('editor.phrase.itemStatus.notStarted');
  return statuses.join(' / ');
}

/**
 * `items_in_status{step_ids?, status, quantifier?}`.
 *
 * A fixed sentence for this primitive states the INVERSE of the truth on
 * shipped data: enrollment's `t_flag_pending_items` carries
 * `{step_ids:['application_form'], status:'rejected', quantifier:'any'}` and
 * read as "only if the required items are complete". Both params are
 * load-bearing — `status` says which side of the vocabulary is being tested
 * and `quantifier` says whether one item or all of them must be there
 * (`primitives.py`'s `_guard_items_in_status`, where `all` is the default).
 */
function describeItemsInStatus(params: Record<string, unknown>, t: Translate): string {
  const statuses = stringList(params.status);
  // No usable `status` at all — `validate.py` rejects this at publish, but a
  // draft can hold it, and a sentence naming no status is the honest render.
  if (statuses.length === 0) return t('editor.phrase.items_in_status');
  const quantifier = params.quantifier === 'any' ? 'any' : 'all';
  const stepIds = stringList(params.step_ids);
  const key = stepIds.length > 0
    ? `editor.phrase.items_in_status.${quantifier}In`
    : `editor.phrase.items_in_status.${quantifier}`;
  return t(key)
    .replace('{steps}', stepIds.join(', '))
    .replace('{status}', statusPhrase(statuses, t));
}

/**
 * `set_entity_field{ref, field, value}`. The fixed sentence ("records the
 * decision on the application") described neither of the two shipped uses:
 * signup writes `enrollment.status = Withdrawn`, enrollment writes
 * `student.status = Enrolled`. Neither is an application, and only one is a
 * decision.
 */
function describeSetEntityField(params: Record<string, unknown>, t: Translate): string {
  const ref = typeof params.ref === 'string' ? params.ref : '';
  const field = typeof params.field === 'string' ? params.field : '';
  if (!ref || !field) return t('editor.phrase.set_entity_field');
  const value = params.value;
  const rendered = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return t('editor.phrase.set_entity_field.detail')
    .replace('{ref}', ref)
    .replace('{field}', field)
    .replace('{value}', rendered);
}

/** `date_window{start?, end?}` — either bound may be absent (`validate.py`
 * only requires at least one), and neither was ever mentioned by the fixed
 * "only during the enrolment window", which also assumed a use this
 * primitive does not have exclusively. */
function describeDateWindow(params: Record<string, unknown>, t: Translate): string {
  const start = typeof params.start === 'string' ? params.start : '';
  const end = typeof params.end === 'string' ? params.end : '';
  if (start && end)
    return t('editor.phrase.date_window.between').replace('{start}', start).replace('{end}', end);
  if (start) return t('editor.phrase.date_window.from').replace('{start}', start);
  if (end) return t('editor.phrase.date_window.until').replace('{end}', end);
  return t('editor.phrase.date_window');
}

/** `set_context{key, value}` writes an arbitrary key onto the workflow
 * instance's context — not "a note on the application", which named the
 * wrong record and the wrong kind of write. */
function describeSetContext(params: Record<string, unknown>, t: Translate): string {
  const key = typeof params.key === 'string' ? params.key : '';
  if (!key) return t('editor.phrase.set_context');
  const value = params.value;
  if (value === undefined || value === null) {
    return t('editor.phrase.set_context.key').replace('{key}', key);
  }
  const rendered = typeof value === 'string' ? value : JSON.stringify(value);
  return t('editor.phrase.set_context.detail').replace('{key}', key).replace('{value}', rendered);
}

/**
 * Primitives whose sentence is derived from their params. Everything else
 * keeps a fixed phrase, and anything unphrased falls through to its raw
 * name plus params.
 *
 * `t` stays a parameter (never a `useTranslation()` call) so this module is
 * pure and testable without React — see the module header.
 */
const PARAM_DERIVED: Record<string, (params: Record<string, unknown>, t: Translate) => string> = {
  items_in_status: describeItemsInStatus,
  set_entity_field: describeSetEntityField,
  date_window: describeDateWindow,
  set_context: describeSetContext,
};

export function describePrimitive(ref: GuardRef | EffectRef, t: Translate): string {
  const key = phraseKey(ref.primitive);
  if (key === null) return `${ref.primitive}${renderParams(ref.params)}`;
  const derive = PARAM_DERIVED[ref.primitive];
  if (derive) return derive(ref.params ?? {}, t);
  return t(key);
}
