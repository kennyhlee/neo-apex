import { useState, useCallback } from 'react';

const VALID_PAGE_SIZES = [10, 20, 30, 40, 50] as const;
type ValidPageSize = (typeof VALID_PAGE_SIZES)[number];

export interface TablePreferences {
  hiddenColumns: string[];
  pageSize: ValidPageSize;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

/**
 * Options that scope a preferences slot to a particular table.
 *
 * `namespace` partitions storage per entity type so that, e.g., the Programs
 * table and the Students table do not clobber each other's sort/page-size/hidden
 * columns. `defaultSortBy` is the fallback sort column when nothing is persisted
 * yet (e.g. 'last_name' for students, 'name' for programs).
 */
export interface UseTablePreferencesOptions {
  namespace?: string;
  defaultSortBy?: string;
}

const DEFAULT_NAMESPACE = 'student';
const DEFAULT_SORT_BY = 'last_name';

function baseDefaults(defaultSortBy: string): TablePreferences {
  return {
    hiddenColumns: [],
    pageSize: 20,
    sortBy: defaultSortBy,
    sortDir: 'asc',
  };
}

function buildStorageKey(namespace: string, userId: string, tenantId: string): string {
  return `admindash_table_prefs_${namespace}_${userId}_${tenantId}`;
}

function validatePageSize(size: number): ValidPageSize {
  return VALID_PAGE_SIZES.includes(size as ValidPageSize)
    ? (size as ValidPageSize)
    : 20;
}

function loadPreferences(
  namespace: string,
  userId: string,
  tenantId: string,
  currentColumns: string[],
  defaultSortBy: string,
): TablePreferences {
  const key = buildStorageKey(namespace, userId, tenantId);
  const raw = localStorage.getItem(key);
  if (!raw) return baseDefaults(defaultSortBy);

  try {
    const parsed = JSON.parse(raw) as Partial<TablePreferences>;
    const colSet = new Set(currentColumns);
    return {
      hiddenColumns: (parsed.hiddenColumns ?? []).filter((c) => colSet.has(c)),
      pageSize: validatePageSize(parsed.pageSize ?? 20),
      sortBy: (parsed.sortBy && colSet.has(parsed.sortBy)) ? parsed.sortBy : defaultSortBy,
      sortDir: parsed.sortDir === 'desc' ? 'desc' : 'asc',
    };
  } catch {
    return baseDefaults(defaultSortBy);
  }
}

function savePreferences(
  namespace: string,
  userId: string,
  tenantId: string,
  prefs: TablePreferences,
): void {
  const key = buildStorageKey(namespace, userId, tenantId);
  localStorage.setItem(key, JSON.stringify(prefs));
}

export function useTablePreferences(
  userId: string,
  tenantId: string,
  currentColumns: string[],
  options: UseTablePreferencesOptions = {},
) {
  const { namespace = DEFAULT_NAMESPACE, defaultSortBy = DEFAULT_SORT_BY } = options;

  const [prefs, setPrefs] = useState<TablePreferences>(() =>
    loadPreferences(namespace, userId, tenantId, currentColumns, defaultSortBy),
  );

  // Re-load preferences when namespace, columns, user, or tenant change by
  // adjusting state during render (the React-recommended alternative to a
  // setState-in-effect; see react.dev "You Might Not Need an Effect").
  const key = `${namespace}_${userId}_${tenantId}_${currentColumns.join(',')}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey && currentColumns.length > 0) {
    setPrevKey(key);
    setPrefs(loadPreferences(namespace, userId, tenantId, currentColumns, defaultSortBy));
  }

  const updatePrefs = useCallback(
    (updates: Partial<TablePreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...updates };
        savePreferences(namespace, userId, tenantId, next);
        return next;
      });
    },
    [namespace, userId, tenantId],
  );

  const toggleColumn = useCallback(
    (columnKey: string) => {
      setPrefs((prev) => {
        const hidden = prev.hiddenColumns.includes(columnKey)
          ? prev.hiddenColumns.filter((c) => c !== columnKey)
          : [...prev.hiddenColumns, columnKey];
        const next = { ...prev, hiddenColumns: hidden };
        savePreferences(namespace, userId, tenantId, next);
        return next;
      });
    },
    [namespace, userId, tenantId],
  );

  return { prefs, updatePrefs, toggleColumn };
}
