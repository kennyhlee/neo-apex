import { ITEM_DONE_STATUSES } from '@neoapex/flow-runtime';
import { parseMachineStates } from './workflowData.ts';

/**
 * Pure logic for the AdminDash attention queue — no network, no React, so
 * vitest exercises it directly under the node environment (same shape as
 * `workflowData.ts`, which this module sits beside and reuses).
 *
 * Two properties this module exists to guarantee:
 *
 * 1. Home's counts and `/attention`'s rows come from ONE grouping, so they
 *    cannot disagree. Home renders `.length`; the page renders the rows.
 * 2. No age is ever derived from `_created_at`. DataCore rebuilds the row on
 *    every write with `_created_at = now` (`store.py:378-388`), so on an
 *    active row it means last-modified. Ages come from `due_at`, from
 *    `workflow_activity."at"`, or not at all.
 *
 * SQL notes: `SELECT *` is banned here — the flattened table carries a
 * 1024-float `vector` column and `/api/query` returns it (unlike
 * `/api/query/readonly`, which pops it). `at` is quoted because it is a
 * DuckDB reserved keyword. `oneInstanceSql` is the sole deliberate exception
 * to the `SELECT *` ban — see its own doc comment for why.
 */

export type BucketKey = 'overdue' | 'review' | 'stalled';

/** A `workflow_definition` row, published, as `publishedDefinitionsSql`
 * returns it. `machine` arrives JSON-ENCODED (DataCore flattens scalars to
 * strings); `parseMachineStates` tolerates both that and a parsed object. */
export interface DefinitionRow {
  definition_id?: string;
  name?: string;
  machine?: unknown;
  [key: string]: unknown;
}

/** One flagged `workflow_item`, already joined to its instance.
 * `last_item_change` is null for items last touched before apexflow began
 * writing `item_id` — the age is then omitted, never guessed. */
export interface ItemAttentionRow {
  item_entity_id?: string;
  title?: string;
  due_at?: string | null;
  instance_entity_id?: string;
  definition_id?: string;
  state?: string;
  applicant_email?: string;
  last_item_change?: string | null;
  [key: string]: unknown;
}

/** One instance with the timestamp of its most recent activity of any type. */
export interface InstanceSilenceRow {
  instance_entity_id?: string;
  definition_id?: string;
  state?: string;
  applicant_email?: string;
  last_activity?: string | null;
  [key: string]: unknown;
}

/** Doubled single quotes, same rule as `workflowData.ts::escapeSqlLiteral` —
 * reimplemented rather than imported so each module stays a leaf. */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Every published definition in the lineage set, with the machine JSON the
 * terminal-state index is built from. Retired lineages are INCLUDED:
 * `lineage_status = 'retired'` stops new instances, but the ones already in
 * flight are still real work. */
export function publishedDefinitionsSql(): string {
  return (
    `SELECT definition_id, name, machine FROM data ` +
    `WHERE entity_type = 'workflow_definition' AND _status = 'active' ` +
    `AND status = 'published'`
  );
}

/**
 * The `machine` of one lineage's published row, for the instance drawer.
 *
 * Keyed on `status = 'published'` rather than on a version number: an
 * attention row carries no `definition_version`, and guessing one (`1`) breaks
 * the moment a lineage is republished. `WorkflowPipelinePage` reaches the same
 * row via `pinnedDefinitionSql` only because it already holds the published
 * version from the definitions list.
 */
export function publishedMachineSql(definitionId: string): string {
  return (
    `SELECT machine FROM data WHERE entity_type = 'workflow_definition' ` +
    `AND _status = 'active' AND status = 'published' ` +
    `AND definition_id = '${escapeSqlLiteral(definitionId)}'`
  );
}

/** Columns both item buckets need, unqualified by SELECT so each builder can
 * prepend/append its own extra columns (`due_at`, the activity aggregate)
 * without duplicating this list. `due_at` is NOT here: it is written only by
 * `start_due_clocks`, so a tenant with no due-dated item ever has no `due_at`
 * column at all, and referencing an absent column is a Binder Error, not a
 * null result (Task 8). `submittedItemsSql` never uses the value — a review
 * row's age comes from `last_item_change` — so it must not select it. */
const ITEM_SELECT_COMMON =
  `i.entity_id AS item_entity_id, i.title AS title, ` +
  `i.instance_id AS instance_entity_id, inst.definition_id AS definition_id, ` +
  `inst.state AS state, inst.applicant_email AS applicant_email`;

/** The item -> instance -> activity join. `a.item_id = i.entity_id` is what
 * makes the age per-ITEM rather than per-instance (Task 1). The column
 * resolves even on a tenant where no activity row has ever carried it: the
 * flattened table is the union of every entity type's columns, and
 * `workflow_item` rows supply `item_id`. Unattributed rows simply return
 * `last_item_change: null`. */
const ITEM_JOIN =
  ` FROM data i ` +
  `JOIN data inst ON inst.entity_id = i.instance_id ` +
  `AND inst.entity_type = 'workflow_instance' AND inst._status = 'active' ` +
  `LEFT JOIN data a ON a.instance_id = inst.entity_id ` +
  `AND a.entity_type = 'workflow_activity' AND a._status = 'active' ` +
  `AND a.type = 'item_change' AND a.item_id = i.entity_id`;

/** `ITEM_SELECT_COMMON` is 6 non-aggregate columns; `submittedItemsSql` adds
 * none, `overdueItemsSql` adds `due_at` as a 7th. Each builder's `GROUP BY`
 * ordinals must match its own non-aggregate column count exactly. */
const ITEM_GROUP_6 = ` GROUP BY 1, 2, 3, 4, 5, 6`;
const ITEM_GROUP_7 = ` GROUP BY 1, 2, 3, 4, 5, 6, 7`;

/** Items a family has sent in that staff must verify or reject.
 *
 * Deliberately does not select `due_at` — a review row's age comes from
 * `last_item_change`, never `due_at`, and `due_at` is absent entirely from a
 * tenant's flattened table until some item gets a due date. Selecting it here
 * would 400 the review bucket on such a tenant for a column it never needed
 * (Task 8). */
export function submittedItemsSql(): string {
  return (
    `SELECT ${ITEM_SELECT_COMMON}, MAX(a."at") AS last_item_change` + ITEM_JOIN +
    ` WHERE i.entity_type = 'workflow_item' AND i._status = 'active' ` +
    `AND i.status = 'submitted'` + ITEM_GROUP_6
  );
}

/**
 * Items past their due date that are not yet done.
 *
 * A `submitted` item is DONE for this rule — `ITEM_DONE_STATUSES` is
 * `{submitted, verified, waived}`. The family met the deadline and the item
 * already appears under Awaiting review; counting it as overdue too would
 * report one item as both a family failure and a staff backlog.
 *
 * The status list is derived from the generated vocabulary rather than
 * re-spelled, so it cannot drift from apexflow's `ItemStatus` enum.
 */
export function overdueItemsSql(nowIso: string): string {
  const done = ITEM_DONE_STATUSES.map((s) => `'${escapeSqlLiteral(s)}'`).join(', ');
  return (
    `SELECT ${ITEM_SELECT_COMMON}, i.due_at AS due_at, MAX(a."at") AS last_item_change` +
    ITEM_JOIN +
    ` WHERE i.entity_type = 'workflow_item' AND i._status = 'active' ` +
    `AND i.due_at IS NOT NULL AND i.due_at <> '' ` +
    `AND i.due_at < '${escapeSqlLiteral(nowIso)}' ` +
    `AND i.status NOT IN (${done})` + ITEM_GROUP_7
  );
}

/**
 * Cheapest possible check that this tenant's flattened table HAS a `due_at`
 * column. DataCore's per-tenant table is the union of the fields that tenant's
 * rows actually carry, so `due_at` is absent entirely until some workflow item
 * gets a due date — and referencing an absent column is a Binder Error, not a
 * null result. Used to tell "this tenant has no due dates" (an empty overdue
 * bucket) apart from "the query failed" (a card that must report itself).
 */
export function dueAtProbeSql(): string {
  return (
    `SELECT i.due_at FROM data i WHERE i.entity_type = 'workflow_item' ` +
    `AND i._status = 'active' LIMIT 1`
  );
}

/**
 * Every active instance with the timestamp of its most recent activity of any
 * type. The silence threshold is applied in TypeScript, not here, so the same
 * rows can answer "how quiet is the quietest" without a second query.
 *
 * Every instance receives a `state_change` at creation
 * (apexflow `engine.py:263`), so `last_activity` is null only for genuinely
 * malformed data — never for a brand-new instance.
 */
export function instanceSilenceSql(): string {
  return (
    `SELECT inst.entity_id AS instance_entity_id, inst.definition_id AS definition_id, ` +
    `inst.state AS state, inst.applicant_email AS applicant_email, ` +
    `MAX(a."at") AS last_activity ` +
    `FROM data inst ` +
    `LEFT JOIN data a ON a.instance_id = inst.entity_id ` +
    `AND a.entity_type = 'workflow_activity' AND a._status = 'active' ` +
    `WHERE inst.entity_type = 'workflow_instance' AND inst._status = 'active' ` +
    `GROUP BY 1, 2, 3, 4`
  );
}

/** Days of silence before an instance counts as stalled. A week of no
 * activity — no item change, no state change — is long enough to say a
 * workflow has gone quiet without flagging normal turnaround time. */
export const STALLED_DAYS = 7;

/** apexflow's `cancel_instance` writes this synthetic state
 * (`machine.py:536`). It is NEVER a declared `state_id` in any machine — the
 * backend's own `_is_terminal_state` special-cases it for exactly that reason
 * — so it can never come from `definitionIndex`, and a cancelled instance
 * would otherwise read as open work forever. */
export const CANCELLED_STATE = 'cancelled';

/** One row on `/attention`; Home renders only the count of each bucket. */
export interface AttentionRow {
  /** Stable React key. Bucket-prefixed because one item can legitimately
   * appear in two buckets across a fetch. */
  key: string;
  bucket: BucketKey;
  instanceEntityId: string;
  definitionId: string;
  workflowName: string;
  applicant: string;
  /** Empty for `stalled` rows, which are instance-scoped. */
  itemTitle: string;
  /** Milliseconds: lateness for `overdue`, waiting time for `review`,
   * silence for `stalled`. **null means not derivable** — render nothing,
   * never zero and never "today". */
  ageMs: number | null;
}

export interface AttentionResult {
  rows: AttentionRow[];
}

export interface AttentionInput {
  definitions: DefinitionRow[];
  submitted: ItemAttentionRow[];
  overdue: ItemAttentionRow[];
  silence: InstanceSilenceRow[];
  /** Injected, never `Date.now()` inside — otherwise nothing here is testable. */
  nowMs: number;
  stalledDays: number;
}

export interface DefinitionEntry {
  name: string;
  terminal: Set<string>;
}

/**
 * definition_id -> display name + terminal state ids.
 *
 * Terminality is resolved PER DEFINITION because a state id is only unique
 * within its own machine: `done` is terminal in enrollment and active in
 * signup. Filtering client-side (rather than in SQL) avoids a compound
 * `NOT IN` over `(definition_id, state)` pairs, and volumes are small.
 */
export function definitionIndex(rows: DefinitionRow[]): Map<string, DefinitionEntry> {
  const index = new Map<string, DefinitionEntry>();
  for (const row of rows) {
    const id = String(row.definition_id ?? '');
    if (!id) continue;
    const states = parseMachineStates(row.machine);
    index.set(id, {
      name: String(row.name ?? '') || id,
      terminal: new Set(states.filter((s) => s.kind === 'terminal').map((s) => s.state_id)),
    });
  }
  return index;
}

/** ISO string -> epoch ms, or null for absent/unparseable. */
function parseIso(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Most urgent first; unknown age always last, since an absent age is not a
 * claim that the work is new. */
function byUrgency(a: AttentionRow, b: AttentionRow): number {
  if (a.ageMs === null && b.ageMs === null) return 0;
  if (a.ageMs === null) return 1;
  if (b.ageMs === null) return -1;
  return b.ageMs - a.ageMs;
}

/**
 * The single grouping both surfaces read. Home renders each bucket's length;
 * `/attention` renders its rows. Because a count is never computed separately
 * from the list it summarizes, the two cannot disagree.
 */
export function buildAttention(input: AttentionInput): AttentionResult {
  const index = definitionIndex(input.definitions);
  const nameOf = (id: string) => index.get(id)?.name ?? id;
  const isTerminal = (id: string, state: string) =>
    state === CANCELLED_STATE || (index.get(id)?.terminal.has(state) ?? false);

  const rows: AttentionRow[] = [];

  const pushItem = (row: ItemAttentionRow, bucket: BucketKey, ageMs: number | null) => {
    const definitionId = String(row.definition_id ?? '');
    if (isTerminal(definitionId, String(row.state ?? ''))) return;
    rows.push({
      key: `${bucket}:${String(row.item_entity_id ?? '')}`,
      bucket,
      instanceEntityId: String(row.instance_entity_id ?? ''),
      definitionId,
      workflowName: nameOf(definitionId),
      applicant: String(row.applicant_email ?? ''),
      itemTitle: String(row.title ?? ''),
      ageMs,
    });
  };

  for (const row of input.overdue) {
    // due_at is a durable base-data field, so lateness needs no activity row.
    const due = parseIso(row.due_at);
    pushItem(row, 'overdue', due === null ? null : input.nowMs - due);
  }

  for (const row of input.submitted) {
    // The only age that depends on apexflow carrying item_id.
    const changed = parseIso(row.last_item_change);
    pushItem(row, 'review', changed === null ? null : input.nowMs - changed);
  }

  const threshold = input.stalledDays * 86_400_000;
  for (const row of input.silence) {
    const definitionId = String(row.definition_id ?? '');
    if (isTerminal(definitionId, String(row.state ?? ''))) continue;
    const last = parseIso(row.last_activity);
    // Every instance gets a state_change at creation (apexflow engine.py:263),
    // so a null here is malformed data, not a new instance. Judging it silent
    // would be a guess, so it is skipped.
    if (last === null) continue;
    const age = input.nowMs - last;
    if (age < threshold) continue;
    rows.push({
      key: `stalled:${String(row.instance_entity_id ?? '')}`,
      bucket: 'stalled',
      instanceEntityId: String(row.instance_entity_id ?? ''),
      definitionId,
      workflowName: nameOf(definitionId),
      applicant: String(row.applicant_email ?? ''),
      itemTitle: '',
      ageMs: age,
    });
  }

  rows.sort(byUrgency);
  return { rows };
}

export function bucketRows(result: AttentionResult, bucket: BucketKey): AttentionRow[] {
  return result.rows.filter((r) => r.bucket === bucket);
}

/**
 * A millisecond age as whole days, floored, never below 1.
 *
 * A row only reaches a bucket by qualifying for it, so it represents at least
 * a day's worth of waiting; rendering "0 days" would read as "no problem" on
 * the one surface whose whole job is to say otherwise. Shared by Home's card
 * detail lines and `/attention`'s rows so the two can never round differently.
 */
export function ageDays(ms: number): number {
  return Math.max(1, Math.floor(ms / 86_400_000));
}

/** One instance row by entity_id, for the drawer. `workflowData.ts`'s
 * `instanceSql` fetches a whole lineage — the right shape for the pipeline
 * board, wasteful for a single row click here (it drags every sibling
 * instance, and the 1024-float `vector` column, across the wire for a row we
 * throw away). This is a deliberate exception to the module's no-`SELECT *`
 * rule, not a violation of it: the drawer (`WorkflowInstanceDrawer`, via
 * `InstanceRow`'s index signature) reads arbitrary fields off the row, so the
 * projection has to stay wide. What changes — and what actually saves the
 * wire cost — is filtering to the one instance server-side instead of
 * fetching the lineage and finding it client-side. */
export function oneInstanceSql(instanceEntityId: string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'workflow_instance' ` +
    `AND _status = 'active' AND entity_id = '${escapeSqlLiteral(instanceEntityId)}'`
  );
}
