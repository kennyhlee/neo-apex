// The confirmation card for a `create_draft` proposal: nothing the assistant
// authors reaches the tenant's data until the operator presses the button here.
//
// `proposal.template_id` is deliberately NOT forwarded to `createDefinition` —
// it is display/provenance only and `CreateDefinitionRequest` does not accept
// it; the authored `machine`/`steps` the model produced are the whole payload.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDefinition } from '../../api/designer.ts';
import type { Proposal } from '../../api/chat.ts';
import { useTranslation } from '../../hooks/useTranslation.ts';
import { errorDetail } from '../../utils/apiError.ts';

export function CreateDraftCard({
  proposal,
  tenantId,
  onDone,
}: {
  proposal: Extract<Proposal, { action: 'create_draft' }>;
  tenantId: string;
  onDone: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createDefinition(tenantId, {
        name: proposal.name,
        machine: proposal.machine,
        steps: proposal.steps,
        channel_access: proposal.channel_access,
      });
      // Ordering matters: `created` retires the actions BEFORE the route change,
      // so a card left mounted in the drawer can never create a second draft.
      setCreated(true);
      onDone(t('assistant.draftCreatedMsg').replace('{name}', proposal.name));
      navigate(`/definitions/${result.row.entity_id}`);
    } catch (e) {
      // The card stays actionable on failure — the proposal is not persisted,
      // so losing the buttons would lose the authored draft with them.
      //
      // The server's own sentence first: the likely failure here is a 422 on a
      // machine the MODEL authored, and `ApiError.message` is only ever
      // `HTTP 422` — the parse error the operator needs in order to know what
      // to ask "Adjust…" for is on `.body`. Falls back to the raw message for
      // the errors that carry no body at all (a dead backend, a network drop).
      setError(errorDetail(e) ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-card">
      <div className="chat-card__title">
        {t('assistant.createDraft')} · {proposal.name}
      </div>
      {proposal.summary.length > 0 && (
        <ul className="chat-card__summary">
          {proposal.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="chat-card__error">
          {t('assistant.createFailed')}: {error}
        </p>
      )}
      {created ? (
        <p className="chat-card__created">{t('assistant.draftCreated')}</p>
      ) : (
        <div className="chat-card__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void create()}
          >
            {t('assistant.createDraft')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => document.getElementById('chat-panel-input')?.focus()}
          >
            {t('assistant.adjust')}
          </button>
        </div>
      )}
    </div>
  );
}
