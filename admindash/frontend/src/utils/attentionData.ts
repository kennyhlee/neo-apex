import { ITEM_DONE_STATUSES } from '@neoapex/flow-runtime';

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
 * DuckDB reserved keyword.
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

/** Shared SELECT list for both item buckets. Eight columns, the last an
 * aggregate — hence `GROUP BY 1..7`. */
const ITEM_SELECT =
  `SELECT i.entity_id AS item_entity_id, i.title AS title, i.due_at AS due_at, ` +
  `i.instance_id AS instance_entity_id, inst.definition_id AS definition_id, ` +
  `inst.state AS state, inst.applicant_email AS applicant_email, ` +
  `MAX(a."at") AS last_item_change`;

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

const ITEM_GROUP = ` GROUP BY 1, 2, 3, 4, 5, 6, 7`;

/** Items a family has sent in that staff must verify or reject. */
export function submittedItemsSql(): string {
  return (
    ITEM_SELECT + ITEM_JOIN +
    ` WHERE i.entity_type = 'workflow_item' AND i._status = 'active' ` +
    `AND i.status = 'submitted'` + ITEM_GROUP
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
    ITEM_SELECT + ITEM_JOIN +
    ` WHERE i.entity_type = 'workflow_item' AND i._status = 'active' ` +
    `AND i.due_at IS NOT NULL AND i.due_at <> '' ` +
    `AND i.due_at < '${escapeSqlLiteral(nowIso)}' ` +
    `AND i.status NOT IN (${done})` + ITEM_GROUP
  );
}

/**
 * Every active instance with the timestamp of its most recent activity of any
 * type. The silence threshold is applied in TypeScript, not here, so the same
 * rows can answer "how quiet is the quietest" without a second query.
 *
 * Every instance receives a `state_change` at creation
 * (apexflow `engine.py:255`), so `last_activity` is null only for genuinely
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
