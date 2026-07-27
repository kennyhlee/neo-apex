import { openDB } from 'idb';

const DB = 'admindash-chat';
const STORE = 'prefs';
const KEY = 'quickActions';
export const MAX_QUICK_ACTIONS = 10;

export const DEFAULT_QUICK_ACTIONS: string[] = [
  'Add a new student',
  'Find a student by name',
  'List students in a program',
  'How many students are enrolled?',
  'Show new leads',
  'Add a lead',
  'List programs',
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
