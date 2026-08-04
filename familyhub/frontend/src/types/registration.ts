import type { RegistrationConfigDef, FlowBlock } from '@neoapex/flow-runtime';

// Re-exported rather than redeclared: flow-runtime's barrel already exports
// these (`flow-runtime/src/types.ts` via `export * from './types'`), and
// duplicating the literal unions here would let the two definitions drift.
export type { ApplicationStatus, ItemStatus } from '@neoapex/flow-runtime';

/**
 * DataCore entities may arrive `base_data`-wrapped (the `{entity_id,
 * entity_type, base_data}` envelope) or already flattened (fields at the
 * top level). familyhub-backend's `/internal/application-by-token/*`
 * relays are flattened rows, NOT envelopes (bindings §2/§3) -- but
 * `entityData()` tolerates both shapes uniformly so a future upstream
 * change on either side doesn't silently break every reader.
 *
 * IDENTIFIER TRAP: rows in this shape carry TWO ids that never match --
 * DataCore's own `entity_id`, and a business id the engine mints
 * separately (`application_id` on applications, `item_id` on items). The
 * backend keys every write on `entity_id`. Whenever you build a payload
 * for `completeItem`, `uploadDocumentFile`, or `startCheckout`, the value
 * you send MUST be `entityData(row).entity_id` (or the row's own top-level
 * `entity_id`) -- never `entityData(row).item_id`. See the field-by-field
 * note on each function below.
 *
 * STRINGLY-TYPED WARNING: DataCore returns every top-level field of a
 * flattened row as a string (`"false"` is truthy in JS). Coerce before
 * arithmetic or truthiness -- e.g. `item.blocking === true` will never
 * match a wire value of `"false"`; use `String(item.blocking) === 'true'`
 * or an explicit `as_bool`-style helper. This does NOT apply to values
 * already inside a parsed JSON blob (`draft_data`, a parsed `blocks`
 * array) -- those arrive as real JS types once parsed and must not be
 * re-coerced.
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
 * The school this registration belongs to, as enrollx names it. A curated
 * two-field summary built server-side (`engine.tenant_label`), NOT a
 * flattened DataCore row -- so unlike an `EntityRecord` these need no
 * stringly-typed coercion.
 */
export interface TenantSummary {
  tenant_id: string;
  name: string;
}

/**
 * Computed capacity snapshot (`enrollx/backend/app/registration/engine.py`
 * `capacity_state`), school-wide for one school year. There is NO `is_full`
 * anywhere else -- fullness lives ONLY here. This is a freshly-built Python
 * dict, NOT a DataCore row, so FastAPI serializes its `int`/`bool` values as
 * real JSON types and these fields need NO coercion.
 *
 * `admitted` counts applications in approved|enrolled for the school year;
 * enrollment rows are not counted at all (spec §2).
 */
export interface CapacityState {
  capacity: number | null;
  admitted: number;
  full: boolean;
}

export interface RegistrationBundle {
  /** Normalized: `blocks` parsed from its wire JSON-string into `FlowBlock[]`,
   *  `version` coerced to a number. Ready to pass straight to `FlowRenderer`.
   *  Entity-sourced form blocks arrive already model-hydrated by enrollx. */
  config: RegistrationConfigDef;
  tenant: TenantSummary;
  capacity: CapacityState;
}

export interface StartResponse {
  application: EntityRecord;
  items: EntityRecord[];
  /** The magic-link token -- the parent's only credential from here on. */
  token: string;
  /** Absolute mailto-style link (`{familyhub_url}/application/{token}`) --
   *  what enrollx put in the confirmation email. Display-only; do not use
   *  this for in-app navigation, use `hub_url` instead. */
  link: string;
  /** Relative in-app route (`/application/{token}`) added by familyhub's
   *  own facade -- NOT an absolute URL. Use with `navigate(hub_url)`. */
  hub_url: string;
}

export interface HubBundle {
  application: EntityRecord;
  items: EntityRecord[];
  /** Normalized the same way as `RegistrationBundle.config` above. */
  config: RegistrationConfigDef;
}

export interface DocumentSlot {
  document_id: string;
  upload_url: string;
  storage_key: string;
}

/**
 * Result of decoding (NOT verifying) a magic-link token's two plaintext
 * segments. This is a convenience for reading which tenant/application a
 * token names before any request completes -- it carries no proof of
 * authenticity. Only enrollx's `resolve_token`/`verify_link_token` (which
 * familyhub never calls -- it holds no `link_secret`) actually authenticate
 * a token; treat a decoded value as displayable, never as an access check.
 */
export interface DecodedToken {
  tenantId: string;
  /**
   * IDENTIFIER TRAP, in the token itself: this segment is the
   * application's DataCore `entity_id`
   * (`enrollx/backend/app/api/internal.py` `_send_magic_link` mints the
   * token from `app_row["entity_id"]`), NOT the business `application_id`
   * field that shows up in `application.application_id` for display. Do
   * not rename this to `applicationId` in a later task -- that name has
   * bitten this plan before.
   */
  applicationEntityId: string;
}

// Re-exported for convenience so a block-shape import doesn't need a
// second module specifier alongside `RegistrationConfigDef`.
export type { FlowBlock };
