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
 */
export function activitySql(instanceEntityId: string): string {
  return (
    `SELECT * FROM data WHERE entity_type = 'workflow_activity' AND _status = 'active' ` +
    `AND instance_id = '${escapeSqlLiteral(instanceEntityId)}' ORDER BY at ASC`
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
 * only accepts `submitted`/`in_progress` (`engine.py:557`); `waive_item`
 * 409s only when already `verified` (`engine.py:584`); `reject_item` has no
 * source-status restriction at all (`engine.py:567-572`'s docstring: "staff
 * may send an item back for correction from whatever state it's in").
 */
export function itemActionVisibility(
  status: string,
): { verify: boolean; reject: boolean; waive: boolean } {
  return {
    verify: status === 'submitted' || status === 'in_progress',
    reject: true,
    waive: status !== 'verified',
  };
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
