import { useEffect, useRef, useState } from 'react';
import { streamChat, type ChatTurn, type Proposal } from '../api/chat';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { QuickActions } from './QuickActions';
import { CreateEntityForm } from './CreateEntityForm';
import { Markdown } from './Markdown';
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

export function ChatPanel({
  /**
   * Renders a close control in the header when provided. Optional because the
   * panel is not inherently a drawer — only HomePage wraps it in one, and a
   * panel embedded directly in a page would have nothing to close.
   */
  onClose,
}: { onClose?: () => void } = {}) {
  const { user } = useAuth();
  const { t } = useTranslation();
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
    } catch (e) {
      // Aborting is a user action, not a failure — leave what streamed in place.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setMsgs((m) => { const c = [...m]; c[c.length - 1] = {
          ...c[c.length - 1],
          content: c[c.length - 1].content + `\n⚠ ${e instanceof Error ? e.message : String(e)}`,
        }; return c; });
      }
    } finally {
      abortRef.current = null;
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
    <aside className="chat-panel" aria-label={t('assistant.title')}>
      <div className="chat-panel__header">
        {/* The title carries the `margin-right: auto` that right-aligns the
            controls, rather than Clear carrying `margin-left: auto` —
            otherwise Clear and Hide each claim the free space and drift
            apart, and Hide would un-align whenever Clear is absent. */}
        <span className="chat-panel__title">{t('assistant.title')}</span>
        {msgs.length > 0 && (
          <button
            type="button"
            className="chat-panel__clear"
            onClick={() => setMsgs([])}
            disabled={busy}
          >
            {t('assistant.clear')}
          </button>
        )}
        {/* "Hide ›" rather than a bare ×: the panel slides out to the right
            rather than being dismissed, and the chevron says which way it
            goes. It is aria-hidden so the button's accessible name stays the
            plain verb instead of "Hide right-pointing angle quotation mark". */}
        {onClose && (
          <button type="button" className="chat-panel__close" onClick={onClose}>
            {t('assistant.hide')}
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
      <div className="chat-panel__log" ref={logRef} aria-live="polite">
        {msgs.length === 0 && (
          <p className="chat-panel__empty">{t('assistant.empty')}</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            <div className="chat-msg__text">
              {m.content
                ? (m.role === 'assistant' ? <Markdown text={m.content} /> : m.content)
                : (busy && i === msgs.length - 1 ? '…' : '')}
            </div>
            {m.proposals?.map((p, j) => (
              <CreateEntityForm key={j} proposal={p} tenantId={user?.tenant_id ?? ''}
                onDone={appendSystem} />
            ))}
          </div>
        ))}
      </div>
      <QuickActions onPick={send} />
      <form className="chat-panel__input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <label className="sr-only" htmlFor="chat-panel-input">
          {t('assistant.inputLabel')}
        </label>
        <input
          id="chat-panel-input"
          value={input}
          placeholder={t('assistant.placeholder')}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
        />
        {/* The AbortController was created and stored but never invoked, so a
            long answer could not be stopped. */}
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            {t('assistant.stop')}
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            {t('assistant.send')}
          </button>
        )}
      </form>
    </aside>
  );
}
