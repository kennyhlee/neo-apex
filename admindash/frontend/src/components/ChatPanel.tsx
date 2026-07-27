import { useEffect, useRef, useState } from 'react';
import { streamChat, type ChatTurn, type Proposal } from '../api/chat';
import { useAuth } from '../contexts/AuthContext';
import { QuickActions } from './QuickActions';
import { ProposalCard } from './ProposalCard';
import './ChatPanel.css';

interface Msg { role: 'user' | 'assistant'; content: string; proposals?: Proposal[]; }

// Transcript persists across in-app navigation for the current login session.
// Cleared on logout (see AuthContext). Session-scoped so a closed tab starts fresh.
const CHAT_HISTORY_KEY = 'admindash_chat_history';

function loadHistory(): Msg[] {
  try {
    const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

export function ChatPanel() {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>(loadHistory);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Persist transcript (text only — not re-actionable proposals) so it survives
  // navigating away from Home and back within the same login session.
  useEffect(() => {
    try {
      const text = msgs.map(({ role, content }) => ({ role, content }));
      sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(text));
    } catch {
      /* ignore storage quota / disabled storage */
    }
  }, [msgs]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const proposals: Proposal[] = [];
    try {
      for await (const ev of streamChat(q, history, msgs.length, ac.signal)) {
        if (ev.type === 'token') {
          setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
            ...c[c.length - 1], content: c[c.length - 1].content + ev.text }; return c; });
        } else if (ev.type === 'proposal') {
          proposals.push(ev.proposal);
        } else if (ev.type === 'error') {
          setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
            ...c[c.length - 1], content: c[c.length - 1].content + `\n⚠ ${ev.message}` }; return c; });
        }
      }
    } finally {
      if (proposals.length) {
        setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
          ...c[c.length - 1], proposals }; return c; });
      }
      setBusy(false);
    }
  };

  const appendSystem = (content: string) =>
    setMsgs((m) => [...m, { role: 'assistant', content }]);

  return (
    <aside className="chat-panel">
      <div className="chat-panel__header">Assistant</div>
      <div className="chat-panel__log" ref={logRef}>
        {msgs.length === 0 && (
          <p className="chat-panel__empty">Ask about students, programs, or leads.</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            <div className="chat-msg__text">{m.content || (busy && i === msgs.length - 1 ? '…' : '')}</div>
            {m.proposals?.map((p, j) => (
              <ProposalCard key={j} proposal={p} tenantId={user?.tenant_id ?? ''}
                onDone={appendSystem} />
            ))}
          </div>
        ))}
      </div>
      <QuickActions onPick={send} />
      <form className="chat-panel__input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input value={input} placeholder="Ask a question…" disabled={busy}
          onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
