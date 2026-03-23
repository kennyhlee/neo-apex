import { openDB } from "idb";
import type { ExtractionResult } from "../types/models";

const DB_NAME = "papermite";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "extraction_id" });
      }
    },
  });
}

export async function saveDraft(extraction: ExtractionResult): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, extraction);
}

export async function getDraft(
  extractionId: string
): Promise<ExtractionResult | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, extractionId);
}

export async function getDraftsByTenant(
  tenantId: string
): Promise<ExtractionResult[]> {
  const db = await getDb();
  const all = await db.getAll(STORE_NAME);
  return all.filter((d) => d.tenant_id === tenantId);
}

export async function deleteDraft(extractionId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, extractionId);
}
