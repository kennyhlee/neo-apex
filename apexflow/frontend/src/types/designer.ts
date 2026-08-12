// TS mirrors of apexflow-backend's designer read/write API (interface map
// §2). Reuses flow-runtime's own wire mirrors of `workflows/schema.py`
// (WorkflowStepDef, WorkflowSectionDef, ConditionGroupDef, etc. — map §2i /
// §4) rather than redeclaring them; flow-runtime does NOT export
// machine-level types (StateDef/TransitionDef/GuardRef/EffectRef), which
// this file adds.
import type {
  Condition,
  ConditionGroupDef,
  ConditionItem,
  FieldPick,
  RepeatSpec,
  WorkflowSectionDef,
  WorkflowStepDef,
} from '@neoapex/flow-runtime';

export type {
  Condition,
  ConditionGroupDef,
  ConditionItem,
  FieldPick,
  RepeatSpec,
  WorkflowSectionDef,
  WorkflowStepDef,
};

// ---- Machine (workflows/schema.py — not exported by flow-runtime) --------

/** Wire mirror of `schema.py`'s `StateDef` (`:126-129`). */
export interface StateDef {
  state_id: string;
  name: string;
  kind: 'initial' | 'active' | 'terminal';
}

/** Wire mirror of `schema.py`'s `GuardRef` (`:134-137`). */
export interface GuardRef {
  primitive: string;
  params: Record<string, unknown>;
}

/** Wire mirror of `schema.py`'s `EffectRef` (`:144-147`). */
export interface EffectRef {
  primitive: string;
  params: Record<string, unknown>;
}

/**
 * Wire mirror of `schema.py`'s `TransitionDef` (`:154-163`). `from_` is
 * `Field(alias="from")` server-side — the wire key (and this key) is
 * `"from"`, no trailing underscore (map §2i's "exact alias spellings" note).
 */
export interface TransitionDef {
  transition_id: string;
  from: string;
  to: string;
  action: string;
  actor: 'family' | 'staff' | 'system';
  guards: GuardRef[];
  effects: EffectRef[];
}

/** Wire mirror of `schema.py`'s `MachineDef` (`:166-169`). */
export interface MachineDef {
  states: StateDef[];
  transitions: TransitionDef[];
}

// ---- Entity models (fetch_models / base_model.json — map §8) -------------

export interface EntityModelField {
  name: string;
  type: string;
  required: boolean;
  options?: string[];
  default?: unknown;
}

export interface EntityModelDef {
  base_fields: EntityModelField[];
  custom_fields: EntityModelField[];
}

/** Keyed by entity_type ("student", "family", "contact", ...). */
export type EntityModelsMap = Record<string, EntityModelDef>;

// ---- Definitions list — GET /api/workflows/{tenant_id}/definitions -------
// (api/designer.py:79-119)

export type DefinitionStatus = 'draft' | 'published' | 'superseded';
export type LineageStatus = 'active' | 'deprecated' | 'archived' | 'retired';

/** Mirrors the backend's `definitions.is_archived`. `retired` is the
 * pre-archive name for the same state and is never migrated, so both values
 * must read as archived — one definition, never an inline comparison. */
export function isArchived(status: LineageStatus): boolean {
  return status === 'archived' || status === 'retired';
}

/** Archive is reachable only from `deprecated` — mirrors
 * `archive_definition`'s own gate so the UI never offers an action the backend
 * will refuse. */
export function canArchive(status: LineageStatus): boolean {
  return status === 'deprecated';
}
export type ChannelAccess = 'staff_only' | 'family';

/**
 * `definition_health`'s three real classifications plus the `"superseded"`
 * literal `api/designer.py`'s `_health_for_row` (`:55-62`) short-circuits to
 * for superseded rows without ever calling `definition_health`.
 */
export type DefinitionHealth = 'current' | 'stale' | 'broken' | 'superseded';

export interface DefinitionListEntry {
  entity_id: string;
  definition_id: string;
  name: string;
  version: number;
  status: DefinitionStatus;
  lineage_status: LineageStatus;
  channel_access: ChannelAccess;
  health: DefinitionHealth;
  open_instances: number;
  /** Only present when published + channel_access === "family" (designer.py:114-116). */
  family_url?: string;
}

export interface ListDefinitionsResponse {
  definitions: DefinitionListEntry[];
}

// ---- Bundle — GET /api/workflows/{tenant_id}/definitions/{entity_id}/bundle
// (api/designer.py:122-152)

export interface DefinitionDetail {
  entity_id: string;
  definition_id: string;
  name: string;
  version: number;
  status: DefinitionStatus;
  lineage_status: LineageStatus;
  channel_access: ChannelAccess;
  machine: MachineDef;
  steps: WorkflowStepDef[];
}

export interface DefinitionBundle {
  definition: DefinitionDetail;
  models: EntityModelsMap;
  health: DefinitionHealth;
  errors: string[];
}

// ---- Validate — POST .../definitions/{entity_id}/validate (designer.py:155-171)

export interface ValidateResult {
  errors: string[];
  health: DefinitionHealth;
}

// ---- Primitives catalog — GET .../primitives (designer.py:174-197) -------

/**
 * `ParamSpec.kind`'s closed vocabulary (workflows/validate.py:408-412):
 * "string_or_list" only appears on `items_in_status.status`.
 *
 * # ADJUST(bindings): task-8-brief.md's own prose sketches a wider kind
 * vocabulary (str/int/bool/list/enum/condition/state-list/section-list/
 * step-list/field-ref) for GuardEffectComposer's per-param form generator —
 * but `designer.py`'s `_param_dict` (the actual catalog generator, read
 * directly off disk for this task) only ever emits ONE of the five kinds
 * below; there is no "int"/"bool"/"enum" kind, and "enum" is instead an
 * orthogonal `PrimitiveParam.enum` list layered on top of kind "string"
 * (e.g. `items_in_status.quantifier`: kind "string", enum ["all","any"]).
 * The brief's state-list/section-list/step-list/field-ref categories are
 * likewise not `kind` values at all — they're widget choices
 * GuardEffectComposer.tsx makes by switching on the (primitive, param.name)
 * PAIR (e.g. `capacity_available.count_states`, `commit_sections.
 * section_ids`, `set_entity_field.ref`/`.field`), layered on top of the
 * generic kind-based fallback for every other param. The catalog wins per
 * this task's binding rule — this type is exactly `_param_dict`'s five
 * kinds, unchanged from Task 2.
 */
export type PrimitiveParamKind = 'string' | 'list' | 'string_or_list' | 'condition' | 'date';

/**
 * Engine-owned `workflow_instance` field names — verbatim mirror of
 * `apexflow/backend/app/workflows/schema.py`'s `ENGINE_OWNED_FIELDS`
 * frozenset (13 entries, `schema.py:32-48`). GuardEffectComposer.tsx uses
 * this to flag a `set_entity_field` effect whose `ref === "instance"`
 * targets one of these — `validate.py`'s `_effect_params_set_entity_field`
 * (`validate.py:501-518`) rejects exactly this shape server-side at publish
 * time; this is the client-side mirror so the editor can hint before that.
 *
 * Deliberately NOT `@neoapex/flow-runtime`'s `ENGINE_OWNED_APPLICATION_FIELDS`
 * (`flow-runtime/src/types.ts:101`'s own doc comment: "NOT the same list as
 * apexflow's `schema.ENGINE_OWNED_FIELDS`") — that constant is the
 * registration-era `registration_application`-scoped field set (a
 * completely different entity), and using it here would silently pass the
 * wrong fields through as "safe to set" on ref "instance".
 *
 * `../editor/fieldPicker.ts` carries an independent copy of this same
 * literal list for the (different) entity-model section-field-picker use
 * case — kept as two separate literals rather than one shared export so
 * neither call site's import graph is coupled to the other's.
 */
export const ENGINE_OWNED_INSTANCE_FIELDS: readonly string[] = [
  'instance_id',
  'workflow_instance_id',
  'definition_id',
  'definition_version',
  'state',
  'subject_refs',
  'context',
  'channel_started',
  'applicant_email',
  'token_version',
  'draft_data',
  'opened_at',
  'closed_at',
];

export interface PrimitiveParam {
  name: string;
  kind: PrimitiveParamKind;
  required: boolean;
  enum?: string[];
  /** Free-form cross-param rule note, e.g. "at_least_one_of:start,end". */
  constraint?: string;
}

export interface PrimitiveEntry {
  name: string;
  params: PrimitiveParam[];
}

export interface PrimitivesCatalog {
  guards: PrimitiveEntry[];
  effects: PrimitiveEntry[];
}

// ---- Lifecycle actions — POST .../definitions/{entity_id}/actions --------
// (api/definitions.py:38-56)

export type DefinitionLifecycleAction =
  | 'publish' | 'deprecate' | 'reactivate' | 'archive' | 'unarchive' | 'delete';

/**
 * The raw updated `workflow_definition` DataCore row that every lifecycle
 * action returns directly (`defs.publish_definition` et al. return `dict`,
 * `api/definitions.py`'s route returns it unwrapped) — `machine`/`steps`
 * are still the JSON-ENCODED STRINGS DataCore stores them as (base_model.json
 * §8), NOT the parsed `MachineDef`/`WorkflowStepDef[]` the bundle route
 * returns. Callers that need the parsed shape must re-fetch the bundle.
 */
export interface DefinitionRow {
  entity_id: string;
  definition_id: string;
  name: string;
  version: number;
  status: DefinitionStatus;
  lineage_status: LineageStatus;
  channel_access: ChannelAccess;
  machine: string;
  steps: string;
  [key: string]: unknown;
}

/** 409 body shape from `archive_definition` when open work items block archiving. */
export interface OpenInstancesConflict {
  open_instances: number;
}

// ---- Template gallery — GET .../templates (designer.py, Task 6) ----------

/**
 * Wire mirror of `template_catalog()`'s per-entry `definition` dict
 * (`app/templates/catalog.py`, which collects one `catalog_entry()` per
 * shipped template) — plain nested `machine`/`steps` (NOT the
 * JSON-encoded-string wire shape a `workflow_definition` row stores; see
 * `DefinitionRow`'s own doc comment). The gallery's "Use template" flow
 * `JSON.stringify`s these at instantiate time, same boundary
 * `DefinitionsPage.tsx`'s `submitNewWorkflow`/`handleNewDraft` already draw
 * (map §3/§8).
 */
export interface TemplateDefinition {
  machine: MachineDef;
  steps: WorkflowStepDef[];
  channel_access: ChannelAccess;
}

export interface TemplateCatalogEntry {
  template_id: string;
  name: string;
  description: string;
  definition: TemplateDefinition;
}

export interface ListTemplatesResponse {
  templates: TemplateCatalogEntry[];
}
