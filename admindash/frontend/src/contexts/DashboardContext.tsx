import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { postQuery } from '../api/client.ts';

const TTL_MS = 60 * 60 * 1000; // 60 minutes

interface CachedCount {
  value: number;
  fetchedAt: number;
}

interface DashboardContextValue {
  getStudentCount: (tenantId: string) => Promise<number | null>;
  invalidateStudentCount: () => void;
  getProgramCount: (tenantId: string) => Promise<number | null>;
  invalidateProgramCount: () => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  getStudentCount: () => Promise.resolve(null),
  invalidateStudentCount: () => {},
  getProgramCount: () => Promise.resolve(null),
  invalidateProgramCount: () => {},
});

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<CachedCount | null>(null);
  const [programCache, setProgramCache] = useState<CachedCount | null>(null);

  const getStudentCount = useCallback(
    async (tenantId: string): Promise<number | null> => {
      // Return cached value if still valid
      if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
        return cache.value;
      }

      try {
        const sql = "SELECT COUNT(*) as count FROM data WHERE entity_type = 'student' AND _status = 'active'";
        const result = await postQuery(tenantId, 'entities', sql);
        const count = Number(result.data[0]?.count ?? 0);
        setCache({ value: count, fetchedAt: Date.now() });
        return count;
      } catch {
        return null;
      }
    },
    [cache],
  );

  const invalidateStudentCount = useCallback(() => {
    setCache(null);
  }, []);

  const getProgramCount = useCallback(
    async (tenantId: string): Promise<number | null> => {
      if (programCache && Date.now() - programCache.fetchedAt < TTL_MS) {
        return programCache.value;
      }
      try {
        const sql = "SELECT COUNT(*) as count FROM data WHERE entity_type = 'program' AND _status = 'active'";
        const result = await postQuery(tenantId, 'entities', sql);
        const count = Number(result.data[0]?.count ?? 0);
        setProgramCache({ value: count, fetchedAt: Date.now() });
        return count;
      } catch {
        return null;
      }
    },
    [programCache],
  );

  const invalidateProgramCount = useCallback(() => {
    setProgramCache(null);
  }, []);

  return (
    <DashboardContext.Provider value={{ getStudentCount, invalidateStudentCount, getProgramCount, invalidateProgramCount }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DashboardContext);
}
