import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { postQuery } from '../api/client.ts';
import type { ModelDefinition } from '../types/models.ts';

interface ModelCache {
  [entityType: string]: ModelDefinition;
}

interface ModelContextValue {
  getModel: (tenantId: string, entityType: string) => Promise<ModelDefinition>;
  getCachedModel: (entityType: string) => ModelDefinition | undefined;
  clearCache: () => void;
}

const ModelContext = createContext<ModelContextValue>({
  getModel: () => Promise.reject(new Error('ModelContext not initialized')),
  getCachedModel: () => undefined,
  clearCache: () => {},
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<ModelCache>({});

  const getModel = useCallback(
    async (tenantId: string, entityType: string): Promise<ModelDefinition> => {
      if (cache[entityType]) return cache[entityType];

      const sql = `SELECT * FROM data WHERE entity_type = '${entityType}' AND _status = 'active'`;
      const result = await postQuery(tenantId, 'models', sql);
      if (!result.data.length) throw new Error('Model not configured');
      const raw = result.data[0].model_definition;
      const modelDef = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ModelDefinition;
      setCache((prev) => ({ ...prev, [entityType]: modelDef }));
      return modelDef;
    },
    [cache],
  );

  const getCachedModel = useCallback(
    (entityType: string): ModelDefinition | undefined => cache[entityType],
    [cache],
  );

  const clearCache = useCallback(() => setCache({}), []);

  return (
    <ModelContext.Provider value={{ getModel, getCachedModel, clearCache }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  return useContext(ModelContext);
}
