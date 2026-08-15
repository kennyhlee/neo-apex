// Ported from admindash/frontend/src/components/ChatPanel.tsx. Four things
// differ, all forced by ApexFlow's shape:
//   1. the sessionStorage key is `apexflow_chat_history` (its own origin, its
//      own transcript — never shared with admindash's);
//   2. every send carries a `ChatContext` derived from the router, because the
//      backend reads the open draft server-side from `entity_id`;
//   3. messages carry a monotonically increasing id used as the React key, so
//      the streaming assistant bubble keeps its identity while its text grows;
//   4. the strings are ApexFlow's `assistant.*` keys.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { streamChat, type ChatContext, type ChatTurn, type Proposal } from '../../api/chat.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';
import { QuickActions } from './QuickActions.tsx';
import { CreateDraftCard } from './CreateDraftCard.tsx';
import { PatchCard } from './PatchCard.tsx';
import { Markdown } from './Markdown.tsx';
import './ChatPanel.css';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  proposals?: Proposal[];
  /**
   * The `entity_id` that was open when these proposals were made — the draft
   * the assistant was actually looking at (the backend loads it server-side
   * from `context.entity_id`).
   *
   * Load-bearing, not bookkeeping: this panel NEVER unmounts (the drawer is
   * mounted outside `<Routes>`), and proposals are held in message state, so
   * a patch card outlives the route it was born on. Without the origin
   * recorded here a card authored for draft A would find a perfectly valid
   * bridge on draft B and apply to it — and the ops that carry no
   * cross-references (`add_stage`, `add_step`, `set_channel_access`) would
   * apply CLEANLY, silently editing a workflow nobody was talking about.
   *
   * Null off the editor page; `create_draft` proposals ignore it.
   */
  proposalOrigin?: string | null;
}

// Transcript persists across in-app navigation for the current login session.
// Cleared on logout (see AuthContext). Session-scoped so a closed tab starts fresh.
const CHAT_HISTORY_KEY = 'apexflow_chat_history';

/**
 * The literal 429 sentence `api/chat.ts` yields for the conversation cap. That
 * module has no locale hook, so it emits the backend's English sentence and
 * this — the call site — swaps in the translated one.
 */
const LIMIT_REACHED = 'Conversation limit reached; start a new chat.';

function loadHistory(): Msg[] {
  try {
    const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    // Persisted turns carry no id (see the persist effect) — re-key on load.
    return (JSON.parse(raw) as Omit<Msg, 'id'>[]).map((m, i) => ({ ...m, id: i }));
  } catch {
    return [];
  }
}

/**
 * Renders the card for one proposal. A proposal with no card would contribute
 * no UI — which is also why proposals are never persisted; both shapes are
 * one-shot offers to write, and a restored transcript must not re-offer them.
 */
function renderProposalCard(
  proposal: Proposal,
  key: string,
  appendSystem: (content: string) => void,
  tenantId: string,
  originEntityId: string | null,
): ReactNode {
  switch (proposal.action) {
    case 'create_draft':
      return (
        <CreateDraftCard
          key={key}
          proposal={proposal}
          tenantId={tenantId}
          onDone={appendSystem}
        />
      );
    case 'patch':
      // No tenantId: the patch never leaves the browser — it edits the draft
      // the editor already has open, and the tenant-scoped write is the
      // autosave PUT the store makes afterwards. `originEntityId` is what
      // pins it to the RIGHT draft (see `Msg.proposalOrigin`).
      return (
        <PatchCard
          key={key}
          proposal={proposal}
          originEntityId={originEntityId}
          onDone={appendSystem}
        />
      );
  }
}

export function ChatPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const [msgs, setMsgs] = useState<Msg[]>(loadHistory);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  // Message ids continue past whatever the restored transcript already used.
  const idRef = useRef(msgs.length);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Persist transcript (text only — not re-actionable proposals) so it survives
  // navigating between the list, the templates page and the editor within the
  // same login session.
  useEffect(() => {
    try {
      const text = msgs.map(({ role, content }) => ({ role, content }));
      sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(text));
    } catch {
      /* ignore storage quota / disabled storage */
    }
  }, [msgs]);

  const appendSystem = (content: string) =>
    setMsgs((m) => [...m, { id: idRef.current++, role: 'assistant', content }]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    // Ids are drawn OUTSIDE the updater: a functional updater can run twice
    // (StrictMode) and would otherwise burn a different id on each pass.
    const userId = idRef.current++;
    const replyId = idRef.current++;
    setMsgs((m) => [
      ...m,
      { id: userId, role: 'user', content: q },
      { id: replyId, role: 'assistant', content: '' },
    ]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;

    // Which surface the question was asked from. On the editor the backend
    // loads the open draft itself from this entity_id.
    const match = matchPath('/definitions/:entityId', location.pathname);
    // Captured HERE, at send time, and stamped onto the reply below: it is the
    // draft the backend loads and therefore the only draft any patch this turn
    // produces may be applied to. Reading the route again when a card renders
    // would read wherever the user has navigated to since.
    const originEntityId = match?.params.entityId ?? null;
    const context: ChatContext = match
      ? { page: 'editor', entity_id: match.params.entityId }
      : location.pathname.startsWith('/templates')
        ? { page: 'templates' }
        : { page: 'list' };

    const appendToReply = (extra: string) =>
      setMsgs((m) =>
        m.map((msg) => (msg.id === replyId ? { ...msg, content: msg.content + extra } : msg)),
      );

    const proposals: Proposal[] = [];
    try {
      for await (const ev of streamChat(
        user?.tenant_id ?? '',
        q,
        history,
        msgs.length,
        context,
        ac.signal,
      )) {
        if (ev.type === 'token') {
          appendToReply(ev.text);
        } else if (ev.type === 'proposal') {
          proposals.push(ev.proposal);
        } else if (ev.type === 'error') {
          appendToReply(`\n⚠ ${ev.message === LIMIT_REACHED ? t('assistant.limitReached') : ev.message}`);
        }
      }
    } catch (e) {
      // Aborting is a user action, not a failure — leave what streamed in place.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        appendToReply(`\n⚠ ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      // Busy/pending state is released HERE, not on the `done` event: a
      // truncated stream ends the generator without a terminal event, and the
      // panel must not be left stuck on "Stop" with a dead input.
      abortRef.current = null;
      if (proposals.length) {
        setMsgs((m) =>
          m.map((msg) =>
            msg.id === replyId ? { ...msg, proposals, proposalOrigin: originEntityId } : msg,
          ),
        );
      }
      setBusy(false);
    }
  };

  return (
    <aside className="chat-panel" aria-label={t('assistant.title')}>
      <div className="chat-panel__header">
        {t('assistant.title')}
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
      </div>
      <div className="chat-panel__log" ref={logRef} aria-live="polite">
        {msgs.length === 0 && <p className="chat-panel__empty">{t('assistant.empty')}</p>}
        {msgs.map((m, i) => (
          <div key={m.id} className={`chat-msg chat-msg--${m.role}`}>
            <div className="chat-msg__text">
              {m.content ? (
                m.role === 'assistant' ? (
                  <Markdown text={m.content} />
                ) : (
                  m.content
                )
              ) : busy && i === msgs.length - 1 ? (
                '…'
              ) : (
                ''
              )}
            </div>
            {m.proposals?.map((p, j) =>
              renderProposalCard(
                p,
                `${m.id}-${j}`,
                appendSystem,
                user?.tenant_id ?? '',
                m.proposalOrigin ?? null,
              ),
            )}
          </div>
        ))}
      </div>
      <QuickActions onPick={send} />
      <form
        className="chat-panel__input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
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
