import { ADMINDASH_API_URL } from '../config';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export interface Proposal {
  action: 'create_student' | 'create_lead' | 'create_program';
  entity_type: string;
  fields: Record<string, string>;
  duplicates: Array<Record<string, unknown>>;
}

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

export async function* streamChat(
  message: string,
  history: ChatTurn[],
  messageCount: number,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const resp = await fetch(`${ADMINDASH_API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ message, history, message_count: messageCount }),
    signal,
  });
  if (resp.status === 429) { yield { type: 'error', message: 'Conversation limit reached. Start a new chat.' }; return; }
  if (!resp.ok || !resp.body) { yield { type: 'error', message: `Request failed (${resp.status})` }; return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { yield JSON.parse(line.slice(5).trim()) as ChatEvent; } catch { /* ignore */ }
    }
  }
}
