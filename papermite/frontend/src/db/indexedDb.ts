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

// ── Edit-flow original snapshot (sessionStorage, per tab) ──────
//
// The Review page's "no changes detected" Finalize-disabled gate needs a
// baseline that is durable across remounts. A useRef inside ReviewPage
// resets every time the page unmounts (e.g., user navigates to the
// Finalize/Confirm step and back), causing the post-back snapshot to equal
// the already-edited draft and falsely report "no changes." Storing the
// snapshot in sessionStorage when the edit flow starts (LandingPage)
// survives remounts within the tab and gets cleared on
// finalize-confirm or finalize-cancel.

const EDIT_ORIGINAL_KEY_PREFIX = "papermite-edit-original-";

export function saveEditOriginal(extraction: ExtractionResult): void {
  sessionStorage.setItem(
    EDIT_ORIGINAL_KEY_PREFIX + extraction.extraction_id,
    JSON.stringify(extraction),
  );
}

export function getEditOriginal(
  extractionId: string,
): ExtractionResult | null {
  const raw = sessionStorage.getItem(EDIT_ORIGINAL_KEY_PREFIX + extractionId);
  return raw ? (JSON.parse(raw) as ExtractionResult) : null;
}

export function clearEditOriginal(extractionId: string): void {
  sessionStorage.removeItem(EDIT_ORIGINAL_KEY_PREFIX + extractionId);
}
