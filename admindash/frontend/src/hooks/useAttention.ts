import { useCallback, useEffect, useState } from 'react';
import { postQuery, listLeads } from '../api/client.ts';
import { settledSection } from '../utils/workflowData.ts';
import { leadStages } from '../utils/leadModel.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import {
  publishedDefinitionsSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
  buildAttention,
  STALLED_DAYS,
  type AttentionResult,
  type DefinitionRow,
  type ItemAttentionRow,
  type InstanceSilenceRow,
} from '../utils/attentionData.ts';
import type { Lead } from '../types/models.ts';

export interface AttentionFailures {
  definitions: boolean;
  submitted: boolean;
  overdue: boolean;
  silence: boolean;
  leads: boolean;
}

const NO_FAILURES: AttentionFailures = {
  definitions: false, submitted: false, overdue: false, silence: false, leads: false,
};

export interface AttentionState {
  result: AttentionResult | null;
  loaded: boolean;
  failed: AttentionFailures;
  reload: () => void;
}

/**
 * The one fetch behind both the Home queue and `/attention`.
 *
 * Every section is settled independently. The drawer's live-gate finding
 * (`workflowData.ts:257`) was that a single rejecting query threw before any
 * `setState` ran, so three healthy sections rendered their empty copy. Here
 * the same failure hides one card and leaves the rest correct.
 */
export function useAttention(tenant: string): AttentionState {
  const { getModel } = useModel();
  const [result, setResult] = useState<AttentionResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<AttentionFailures>(NO_FAILURES);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;

    async function load() {
      setLoaded(false);
      // The lead model supplies the stage vocabulary. A failure here does NOT
      // degrade to "no stages" — leadStages(undefined) falls back to
      // DEFAULT_LEAD_STAGES, a real (if generic) vocabulary — so a swallowed
      // failure would silently substitute the default stages for whatever
      // this tenant actually configured, undercounting a renamed bucket like
      // "Inquiry" with no visible sign anything went wrong. So the failure is
      // captured and folded into `failed.leads` below, not swallowed.
      let leadModelFailed = false;
      const leadModel = await getModel(tenant, 'lead').catch(() => {
        leadModelFailed = true;
        return undefined;
      });
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const [defs, submitted, overdue, silence, leads] = await Promise.allSettled([
        postQuery(tenant, 'entities', publishedDefinitionsSql()),
        postQuery(tenant, 'entities', submittedItemsSql()),
        postQuery(tenant, 'entities', overdueItemsSql(nowIso)),
        postQuery(tenant, 'entities', instanceSilenceSql()),
        listLeads(tenant),
      ]);

      if (cancelled) return;

      const d = settledSection(defs, { data: [], total: 0 });
      const s = settledSection(submitted, { data: [], total: 0 });
      const o = settledSection(overdue, { data: [], total: 0 });
      const q = settledSection(silence, { data: [], total: 0 });
      const l = settledSection(leads, [] as Lead[]);

      setFailed({
        definitions: d.failed, submitted: s.failed,
        overdue: o.failed, silence: q.failed, leads: l.failed || leadModelFailed,
      });

      setResult(buildAttention({
        definitions: d.data.data as unknown as DefinitionRow[],
        submitted: s.data.data as unknown as ItemAttentionRow[],
        overdue: o.data.data as unknown as ItemAttentionRow[],
        silence: q.data.data as unknown as InstanceSilenceRow[],
        leads: l.data,
        leadStages: leadStages(leadModel),
        nowMs,
        stalledDays: STALLED_DAYS,
      }));
      setLoaded(true);
    }

    void load();
    return () => { cancelled = true; };
  }, [tenant, nonce, getModel]);

  return { result, loaded, failed, reload };
}
