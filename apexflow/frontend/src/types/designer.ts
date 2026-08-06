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
export type LineageStatus = 'active' | 'deprecated' | 'retired';
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
 */
export type PrimitiveParamKind = 'string' | 'list' | 'string_or_list' | 'condition' | 'date';

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

export type DefinitionLifecycleAction = 'publish' | 'deprecate' | 'reactivate' | 'retire';

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

/** 409 body shape from `retire_definition` when open instances block retirement. */
export interface OpenInstancesConflict {
  open_instances: number;
}

// ---- Template gallery — GET .../templates (designer.py, Task 6) ----------

/**
 * Wire mirror of `template_catalog()`'s per-entry `definition` dict
 * (`app/templates/enrollment.py`) — plain nested `machine`/`steps` (NOT the
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
