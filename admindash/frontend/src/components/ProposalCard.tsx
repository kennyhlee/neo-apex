import { useState } from 'react';
import type { Proposal } from '../api/chat';
import { createEntity, createLead } from '../api/client';
import './ProposalCard.css';

export function ProposalCard(
  { proposal, tenantId, onDone }:
  { proposal: Proposal; tenantId: string; onDone: (msg: string) => void },
) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const confirm = async () => {
    setState('saving');
    try {
      if (proposal.action === 'create_lead') {
        await createLead(tenantId, proposal.fields);
      } else {
        await createEntity(tenantId, proposal.entity_type, proposal.fields, {});
      }
      setState('saved');
      onDone(`Created ${proposal.entity_type}: ${Object.values(proposal.fields).join(' ')}`);
    } catch {
      setState('idle');
      onDone(`Failed to create ${proposal.entity_type}.`);
    }
  };

  return (
    <div className="proposal-card">
      <div className="proposal-card__title">Confirm: create {proposal.entity_type}</div>
      <dl className="proposal-card__fields">
        {Object.entries(proposal.fields).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {proposal.duplicates.length > 0 && (
        <div className="proposal-card__warn">
          ⚠ {proposal.duplicates.length} possible duplicate(s) found.
        </div>
      )}
      {state === 'saved' ? (
        <div className="proposal-card__ok">✓ Created</div>
      ) : (
        <div className="proposal-card__actions">
          <button className="proposal-card__cancel" disabled={state === 'saving'}
            onClick={() => onDone('Cancelled.')}>Cancel</button>
          <button className="proposal-card__confirm" disabled={state === 'saving'}
            onClick={confirm}>{state === 'saving' ? 'Saving…' : 'Confirm'}</button>
        </div>
      )}
    </div>
  );
}
