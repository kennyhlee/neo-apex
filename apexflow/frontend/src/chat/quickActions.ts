// Editable quick-action chips, ported from admindash/frontend/src/chat/
// quickActions.ts. Only the IndexedDB database name and the defaults differ:
// `apexflow-chat` (its own origin, its own store — never shared with
// admindash's) and prompts about workflows rather than students.
import { openDB } from 'idb';

const DB = 'apexflow-chat';
const STORE = 'prefs';
const KEY = 'quickActions';
export const MAX_QUICK_ACTIONS = 10;

export const DEFAULT_QUICK_ACTIONS: string[] = [
  'Start a registration workflow from a template',
  'Build a simple signup workflow from scratch',
  'Add a document upload step to this draft',
  'Add a staff approval stage to this draft',
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
