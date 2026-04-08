import { useState, useCallback, useEffect, useRef } from 'react';

const VALID_PAGE_SIZES = [10, 20, 30, 40, 50] as const;
type ValidPageSize = (typeof VALID_PAGE_SIZES)[number];

export interface TablePreferences {
  hiddenColumns: string[];
  pageSize: ValidPageSize;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

const DEFAULT_PREFS: TablePreferences = {
  hiddenColumns: [],
  pageSize: 20,
  sortBy: 'last_name',
  sortDir: 'asc',
};

function buildStorageKey(userId: string, tenantId: string): string {
  return `admindash_table_prefs_${userId}_${tenantId}`;
}

function validatePageSize(size: number): ValidPageSize {
  return VALID_PAGE_SIZES.includes(size as ValidPageSize)
    ? (size as ValidPageSize)
    : 20;
}

function loadPreferences(
  userId: string,
  tenantId: string,
  currentColumns: string[],
): TablePreferences {
  const key = buildStorageKey(userId, tenantId);
  const raw = localStorage.getItem(key);
  if (!raw) return { ...DEFAULT_PREFS };

  try {
    const parsed = JSON.parse(raw) as Partial<TablePreferences>;
    const colSet = new Set(currentColumns);
    return {
      hiddenColumns: (parsed.hiddenColumns ?? []).filter((c) => colSet.has(c)),
      pageSize: validatePageSize(parsed.pageSize ?? 20),
      sortBy: (parsed.sortBy && colSet.has(parsed.sortBy)) ? parsed.sortBy : DEFAULT_PREFS.sortBy,
      sortDir: parsed.sortDir === 'desc' ? 'desc' : 'asc',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePreferences(
  userId: string,
  tenantId: string,
  prefs: TablePreferences,
): void {
  const key = buildStorageKey(userId, tenantId);
  localStorage.setItem(key, JSON.stringify(prefs));
}

export function useTablePreferences(
  userId: string,
  tenantId: string,
  currentColumns: string[],
) {
  const [prefs, setPrefs] = useState<TablePreferences>(() =>
    loadPreferences(userId, tenantId, currentColumns),
  );

  // Re-load preferences when columns, user, or tenant change
  const prevKey = useRef(`${userId}_${tenantId}_${currentColumns.join(',')}`);
  useEffect(() => {
    const key = `${userId}_${tenantId}_${currentColumns.join(',')}`;
    if (key !== prevKey.current && currentColumns.length > 0) {
      prevKey.current = key;
      setPrefs(loadPreferences(userId, tenantId, currentColumns));
    }
  }, [userId, tenantId, currentColumns]);

  const updatePrefs = useCallback(
    (updates: Partial<TablePreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...updates };
        savePreferences(userId, tenantId, next);
        return next;
      });
    },
    [userId, tenantId],
  );

  const toggleColumn = useCallback(
    (columnKey: string) => {
      setPrefs((prev) => {
        const hidden = prev.hiddenColumns.includes(columnKey)
          ? prev.hiddenColumns.filter((c) => c !== columnKey)
          : [...prev.hiddenColumns, columnKey];
        const next = { ...prev, hiddenColumns: hidden };
        savePreferences(userId, tenantId, next);
        return next;
      });
    },
    [userId, tenantId],
  );

  return { prefs, updatePrefs, toggleColumn };
}
