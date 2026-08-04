// flow-runtime/src/blocks/MessageBlock.tsx
import type { FlowBlock } from '../types';
import { messageBody } from '../blockConfig';

export function MessageBlock({ block }: { block: FlowBlock }) {
  const paragraphs = messageBody(block).split('\n').filter((p) => p.trim() !== '');
  return (
    <div className="fr-message-body">
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}
