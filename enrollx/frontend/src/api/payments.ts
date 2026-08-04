import { ENROLLX_API_URL } from '../config.ts';

const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchStripeConnectLink(tenantId: string): Promise<string> {
  const resp = await fetch(
    `${ENROLLX_API_URL}/api/stripe/${encodeURIComponent(tenantId)}/connect-link`,
    { headers: authHeaders() },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).url as string;
}

/**
 * Connect state via a read-only backend route rather than client-built SQL.
 *
 * `stripe_account_id` is written by tenant rows alone, and only after a
 * successful Connect callback — DataCore materializes a flattened column only
 * once some row carries the key, so `SELECT stripe_account_id ...` raises a
 * binder error (DataCore 400) for every tenant that has not connected yet.
 * That put a load-failure banner on the page whose only purpose in that state
 * is to offer the Connect button. The backend reads the tenant row by
 * entity_id and checks the field in Python instead.
 */
export async function fetchStripeAccountId(tenantId: string): Promise<string | null> {
  const resp = await fetch(
    `${ENROLLX_API_URL}/api/stripe/${encodeURIComponent(tenantId)}/status`,
    { headers: authHeaders() },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { connected?: boolean; account_id?: string | null };
  return data.connected && data.account_id ? data.account_id : null;
}
