// admindash/frontend/src/db/bulkAddDrafts.ts
import { openDB, type IDBPDatabase } from 'idb';
import type { BatchDraft } from '../types/bulkAdd.ts';

const DB_NAME = 'admindash';
const STORE = 'bulk_add_drafts';
const DB_VERSION = 1;

interface AdmindashDb {
  bulk_add_drafts: {
    key: string;
    value: BatchDraft;
    indexes: { tenantId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<AdmindashDb>> | null = null;

function getDb(): Promise<IDBPDatabase<AdmindashDb>> {
  if (!dbPromise) {
    dbPromise = openDB<AdmindashDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('tenantId', 'tenantId', { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(draft: BatchDraft): Promise<void> {
  const db = await getDb();
  await db.put(STORE, draft);
}

export async function loadDraft(id: string): Promise<BatchDraft | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function findActiveDraftsForTenant(tenantId: string): Promise<BatchDraft[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, 'tenantId', tenantId);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function deleteDraftsForTenant(tenantId: string, exceptId?: string): Promise<void> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, 'tenantId', tenantId);
  await Promise.all(
    all
      .filter((d) => d.id !== exceptId)
      .map((d) => db.delete(STORE, d.id)),
  );
}

export function buildDraftId(tenantId: string, batchId: string): string {
  return `${tenantId}:${batchId}`;
}
