// Editable quick-action chips, ported from admindash/frontend/src/chat/
// quickActions.ts. Only the IndexedDB database name and the defaults differ:
// `apexflow-chat` (its own origin, its own store — never shared with
// admindash's) and prompts about workflows rather than students.
import { openDB } from 'idb';

const DB = 'apexflow-chat';
const STORE = 'prefs';
const KEY = 'quickActions';
export const MAX_QUICK_ACTIONS = 10;

/**
 * Grouped by what the admin is trying to do: make one, see one, change one,
 * understand one.
 *
 * THE WORDING OF THE "see one" CHIPS IS LOAD-BEARING. `SYSTEM_PROMPT`
 * (backend `app/chat/agent.py`) tells the model to call `show_flow` when
 * asked to "see, show, draw, visualise or explain the shape of" a workflow,
 * and to draw nothing itself. A chip phrased around any other verb gets a
 * paragraph of prose instead of a flow card — so if these are reworded, keep
 * a trigger verb in them. `quickActions.test.ts` holds that line.
 *
 * Must stay within `MAX_QUICK_ACTIONS`: `loadQuickActions` slices a STORED
 * list to that cap but returns this one as-is, so an over-long default set
 * would render more chips than the editor will let anyone add back.
 */
export const DEFAULT_QUICK_ACTIONS: string[] = [
  // Make one
  'Start a registration workflow from a template',
  'Build a simple signup workflow from scratch',
  // See one. Two, not four: chips are the last thing above the input, so
  // every one of them costs transcript height. These cover both paths
  // `show_flow` supports — the open draft, and picking another workflow —
  // and the card itself already answers "who does what" and "where can this
  // end up", which is what a third and fourth chip would have asked.
  'Show me the flow of this workflow',
  'Draw the flow of one of my workflows',
  // Change one
  'Add a document upload step to this draft',
  'Add a staff approval stage to this draft',
  // Understand one
  'Explain this draft\'s validation errors',
  'What workflow templates are available?',
];

async function db() {
  return openDB(DB, 1, { upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); } });
}

export async function loadQuickActions(): Promise<string[]> {
  const stored = (await (await db()).get(STORE, KEY)) as string[] | undefined;
  return stored?.length ? stored.slice(0, MAX_QUICK_ACTIONS) : DEFAULT_QUICK_ACTIONS;
}

export async function saveQuickActions(items: string[]): Promise<void> {
  await (await db()).put(STORE, items.slice(0, MAX_QUICK_ACTIONS), KEY);
}
