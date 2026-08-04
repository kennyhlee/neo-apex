import { ENROLLX_API_URL } from '../config.ts';

const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Double single quotes so a value is safe inside a SQL string literal. */
function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export async function fetchStripeConnectLink(tenantId: string): Promise<string> {
  const resp = await fetch(
    `${ENROLLX_API_URL}/api/stripe/${encodeURIComponent(tenantId)}/connect-link`,
    { headers: authHeaders() },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).url as string;
}

/** Connect state via the generic query endpoint — no bespoke status route. */
export async function fetchStripeAccountId(tenantId: string): Promise<string | null> {
  const sql =
    `SELECT stripe_account_id FROM data WHERE entity_type = 'tenant' ` +
    `AND entity_id = '${escapeSql(tenantId)}' AND _status = 'active'`;
  const resp = await fetch(`${ENROLLX_API_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant_id: tenantId, table: 'entities', sql }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const row = (data.data ?? [])[0] as Record<string, unknown> | undefined;
  const acct = row?.stripe_account_id;
  return typeof acct === 'string' && acct.length > 0 ? acct : null;
}
