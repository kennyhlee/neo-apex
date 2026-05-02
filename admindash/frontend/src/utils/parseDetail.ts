// admindash/frontend/src/utils/parseDetail.ts

/**
 * Parse FastAPI's `{detail: "..."}` body from a Response, falling back
 * to `HTTP <status>` when the body is missing/unparseable. Always returns
 * a non-empty string.
 */
export async function parseDetailError(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    if (!text) return `HTTP ${resp.status}`;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'detail' in parsed &&
        typeof (parsed as { detail: unknown }).detail === 'string'
      ) {
        const detail = (parsed as { detail: string }).detail.trim();
        if (detail) return detail;
      }
    } catch {
      /* not JSON — fall through */
    }
    const snippet = text.trim().slice(0, 200);
    return snippet || `HTTP ${resp.status}`;
  } catch {
    return `HTTP ${resp.status}`;
  }
}

/** Throws Error(parsedDetail) on non-OK; returns the Response otherwise. */
export async function fetchOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resp = await fetch(input, init);
  if (!resp.ok) {
    const detail = await parseDetailError(resp);
    throw new Error(detail);
  }
  return resp;
}
