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
//   `submitNewWorkflow` already draws.
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
// - Task 13 (Plan 2 follow-up item 8): a `parse_error` from the DIRECT load
//   path (`load`/the mount effect's `run`) always means `parseError` — the
//   full-page hijack is correct there, since there's no local edit session
//   to fall back on yet. But a `parse_error` from the BACKGROUND debounced
//   `runValidate` call is different: it means the SERVER-STORED row failed
//   to parse as of that read, which can be a stale read racing this
//   session's own in-flight/just-landed autosave rather than genuine
//   corruption — the in-memory `machine`/`steps` the user is actively
//   editing may be perfectly valid and about to overwrite the bad row on
//   the next save. `runValidate` therefore checks `localStateParses()`
//   first: if local state is fine, it sets `staleParseWarning` (a
//   dismissable inline banner) instead of `parseError` (full-page). Only
//   `runValidate`'s own catch branch makes this distinction — `load`/`run`
//   keep setting `parseError` unconditionally, unchanged.
// - Cross-definition race follow-up (re-review of fix #4): EditorPage does
//   NOT remount when the route's `:entityId` param changes to a different
//   definition (same component instance, `useDraftStore` just re-runs with
//   new args) — so the in-flight-save machinery (`savingRef`/
//   `queuedForEntityRef`/`runAutosaveRef`) is SHARED state that survives a
//   definition switch. Without the three-layer guard below (reset on
//   entityId change, entity-tagged queued retries, and a final entity_id
//   match check immediately before every PUT), an in-flight save for
//   definition A that had a queued retry, followed by navigating straight
//   to definition B before A's PUT resolves, could fire that retry AFTER
//   `runAutosaveRef` has been repointed at B's closure while
//   `definitionRef`/`machineRef`/`stepsRef` still held A's data — a PUT
//   under B's entity_id carrying A's content. See each guard's own doc
//   comment below for its specific role.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getBundle, saveDefinition, validateDefinition } from '../api/designer.ts';
import type {
  ChannelAccess,
  DefinitionDetail,
  DefinitionHealth,
  EntityModelsMap,
  MachineDef,
  WorkflowStepDef,
} from '../types/designer.ts';

/**
 * Where unsaved edits are mirrored so a crashed or closed tab does not lose
 * them. Purely a browser write — no request, no DataCore round trip.
 *
 * Keyed by tenant AND entity so two definitions, or two tenants in the same
 * browser profile, cannot shadow each other.
 */
const MIRROR_PREFIX = 'apexflow_draft';
const mirrorKey = (tenantId: string, entityId: string) =>
  `${MIRROR_PREFIX}:${tenantId}:${entityId}`;

interface DraftMirror {
  machine: MachineDef;
  steps: WorkflowStepDef[];
  at: number;
}
const FLUSH_POLL_INTERVAL_MS = 50;
/** Task 10 review fix (minor): `flush()` bails out rather than polling
 * forever if a save is somehow still in flight after this long (a hung
 * request, dead network, ...) — the Publish button's caller catches the
 * thrown error and surfaces a toast instead of leaving the button spinning
 * with no way out. */
const FLUSH_MAX_WAIT_MS = 10_000;

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
  /** Task 13 (Plan 2 follow-up item 8): set instead of `parseError` when the
   * background debounced `runValidate` call 422s with `parse_error` but the
   * CURRENT in-memory `machine`/`steps` are still valid (`localStateParses`)
   * — e.g. a stale read racing this session's own recent autosave, not
   * genuine corruption. Renders as a dismissable inline banner rather than
   * the full-page `parseError` replacement. Cleared on the next successful
   * autosave or validate, via `dismissStaleParseWarning`, or on switching to
   * a different definition. */
  staleParseWarning: string | null;
  /** Dismisses `staleParseWarning` without waiting for the next
   * autosave/validate to clear it. */
  dismissStaleParseWarning: () => void;
  /** Metadata (name, version, status, ...) of the loaded row — `null` until
   * the first successful load. */
  definition: DefinitionDetail | null;
  models: EntityModelsMap;
  machine: MachineDef;
  steps: WorkflowStepDef[];
  setSteps: (updater: StepsUpdater) => void;
  setMachine: (updater: MachineUpdater) => void;
  /** Edits `definition.channel_access` — same draft field as everything
   * else this store owns (autosaved on the same debounce), not a
   * publish-time-only choice. Task 10 binding rule: lives in the editor
   * header near the Publish button, not inside PublishDialog. */
  setChannelAccess: (value: ChannelAccess) => void;
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
  /**
   * Task 10: cancel any pending debounce and, if the draft is dirty,
   * persist immediately and await the write — the Publish button calls
   * this before opening PublishDialog so its own on-open `validateDefinition`
   * call reads the just-saved row, not a stale one still sitting in the
   * 800ms autosave window. Resolves immediately if nothing is dirty.
   * Rejects if an in-flight save doesn't finish within `FLUSH_MAX_WAIT_MS`
   * — callers should catch this and surface it rather than leaving a
   * Publish button stuck in a busy state.
   */
  flush: () => Promise<void>;
  /** Explicit save — the only write, and the only validation. */
  save: () => Promise<void>;
  /** Drop unsaved edits, returning to the last SAVED state. */
  cancel: () => void;
  /** Unsaved edits found in this browser on open, if they differ from the
   * server's copy. Never applied without the author choosing. */
  recovered: { at: number } | null;
  applyRecovered: () => void;
  discardRecovered: () => void;
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

/** Task 13: true if the given `machine`/`steps` are still valid,
 * JSON-round-trippable objects — what `runValidate`'s catch branch uses
 * to decide whether a background `parse_error` reflects genuine local
 * corruption (full-page `parseError`) or just a stale server-side read
 * (dismissable `staleParseWarning`, since these values are what the next
 * autosave will write anyway). Deliberately takes the values as parameters
 * rather than closing over store state, so callers control exactly which
 * snapshot (e.g. the latest ref, not a stale closure) is being judged. */
function localStateParses(machine: MachineDef, steps: WorkflowStepDef[]): boolean {
  try {
    const roundTrippedMachine: unknown = JSON.parse(JSON.stringify(machine));
    const roundTrippedSteps: unknown = JSON.parse(JSON.stringify(steps));
    return (
      roundTrippedMachine !== null &&
      typeof roundTrippedMachine === 'object' &&
      roundTrippedSteps !== null &&
      typeof roundTrippedSteps === 'object'
    );
  } catch {
    return false;
  }
}

export function useDraftStore(tenantId: string, entityId: string | undefined): DraftStore {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [staleParseWarning, setStaleParseWarning] = useState<string | null>(null);
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

  // The hook's PARAMETER (not state) reflecting which definition the store
  // is CURRENTLY scoped to — synced the same render-safe way as the refs
  // above. Read by the queued-retry check below to detect "this queued
  // save was requested for a definition we've since navigated away from"
  // (cross-definition race follow-up, module doc comment).
  const currentEntityIdRef = useRef(entityId);
  useEffect(() => {
    currentEntityIdRef.current = entityId;
  }, [entityId]);

  // In-flight-save guard (task review fix #4): plain refs, never read
  // during render, only mutated from `runAutosave`'s own async body — not
  // subject to the `refs` render-mutation rule.
  const savingRef = useRef(false);
  // Which entityId a queued retry was requested FOR (not a plain boolean —
  // cross-definition race follow-up: the retry must know, and re-check,
  // which definition it was originally queued for before it's allowed to
  // fire against `runAutosaveRef`'s CURRENT target).
  const queuedForEntityRef = useRef<string | null>(null);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Task 10 review fix: monotonic edit counter, incremented by `markDirty`
   * (the single choke point `setSteps`/`setMachine`/`setChannelAccess` all
   * route through) every time an edit happens. `runAutosave` snapshots this
   * at the START of a PUT and, on success, only clears `dirty` if NO edit
   * landed (no increment) while that PUT was in flight.
   *
   * Without this, `flush()` could silently drop an edit:
   *   1. Edit #1 schedules an autosave; its 800ms timer fires and the PUT
   *      starts (`savingRef.current = true`).
   *   2. Edit #2 arrives while that PUT is still in flight — `markDirty`
   *      calls `setDirty(true)` (already true, a no-op) and schedules its
   *      OWN 800ms timer. It does NOT set `queuedForEntityRef` — that's
   *      only set when `runAutosave` itself re-enters while `savingRef` is
   *      already true, which a plain edit never does.
   *   3. The user clicks Publish. `flush()` cancels edit #2's pending timer
   *      and waits (the `while (savingRef.current)` loop) for edit #1's PUT
   *      to finish.
   *   4. Edit #1's PUT resolves successfully. The OLD code unconditionally
   *      ran `setDirty(false)` here — clearing the flag edit #2 needed to
   *      still be true, even though edit #2's content was never sent.
   *   5. `flush()`'s `while` loop exits (`savingRef.current` is now false)
   *      and checks `dirtyRef.current` — which the OLD code had just wrongly
   *      cleared — sees `false`, and skips the forced save entirely. Publish
   *      proceeds with edit #1's (stale) content; edit #2 is silently lost,
   *      with no UI path to recover it once the row is published.
   *
   * Fixed sequence with `editSeqRef`: edit #1's PUT snapshots `seqAtSave =
   * 1` at start. Edit #2's `markDirty` bumps the counter to `2`. Edit #1's
   * PUT resolves, compares `1 !== 2`, and LEAVES `dirty` as-is (still `true`
   * from edit #2). `flush()`'s wait loop exits, sees `dirtyRef.current ===
   * true`, and force-runs `runAutosave()` again — THIS call snapshots
   * `seqAtSave = 2`, PUTs the current (edit #2-inclusive) `stepsRef`/
   * `machineRef`/`definitionRef` content, sees `2 === 2` on success, and
   * only THEN clears `dirty`. `flush()` doesn't resolve until this second
   * save completes, so Publish always opens against fully-persisted content.
   */
  const editSeqRef = useRef(0);

  /**
   * Unsaved edits found in this browser on open, when they differ from what
   * the server returned. Never applied silently: the server row may have moved
   * too, and picking a winner unasked is how people lose work.
   */
  const [recovered, setRecovered] = useState<{ at: number } | null>(null);

  const writeLocalMirror = useCallback(() => {
    if (!tenantId || !entityId) return;
    try {
      const mirror: DraftMirror = {
        machine: machineRef.current,
        steps: stepsRef.current,
        at: Date.now(),
      };
      localStorage.setItem(mirrorKey(tenantId, entityId), JSON.stringify(mirror));
    } catch {
      // A full or disabled localStorage must never break editing — the mirror
      // is a convenience, not the source of truth.
    }
  }, [tenantId, entityId]);

  /**
   * Offer a local copy only when it actually differs from what the server just
   * returned. An identical mirror means the last session ended cleanly, and
   * prompting there would train people to dismiss the prompt reflexively.
   */
  const detectLocalMirror = useCallback((serverDef: DefinitionDetail) => {
    if (!tenantId || !entityId) return;
    try {
      const raw = localStorage.getItem(mirrorKey(tenantId, entityId));
      if (!raw) { setRecovered(null); return; }
      const mirror = JSON.parse(raw) as DraftMirror;
      const same =
        JSON.stringify(mirror.machine) === JSON.stringify(serverDef.machine) &&
        JSON.stringify(mirror.steps) === JSON.stringify(serverDef.steps);
      if (same) {
        localStorage.removeItem(mirrorKey(tenantId, entityId));
        setRecovered(null);
      } else {
        setRecovered({ at: mirror.at });
      }
    } catch {
      setRecovered(null);
    }
  }, [tenantId, entityId]);

  const clearLocalMirror = useCallback(() => {
    if (!tenantId || !entityId) return;
    try {
      localStorage.removeItem(mirrorKey(tenantId, entityId));
    } catch { /* see writeLocalMirror */ }
    setRecovered(null);
  }, [tenantId, entityId]);

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
      // Task 13: a successful validate means the currently-loaded row is
      // fine as of right now — clear any stale-parse banner left over from
      // an earlier racy read.
      setStaleParseWarning(null);
    } catch (err) {
      const parseMsg = extractParseError(err);
      if (parseMsg) {
        // Task 13 (Plan 2 follow-up item 8): only hijack the whole editor
        // (`parseError`) if the LOCAL in-memory machine/steps are ALSO
        // unparseable — read via refs (not the `machine`/`steps` state
        // captured at hook-definition time; this callback isn't
        // re-created on every edit, same reasoning as `runAutosave` using
        // `machineRef`/`stepsRef` throughout). Otherwise this is just a
        // stale server-side read (e.g. racing this session's own recent
        // autosave) — show a dismissable banner instead, since the next
        // autosave will overwrite the bad row with what's on screen.
        if (localStateParses(machineRef.current, stepsRef.current)) {
          setStaleParseWarning(parseMsg);
        } else {
          setParseError(parseMsg);
        }
      }
      // Leave the last-known errors/health in place otherwise — a failed
      // validate call is a transient network hiccup, not "this draft is
      // now valid".
      setValidation((v) => ({ ...v, validating: false }));
    }
  }, [tenantId, entityId]);


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
   * individual write is atomic. Instead flag `queuedForEntityRef` and,
   * once the in-flight write finishes, run exactly once more reading
   * whatever the LATEST refs hold at that point (never a stale snapshot
   * from when the second call was originally requested).
   *
   * Cross-definition race follow-up (module doc comment): three layered
   * guards make this safe across a definition switch, not just across
   * rapid edits to the SAME definition —
   *   1. `queuedForEntityRef` records the entityId THIS closure was
   *      invoked for (its own `entityId` param) when queuing, not just a
   *      boolean — so the finally block below can tell whether the
   *      definition it was queued for is still the one the store is
   *      currently showing.
   *   2. The load effect resets `savingRef`/`queuedForEntityRef` the
   *      moment `tenantId`/`entityId` changes, cancelling any retry
   *      that was queued for the definition being navigated away from
   *      (this fires synchronously as part of that same render's effect
   *      processing, which always happens-before an already-in-flight
   *      PUT's `.then`/`finally` continuation — JS is single-threaded and
   *      a pending network response can't preempt already-queued
   *      synchronous effect work).
   *   3. Belt-and-suspenders, right here: even if (1)/(2) somehow didn't
   *      catch it, refuse to PUT if `definitionRef.current.entity_id`
   *      doesn't match the `entityId` this closure is about to write
   *      under — `definitionRef` is a SHARED ref the load effect updates
   *      asynchronously once ITS fetch resolves, so a drift here means
   *      something raced ahead of that update.
   */
  const runAutosave = useCallback(async () => {
    if (savingRef.current) {
      queuedForEntityRef.current = entityId ?? null;
      return;
    }
    const def = definitionRef.current;
    if (!tenantId || !entityId || !def) return;
    // Hard guard (binding rule): never autosave published/superseded rows.
    if (def.status !== 'draft') return;
    // Guard 3 above — refuse rather than send a different definition's
    // content to this entity_id, or vice versa.
    if (def.entity_id !== entityId) {
      console.error(
        '[draftStore] Refusing autosave: definitionRef.entity_id ' +
          `(${def.entity_id}) does not match the target entityId (${entityId}) — ` +
          'likely a save queued across a definition switch. Skipping this write.',
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    // Snapshot BEFORE the PUT — see editSeqRef's own doc comment for the
    // exact edit-loss race this prevents (Task 10 review fix).
    const seqAtSave = editSeqRef.current;
    try {
      const result = await saveDefinition(tenantId, entityId, {
        machine: machineRef.current,
        steps: stepsRef.current,
        channel_access: def.channel_access,
      });
      // Validation rides the write — no separate call, and no way for the
      // editor to ask for it independently.
      setValidation({ errors: result.errors, health: result.health, validating: false });
      // Only clear `dirty` if no edit landed while this PUT was in flight
      // (editSeqRef unchanged since the snapshot above) — otherwise this
      // write is already stale relative to the newer edit, and `dirty` must
      // stay true so that edit still gets its own save (either the timer it
      // already scheduled, or a caller like `flush()` re-checking `dirty`).
      if (seqAtSave === editSeqRef.current) {
        setDirty(false);
      }
      setSavedAt(Date.now());
      // Task 13: a successful autosave writes exactly what's in
      // `machineRef`/`stepsRef` right now, which is by definition
      // `localStateParses`-valid content — clear any stale-parse banner
      // immediately rather than waiting for the validate call below to
      // land (belt-and-suspenders; that call also clears it on success).
      setStaleParseWarning(null);
      // The local mirror exists only to survive a crash between saves; once
      // the content is on the server it is noise, and leaving it behind would
      // shadow the real row on the next open.
      clearLocalMirror();
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
      const queuedFor = queuedForEntityRef.current;
      if (queuedFor !== null) {
        queuedForEntityRef.current = null;
        // Guard 1 above — drop a queued retry silently if the definition
        // it was requested for isn't the one currently loaded; any edit
        // that was genuinely still dirty for THAT definition at the
        // moment of navigating away was already flushed by the
        // flush-on-unmount effect (task review fix #3), so this isn't a
        // data-loss regression.
        if (queuedFor === currentEntityIdRef.current) {
          runAutosaveRef.current();
        }
      }
    }
  }, [tenantId, entityId, clearLocalMirror]);

  useEffect(() => {
    runAutosaveRef.current = () => {
      void runAutosave();
    };
  }, [runAutosave]);


  const markDirty = useCallback(() => {
    // Defensive backstop (task review fix #6): the editor disables every
    // mutating control once read-only, so this path shouldn't normally be
    // reachable non-draft — but never mark dirty (or schedule a write that
    // would be a no-op anyway per runAutosave's own guard) if it is.
    if (definitionRef.current && definitionRef.current.status !== 'draft') return;
    // Bumped on every edit — `runAutosave`'s snapshot-and-compare against
    // this is what lets it tell "no newer edit happened during my PUT"
    // apart from "one did" (editSeqRef's own doc comment, Task 10 review
    // fix). `setSteps`/`setMachine`/`setChannelAccess` all route through
    // this single function for the dirty-flagging step, so incrementing
    // here alone covers all three.
    editSeqRef.current += 1;
    setDirty(true);
    setSaveError(false);
    // No timers. Edits stay in the browser until an explicit save, and are
    // mirrored to localStorage purely so a crashed or closed tab does not lose
    // them — that mirror is a synchronous browser write, never a request.
    writeLocalMirror();
  }, [writeLocalMirror]);

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

  const setChannelAccess = useCallback(
    (value: ChannelAccess) => {
      if (definitionRef.current && definitionRef.current.status !== 'draft') return;
      setDefinition((prev) => (prev ? { ...prev, channel_access: value } : prev));
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
    setStaleParseWarning(null);
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
      // The bundle already carries validation, so nothing needs to ask for it
      // separately on load.
      detectLocalMirror(bundle.definition);
    } catch (err) {
      const parseMsg = extractParseError(err);
      if (parseMsg) setParseError(parseMsg);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, entityId, clearTimers, detectLocalMirror]);

  useEffect(() => {
    // Cross-definition race follow-up (module doc comment, guard 2 of 3):
    // reset the in-flight-save machinery the moment we're scoping to a new
    // tenantId/entityId — cancels any retry that was queued for the
    // definition being navigated away from before its own in-flight PUT's
    // `finally` block gets a chance to act on it. Deliberately does NOT
    // touch `savingRef` alone without also clearing the queued flag (or
    // vice versa) — both must move together so a stale queue can never
    // survive into the new definition's era. Runs synchronously here
    // (before the async `run()` below even starts), which — because JS is
    // single-threaded — always happens-before any already-in-flight PUT's
    // continuation, regardless of that PUT's own timing.
    savingRef.current = false;
    queuedForEntityRef.current = null;

    let cancelled = false;

    async function run() {
      if (!tenantId || !entityId) return;
      clearTimers();
      setLoading(true);
      setLoadError(false);
      setParseError(null);
      // Task 13: `staleParseWarning` is per-definition, same as
      // `parseError` on the line above — a banner surfaced for the
      // definition being navigated away from must not linger over the
      // next one.
      setStaleParseWarning(null);
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

  // Task 10: Publish button's pre-open flush. Cancels the debounce timer
  // (so it can't ALSO fire and race this write) and, only if there's
  // actually something unsaved, runs the save immediately and awaits it —
  // `runAutosave` re-validates its own dirty/status/in-flight guards, so
  // this is just "do it now instead of after 800ms" rather than a second
  // code path. The wait-out-any-in-flight-save loop below covers the
  // narrow race where a debounce-triggered save started microtasks before
  // this fires (savingRef true, but not from THIS call) — without it,
  // calling `runAutosave` immediately would just re-queue behind that save
  // (`queuedForEntityRef`) and resolve before the queued retry actually
  // ran, handing the Publish dialog a promise that resolved before the
  // draft was actually fully flushed. Combined with `editSeqRef` (see its
  // own doc comment), re-checking `dirtyRef` AFTER draining the in-flight
  // save is now reliable: if an edit landed during that save, `dirty` was
  // deliberately left true, so the `if (dirtyRef.current)` below force-runs
  // a second save carrying that edit's content.
  //
  // Bounded by `FLUSH_MAX_WAIT_MS` (review fix, minor): a save that never
  // resolves (dead network, hung request) would otherwise poll forever —
  // this throws instead, so the Publish button's `catch` can surface a
  // toast and re-enable itself rather than spinning indefinitely.
  const flush = useCallback(async () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    let waited = 0;
    while (savingRef.current) {
      if (waited >= FLUSH_MAX_WAIT_MS) {
        throw new Error('flush() timed out waiting for an in-flight save to finish');
      }
      await new Promise((resolve) => setTimeout(resolve, FLUSH_POLL_INTERVAL_MS));
      waited += FLUSH_POLL_INTERVAL_MS;
    }
    if (dirtyRef.current) {
      await runAutosave();
    }
  }, [runAutosave]);

  /** Explicit save. The only thing that writes, and the only thing that
   * validates — both in one request. */
  const save = useCallback(async () => {
    await runAutosave();
  }, [runAutosave]);

  /**
   * Drop unsaved edits and return to the last SAVED state.
   *
   * Deliberately not "back to how it was when the editor opened": once someone
   * has saved mid-session those diverge, and discarding a save the author
   * deliberately made would be undoing their work, not cancelling it.
   */
  const cancel = useCallback(() => {
    const def = definitionRef.current;
    if (!def) return;
    setMachineState(def.machine);
    setStepsState(def.steps);
    setDirty(false);
    setSaveError(false);
    clearLocalMirror();
  }, [clearLocalMirror]);

  /** Apply the recovered local copy as the current working content. It stays
   * unsaved — the author reviews it and saves, or cancels it away. */
  const applyRecovered = useCallback(() => {
    if (!tenantId || !entityId) return;
    try {
      const raw = localStorage.getItem(mirrorKey(tenantId, entityId));
      if (!raw) return;
      const mirror = JSON.parse(raw) as DraftMirror;
      setMachineState(mirror.machine);
      setStepsState(mirror.steps);
      setDirty(true);
    } catch { /* a corrupt mirror is simply not offered */ }
    setRecovered(null);
  }, [tenantId, entityId]);

  const readOnly = definition ? definition.status !== 'draft' : false;

  const dismissStaleParseWarning = useCallback(() => setStaleParseWarning(null), []);

  return {
    loading,
    loadError,
    parseError,
    staleParseWarning,
    dismissStaleParseWarning,
    definition,
    models,
    machine,
    steps,
    setSteps,
    setMachine,
    setChannelAccess,
    readOnly,
    dirty,
    saving,
    saveError,
    savedAt,
    validation,
    reload: load,
    flush,
    save,
    cancel,
    recovered,
    applyRecovered,
    discardRecovered: clearLocalMirror,
  };
}
