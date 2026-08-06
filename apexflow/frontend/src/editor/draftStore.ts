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
//   first edit; a live `validateDefinition` call still follows immediately
//   after (task review fix #5) so the rail's source of truth is always the
//   PERSISTED state, not a fetch that may already be one edit stale.
// - Task review fix #2: `getBundle`/`validateDefinition` 422 with
//   `{"parse_error": ...}` when the row's stored machine/steps JSON no
//   longer parses (`app/api/designer.py`'s `_parse_or_422`) — a distinct,
//   recoverable state (`parseError`) from a generic network/load failure
//   (`loadError`), so the editor can show "this draft's data is invalid"
//   rather than a blank/opaque error.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getBundle, validateDefinition } from '../api/designer.ts';
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
  /** Set instead of `loadError` when the backend's read routes 422 because
   * the row's stored machine/steps JSON no longer parses — holds the raw
   * backend `parse_error` detail string (task review fix #2). */
  parseError: string | null;
  /** Metadata (name, version, status, ...) of the loaded row — `null` until
   * the first successful load. */
  definition: DefinitionDetail | null;
  models: EntityModelsMap;
  machine: MachineDef;
  steps: WorkflowStepDef[];
  setSteps: (updater: StepsUpdater) => void;
  setMachine: (updater: MachineUpdater) => void;
  /** `definition.status !== "draft"` — every mutating control the editor
   * renders should be disabled when this is true (task review fix #6);
   * `setSteps`/`setMachine` also self-guard against it as a backstop. */
  readOnly: boolean;
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

/** Extracts `{"parse_error": "..."}` from a 422 `ApiError` body
 * (`app/api/designer.py`'s `_parse_or_422`) — `null` for anything else
 * (network failure, 404, 403, ...), which callers treat as a generic
 * `loadError` instead. */
function extractParseError(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const body = err.body;
  if (body && typeof body === 'object' && 'parse_error' in body) {
    const msg = (body as { parse_error?: unknown }).parse_error;
    if (typeof msg === 'string' && msg) return msg;
  }
  return 'Invalid draft data.';
}

export function useDraftStore(tenantId: string, entityId: string | undefined): DraftStore {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
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

  // Timers/flush read the LATEST state via refs rather than closing over
  // the state at schedule time — a rapid string of edits inside one
  // 800ms/600ms window (or a flush-on-unmount firing between renders) must
  // save/validate the final value, not an intermediate one. Synced via
  // effects (not assigned during render) per eslint-plugin-react-hooks'
  // `refs` rule — a ref value used only by later-firing timers/callbacks is
  // exactly the "outside render" case that rule wants, and the
  // one-tick-behind timing is immaterial here (the timers themselves don't
  // fire for another 600-800ms, and dirtyRef is only read from a cleanup
  // function that necessarily runs after the render that set it).
  const definitionRef = useRef(definition);
  const machineRef = useRef(machine);
  const stepsRef = useRef(steps);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    definitionRef.current = definition;
  }, [definition]);
  useEffect(() => {
    machineRef.current = machine;
  }, [machine]);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // In-flight-save guard (task review fix #4): plain refs, never read
  // during render, only mutated from `runAutosave`'s own async body — not
  // subject to the `refs` render-mutation rule.
  const savingRef = useRef(false);
  const queuedRef = useRef(false);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (validateTimer.current) clearTimeout(validateTimer.current);
    autosaveTimer.current = null;
    validateTimer.current = null;
  }, []);

  const runValidate = useCallback(async () => {
    if (!tenantId || !entityId) return;
    setValidation((v) => ({ ...v, validating: true }));
    try {
      const result = await validateDefinition(tenantId, entityId);
      setValidation({ errors: result.errors, health: result.health, validating: false });
    } catch (err) {
      const parseMsg = extractParseError(err);
      if (parseMsg) setParseError(parseMsg);
      // Leave the last-known errors/health in place otherwise — a failed
      // validate call is a transient network hiccup, not "this draft is
      // now valid".
      setValidation((v) => ({ ...v, validating: false }));
    }
  }, [tenantId, entityId]);

  const scheduleValidate = useCallback(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(() => {
      void runValidate();
    }, VALIDATE_DEBOUNCE_MS);
  }, [runValidate]);

  // Always-current pointer to `runAutosave` itself, so the queued-retry
  // path below can invoke "the latest autosave function" without a direct
  // self-reference inside its own `useCallback` body — React Compiler's
  // `react-hooks/preserve-manual-memoization` rejects that shape (it can't
  // preserve memoization across a callback that closes over its own
  // binding). Set via effect, never during render, per the `refs` rule.
  const runAutosaveRef = useRef<() => void>(() => {});

  /**
   * Task review fix #4: never let two PUTs race. If a save is already in
   * flight when this fires again (debounce timer, flush-on-unmount, or a
   * queued re-run), don't start a second concurrent write — `put_entity`
   * archives-and-reinserts (draftStore's own module doc comment), so two
   * overlapping writers is a lost-update hazard even though each
   * individual write is atomic. Instead flag `queuedRef` and, once the
   * in-flight write finishes, run exactly once more reading whatever the
   * LATEST refs hold at that point (never a stale snapshot from when the
   * second call was originally requested).
   */
  const runAutosave = useCallback(async () => {
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    const def = definitionRef.current;
    if (!tenantId || !entityId || !def) return;
    // Hard guard (binding rule): never autosave published/superseded rows.
    if (def.status !== 'draft') return;

    savingRef.current = true;
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
      // Task review fix #5: the debounced typing-triggered validate reads
      // whatever's on the server as of ITS OWN timer firing, which can be
      // stale relative to what just got persisted here — the post-save
      // validate is the authoritative one.
      void runValidate();
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (queuedRef.current) {
        queuedRef.current = false;
        runAutosaveRef.current();
      }
    }
  }, [tenantId, entityId, runValidate]);

  useEffect(() => {
    runAutosaveRef.current = () => {
      void runAutosave();
    };
  }, [runAutosave]);

  const scheduleAutosave = useCallback(() => {
    const def = definitionRef.current;
    if (!def || def.status !== 'draft') return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void runAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [runAutosave]);

  const markDirty = useCallback(() => {
    // Defensive backstop (task review fix #6): the editor disables every
    // mutating control once read-only, so this path shouldn't normally be
    // reachable non-draft — but never mark dirty (or schedule a write that
    // would be a no-op anyway per runAutosave's own guard) if it is.
    if (definitionRef.current && definitionRef.current.status !== 'draft') return;
    setDirty(true);
    setSaveError(false);
    scheduleAutosave();
    scheduleValidate();
  }, [scheduleAutosave, scheduleValidate]);

  const setSteps = useCallback(
    (updater: StepsUpdater) => {
      if (definitionRef.current && definitionRef.current.status !== 'draft') return;
      setStepsState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
      markDirty();
    },
    [markDirty],
  );

  const setMachine = useCallback(
    (updater: MachineUpdater) => {
      if (definitionRef.current && definitionRef.current.status !== 'draft') return;
      setMachineState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
      markDirty();
    },
    [markDirty],
  );

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
    setParseError(null);
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
      void runValidate();
    } catch (err) {
      const parseMsg = extractParseError(err);
      if (parseMsg) setParseError(parseMsg);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, entityId, clearTimers, runValidate]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!tenantId || !entityId) return;
      clearTimers();
      setLoading(true);
      setLoadError(false);
      setParseError(null);
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
        // Task review fix #5: one authoritative validate right after load,
        // in addition to the bundle's own (already-fresh-as-of-fetch)
        // errors/health — keeps "what triggers a validate" uniform with
        // the post-autosave case below rather than two different stories.
        void runValidate();
      } catch (err) {
        if (cancelled) return;
        const parseMsg = extractParseError(err);
        if (parseMsg) setParseError(parseMsg);
        else setLoadError(true);
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

  // Task review fix #3: flush a pending edit on unmount / entityId change.
  // Clearing timers alone (the effect above) would silently DROP an edit
  // that hadn't reached the 800ms debounce yet — e.g. navigating away
  // moments after typing. This is a separate effect (not folded into the
  // load effect's own cleanup) specifically so it can run AFTER
  // `runAutosave` is defined and reference the always-current callback via
  // closure. Fire-and-forget: the component is going away, there's nowhere
  // to show a saving/error state for this particular write, but the row
  // should still end up with the latest edit rather than silently
  // reverting to whatever the debounce last managed to persist.
  // `runAutosave` itself re-checks `status === "draft"` and the in-flight
  // guard, so this is safe to call unconditionally once `dirtyRef` says
  // there's something to flush.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        void runAutosave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, entityId]);

  const readOnly = definition ? definition.status !== 'draft' : false;

  return {
    loading,
    loadError,
    parseError,
    definition,
    models,
    machine,
    steps,
    setSteps,
    setMachine,
    readOnly,
    dirty,
    saving,
    saveError,
    savedAt,
    validation,
    reload: load,
  };
}
