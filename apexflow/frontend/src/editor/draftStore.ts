// Single source of truth for the loaded draft (Task 7 brief's binding rule).
// Owns the parsed `machine`/`steps` objects, a debounced autosave that
// JSON.stringifies them and PUTs through `updateEntity` — ONLY while
// `status === "draft"` (hard guard: never autosave a published/superseded
// row) — dirty/saving/saved indicator state, and a debounced `validate()`
// call holding `{errors, health}` for the right rail.
//
// Binding notes:
// - `getBundle` already returns `definition.machine`/`.steps` PARSED
//   (`DefinitionBundle` — interface map §2i / types/designer.ts), not the
//   JSON-encoded strings a `workflow_definition` DataCore row stores them
//   as (map §3/§8) — this store parses once at load and re-stringifies only
//   at the autosave write boundary, same boundary DefinitionsPage.tsx's
//   `handleNewDraft`/`submitNewWorkflow` already draw.
// - `updateEntity` (api/client.ts, PUT /api/entities/.../{entity_id}) maps
//   to DataCore's `store.put_entity`, which REPLACES the row's entire
//   `base_data` with what's sent (archive-and-reinsert, not a merge —
//   `datacore/src/datacore/store.py:307-355`). Every autosave write must
//   therefore carry the FULL known base-field set (definition_id, name,
//   version, status, lineage_status, channel_access, machine, steps), not
//   just the two fields this store actually edits — omitting any of them
//   would silently blank it on the next save.
// - The bundle route's top-level `health`/`errors` (`DefinitionBundle`) are
//   the definition's CURRENT validation state as of load — seeded directly
//   into `validation` so the right rail has something to show before the
//   first edit, without a redundant extra `validateDefinition` call.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBundle, validateDefinition } from '../api/designer.ts';
import { updateEntity } from '../api/client.ts';
import type {
  DefinitionDetail,
  DefinitionHealth,
  EntityModelsMap,
  MachineDef,
  WorkflowStepDef,
} from '../types/designer.ts';

const AUTOSAVE_DEBOUNCE_MS = 800;
const VALIDATE_DEBOUNCE_MS = 600;

const EMPTY_MACHINE: MachineDef = { states: [], transitions: [] };

export type StepsUpdater = WorkflowStepDef[] | ((prev: WorkflowStepDef[]) => WorkflowStepDef[]);
export type MachineUpdater = MachineDef | ((prev: MachineDef) => MachineDef);

export interface ValidationState {
  errors: string[];
  health: DefinitionHealth | null;
  validating: boolean;
}

export interface DraftStore {
  loading: boolean;
  loadError: boolean;
  /** Metadata (name, version, status, ...) of the loaded row — `null` until
   * the first successful load. */
  definition: DefinitionDetail | null;
  models: EntityModelsMap;
  machine: MachineDef;
  steps: WorkflowStepDef[];
  setSteps: (updater: StepsUpdater) => void;
  setMachine: (updater: MachineUpdater) => void;
  /** True once an edit has been made since the last successful save. */
  dirty: boolean;
  saving: boolean;
  saveError: boolean;
  /** `Date.now()` of the last successful autosave, or `null` before the
   * first one. */
  savedAt: number | null;
  validation: ValidationState;
  reload: () => Promise<void>;
}

export function useDraftStore(tenantId: string, entityId: string | undefined): DraftStore {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [definition, setDefinition] = useState<DefinitionDetail | null>(null);
  const [models, setModels] = useState<EntityModelsMap>({});
  const [machine, setMachineState] = useState<MachineDef>(EMPTY_MACHINE);
  const [steps, setStepsState] = useState<WorkflowStepDef[]>([]);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [validation, setValidation] = useState<ValidationState>({
    errors: [],
    health: null,
    validating: false,
  });

  // Timers read the LATEST state via refs rather than closing over the
  // state at schedule time — a rapid string of edits inside one 800ms/600ms
  // window must save/validate the final value, not an intermediate one.
  // Synced via effects (not assigned during render) per
  // eslint-plugin-react-hooks' `refs` rule — a ref value used only by
  // later-firing timers/callbacks is exactly the "outside render" case that
  // rule wants, and the one-tick-behind timing is immaterial here (the
  // timers themselves don't fire for another 600-800ms).
  const definitionRef = useRef(definition);
  const machineRef = useRef(machine);
  const stepsRef = useRef(steps);
  useEffect(() => {
    definitionRef.current = definition;
  }, [definition]);
  useEffect(() => {
    machineRef.current = machine;
  }, [machine]);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (validateTimer.current) clearTimeout(validateTimer.current);
    autosaveTimer.current = null;
    validateTimer.current = null;
  }, []);

  // `load` is the reusable reload path (retry button, `reload()`). The
  // mount/entityId-change effect below deliberately does NOT call it
  // directly — same reasoning as DefinitionsPage.tsx's own `load` doc
  // comment: an effect whose body is (transitively) just "call this
  // memoized function that sets state" trips eslint-plugin-react-hooks'
  // set-state-in-effect rule.
  const load = useCallback(async () => {
    if (!tenantId || !entityId) return;
    clearTimers();
    setLoading(true);
    setLoadError(false);
    try {
      const bundle = await getBundle(tenantId, entityId);
      setDefinition(bundle.definition);
      setModels(bundle.models);
      setMachineState(bundle.definition.machine);
      setStepsState(bundle.definition.steps);
      setValidation({ errors: bundle.errors, health: bundle.health, validating: false });
      setDirty(false);
      setSaveError(false);
      setSavedAt(null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, entityId, clearTimers]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!tenantId || !entityId) return;
      clearTimers();
      setLoading(true);
      setLoadError(false);
      try {
        const bundle = await getBundle(tenantId, entityId);
        if (cancelled) return;
        setDefinition(bundle.definition);
        setModels(bundle.models);
        setMachineState(bundle.definition.machine);
        setStepsState(bundle.definition.steps);
        setValidation({ errors: bundle.errors, health: bundle.health, validating: false });
        setDirty(false);
        setSaveError(false);
        setSavedAt(null);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, entityId]);

  const runValidate = useCallback(async () => {
    if (!tenantId || !entityId) return;
    setValidation((v) => ({ ...v, validating: true }));
    try {
      const result = await validateDefinition(tenantId, entityId);
      setValidation({ errors: result.errors, health: result.health, validating: false });
    } catch {
      // Leave the last-known errors/health in place — a failed validate
      // call is a transient network hiccup, not "this draft is now valid".
      setValidation((v) => ({ ...v, validating: false }));
    }
  }, [tenantId, entityId]);

  const scheduleValidate = useCallback(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(() => {
      void runValidate();
    }, VALIDATE_DEBOUNCE_MS);
  }, [runValidate]);

  const runAutosave = useCallback(async () => {
    const def = definitionRef.current;
    if (!tenantId || !entityId || !def) return;
    // Hard guard (binding rule): never autosave published/superseded rows.
    if (def.status !== 'draft') return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateEntity(tenantId, 'workflow_definition', entityId, {
        definition_id: def.definition_id,
        name: def.name,
        version: def.version,
        status: def.status,
        lineage_status: def.lineage_status,
        channel_access: def.channel_access,
        machine: JSON.stringify(machineRef.current),
        steps: JSON.stringify(stepsRef.current),
      });
      setDirty(false);
      setSavedAt(Date.now());
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [tenantId, entityId]);

  const scheduleAutosave = useCallback(() => {
    const def = definitionRef.current;
    if (!def || def.status !== 'draft') return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void runAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [runAutosave]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaveError(false);
    scheduleAutosave();
    scheduleValidate();
  }, [scheduleAutosave, scheduleValidate]);

  const setSteps = useCallback(
    (updater: StepsUpdater) => {
      setStepsState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
      markDirty();
    },
    [markDirty],
  );

  const setMachine = useCallback(
    (updater: MachineUpdater) => {
      setMachineState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
      markDirty();
    },
    [markDirty],
  );

  return {
    loading,
    loadError,
    definition,
    models,
    machine,
    steps,
    setSteps,
    setMachine,
    dirty,
    saving,
    saveError,
    savedAt,
    validation,
    reload: load,
  };
}
