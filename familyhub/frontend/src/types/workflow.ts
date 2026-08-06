import type { ModelFieldSource, WorkflowStepDef } from '@neoapex/flow-runtime';

// Re-exported rather than redeclared: flow-runtime's barrel already exports
// these (`flow-runtime/src/types.ts` via `export * from './types'`), and
// duplicating the literal unions here would let the two definitions drift.
// `ItemStatus`'s vocabulary (not_started/in_progress/submitted/verified/
// rejected/waived) is unchanged from the registration era -- apexflow's
// `workflow_item.status` uses the exact same values (StepRenderer's own
// `DONE_ITEM_STATUSES` constant is shared across both).
export type { ItemStatus, WorkflowStepDef, WorkflowItemView, InstanceDocumentView } from '@neoapex/flow-runtime';
export type { ModelFieldSource };

/**
 * DataCore entities may arrive `base_data`-wrapped (the `{entity_id,
 * entity_type, base_data}` envelope) or already flattened (fields at the
 * top level). familyhub-backend's `/api/instance/*` / `/api/workflows/*`
 * relays are flattened rows, NOT envelopes (interface map §5-6) --
 * `entityData()` tolerates both shapes uniformly so a future upstream
 * change on either side doesn't silently break every reader.
 *
 * IDENTIFIER TRAP: rows in this shape carry TWO ids that never match --
 * DataCore's own `entity_id`, and a business id the engine mints separately
 * (`instance_id` on a workflow instance, `item_id` on a workflow item). The
 * backend keys every write on `entity_id`. Whenever you build a payload for
 * `completeItem` or `uploadDocumentFile`, the value you send MUST be
 * `entityId(row)` -- never `entityData(row).item_id`.
 *
 * STRINGLY-TYPED WARNING: DataCore returns every top-level field of a
 * flattened row as a string (`"false"` is truthy in JS). Coerce before
 * arithmetic or truthiness -- e.g. `item.blocking === true` will never match
 * a wire value of `"false"`; use `String(item.blocking) === 'true'`. This
 * does NOT apply to values already inside a parsed JSON blob (`draft_data`)
 * -- those arrive as real JS types once parsed and must not be re-coerced.
 */
export interface EntityRecord {
  base_data?: Record<string, unknown>;
  [key: string]: unknown;
}

export function entityData(e: EntityRecord | undefined | null): Record<string, unknown> {
  if (!e || typeof e !== 'object') return {};
  const inner = e.base_data;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : (e as Record<string, unknown>);
}

/**
 * A row's DataCore `entity_id`, from EITHER wire shape.
 *
 * `entityData()` cannot supply this: in the `{entity_id, entity_type,
 * base_data}` ENVELOPE shape `entity_id` sits at the TOP LEVEL, not inside
 * `base_data`, so `entityData(row).entity_id` is `undefined` there. Both
 * shapes genuinely occur on the register page: `fetchInstance` relays
 * FLATTENED rows, while `startWorkflow` hands back apexflow's `dc_create`
 * ENVELOPE for the fresh instance/items and `RegisterPage` mounts those
 * directly to save a round trip on the resume path. Every id read MUST go
 * through this helper (registration-era bug, see the git history on this
 * file -- a parent's first Save & continue 400'd on an empty `item_id`).
 */
export function entityId(e: EntityRecord | undefined | null): string {
  if (!e || typeof e !== 'object') return '';
  const top = (e as Record<string, unknown>).entity_id;
  if (typeof top === 'string' && top) return top;
  const inner = entityData(e).entity_id;
  return typeof inner === 'string' ? inner : '';
}

/**
 * The school this workflow instance belongs to. A curated two-field summary
 * built server-side, NOT a flattened DataCore row -- so unlike an
 * `EntityRecord` these need no stringly-typed coercion.
 */
export interface TenantSummary {
  tenant_id: string;
  name: string;
}

/**
 * Computed capacity snapshot (`apexflow/backend/app/api/internal.py`
 * `_capacity_summary`), school-wide for one school year. There is NO
 * `is_full` anywhere else -- fullness lives ONLY here. This is a freshly
 * built Python dict, NOT a DataCore row, so FastAPI serializes its
 * `int`/`bool` values as real JSON types and these fields need NO coercion.
 */
export interface CapacityState {
  capacity: number | null;
  admitted: number;
  full: boolean;
}

/** One state in a published definition's machine, as the family runtime
 *  needs it (label + terminality) -- wire mirror of `schema.py`'s
 *  `StateDef`, trimmed to what this channel reads. */
export interface WorkflowMachineStateView {
  state_id: string;
  name: string;
  kind: string; // 'initial' | 'active' | 'terminal'
}

/** The `definition`/`machine`/`steps` slice apexflow's config and
 *  instance-by-token bundles both carry (bindings §5's `WorkflowDefinitionView`). */
export interface WorkflowDefinitionView {
  definition_id: string;
  name: string;
  version: number;
  machine: { states: WorkflowMachineStateView[]; transitions: unknown[] };
  steps: WorkflowStepDef[];
}

export type LineageStatus = 'active' | 'deprecated' | 'retired';

/**
 * GET /api/workflows/{tenant_id}/{definition_id} -> apexflow's config
 * bundle, relayed verbatim by familyhub-backend since Task 6 (no more
 * `_config_bundle_from_apexflow` `blocks: []` placeholder reshape).
 *
 * `models` values may be `null`: apexflow's `fetch_models` calls
 * `dc.get_model_definition` per referenced `entity_model`, which returns
 * `null` for a tenant model that was never set up (Plan 3 Task 4 finding).
 * Callers MUST filter/guard nulls before handing this map to
 * `StepRenderer` (which types `models` as `Record<string, ModelFieldSource>`
 * with no null) -- a section bound to a filtered-out key resolves to
 * `undefined` in `StepRenderer`'s own lookup, and `sectionFields` already
 * treats an undefined model as "render no fields" rather than crashing.
 */
export interface WorkflowBundle {
  definition: WorkflowDefinitionView;
  models: Record<string, ModelFieldSource | null>;
  tenant: TenantSummary;
  capacity: CapacityState;
  lineage_status: LineageStatus;
}

/**
 * GET /api/instance/{token} -> apexflow's instance-by-token bundle, relayed
 * verbatim. `allowed` is the family-actor-scoped action list
 * (`machine.allowed_actions`) -- always includes `save_draft`/`complete_item`
 * (the family channel's item built-ins) alongside whatever real machine
 * transitions are currently legal for this actor/state/guards. Callers
 * building a "submit"-style action-button row must filter those two out
 * (`allowed.filter(a => !['save_draft', 'complete_item'].includes(a))`) --
 * they are wired through `saveDraft`/`completeItem`, never a generic button.
 *
 * NOTE: unlike `WorkflowBundle`, this `definition` carries no `models` key
 * -- it is the INSTANCE'S PINNED version's steps/machine (`engine.py`'s
 * "in-flight instances always run and commit per their pinned version"
 * rule), which may differ from the currently-published `WorkflowBundle` if
 * the lineage was republished after this instance started. RegisterPage
 * deliberately renders against the `WorkflowBundle` fetched at page load
 * (bindings §5's own code sample), not this pinned copy -- see that page's
 * top-of-file note.
 */
export interface InstanceBundle {
  instance: EntityRecord;
  items: EntityRecord[];
  definition: WorkflowDefinitionView;
  allowed: string[];
}

/**
 * POST /api/workflows/{tenant_id}/{definition_id}/start response. Carries
 * no `allowed` or `models` -- callers that need a full `InstanceBundle`
 * (action buttons, StepRenderer's `models`) call `fetchInstance(token)`
 * right after starting rather than hand-assembling one from this shape.
 */
export interface StartResponse {
  instance: EntityRecord;
  items: EntityRecord[];
  /** The magic-link token -- the parent's only credential from here on. */
  token: string;
  /** Absolute mailto-style link (`{familyhub_url}/w/{tenant}/{definition}?token=...`)
   *  -- what apexflow puts in the confirmation email. Display-only; do not
   *  use this for in-app navigation, use `hub_url` instead. */
  link: string;
  /** Relative in-app route (`/application/{token}`) added by familyhub's
   *  own facade -- NOT an absolute URL. Use with `navigate(hub_url)`. */
  hub_url: string;
}

export interface DocumentSlot {
  document_id: string;
  upload_url: string;
  storage_key: string;
}

/**
 * Result of decoding (NOT verifying) a magic-link token's two plaintext
 * segments. This is a convenience for reading which tenant/instance a
 * token names before any request completes -- it carries no proof of
 * authenticity. Only apexflow's `resolve_token` (which familyhub never
 * calls -- it holds no `link_secret`) actually authenticates a token; treat
 * a decoded value as displayable, never as an access check.
 */
export interface DecodedToken {
  tenantId: string;
  /**
   * IDENTIFIER TRAP, in the token itself: this segment is the workflow
   * instance's DataCore `entity_id` (`apexflow/backend/app/api/internal.py`
   * `_send_magic_link` mints the token from `ctx.instance["entity_id"]`),
   * NOT any business id. Do not rename this to something implying a
   * business id in a later task -- that mistake has bitten this plan
   * before (registration-era `applicationEntityId`/`application_id` mixup).
   */
  instanceEntityId: string;
}
