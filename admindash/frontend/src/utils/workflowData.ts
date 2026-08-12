import {
  ITEM_STATUSES,
  type InstanceDocumentView,
  type ItemStatus,
  type ModelFieldSource,
  type WorkflowItemView,
} from '@neoapex/workflow-forms';

/**
 * Pure logic for the AdminDash Workflows area — no network, no React, so it
 * can be exercised directly by vitest under the node environment.
 *
 * DataCore flattens every scalar column on a queried row to a string
 * (interface map §2c: `_scalar_to_str` — bool checked before numeric,
 * dict/list JSON-encoded, everything else `str()`). Two consequences show up
 * here: `workflow_definition.version` must be compared as a string
 * (`pinnedDefinitionSql`), and `machine` arrives as a JSON-ENCODED STRING,
 * not a parsed object (`parseMachineStates` tolerates both, since callers
 * that already parsed a bundle response hand it an object instead).
 */

/** One state from a published machine's declared state list, in the shape
 * the board renders a column from. Field names mirror apexflow's
 * `StateDef` (backend `workflows/schema.py:126-131`) verbatim. */
export interface MachineStateView {
  state_id: string;
  name: string;
  kind: string;
}

/** A `workflow_instance` row as it comes back from `/api/query` — flattened,
 * every field a string except where noted. Only the fields the board reads
 * are declared; the rest pass through via the index signature. */
export interface InstanceRow {
  entity_id: string;
  state: string;
  instance_id?: string;
  applicant_email?: string;
  opened_at?: string;
  channel_started?: string;
  [key: string]: unknown;
}

/** Double single quotes so a value is safe to interpolate into a SQL literal
 * (same rule as `api/client.ts`'s `escapeSql` — reimplemented here rather
 * than imported so this module stays a leaf with no dependency on the API
 * layer). */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Tolerates: an already-parsed machine object (e.g. from
 * `getDefinitionBundle`'s response), a JSON-encoded string (the raw
 * DataCore wire shape), or garbage of any other kind — degrading to `[]`
 * rather than throwing, so one corrupt/mid-edit row degrades the board to
 * an all-orphans view instead of crashing the page.
 */
export function parseMachineStates(machineJson: unknown): MachineStateView[] {
  let parsed: unknown = machineJson;

  if (typeof machineJson === 'string') {
    try {
      parsed = JSON.parse(machineJson);
    } catch {
      return [];
    }
  }

  if (!parsed || typeof parsed !== 'object') return [];

  const states = (parsed as Record<string, unknown>).states;
  if (!Array.isArray(states)) return [];

  const out: MachineStateView[] = [];
  for (const entry of states) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.state_id !== 'string' || !rec.state_id) continue;
    out.push({
      state_id: rec.state_id,
      name: typeof rec.name === 'string' ? rec.name : rec.state_id,
      kind: typeof rec.kind === 'string' ? rec.kind : '',
    });
  }
  return out;
}

/**
 * Groups instance rows into one column per declared state, in declaration
 * order (the board's column order — `stageTone(i, states.length)` reads
 * position, per `utils/tone.ts`'s own doc comment, the same way
 * `LeadPage.tsx` groups leads by stage). Any row whose `state` doesn't match
 * a declared `state_id` — including instances pinned to an older version
 * whose states were since renamed — falls into `orphans` instead of being
 * silently dropped (mirrors `LeadPage.tsx`'s `otherLeads`).
 */
export function instancesByState(
  states: MachineStateView[],
  rows: InstanceRow[],
): { columns: { state: MachineStateView; rows: InstanceRow[] }[]; orphans: InstanceRow[] } {
  const declared = new Set(states.map((s) => s.state_id));
  const columns = states.map((state) => ({
    state,
    rows: rows.filter((r) => r.state === state.state_id),
  }));
  const orphans = rows.filter((r) => !declared.has(r.state));
  return { columns, orphans };
}

/**
 * ALL active `workflow_instance` rows for a lineage (every version pinned
 * to that `definition_id`, not just the published one — the board's column
 * source is the published machine, but instances pinned to older versions
 * still appear as rows, absorbed into the orphan bucket if their state was
 * since renamed). `_status = 'active'` is required: DataCore archives prior
 * versions on every write rather than deleting them, so omitting it returns
 * every historical `_version` row too (interface map §2c).
 */
export function instanceSql(definitionId: string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'workflow_instance' AND _status = 'active' ` +
    `AND definition_id = '${escapeSqlLiteral(definitionId)}' ORDER BY _created_at DESC`
  );
}

/**
 * The single `workflow_definition` row pinned to a specific lineage
 * version — used to fetch the published row's raw `machine` JSON. `version`
 * is compared as a string because DataCore flattens every scalar column to
 * a string on the wire (module doc comment); passing a number here still
 * produces a quoted string literal via `String(version)`.
 */
export function pinnedDefinitionSql(definitionId: string, version: number | string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'workflow_definition' AND _status = 'active' ` +
    `AND definition_id = '${escapeSqlLiteral(definitionId)}' ` +
    `AND version = '${escapeSqlLiteral(String(version))}'`
  );
}

/**
 * The `workflow_item` rows for one instance — Task 11's items checklist.
 * `instance_id` on a `workflow_item` row IS the parent instance's DataCore
 * `entity_id` (identifier convention confirmed by
 * `apexflow/backend/app/workflows/engine.py::_create_item`).
 */
export function itemsSql(instanceEntityId: string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'workflow_item' AND _status = 'active' ` +
    `AND instance_id = '${escapeSqlLiteral(instanceEntityId)}'`
  );
}

/**
 * The `document` rows for one instance. Keyed on `application_id` —
 * DataCore's own FIXED field name for the owning application/instance on a
 * document row (`apexflow/backend/app/api/documents.py:74`'s module
 * docstring: apexflow's staff surface accepts `instance_id` from callers but
 * still writes the outbound payload under DataCore's un-renameable
 * `application_id` key).
 */
export function documentsSql(instanceEntityId: string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'document' AND _status = 'active' ` +
    `AND application_id = '${escapeSqlLiteral(instanceEntityId)}'`
  );
}

/**
 * The `workflow_activity` rows for one instance, oldest first — the
 * drawer's activity feed reads top-to-bottom as a timeline, same convention
 * as `LeadDetailDrawer`'s activity list (which sorts client-side; this one
 * sorts in SQL since `at` is always present on every activity row).
 *
 * `at` is quoted as `"at"` in the `ORDER BY` — it's a DuckDB RESERVED
 * keyword (used in `AT TIME ZONE`/temporal syntax), so the bare identifier
 * 400s DataCore's `/api/query` with `Parser Error: syntax error at or near
 * "FROM"` (fix round 1, live-browser-gate finding: reproduced with curl
 * against live DataCore). `entity_type`/`_status`/`instance_id` and the
 * other builders' column names (`definition_id`, `version`,
 * `application_id`, `_created_at`) are not DuckDB keywords and need no
 * quoting.
 */
export function activitySql(instanceEntityId: string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'workflow_activity' AND _status = 'active' ` +
    `AND instance_id = '${escapeSqlLiteral(instanceEntityId)}' ORDER BY "at" ASC`
  );
}

/** The five item built-in actions `machine.py::ITEM_BUILTIN_ACTIONS` handles
 * itself — never rendered as generic transition buttons in the drawer's
 * actions bar (items get their own per-row verify/reject/waive controls;
 * `save_draft`/`complete_item` have no staff-assisted-entry UI in this
 * task). Mirrors `apexflow/backend/app/workflows/machine.py`'s
 * `_ITEM_BUILTINS_ALL` list verbatim. */
const ITEM_BUILTIN_ACTIONS = new Set([
  'save_draft', 'complete_item', 'verify_item', 'reject_item', 'waive_item',
]);

/**
 * The advertised-actions bar's button list: `allowed` (from
 * `getAllowedActions`) minus the five item built-ins, order preserved.
 * `cancel_instance` is NOT special-cased here — it still passes through;
 * the drawer itself renders it with a `danger` variant behind a confirm,
 * same as every other name in the returned list gets a plain button.
 */
export function actionButtonsFor(allowed: string[]): string[] {
  return allowed.filter((a) => !ITEM_BUILTIN_ACTIONS.has(a));
}

/**
 * Per-item staff-button visibility for one `workflow_item.status` value —
 * verbatim port of `engine.py`'s own source-status guards: `verify_item`
 * only accepts `submitted` (`engine.py`'s `VERIFIABLE_STATUSES`);
 * `waive_item` 409s only when already `verified`; `reject_item` has no
 * source-status restriction at all (its docstring: "staff may send an item
 * back for correction from whatever state it's in").
 *
 * The status values compared here come from `ItemStatus`, generated from
 * apexflow's StrEnum — `status` is deliberately still `string` because
 * callers hand it straight from a flattened DataCore query row.
 */
export function itemActionVisibility(
  status: string,
): { verify: boolean; reject: boolean; waive: boolean } {
  const s = status as ItemStatus;
  return {
    verify: s === 'submitted',
    reject: true,
    waive: s !== 'verified',
  };
}

export interface SettledSection<T> {
  data: T;
  failed: boolean;
}

/**
 * Maps one `Promise.allSettled` result to a section's render state: the
 * resolved value on success, or `fallback` + `failed: true` on rejection.
 * Generic so the drawer's four parallel fetches (items/documents/activity/
 * allowed-actions) can each be mapped through the same function instead of
 * four inline try/catches.
 *
 * Fix round 1, live-browser-gate finding #2: the drawer originally awaited
 * all four fetches via `Promise.all`, so ONE rejecting query (the `at`
 * reserved-keyword 400 above, but any future per-column Binder Error on an
 * empty table would do the same) threw before any `setState` call ran —
 * every section rendered its "empty" copy even though items/documents/
 * allowed-actions had already succeeded. Routing each fetch through this
 * helper after a `Promise.allSettled` means a section's own state is set
 * from its own result regardless of what happened to the other three.
 */
export function settledSection<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): SettledSection<T> {
  if (result.status === 'fulfilled') return { data: result.value, failed: false };
  return { data: fallback, failed: true };
}

/**
 * Best-effort coercion for a numeric value that crossed DataCore's
 * flattened-row boundary — verbatim port of apexflow-frontend's
 * `utils/numeric.ts::asNumber` (interface map §8/task binding: "asNumber
 * util per apexflow's designer.ts coercion pattern"). Falls back to 0 (not
 * NaN) so a badly-shaped value degrades to "no arithmetic explosion" rather
 * than poisoning downstream math with NaN.
 */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Task 4 finding: a `DefinitionBundle.models` entry is `null` for a tenant
 * model that was never set up (`fetch_models`'s per-referenced-model
 * lookup can miss). `StepRenderer` types `models` as
 * `Record<string, ModelFieldSource>` with no null — filtering here means a
 * section bound to a dropped key resolves to `undefined` in `StepRenderer`'s
 * own lookup, and `sectionFields` (workflow-forms) already renders that as
 * "no fields" rather than crashing. Used by `StaffEntryPage` (Task 12);
 * familyhub's `RegisterPage` carries an unexported equivalent (`usableModels`)
 * since that app has no shared pure-logic test module to hoist into.
 */
export function usableModels(
  models: Record<string, ModelFieldSource | null>,
): Record<string, ModelFieldSource> {
  const out: Record<string, ModelFieldSource> = {};
  for (const [key, value] of Object.entries(models)) {
    if (value) out[key] = value;
  }
  return out;
}

/** DataCore stringifies every top-level scalar on a flattened row --
 * `"false"` is truthy in JS. Does NOT apply to values already inside a
 * parsed JSON blob (e.g. `draft_data`'s contents), which arrive as real JS
 * types and must not be re-coerced. */
export function asBool(v: unknown): boolean {
  return v === true || String(v) === 'true';
}

/**
 * A flattened `workflow_item` row (from `itemsSql` via `/api/query`) ->
 * `StepRenderer`'s `WorkflowItemView`. Used by `StaffEntryPage` (Task 12) to
 * hydrate the runtime's `items` prop after every create/action/refetch.
 */
export function toItemView(row: Record<string, unknown>): WorkflowItemView {
  return {
    entity_id: String(row.entity_id ?? ''),
    step_id: String(row.step_id ?? ''),
    kind: (row.kind as WorkflowItemView['kind']) ?? 'form',
    title: String(row.title ?? ''),
    status: asItemStatus(row.status),
    blocking: asBool(row.blocking),
  };
}

/**
 * A flattened row's `status` column -> `ItemStatus`. Checked against the
 * GENERATED vocabulary (`ITEM_STATUSES`, emitted from apexflow's `ItemStatus`
 * StrEnum) rather than cast, so a value the backend vocabulary doesn't
 * contain degrades to `not_started` instead of lying to the type system.
 */
export function asItemStatus(value: unknown): ItemStatus {
  return ITEM_STATUSES.includes(value as ItemStatus)
    ? (value as ItemStatus)
    : 'not_started';
}

/**
 * A flattened `document` row (from `documentsSql` via `/api/query`) ->
 * `StepRenderer`'s `InstanceDocumentView`.
 */
export function toDocumentView(row: Record<string, unknown>): InstanceDocumentView {
  return {
    document_id: String(row.document_id ?? row.entity_id ?? ''),
    filename: String(row.filename ?? ''),
    item_id: row.item_id ? String(row.item_id) : undefined,
  };
}

/** One `workflow_instance` as the lineage work-item list route returns it.
 * Every scalar arrives as a string off DataCore's flattened rows except
 * `definition_version`, which the API client coerces with `asNumber`. */
export interface LineageInstance {
  entity_id: string;
  instance_id: string;
  state: string;
  definition_version: number;
  channel_started: string;
  applicant_email: string;
  opened_at: string;
  closed_at: string;
  /** Set while the work item is suspended by an archived workflow. The state
   * is untouched during a freeze, so this is the only signal. */
  frozen_at: string;
}

export interface InstanceFilter {
  state?: string;
  openness?: 'all' | 'open' | 'closed' | 'frozen';
}

/** Client-side because the server cannot filter on `frozen_at`: a
 * DataCore `where` naming a column a tenant's table has not materialized is a
 * binder error, not an empty result. Same reason the pipeline board's own
 * grouping happens here rather than in SQL. */
export function filterInstances(
  rows: LineageInstance[],
  { state, openness = 'all' }: InstanceFilter,
): LineageInstance[] {
  return rows.filter((r) => {
    if (state && r.state !== state) return false;
    if (openness === 'open') return !r.closed_at;
    if (openness === 'closed') return Boolean(r.closed_at);
    if (openness === 'frozen') return Boolean(r.frozen_at);
    return true;
  });
}
