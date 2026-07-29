import type { FamilyData } from '../types/models.ts';
import { normalizeSignature, signatureKey, type FamilySignature } from './familyMatch.ts';

export interface RowFamilyInput {
  rowId: string;
  data: FamilyData | null;
}

export interface FamilyPlan {
  /** rowId -> already-known family entity_id (matched existing family). */
  resolved: Record<string, string>;
  /** unique new families to create, one per clusterKey. */
  toCreate: { clusterKey: string; data: FamilyData }[];
  /** rowId -> clusterKey (row whose family must be created in phase A). */
  rowToCluster: Record<string, string>;
  /** rowIds with no family info at all. */
  unassigned: string[];
}

export function planFamilies(
  inputs: RowFamilyInput[],
  matchExisting: (sig: FamilySignature) => string | null,
): FamilyPlan {
  const resolved: Record<string, string> = {};
  const rowToCluster: Record<string, string> = {};
  const unassigned: string[] = [];
  const toCreate: { clusterKey: string; data: FamilyData }[] = [];
  const seenClusters = new Set<string>();

  for (const { rowId, data } of inputs) {
    if (!data) { unassigned.push(rowId); continue; }
    const sig = normalizeSignature(data as unknown as Record<string, unknown>);
    const key = signatureKey(sig);
    if (key) {
      const existing = matchExisting(sig);
      if (existing) { resolved[rowId] = existing; continue; }
      if (!seenClusters.has(key)) { seenClusters.add(key); toCreate.push({ clusterKey: key, data }); }
      rowToCluster[rowId] = key;
    } else {
      // Data present but no dedupe key (e.g. name only) — create a unique family.
      const solo = `solo:${rowId}`;
      toCreate.push({ clusterKey: solo, data });
      rowToCluster[rowId] = solo;
    }
  }

  return { resolved, toCreate, rowToCluster, unassigned };
}
