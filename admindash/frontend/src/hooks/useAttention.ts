import { useCallback, useEffect, useState } from 'react';
import { postQuery } from '../api/client.ts';
import { settledSection } from '../utils/workflowData.ts';
import {
  publishedDefinitionsSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
  dueAtProbeSql,
  buildAttention,
  STALLED_DAYS,
  type AttentionResult,
  type DefinitionRow,
  type ItemAttentionRow,
  type InstanceSilenceRow,
} from '../utils/attentionData.ts';

export interface AttentionFailures {
  definitions: boolean;
  submitted: boolean;
  overdue: boolean;
  silence: boolean;
}

const NO_FAILURES: AttentionFailures = {
  definitions: false, submitted: false, overdue: false, silence: false,
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
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const [defs, submitted, overdue, silence] = await Promise.allSettled([
        postQuery(tenant, 'entities', publishedDefinitionsSql()),
        postQuery(tenant, 'entities', submittedItemsSql()),
        postQuery(tenant, 'entities', overdueItemsSql(nowIso)),
        postQuery(tenant, 'entities', instanceSilenceSql()),
      ]);

      if (cancelled) return;

      const d = settledSection(defs, { data: [], total: 0 });
      const s = settledSection(submitted, { data: [], total: 0 });
      let o = settledSection(overdue, { data: [], total: 0 });
      const q = settledSection(silence, { data: [], total: 0 });

      // A rejected overdue query has two possible causes that must not be
      // reported the same way. DataCore's per-tenant table only carries the
      // columns that tenant's rows actually have, so a tenant where no item
      // has ever gotten a due date has no `due_at` column at all — referencing
      // it is a Binder Error, not a null result. That case means "nothing is
      // overdue" (an empty, non-failed bucket), not "the query failed" (a card
      // that must report itself). The cheap probe disambiguates: if it ALSO
      // rejects, `due_at` is genuinely absent and the overdue rejection was
      // that expected case; if the probe resolves, `due_at` exists and the
      // overdue rejection was a real failure. Do not simplify this back into
      // a plain failure flag — that is exactly the bug this exists to avoid.
      if (o.failed) {
        try {
          await postQuery(tenant, 'entities', dueAtProbeSql());
          // Probe resolved: due_at exists on this tenant, so the overdue
          // rejection above was a genuine failure. Leave `o` as-is.
        } catch {
          o = { data: { data: [], total: 0 }, failed: false };
        }
      }

      if (cancelled) return;

      setFailed({
        definitions: d.failed, submitted: s.failed,
        overdue: o.failed, silence: q.failed,
      });

      setResult(buildAttention({
        definitions: d.data.data as unknown as DefinitionRow[],
        submitted: s.data.data as unknown as ItemAttentionRow[],
        overdue: o.data.data as unknown as ItemAttentionRow[],
        silence: q.data.data as unknown as InstanceSilenceRow[],
        nowMs,
        stalledDays: STALLED_DAYS,
      }));
      setLoaded(true);
    }

    void load();
    return () => { cancelled = true; };
  }, [tenant, nonce]);

  return { result, loaded, failed, reload };
}
