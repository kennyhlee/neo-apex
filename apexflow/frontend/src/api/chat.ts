// SSE chat client, ported from admindash/frontend/src/api/chat.ts.
//
// Two things differ from the admindash original, both forced by the route:
// the URL is tenant-scoped (`/api/workflows/{tenant_id}/chat` — the tenant
// comes from the PATH there, not the token), the request carries a `context`
// ({page, entity_id}; the backend reads the open draft server-side from that
// entity_id, so the client never ships a definition), and the proposal union
// is ApexFlow's two shapes rather than admindash's entity-creation one.
//
// The read loop is deliberately thin: all frame handling lives in
// `parseSseChunks` below, which is a pure function over a string and is
// therefore testable without a fetch, a ReadableStream, or a DOM (see
// src/chat/__tests__/sse.test.ts).
import { APEXFLOW_API_URL } from '../config.ts';
import type { PatchOp } from '../chat/patchOps.ts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Which surface the composer is open on — `app/api/chat.py:ChatContext`. */
export type ChatPage = 'list' | 'templates' | 'editor';

export interface ChatContext {
  page: ChatPage;
  /** The open draft's entity_id. Only meaningful (and only sent) on `editor`. */
  entity_id?: string;
}

/**
 * The two proposal shapes `app/chat/tools.py` queues on
 * `ChatDeps.pending_proposals` and `sse_chat` emits verbatim.
 *
 * `machine`/`steps` are `unknown` on purpose: they are the model's authored
 * definition, and the create card parses them where it uses them rather than
 * this transport asserting a shape it never checks.
 */
export type Proposal =
  | {
      action: 'create_draft';
      name: string;
      template_id: string | null;
      machine: unknown;
      steps: unknown[];
      channel_access: string;
      summary: string[];
    }
  | { action: 'patch'; ops: PatchOp[]; summary: string[] };

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'done' }
  | { type: 'error'; message: string };

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('neoapex_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Split a decoded byte buffer into whole SSE frames.
 *
 * Returns the events parsed out of every COMPLETE frame (one terminated by a
 * blank line) plus `rest`, the trailing partial frame the caller must prepend
 * to the next chunk. Holding that tail back is the entire point: a token frame
 * routinely arrives cut mid-JSON, and parsing either half alone throws.
 *
 * A frame whose `data:` payload is not JSON — or that has no `data:` line at
 * all, e.g. a `:` keep-alive comment — is skipped rather than surfaced as an
 * error: the stream's own `error` frame is how the backend reports failure,
 * and a client-side parse hiccup must not truncate the frames after it.
 */
export function parseSseChunks(buffer: string): { events: ChatEvent[]; rest: string } {
  const events: ChatEvent[] = [];
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() ?? '';
  for (const chunk of chunks) {
    const line = chunk.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as ChatEvent);
    } catch {
      /* ignore a malformed frame */
    }
  }
  return { events, rest };
}

/**
 * POST the turn and yield each SSE event as it arrives.
 *
 * Every terminal path yields something the composer can act on: the backend
 * guarantees the stream ends in `done` (`_guarded_sse_chat` wraps even agent
 * construction), and the two non-stream outcomes — the 429 cap and any other
 * non-OK response — yield `error` and return.
 *
 * The 429 body is `{"detail": "Conversation limit reached; start a new chat."}`
 * (`app/api/chat.py:102`); the message below is the same sentence, kept
 * literal here and translated at the call site (Task 8), because this module
 * has no access to the locale hook.
 */
export async function* streamChat(
  tenantId: string,
  message: string,
  history: ChatTurn[],
  messageCount: number,
  context: ChatContext,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const resp = await fetch(`${APEXFLOW_API_URL}/api/workflows/${tenantId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ message, history, message_count: messageCount, context }),
    signal,
  });
  if (resp.status === 429) {
    yield { type: 'error', message: 'Conversation limit reached; start a new chat.' };
    return;
  }
  if (!resp.ok || !resp.body) {
    yield { type: 'error', message: `Request failed (${resp.status})` };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunks(buffer);
    buffer = rest;
    for (const event of events) yield event;
  }
}
